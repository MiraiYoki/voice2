// ╔══════════════════════════════════════════╗
// ║  9. UIController — 面板流 + 加入/离开       ║
// ╚══════════════════════════════════════════╝

import { state } from './state.js';
import { $, toast, simpleHash, showPanel, renderAllLogs, addLog, addChatBubble } from './utils.js';
import { ROOM_SIZE, MAP_THEMES } from './config.js';
import { connectLiveKit, toggleMic, updateMicUI, removePeer, stopDucking, stopQualityMonitor } from './audio.js';
import { stopPositionSync } from './netcode.js';
import { renderRoomList, setRoomWill, clearRoomWill, startRoomHeartbeat, stopRoomHeartbeat } from './registry.js';

// ── 9a. 加入房间 ──
export function joinRoom(asCreator) {
  const nameEl = $('create-name'), pwEl = $('create-pw');
  const roomName = (nameEl && nameEl.value) ? nameEl.value.trim() : '';
  if (!roomName) { toast('请输入房间名称'); return; }

  // 创建房间时检查重名
  if (asCreator && state.rooms.has(roomName)) {
    if (!confirm('房间 "' + roomName + '" 已存在，确定要加入已有房间？')) return;
  }

  const hasPassword = !!(pwEl && pwEl.value);
  const password = hasPassword ? pwEl.value : '';

  state.myPeerId = state.profileName || ('user-' + simpleHash(Date.now().toString()));
  state.currentRoom = roomName;
  state.isRoomCreator = asCreator;

  // 隐藏面板，显示游戏UI
  ['home-panel','room-panel','profile-panel','create-panel'].forEach(id => {
    const p = $(id); if (p) p.style.display = 'none';
  });
  $('room-title').textContent = roomName;
  $('status').textContent = '连接中...';
  $('self-name').textContent = state.profileName || '我';

  // 连接语音 + LWT遗嘱 + 显示按钮
  // MQTT 先发布 (用现有连接, 不重连)
  state.regMqtt.publish('voice-registry/' + roomName,
    JSON.stringify({ hasPassword, memberCount: 1, _ts: Date.now() }), { retain: true });

  connectLiveKit(roomName);
  startRoomHeartbeat();
  $('btn-leave-top').style.display = '';
}

// ── 9b. 离开房间 ──
export function leaveRoom() {
  if (!state.currentRoom) return;

  // _closing 先置 true，防止 MQTT 回弹触发二次确认
  state._closing = true;

  // 最后一人退出前确认，非最后更新人数
  if (state.regMqtt) {
    if (state.peers.size === 0) {
      if (!confirm('你是最后一个在线的人，退出后房间将消失。确定退出？')) {
        state._closing = false;  // 取消退出，重置
        return;
      }
      state.regMqtt.publish('voice-registry/' + state.currentRoom, '', { retain: true });
      addLog('conn', '🏚️ 最后一人退出，房间已销毁');
    } else {
      const info = state.rooms.get(state.currentRoom);
      state.regMqtt.publish('voice-registry/' + state.currentRoom,
        JSON.stringify({ hasPassword: info?.hasPassword || false, memberCount: state.peers.size }),
        { retain: true });
    }
  }
  state._lkRoomName = null;
  if (state._lkRoom) { try { state._lkRoom.disconnect(); } catch (e) {} state._lkRoom = null; }

  // 清理 peers
  for (const pid of state.peers.keys()) { removePeer(pid); }
  state.peers.clear();

  // 停同步 & ducking & 质量监控 & JWT定时器 & 心跳
  stopPositionSync();
  stopDucking();
  stopQualityMonitor();
  stopRoomHeartbeat();
  if (state._jwtRefreshTimer) { clearTimeout(state._jwtRefreshTimer); state._jwtRefreshTimer = null; }

  // 重置状态
  state.currentRoom = null;
  state.isRoomCreator = false;
  state.myPeerId = null;

  // 停音乐 + 关麦
  if (state._musicEl) { try { state._musicEl.pause(); state._musicEl.remove(); } catch(e) {} state._musicEl = null; }
  state._musicPlaying = false;
  if (state.localStream) {
    try { state.localStream.getAudioTracks().forEach(t => t.stop()); } catch (e) {}
    state.localStream = null;
    updateMicUI(false);
  }
  if (navigator.audioSession) { try { navigator.audioSession.type = 'playback'; } catch(e) {} }

  // 关 AudioContext
  if (state.audioCtx) { try { state.audioCtx.close(); } catch (e) {} state.audioCtx = null; }

  // 恢复 UI
  $('game-bar').style.display = 'none';
  $('map-wrap').style.display = 'none';
  const dot = $('conn-dot');
  if (dot) { dot.style.display = 'none'; dot.style.background = '#e04949'; }
  $('home-panel').style.display = '';
  $('btn-leave-top').style.display = 'none';
  $('room-title').textContent = '空间语音聊天室';
  $('status').textContent = '输入房间名加入';
  toast('已离开房间');
}

// ── 9c. 头像缩放 ──
function resizeAndSetAvatar(file) {
  if (!file) return;
  const img = new Image();
  img.onload = () => {
    const size = 64;
    const c = document.createElement('canvas');
    c.width = size; c.height = size;
    const ctx = c.getContext('2d');
    const min = Math.min(img.width, img.height);
    ctx.drawImage(img, (img.width-min)/2, (img.height-min)/2, min, min, 0, 0, size, size);
    const thumb = c.toDataURL('image/jpeg', 0.7);
    state.profileAvatar = thumb;
    localStorage.setItem('voice-profile-avatar', thumb);
    if (state.avatarImg) state.avatarImg.src = thumb;
    $('avatar-preview').innerHTML = '<img src="' + thumb + '" alt="头像预览" style="width:100%;height:100%;object-fit:cover">';
    $('home-avatar-ring').innerHTML = '<img src="' + thumb + '" alt="头像" style="width:100%;height:100%;object-fit:cover;border-radius:50%">';
    $('self-color').style.backgroundImage = 'url(' + thumb + ')';
    // 头像换了就发给所有人
    if (state._lkRoom && state.currentRoom) {
      import('./netcode.js').then(m => m.sendProfile(state._lkRoom));
    }
  };
  img.src = URL.createObjectURL(file);
}

// ── 9d. 所有 UI 事件绑定 ──
export function wireUI() {
  // 首页 → 创建房间
  $('btn-create-room-card').onclick = () => { showPanel('create-panel'); $('create-name').focus(); };
  $('create-back').onclick = () => showPanel('home-panel');
  $('btn-create-room').onclick = () => joinRoom(true);

  // 首页 → 查找房间
  $('btn-find-rooms').onclick = () => { showPanel('room-panel'); toast('房间数: ' + state.rooms.size); renderRoomList(); };
  $('room-back').onclick = () => showPanel('home-panel');
  $('room-search').oninput = () => renderRoomList();
  $('btn-refresh-rooms').onclick = () => { toast('刷新中...'); renderRoomList(); };

  // 首页 → 角色设置
  $('btn-profile').onclick = () => { showPanel('profile-panel'); $('profile-name').value = state.profileName; };
  $('profile-back').onclick = () => {
    state.profileName = $('profile-name').value.trim().slice(0, 12);
    localStorage.setItem('voice-profile-name', state.profileName);
    const hpn = $('home-profile-name'); if (hpn) hpn.textContent = state.profileName || '未设置角色';
    $('self-name').textContent = state.profileName || '我';
    showPanel('home-panel');
  };

  // 头像上传 (缩到 64x64，保证 DataChannel 能传输)
  $('avatar-upload').onchange = e => { resizeAndSetAvatar(e.target.files[0]); };
  $('game-avatar-upload').onchange = e => { resizeAndSetAvatar(e.target.files[0]); };

  // 游戏中按钮
  $('btn-mic').onclick = toggleMic;
  $('btn-leave-top').onclick = leaveRoom;

  // 菜单面板 (定位在按钮上方)
  $('btn-menu').onclick = () => {
    const p = $('menu-panel');
    if (!p) return;
    const isOpen = p.style.display === 'flex';
    if (isOpen) { p.style.display = 'none'; return; }
    fillMenuPanel();
    // 先显示再测量高度
    p.style.display = 'flex';
    p.style.visibility = 'hidden';
    const btn = $('btn-menu');
    const rect = btn.getBoundingClientRect();
    p.style.left = Math.max(4, rect.left - 70) + 'px';
    p.style.top = (rect.top - p.offsetHeight - 26) + 'px';
    p.style.bottom = 'auto'; p.style.right = 'auto';
    p.style.visibility = 'visible';
  };
  document.addEventListener('click', (e) => {
    const mp = $('menu-panel');
    if (!mp || mp.style.display !== 'flex') return;
    if (!mp.contains(e.target) && e.target !== $('btn-menu')) mp.style.display = 'none';
  });

  // 聊天
  $('btn-chat').onclick = () => {
    const bar = $('chat-bar');
    if (bar) { bar.style.display = bar.style.display === 'flex' ? 'none' : 'flex'; $('chat-input').focus(); }
  };
  $('btn-chat-send').onclick = sendChat;
  $('chat-input').onkeydown = e => { if (e.key === 'Enter') sendChat(); };

  // 点击名字改ID
  $('self-name').onclick = () => {
    const name = prompt('修改角色名称', state.profileName || '');
    if (name === null) return;
    state.profileName = name.trim().slice(0,12);
    localStorage.setItem('voice-profile-name', state.profileName);
    $('self-name').textContent = state.profileName || '我';
    const hpn = $('home-profile-name');
    if (hpn) hpn.textContent = state.profileName || '未设置角色';
  };

  wireDebugPanel();

  window.addEventListener('resize', () => {
    import('./renderer.js').then(m => { m.resizeCanvas(); m.drawMap(); });
  });
  window.addEventListener('beforeunload', () => { if (state.currentRoom) leaveRoom(); });
}

// ── 9e. 菜单面板 ──
function fillMenuPanel() {
  const panel = $('menu-panel');
  if (!panel) return;
  const items = [
    { id:'music', icon:'🎼', label:'音乐' },
    { id:'sfx', icon:'🔊', label:'音效' },
    { id:'voice', icon:'🎙️', label:'变声器' },
    { id:'fx', icon:'✨', label:'特效' },
    { id:'portal', icon:'🌀', label:'传送门' },
  ];
  if (state.isRoomCreator) items.push({ id:'theme', icon:'🗺️', label:'切换地图' });
  let html = items.map(i => '<button style="padding:6px 12px;border-radius:8px;border:none;background:var(--card);color:var(--text);font-size:12px;cursor:pointer;text-align:left" data-menu="'+i.id+'">'+i.icon+' '+i.label+'</button>').join('');
  // 音量滑块
  html += '<div style="border-top:1px solid var(--border);margin-top:6px;padding-top:6px">';
  html += '<div style="font-size:10px;color:var(--text2);margin-bottom:2px">🎼 音乐 ' + Math.round(state._musicVol*100) + '%</div>';
  html += '<input type="range" id="vol-music" min="0" max="100" value="' + Math.round(state._musicVol*100) + '" style="width:100%;accent-color:var(--accent)">';
  html += '<div style="font-size:10px;color:var(--text2);margin-bottom:2px;margin-top:4px">🔊 音效 ' + Math.round(state._sfxVol*100) + '%</div>';
  html += '<input type="range" id="vol-sfx" min="0" max="100" value="' + Math.round(state._sfxVol*100) + '" style="width:100%;accent-color:var(--accent)">';
  html += '</div>';
  panel.innerHTML = html;

  panel.querySelectorAll('button[data-menu]').forEach(b => {
    b.onclick = () => {
      if (b.dataset.menu === 'theme') showThemeModal();
      else if (b.dataset.menu === 'music') toggleMusicPlayer();
      else if (b.dataset.menu === 'sfx') openSfxBrowser();
      else if (b.dataset.menu === 'fx') openFxMenu();
      panel.style.display = 'none';
    };
  });

  // 音量滑块事件
  $('vol-music').oninput = function() {
    state._musicVol = this.value / 100;
    try { localStorage.setItem('voice-music-vol', state._musicVol); } catch(e) {}
    if (state._musicEl) state._musicEl.volume = state._musicVol;
    this.previousElementSibling.textContent = '🎼 音乐 ' + this.value + '%';
  };
  $('vol-sfx').oninput = function() {
    state._sfxVol = this.value / 100;
    try { localStorage.setItem('voice-sfx-vol', state._sfxVol); } catch(e) {}
    this.previousElementSibling.textContent = '🔊 音效 ' + this.value + '%';
  };
}

// 音乐播放器 (房主控制, 全场同步, 居中弹窗)
import { MUSIC_PLAYLIST } from './config.js';

function toggleMusicPlayer() {
  if (!state.isRoomCreator) { toast('仅房主可控制音乐'); return; }
  const modal = $('theme-modal');
  const backdrop = $('modal-backdrop');
  if (!modal || !backdrop) return;
  const isOpen = modal.style.display === 'flex';
  if (isOpen) { modal.style.display = 'none'; backdrop.style.display = 'none'; return; }
  modal.innerHTML = '<h3>🎼 全场音乐 (仅房主)</h3>'
    + MUSIC_PLAYLIST.map(s => '<button data-song="'+s.id+'">'+s.name+'</button>').join('')
    + '<div style="display:flex;gap:4px;margin-top:6px"><button id="btn-music-stop" style="background:var(--danger);padding:6px 12px;border-radius:8px;border:none;color:#fff;cursor:pointer;font-size:11px">⏹ 停止</button></div>';
  modal.querySelectorAll('[data-song]').forEach(b => {
    b.onclick = () => { sendMusicCmd('play', b.dataset.song); modal.style.display = 'none'; backdrop.style.display = 'none'; };
  });
  const stopBtn = document.getElementById('btn-music-stop');
  if (stopBtn) stopBtn.onclick = () => { sendMusicCmd('stop'); modal.style.display = 'none'; backdrop.style.display = 'none'; };
  modal.style.display = 'flex';
  backdrop.style.display = 'block';
  backdrop.onclick = () => { modal.style.display = 'none'; backdrop.style.display = 'none'; };
}

function sendMusicCmd(action, songId) {
  if (!state._lkRoom || !state._lkRoom.localParticipant) return;
  const enc = new TextEncoder();
  const now = Date.now();
  state._lkRoom.localParticipant.publishData(
    enc.encode(JSON.stringify({ channelId:'music', payload:{ action, songId, ts:now } })),
    { reliable: true }
  );
  // 自己也播放
  const song = MUSIC_PLAYLIST.find(s => s.id === songId);
  if (action === 'play' && song) {
    if (state._musicEl) { try { state._musicEl.pause(); state._musicEl.remove(); } catch(e) {} }
    const el = document.createElement('audio');
    el.src = song.src;
    el.volume = state._musicVol;
    el.loop = true;
    el.play().then(() => { state._musicEl = el; state._musicPlaying = true; }).catch(e => toast('音乐加载失败: ' + e.message));
  } else if (action === 'stop') {
    if (state._musicEl) { try { state._musicEl.pause(); state._musicEl.remove(); } catch(e) {} state._musicEl = null; }
    state._musicPlaying = false;
  }
}

// ── 9f. 主题弹窗 ──
function showThemeModal() {
  const modal = $('theme-modal');
  const backdrop = $('modal-backdrop');
  if (!modal || !backdrop) return;
  modal.innerHTML = '<h3>🗺️ 选择主题</h3>'
    + MAP_THEMES.map(t => '<button style="padding:8px 12px;border-radius:8px;border:1px solid var(--border);background:var(--card);color:var(--text);font-size:13px;cursor:pointer;text-align:center;'
      + (t.id===state.mapTheme?'background:var(--accent);border-color:var(--accent);':'')
      + '" data-theme="'+t.id+'">'+t.name+'</button>').join('');
  modal.querySelectorAll('button').forEach(b => {
    b.onclick = () => {
      const t = MAP_THEMES.find(th => th.id === b.dataset.theme);
      if (!t) return;
      state.mapTheme = t.id;
      try { localStorage.setItem('voice-map-theme', t.id); } catch(e) {}
      state.mapImg.src = t.src;
      state.mapImg.onload = () => {
        state.worldW = state.mapImg.naturalWidth || 1600; state.worldH = state.mapImg.naturalHeight || 1200;
        state.myPos.x = state.worldW / 2; state.myPos.y = state.worldH / 2;
      };
      toast('主题: ' + t.name); modal.style.display = 'none'; backdrop.style.display = 'none';
    };
  });
  modal.style.display = 'flex'; backdrop.style.display = 'block';
  backdrop.onclick = () => { modal.style.display = 'none'; backdrop.style.display = 'none'; };
}

// ── 9i. 特效菜单 ──
const FX_LIST = [
  { id:'petal', icon:'🌸', name:'花瓣雨' },
  { id:'meteor', icon:'🌠', name:'金色流星' },
  { id:'snow', icon:'❄️', name:'飘雪' },
  { id:'firefly', icon:'🪲', name:'萤火虫' },
  { id:'firework', icon:'🎆', name:'烟花' },
];

function openFxMenu() {
  const modal = $('theme-modal');
  const backdrop = $('modal-backdrop');
  if (!modal || !backdrop) return;
  modal.innerHTML = '<h3>✨ 特效</h3>'
    + FX_LIST.map(f => '<button data-fx="'+f.id+'">'+f.icon+' '+f.name+'</button>').join('');
  modal.querySelectorAll('button').forEach(b => {
    b.onclick = () => { broadcastFx(b.dataset.fx); modal.style.display = 'none'; backdrop.style.display = 'none'; };
  });
  modal.style.display = 'flex';
  backdrop.style.display = 'block';
  backdrop.onclick = () => { modal.style.display = 'none'; backdrop.style.display = 'none'; };
}

function broadcastFx(fxId) {
  import('./effects.js').then(m => m.triggerEffect(fxId));
  if (state._lkRoom && state._lkRoom.localParticipant) {
    const enc = new TextEncoder();
    state._lkRoom.localParticipant.publishData(
      enc.encode(JSON.stringify({ channelId:'fx', payload:{ fx:fxId } })),
      { reliable: true }
    );
  }
}

// ── 9j. 音效浏览器 (多级目录, 居中弹窗) ──
const SFX_TREE = [
  { name:'一、人物动作音效', children:[
    { name:'移动类', files:['缓步走路','快步走-赶路'] },
    { name:'.肢体接触拖拽类', files:[] },
    { name:'手部小动作', files:[] },
    { name:'坐卧躺类', files:[] },
  ]},
  { name:'三、武器械斗音效', children:[
    { name:'冷兵器', children:[
      { name:'刀剑', files:['出鞘','收剑','刺击','砍下','蓄力劈砍','刀剑碰撞短','刀剑碰撞长'] },
      { name:'鞭子', files:['鞭打一声','鞭打三声'] },
    ]},
    { name:'热武器', children:[
      { name:'手枪', files:['拔枪','上膛','单发枪声','连射'] },
      { name:'炸弹', files:['爆炸'] },
    ]},
    { name:'禁锢器械', files:[] },
  ]},
  { name:'二、语音情绪人声', children:[
    { name:'1.基础人声', files:[] },
    { name:'2.互动人声', files:[] },
  ]},
  { name:'四、道具生活物件', children:[
    { name:'1.通用小件', files:[] },
    { name:'2.古风专属', files:[] },
    { name:'3.民国专属', files:[] },
    { name:'4.现代专属', files:[] },
    { name:'5.未来赛博科幻', files:[] },
  ]},
  { name:'五、环境氛围音', children:[
    { name:'1.自然环境', files:[] },
    { name:'2.室内环境', files:[] },
    { name:'3.室外场景', files:[] },
    { name:'4.情绪氛围纯音效', files:[] },
  ]},
  { name:'六、场景互动特殊剧情', children:[
    { name:'1.门窗墙体', files:[] },
    { name:'2.坠落破碎坍塌', files:[] },
    { name:'3.生死离别高光', files:[] },
    { name:'4.仪式特殊桥段', files:[] },
  ]},
  { name:'七、动物音效', files:[] },
];

let _sfxStack = []; // 目录栈

function openSfxBrowser() {
  _sfxStack = [];
  showSfxLevel(SFX_TREE);
}

function showSfxLevel(nodes) {
  const modal = $('theme-modal');
  const backdrop = $('modal-backdrop');
  if (!modal || !backdrop) return;
  modal.style.display = 'flex';
  backdrop.style.display = 'block';
  backdrop.onclick = () => { modal.style.display = 'none'; backdrop.style.display = 'none'; };

  const path = _sfxStack.map(n => n.name).join(' › ') || '音效库';
  let html = '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">';
  if (_sfxStack.length > 0) {
    html += '<button id="sfx-back" style="padding:4px 8px;border-radius:6px;border:1px solid var(--border);background:var(--card);color:var(--text);cursor:pointer;font-size:12px">← 返回</button>';
  }
  html += '<h3 style="font-size:14px;margin:0">🔊 ' + path + '</h3>';
  html += '<button id="sfx-close" style="margin-left:auto;padding:4px 8px;border-radius:6px;border:1px solid var(--border);background:var(--card);color:var(--text);cursor:pointer;font-size:12px">✕</button></div>';

  for (const node of nodes) {
    const hasFiles = node.files && node.files.length > 0;
    const hasChildren = node.children && node.children.length > 0;
    if (hasFiles) {
      html += '<div style="font-size:12px;font-weight:600;color:var(--accent);margin:6px 0 2px">' + node.name + '</div>';
      for (const f of node.files) {
        // 构建文件路径: sfx/顶层/子层/.../文件名.mp3
        const segs = _sfxStack.map(n => n.name);
        segs.push(node.name);
        const src = 'sfx/' + segs.join('/') + '/' + f + '.mp3';
        html += '<button data-sfx="' + src + '" style="display:block;width:100%;padding:5px 8px;border-radius:6px;border:1px solid var(--border);background:var(--card);color:var(--text);font-size:11px;cursor:pointer;text-align:left;margin-bottom:2px">🔊 ' + f + '</button>';
      }
    }
    if (hasChildren) {
      html += '<button class="sfx-dir" style="display:block;width:100%;padding:6px 10px;border-radius:6px;border:1px solid var(--border);background:var(--card);color:var(--text);font-size:12px;cursor:pointer;text-align:left;margin-bottom:2px">📁 ' + node.name + '</button>';
    } else if (!hasFiles) {
      html += '<div style="font-size:11px;color:var(--text2);padding:4px 8px">' + node.name + ' (空)</div>';
    }
  }
  modal.innerHTML = html;

  // wire buttons
  const backBtn = document.getElementById('sfx-back');
  if (backBtn) backBtn.onclick = () => { _sfxStack.pop(); showSfxLevel(_sfxStack.length === 0 ? SFX_TREE : _sfxStack[_sfxStack.length-1].children); };
  const closeBtn = document.getElementById('sfx-close');
  if (closeBtn) closeBtn.onclick = () => { modal.style.display = 'none'; backdrop.style.display = 'none'; };

  modal.querySelectorAll('.sfx-dir').forEach(btn => {
    const nodeName = btn.textContent.replace('📁 ','');
    const node = nodes.find(n => n.name === nodeName);
    btn.onclick = () => { _sfxStack.push(node); showSfxLevel(node.children); };
  });
  modal.querySelectorAll('[data-sfx]').forEach(btn => {
    btn.onclick = () => { playSfx(btn.dataset.sfx); };
  });
}

let _sfxEl = null;  // 全局唯一音效元素

function playSfx(src) {
  // 互斥保护: 停掉上一个
  if (_sfxEl) { try { _sfxEl.pause(); _sfxEl.remove(); } catch(e) {} _sfxEl = null; }
  const el = document.createElement('audio');
  el.src = src;
  el.volume = state._sfxVol;
  el.play().catch(() => {});
  _sfxEl = el;
  // 广播给其他人
  if (state._lkRoom && state._lkRoom.localParticipant) {
    const enc = new TextEncoder();
    state._lkRoom.localParticipant.publishData(
      enc.encode(JSON.stringify({ channelId:'sfx', payload:{ src } })),
      { reliable: true }
    );
  }
}

// ── 9g. 聊天 ──
function sendChat() {
  const input = $('chat-input');
  if (!input || !input.value.trim()) return;
  const text = input.value.trim().slice(0, 60);
  input.value = '';
  addChatBubble(state.myPeerId, text);
  if (state._lkRoom && state._lkRoom.localParticipant) {
    try {
      const enc = new TextEncoder();
      state._lkRoom.localParticipant.publishData(
        enc.encode(JSON.stringify({ channelId:'chat', payload:{ text } })),
        { reliable: true }
      );
    } catch(e) {}
  }
}

// ── 9h. 调试面板 ──
function wireDebugPanel() {
  const btns = { 'debug-filter-all':'all','debug-filter-conn':'conn','debug-filter-audio':'audio','debug-filter-pos':'pos','debug-filter-avatar':'avatar' };
  for (const [id, cat] of Object.entries(btns)) {
    const btn = $(id); if (!btn) continue;
    btn.onclick = () => {
      Object.keys(btns).forEach(bid => { const b = $(bid); if (b) b.style.background = 'var(--card)'; });
      btn.style.background = 'var(--accent)'; renderAllLogs(cat);
    };
  }
  $('debug-close').onclick = () => { const p = $('debug-panel'); if (p) p.style.display = 'none'; };
}
