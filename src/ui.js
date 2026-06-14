// ╔══════════════════════════════════════════╗
// ║  9. UIController — 面板流 + 加入/离开       ║
// ╚══════════════════════════════════════════╝

import { state } from './state.js';
import { $, toast, simpleHash, showPanel, renderAllLogs, addLog, addChatBubble } from './utils.js';
import { ROOM_SIZE, MAP_THEMES } from './config.js';
import { connectLiveKit, toggleMic, updateMicUI, removePeer, stopDucking, stopQualityMonitor } from './audio.js';
import { stopPositionSync } from './netcode.js';
import { renderRoomList, setRoomWill, clearRoomWill } from './registry.js';

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

  // MQTT 注册
  state.regMqtt.publish('voice-registry/' + roomName,
    JSON.stringify({ hasPassword, memberCount: 1, _ts: Date.now() }), { retain: true });

  // 隐藏面板，显示游戏UI
  ['home-panel','room-panel','profile-panel','create-panel'].forEach(id => {
    const p = $(id); if (p) p.style.display = 'none';
  });
  $('room-title').textContent = roomName;
  $('status').textContent = '连接中...';
  $('self-name').textContent = state.profileName || '我';

  // 连接语音 + LWT遗嘱 + 显示按钮
  connectLiveKit(roomName);
  setRoomWill(roomName);
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

  // 停同步 & ducking & 质量监控 & JWT定时器
  stopPositionSync();
  stopDucking();
  stopQualityMonitor();
  if (state._jwtRefreshTimer) { clearTimeout(state._jwtRefreshTimer); state._jwtRefreshTimer = null; }

  // 重置状态
  state.currentRoom = null;
  state.isRoomCreator = false;
  state.myPeerId = null;

  // 清除LWT遗嘱 + 关麦
  clearRoomWill();
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
    p.style.top = (rect.top - p.offsetHeight - 16) + 'px';
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
    { id:'sound', icon:'🎵', label:'音效' },
    { id:'voice', icon:'🎙️', label:'变声器' },
    { id:'fx', icon:'✨', label:'特效' },
    { id:'portal', icon:'🌀', label:'传送门' },
  ];
  if (state.isRoomCreator) items.push({ id:'theme', icon:'🗺️', label:'切换地图' });
  panel.innerHTML = items.map(i => '<button style="padding:6px 12px;border-radius:8px;border:none;background:var(--card);color:var(--text);font-size:12px;cursor:pointer;text-align:left" data-menu="'+i.id+'">'+i.icon+' '+i.label+'</button>').join('');
  panel.querySelectorAll('button').forEach(b => {
    b.onclick = () => {
      if (b.dataset.menu === 'theme') showThemeModal();
      else toast(b.textContent + ' (即将推出)');
      panel.style.display = 'none';
    };
  });
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
