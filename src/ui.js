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

let _stereoOsc = null, _stereoGain = null, _stereoCleanup = null;
function wireStereoTest() {
  const status = $('stereo-test-status');
  const setStatus = (s) => { if (status) status.textContent = s; };

  function stopTest() {
    if (_stereoCleanup) { try { _stereoCleanup(); } catch(e) {} _stereoCleanup = null; }
    if (_stereoGain) { try { _stereoGain.disconnect(); } catch(e) {} _stereoGain = null; }
    if (_stereoOsc) { try { _stereoOsc.stop(); _stereoOsc.disconnect(); } catch(e) {} _stereoOsc = null; }
    setStatus('点击按钮播放测试音');
  }

  function getCtx() {
    const ctx = state.audioCtx || new AudioContext();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function makeOsc(ctx, freq) {
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = freq;
    return o;
  }

  function diagInfo(ctx) {
    const d = ctx.destination;
    return 'ctx=' + ctx.state + ' dstCh=' + d.channelCount + ' maxCh=' + d.maxChannelCount;
  }

  // 方法1: 硬切左→右 (左右分别发不同频率)
  function test_hardLR() {
    stopTest();
    const ctx = getCtx();
    const oscL = makeOsc(ctx, 330);  // E4
    const oscR = makeOsc(ctx, 660);  // E5
    const gain = ctx.createGain(); gain.gain.value = 0.08;
    const merger = ctx.createChannelMerger(2);
    oscL.connect(merger, 0, 0);
    oscR.connect(merger, 0, 1);
    merger.connect(gain).connect(ctx.destination);
    oscL.start(); oscR.start();
    _stereoOsc = oscL;
    _stereoGain = gain;
    setStatus('🔊 硬切: 左耳330Hz 右耳660Hz | ' + diagInfo(ctx));
    _stereoCleanup = () => { oscL.stop(); oscR.stop(); oscL.disconnect(); oscR.disconnect(); merger.disconnect(); };
  }

  // 方法2: StereoPanner 慢扫
  function test_stereoPanner() {
    stopTest();
    const ctx = getCtx();
    const osc = makeOsc(ctx, 440);
    const gain = ctx.createGain(); gain.gain.value = 0.1;
    const pan = ctx.createStereoPanner();
    osc.connect(pan).connect(gain).connect(ctx.destination);
    let t = 0;
    const iv = setInterval(() => { t += 0.015; pan.pan.value = Math.sin(t); }, 30);
    _stereoOsc = osc; _stereoGain = gain;
    setStatus('🔊 StereoPanner慢扫 | ' + diagInfo(ctx));
    _stereoCleanup = () => { clearInterval(iv); osc.stop(); osc.disconnect(); pan.disconnect(); };
  }

  // 方法3: AudioBuffer 双声道硬数据
  function test_audioBuffer() {
    stopTest();
    const ctx = getCtx();
    const sr = ctx.sampleRate;
    const dur = 9999;
    const buf = ctx.createBuffer(2, sr * dur, sr);
    const L = buf.getChannelData(0), R = buf.getChannelData(1);
    for (let i = 0; i < L.length; i++) {
      const t = i / sr;
      L[i] = 0.08 * Math.sin(2 * Math.PI * 330 * t);
      R[i] = 0.08 * Math.sin(2 * Math.PI * 660 * t);
    }
    const src = ctx.createBufferSource(); src.buffer = buf;
    src.connect(ctx.destination);
    src.start();
    _stereoOsc = { stop: () => src.stop(), disconnect: () => src.disconnect() };
    setStatus('🔊 AudioBuffer硬立体声 L330Hz R660Hz | ' + diagInfo(ctx));
    _stereoCleanup = () => { src.stop(); src.disconnect(); };
  }

  // 方法4: 强制destination为双声道 + ChannelMerger
  function test_forceDest() {
    stopTest();
    const ctx = getCtx();
    ctx.destination.channelCount = 2;
    ctx.destination.channelCountMode = 'explicit';
    ctx.destination.channelInterpretation = 'discrete';
    const oscL = makeOsc(ctx, 440);
    const oscR = makeOsc(ctx, 880);
    const gain = ctx.createGain(); gain.gain.value = 0.06;
    const merger = ctx.createChannelMerger(2);
    oscL.connect(merger, 0, 0);
    oscR.connect(merger, 0, 1);
    merger.connect(gain).connect(ctx.destination);
    oscL.start(); oscR.start();
    _stereoOsc = oscL; _stereoGain = gain;
    setStatus('🔊 强制dest=2ch L440Hz R880Hz | ' + diagInfo(ctx));
    _stereoCleanup = () => { oscL.stop(); oscR.stop(); oscL.disconnect(); oscR.disconnect(); merger.disconnect(); };
  }

  // 方法5: Haas效应 (声道间延迟)
  function test_haas() {
    stopTest();
    const ctx = getCtx();
    const osc = makeOsc(ctx, 440);
    const gain = ctx.createGain(); gain.gain.value = 0.08;
    const split = ctx.createChannelSplitter(2);
    const merge = ctx.createChannelMerger(2);
    const delayR = ctx.createDelay(0.001);
    delayR.delayTime.value = 0;
    osc.connect(split);
    split.connect(merge, 0, 0);
    split.connect(delayR, 1);
    delayR.connect(merge, 0, 1);
    merge.connect(gain).connect(ctx.destination);
    let t = 0;
    const iv = setInterval(() => { t += 0.02; delayR.delayTime.value = (0.1 + (Math.sin(t)+1)*0.45) / 1000; }, 30);
    _stereoOsc = osc; _stereoGain = gain;
    setStatus('🔊 Haas延迟 0.1~1.0ms | ' + diagInfo(ctx));
    _stereoCleanup = () => { clearInterval(iv); osc.stop(); osc.disconnect(); split.disconnect(); delayR.disconnect(); merge.disconnect(); };
  }

  // 方法6: 纯增益左右切 (不依赖任何panner)
  function test_gainLR() {
    stopTest();
    const ctx = getCtx();
    const oscL = makeOsc(ctx, 440);
    const oscR = makeOsc(ctx, 880);
    const gain = ctx.createGain(); gain.gain.value = 0.06;
    const merger = ctx.createChannelMerger(2);
    oscL.connect(merger, 0, 0);
    oscR.connect(merger, 0, 1);
    merger.connect(gain).connect(ctx.destination);
    oscL.start(); oscR.start();
    let t = 0;
    const iv = setInterval(() => { t += 0.02; const v = Math.sin(t); oscL.frequency.value = 440 + 220*v; oscR.frequency.value = 440 - 220*v; }, 30);
    _stereoOsc = oscL; _stereoGain = gain;
    setStatus('🔊 纯增益: 双osc左右不同频 | ' + diagInfo(ctx));
    _stereoCleanup = () => { clearInterval(iv); oscL.stop(); oscR.stop(); oscL.disconnect(); oscR.disconnect(); merger.disconnect(); };
  }

  // 一键测试所有, 自动轮换
  const tests = [test_hardLR, test_stereoPanner, test_audioBuffer, test_forceDest, test_haas, test_gainLR];
  const names = ['硬切LR', 'StereoPanner', 'AudioBuffer', '强制Dest', 'Haas延迟', '纯增益'];
  let autoIdx = -1;
  function runAll() {
    stopTest();
    autoIdx = (autoIdx + 1) % tests.length;
    tests[autoIdx]();
    setStatus('▶ [' + (autoIdx+1) + '/' + tests.length + '] ' + names[autoIdx] + ' — ' + diagInfo(getCtx()));
  }

  $('stereo-test-a')?.addEventListener('click', test_hardLR);
  $('stereo-test-b')?.addEventListener('click', test_forceDest);
  $('stereo-test-c')?.addEventListener('click', test_audioBuffer);
  $('stereo-test-d')?.addEventListener('click', runAll);
  $('stereo-test-stop')?.addEventListener('click', () => { autoIdx = -1; stopTest(); });
}
