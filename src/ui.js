// ╔══════════════════════════════════════════╗
// ║  9. UIController — 面板流 + 加入/离开       ║
// ╚══════════════════════════════════════════╝

import { state } from './state.js';
import { $, toast, simpleHash, showPanel, renderAllLogs, addLog } from './utils.js';
import { ROOM_SIZE } from './config.js';
import { connectLiveKit, toggleMic, updateMicUI, removePeer, stopDucking, stopQualityMonitor } from './audio.js';
import { stopPositionSync } from './netcode.js';
import { renderRoomList } from './registry.js';

// ── 9a. 加入房间 ──
export function joinRoom(asCreator) {
  const nameEl = $('create-name'), pwEl = $('create-pw');
  const roomName = (nameEl && nameEl.value) ? nameEl.value.trim() : '';
  if (!roomName) { toast('请输入房间名称'); return; }
  const hasPassword = !!(pwEl && pwEl.value);
  const password = hasPassword ? pwEl.value : '';

  state.myPeerId = state.profileName || ('user-' + simpleHash(Date.now().toString()));
  state.currentRoom = roomName;
  state.isRoomCreator = asCreator;

  // MQTT 注册
  state.regMqtt.publish('voice-registry/' + roomName,
    JSON.stringify({ hasPassword, memberCount: 1 }), { retain: true });

  // 隐藏面板，显示游戏UI
  ['home-panel','room-panel','profile-panel','create-panel'].forEach(id => {
    const p = $(id); if (p) p.style.display = 'none';
  });
  $('room-title').textContent = roomName;
  $('status').textContent = '连接中...';
  $('self-name').textContent = state.profileName || '我';

  // 连接语音
  connectLiveKit(roomName);
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

  // 关麦克风
  if (state.localStream) {
    try { state.localStream.getAudioTracks().forEach(t => t.stop()); } catch (e) {}
    state.localStream = null;
    updateMicUI(false);
  }

  // 关 AudioContext
  if (state.audioCtx) { try { state.audioCtx.close(); } catch (e) {} state.audioCtx = null; }

  // 恢复 UI
  $('game-bar').style.display = 'none';
  $('map-wrap').style.display = 'none';
  const dot = $('conn-dot');
  if (dot) { dot.style.display = 'none'; dot.style.background = '#e04949'; }
  $('home-panel').style.display = '';
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
  $('btn-leave').onclick = leaveRoom;
  $('btn-debug').onclick = toggleDebugPanel;

  // 调试面板内部按钮
  wireDebugPanel();

  // 全局
  window.addEventListener('resize', () => {
    // resizeCanvas() 由 renderer.js export，此处延迟导入避免循环
    import('./renderer.js').then(m => { m.resizeCanvas(); m.drawMap(); });
  });
  window.addEventListener('beforeunload', () => { if (state.currentRoom) leaveRoom(); });
}

// ── 9e. 调试面板 ──
function toggleDebugPanel() {
  const panel = $('debug-panel');
  if (!panel) return;
  const isOpen = panel.style.display === 'flex';
  panel.style.display = isOpen ? 'none' : 'flex';
  if (!isOpen) {
    renderAllLogs('all');
    // 高亮"全部"按钮
    $('debug-filter-all').style.background = 'var(--accent)';
  }
}

function wireDebugPanel() {
  const btns = {
    'debug-filter-all': 'all',
    'debug-filter-conn': 'conn',
    'debug-filter-audio': 'audio',
    'debug-filter-pos': 'pos',
    'debug-filter-avatar': 'avatar',
  };
  for (const [id, cat] of Object.entries(btns)) {
    const btn = $(id);
    if (!btn) continue;
    btn.onclick = () => {
      // 重置所有按钮样式
      Object.keys(btns).forEach(bid => {
        const b = $(bid);
        if (b) b.style.background = 'var(--card)';
      });
      btn.style.background = 'var(--accent)';
      renderAllLogs(cat);
    };
  }
  $('debug-close').onclick = () => {
    const panel = $('debug-panel');
    if (panel) panel.style.display = 'none';
  };

  // 立体声测试
  wireStereoTest();
}

let _stereoCleanup = null;
function wireStereoTest() {
  const status = $('stereo-test-status');
  const setStatus = (s) => { if (status) status.textContent = s; };

  function stopTest() {
    if (_stereoCleanup) { try { _stereoCleanup(); } catch(e) {} _stereoCleanup = null; }
    setStatus('就绪');
  }

  function getCtx() {
    const ctx = new AudioContext();
    if (ctx.state === 'suspended') ctx.resume();
    // 强制 playback 模式
    if (navigator.audioSession) {
      try { navigator.audioSession.type = 'playback'; } catch(e) {}
    }
    return ctx;
  }

  function diagInfo(ctx) {
    const d = ctx.destination;
    const a = navigator.audioSession;
    const mic = state.localStream ? 'mic=on' : 'mic=off';
    return mic + ' ch=' + d.channelCount + '/' + d.maxChannelCount
      + (a ? ' sess=' + (a.type || '?') : '');
  }

  // 测试: HTMLAudioElement 播放嵌入立体声 (绕过WebAudio, 最接近系统层)
  function test_htmlAudio() {
    stopTest();
    // 生成一个立体声 WAV 的 data URL: 左440Hz 右880Hz, 各0.1s
    // 1s左, 1s右交替
    const sr = 44100;
    const dur = 2; // 2秒: 1s左 1s右
    const samples = sr * dur;
    const buf = new ArrayBuffer(44 + samples * 4); // 16-bit stereo
    const v = new DataView(buf);
    // WAV header
    const w = (s, o) => { for(let i=0;i<s.length;i++) v.setUint8(o+i, s.charCodeAt(i)); };
    w('RIFF', 0); v.setUint32(4, 36+samples*4, true); w('WAVE', 8);
    w('fmt ', 12); v.setUint32(16, 16, true); v.setUint16(20, 1, true); // PCM
    v.setUint16(22, 2, true); v.setUint32(24, sr, true); // stereo, sr
    v.setUint32(28, sr*4, true); v.setUint16(32, 4, true); v.setUint16(34, 16, true);
    w('data', 36); v.setUint32(40, samples*4, true);
    for (let i = 0; i < samples; i++) {
      const sec = Math.floor(i / sr); // 0 or 1
      const t = i / sr;
      const amp = 0.3;
      const sL = sec === 0 ? Math.sin(2*Math.PI*440*t) * amp : 0;
      const sR = sec === 1 ? Math.sin(2*Math.PI*880*t) * amp : 0;
      v.setInt16(44 + i*4, sL * 32767, true);
      v.setInt16(44 + i*4 + 2, sR * 32767, true);
    }
    const blob = new Blob([buf], { type: 'audio/wav' });
    const url = URL.createObjectURL(blob);
    const el = document.createElement('audio');
    el.src = url;
    el.loop = true;
    el.play().catch(e => setStatus('HTMLAudio play失败: ' + e.message));
    setStatus('HTMLAudio WAV | 左耳1s440Hz 右耳1s880Hz | ' + diagInfo(null));
    _stereoCleanup = () => { el.pause(); el.remove(); URL.revokeObjectURL(url); };
  }

  // 左右轮播器: 每秒切换左右, 播放 beep 音
  // method: 'panner' | 'merger' | 'buffer' | 'haas' | 'forceDest'
  function startLRTest(method) {
    stopTest();
    const ctx = getCtx();
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = 440;
    const g = ctx.createGain();
    g.gain.value = 0.12;

    let pan, merger, split, delayR, bufSrc;
    let side = 0; // 0=左, 1=右
    const names = { panner:'StereoPanner', merger:'ChannelMerger', buffer:'AudioBuffer', haas:'Haas延迟', forceDest:'强制Dest' };

    if (method === 'forceDest') {
      ctx.destination.channelCount = 2;
      ctx.destination.channelCountMode = 'explicit';
      ctx.destination.channelInterpretation = 'discrete';
      merger = ctx.createChannelMerger(2);
    }

    if (method === 'panner') {
      pan = ctx.createStereoPanner();
      osc.connect(pan).connect(g).connect(ctx.destination);
    } else if (method === 'merger') {
      merger = ctx.createChannelMerger(2);
      osc.connect(merger, 0, 0);
      osc.connect(merger, 0, 1);
      merger.connect(g).connect(ctx.destination);
    } else if (method === 'buffer') {
      bufSrc = ctx.createBufferSource();
      const sr = ctx.sampleRate;
      const buf = ctx.createBuffer(2, sr * 9999, sr);
      for (let i = 0; i < sr; i++) {
        buf.getChannelData(0)[i] = 0.12 * Math.sin(2*Math.PI*440*i/sr);
        buf.getChannelData(1)[i] = 0;
      }
      bufSrc.buffer = buf;
      bufSrc.loop = true;
      bufSrc.connect(ctx.destination);
      bufSrc.start();
    } else if (method === 'haas') {
      split = ctx.createChannelSplitter(2);
      merger = ctx.createChannelMerger(2);
      delayR = ctx.createDelay(0.001);
      delayR.delayTime.value = 0.0005; // 0.5ms
      osc.connect(split);
      split.connect(merger, 0, 0);
      split.connect(delayR, 1);
      delayR.connect(merger, 0, 1);
      merger.connect(g).connect(ctx.destination);
    } else if (method === 'forceDest') {
      osc.connect(merger, 0, 0);
      osc.connect(merger, 0, 1);
      merger.connect(g).connect(ctx.destination);
    }

    // 每秒切换左右
    const iv = setInterval(() => {
      side = 1 - side;
      if (method === 'panner') {
        pan.pan.value = side ? 1 : -1;
      } else if (method === 'merger' || method === 'forceDest') {
        // 断开旧连接, 重新连到目标声道
        osc.disconnect();
        if (merger) {
          osc.connect(merger, 0, side);
          setStatus(names[method] + ' | ▶ ' + (side?'右耳':'左耳') + ' | ' + diagInfo(ctx));
        }
      } else if (method === 'buffer') {
        const sr = ctx.sampleRate;
        const buf = ctx.createBuffer(2, sr * 9999, sr);
        for (let i = 0; i < sr; i++) {
          buf.getChannelData(side)[i] = 0.12 * Math.sin(2*Math.PI*440*i/sr);
          buf.getChannelData(1-side)[i] = 0;
        }
        bufSrc.stop();
        bufSrc.disconnect();
        bufSrc = ctx.createBufferSource();
        bufSrc.buffer = buf;
        bufSrc.loop = true;
        bufSrc.connect(ctx.destination);
        bufSrc.start();
        setStatus(names[method] + ' | ▶ ' + (side?'右耳':'左耳') + ' | ' + diagInfo(ctx));
      } else if (method === 'haas') {
        delayR.delayTime.value = side ? 0.0005 : 0;
        setStatus(names[method] + ' | delay=' + (side?'0.5ms→左先右后':'0ms→同到') + ' | ' + diagInfo(ctx));
      }
      if (method === 'panner' || method === 'haas') {
        setStatus(names[method] + ' | ▶ ' + (side?'右耳':'左耳') + ' | ' + diagInfo(ctx));
      }
    }, 800);

    osc.start();
    _stereoCleanup = () => {
      clearInterval(iv);
      try { osc.stop(); osc.disconnect(); } catch(e) {}
      try { if(pan) pan.disconnect(); } catch(e) {}
      try { if(merger) merger.disconnect(); } catch(e) {}
      try { if(split) split.disconnect(); } catch(e) {}
      try { if(delayR) delayR.disconnect(); } catch(e) {}
      try { if(bufSrc) { bufSrc.stop(); bufSrc.disconnect(); } } catch(e) {}
    };
    setStatus(names[method] + ' | ▶ 左耳 | ' + diagInfo(ctx));
  }

  $('stereo-test-a')?.addEventListener('click', () => startLRTest('panner'));
  $('stereo-test-b')?.addEventListener('click', () => startLRTest('merger'));
  $('stereo-test-c')?.addEventListener('click', () => startLRTest('haas'));
  $('stereo-test-d')?.addEventListener('click', () => startLRTest('buffer'));
  $('stereo-test-e')?.addEventListener('click', () => startLRTest('forceDest'));
  $('stereo-test-f')?.addEventListener('click', test_htmlAudio);
  $('stereo-test-stop')?.addEventListener('click', stopTest);
}
