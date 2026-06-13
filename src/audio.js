// ╔══════════════════════════════════════════╗
// ║  5. AudioController (LiveKit + 空间音频)   ║
// ╚══════════════════════════════════════════╝
// v2.3.2 — 修复4个音频bug + 接入统一调试日志

import { Room, LocalAudioTrack } from 'livekit-client';
import { state } from './state.js';
import { $, toast, addLog, statusLog } from './utils.js';
import { updateRoomCount } from './registry.js';
import { startPositionSync, sendProfile } from './netcode.js';
import {
  LIVEKIT_URL, LIVEKIT_KEY, LIVEKIT_SECRET,
  ROOM_SIZE, COLORS,
  PANNER_REF_DISTANCE, PANNER_MAX_DISTANCE, PANNER_ROLLOFF_FACTOR, EARSHOT_RADIUS,
  SUBSCRIBE_IN, UNSUBSCRIBE_OUT,
} from './config.js';

// ── 5a. JWT生成 (浏览器WebCrypto) ──
function b64u(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

export async function makeLKToken(identity, room) {
  try {
    const hdr = { alg: 'HS256', typ: 'JWT' };
    const now = Math.floor(Date.now() / 1000);
    const pld = {
      iss: LIVEKIT_KEY, sub: identity, nbf: now, exp: now + 86400,
      video: { room, roomJoin: true, canPublish: true, canSubscribe: true },
    };
    const enc = new TextEncoder();
    const h = b64u(JSON.stringify(hdr));
    const p = b64u(JSON.stringify(pld));
    const keyData = enc.encode(LIVEKIT_SECRET);
    const key = await crypto.subtle.importKey('raw', keyData,
      { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = await crypto.subtle.sign('HMAC', key, enc.encode(h + '.' + p));
    const arr = new Uint8Array(sig);
    let bin = '';
    for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
    const s = btoa(bin).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    return h + '.' + p + '.' + s;
  } catch (e) {
    addLog('err', 'Token生成失败: ' + e.message);
    throw e;
  }
}

// ── 5b. 空间音频管线 ──
const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);

export async function setupAudioNodes(pid, remoteStream) {
  if (!state.audioCtx) {
    addLog('err', 'setupAudioNodes: 无AudioContext');
    return;
  }

  // BUGFIX 1: await resume() — 之前没等异步完成就继续了
  if (state.audioCtx.state === 'suspended') {
    try {
      await state.audioCtx.resume();
      addLog('audio', 'AudioContext已恢复 → ' + state.audioCtx.state);
    } catch (e) {
      addLog('err', 'AudioContext恢复失败: ' + e.message);
      return;
    }
  }

  let info = state.peers.get(pid);
  if (!info) {
    info = { x: ROOM_SIZE / 2, y: ROOM_SIZE / 2 };
    state.peers.set(pid, info);
  }

  // BUGFIX 2: 重连时清理旧音频管线再重建，而不是直接 return
  if (info.stream) {
    addLog('audio', pid.slice(0,8) + ' 重连，清理旧音频节点');
    try { if (info.source) info.source.disconnect(); } catch (e) {}
    try { if (info.panner) info.panner.disconnect(); } catch (e) {}
    try { if (info.gainNode) info.gainNode.disconnect(); } catch (e) {}
    try { if (info._audioEl) { info._audioEl.srcObject = null; info._audioEl.remove(); } } catch (e) {}
    info.stream = null;
    info.source = null;
    info.panner = null;
    info.gainNode = null;
    info._audioEl = null;
  }

  info.stream = remoteStream;
  addLog('audio', '🎧 设置音频节点: ' + pid.slice(0,8) + ' ctx=' + state.audioCtx.state);

  // 检查远端音轨状态
  const audioTracks = remoteStream.getAudioTracks();
  addLog('audio', '音轨数: ' + audioTracks.length + ' 启用: ' + (audioTracks[0]?.enabled ?? '?'));

  // BUGFIX 4: play 失败后绑定用户手势重试
  const audioEl = document.createElement('audio');
  audioEl.muted = true;
  audioEl.srcObject = remoteStream;
  let playOk = false;
  try {
    await audioEl.play();
    playOk = true;
  } catch (e) {
    addLog('audio', '⚠️ play被拒: ' + e.message + ' — 等待用户交互');
  }
  if (!playOk) {
    // 绑定一次性重试：任意点击/触摸后恢复播放
    const retry = async () => {
      try { await audioEl.play(); addLog('audio', '🎧 play重试成功'); }
      catch (e2) { addLog('err', '🎧 play重试仍失败: ' + e2.message); }
    };
    ['click','touchstart','keydown'].forEach(evt =>
      document.addEventListener(evt, retry, { once: true }));
    // 同时立即重试一次（如果 AudioContext resume 已经解开了 autoplay 锁）
    setTimeout(retry, 500);
  }
  info._audioEl = audioEl;

  const src = state.audioCtx.createMediaStreamSource(remoteStream);

  // AnalyserNode 诊断
  const diagA = state.audioCtx.createAnalyser();
  diagA.fftSize = 256;
  const diagBuf = new Uint8Array(diagA.frequencyBinCount);
  src.connect(diagA);
  let diagTicks = 0;
  const diagTimer = setInterval(() => {
    diagA.getByteFrequencyData(diagBuf);
    const avg = diagBuf.reduce((a,b)=>a+b,0)/diagBuf.length;
    if (diagTicks++ < 5) addLog('audio', '🎵 远端音量[' + pid.slice(0,6) + ']: ' + avg.toFixed(1));
    if (diagTicks === 10) clearInterval(diagTimer);
  }, 500);

  if (isIOS) {
    const gain = state.audioCtx.createGain();
    gain.gain.value = 1;
    src.connect(gain).connect(state.audioCtx.destination);
    info.gainNode = gain;
    info._isIOS = true;
    addLog('audio', 'iOS模式: 距离衰减 (无HRTF)');
  } else {
    const panner = state.audioCtx.createPanner();
    const gain = state.audioCtx.createGain();

    panner.panningModel = 'HRTF';
    panner.distanceModel = 'exponential';
    panner.refDistance = PANNER_REF_DISTANCE;
    panner.maxDistance = PANNER_MAX_DISTANCE;
    panner.rolloffFactor = PANNER_ROLLOFF_FACTOR;
    panner.coneOuterAngle = 360;
    panner.coneInnerAngle = 360;
    panner.coneOuterGain = 1;

    const rx = info.x - state.myPos.x;
    const ry = info.y - state.myPos.y;
    if (panner.positionX) {
      panner.positionX.setValueAtTime(rx, 0);
      panner.positionZ.setValueAtTime(ry, 0);
    } else {
      panner.setPosition(rx, 0, ry);
    }

    src.connect(panner);
    panner.connect(gain);

    const volA = state.audioCtx.createAnalyser();
    volA.fftSize = 256;
    gain.connect(volA);
    volA.connect(state.audioCtx.destination);

    info.source = src;
    info.panner = panner;
    info.gainNode = gain;
    info._volBuf = new Uint8Array(volA.frequencyBinCount);
    info.smoothedVol = 0;

    (function tick() {
      if (!state.peers.has(pid)) return;
      volA.getByteFrequencyData(info._volBuf);
      const avg = info._volBuf.reduce((a, b) => a + b, 0) / info._volBuf.length;
      info.smoothedVol = info.smoothedVol * 0.6 + avg * 0.4;
      requestAnimationFrame(tick);
    })();

    addLog('audio', '桌面端HRTF管线完成: ' + pid.slice(0,8));
  }

  updateSpatialAudio();
}

// ── 5c. 空间位置更新 ──
export function updateSpatialAudio() {
  if (!state.audioCtx) return;
  for (const [pid, p] of state.peers) {
    const rx = p.x - state.myPos.x;
    const ry = p.y - state.myPos.y;
    const tNow = state.audioCtx.currentTime;

    if (p._isIOS) {
      const dist = Math.sqrt(rx * rx + ry * ry);
      let vol;
      if (dist < PANNER_REF_DISTANCE) vol = 1;
      else if (dist > PANNER_MAX_DISTANCE) vol = 0;
      else vol = 1 - (dist - PANNER_REF_DISTANCE) / (PANNER_MAX_DISTANCE - PANNER_REF_DISTANCE);
      if (p.gainNode) p.gainNode.gain.setTargetAtTime(vol, tNow, 0.02);
    } else if (p.panner) {
      if (p.panner.positionX) {
        p.panner.positionX.setTargetAtTime(rx, tNow, 0.02);
        p.panner.positionZ.setTargetAtTime(ry, tNow, 0.02);
      } else {
        p.panner.setPosition(rx, 0, ry);
      }
    }
  }
}

// ── 本地噪声门 ──
const NOISE_FLOOR = 12; // 低于此音量→判定为底噪

function applyNoiseGate(rawStream) {
  if (!state.audioCtx) return rawStream;
  const ctx = state.audioCtx;
  const src = ctx.createMediaStreamSource(rawStream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 256;
  const gate = ctx.createGain();
  const dest = ctx.createMediaStreamDestination();

  src.connect(analyser);
  src.connect(gate);
  gate.connect(dest);

  const buf = new Uint8Array(analyser.frequencyBinCount);
  const gatedStream = dest.stream;
  let gated = false;
  const tick = () => {
    if (state.localStream !== gatedStream) return; // 流已更换，停止
    analyser.getByteFrequencyData(buf);
    const avg = buf.reduce((a, b) => a + b, 0) / buf.length;
    const target = avg > NOISE_FLOOR ? 1.0 : 0.01;
    // 平滑门控：开快关慢
    const speed = target > gate.gain.value ? 0.3 : 0.06;
    gate.gain.value += (target - gate.gain.value) * speed;
    if (target > 0.5 && !gated) { gated = true; /* 首次开，不记日志 */ }
    requestAnimationFrame(tick);
  };
  tick();

  addLog('audio', '🔇 噪声门已启用, 阈值=' + NOISE_FLOOR);
  return gatedStream;
}

// ── 5d. 推讲 (toggleMic) ──
export async function toggleMic() {
  if (state.micBusy) return;
  state.micBusy = true;
  try {
    if (state.localStream) {
      // 关麦：停止本地流 + 从 LiveKit 取消发布
      if (state._lkRoom && state._lkRoom.state === 'connected') {
        try {
          state._lkRoom.localParticipant.unpublishTrack(state._lkRoom.localParticipant.getTrackPublication('mic')?.track);
        } catch (e) {}
      }
      state.localStream.getAudioTracks().forEach(t => t.stop());
      state.localStream = null;
      updateMicUI(false);
      addLog('audio', '🔇 麦克风已关闭');
    } else {
      // 开麦：获取新流 + 发布到 LiveKit
      if (!state.audioCtx) { state.audioCtx = new AudioContext(); await state.audioCtx.resume(); }
      await new Promise(r => setTimeout(r, 150));
      state.localStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, autoGainControl: true, noiseSuppression: true, channelCount: 1 } });
      state.localStream = applyNoiseGate(state.localStream);  // 噪声门
      if (navigator.audioSession) navigator.audioSession.type = 'play-and-record';
      if (!state.audioCtx) { state.audioCtx = new AudioContext(); await state.audioCtx.resume(); }
      updateMicUI(true);
      addLog('audio', '🎤 麦克风已开启');

      // 发布到 LiveKit
      if (state._lkRoom && state._lkRoom.state === 'connected') {
        const tracks = state.localStream.getAudioTracks();
        if (tracks.length > 0 && tracks[0].readyState === 'live') {
          const audioTrack = new LocalAudioTrack(tracks[0]);
          try {
            await state._lkRoom.localParticipant.publishTrack(audioTrack, { name: 'mic' });
            addLog('audio', '📤 音轨已重新发布');
          } catch (e) {
            addLog('err', '重新发布失败: ' + e.message);
          }
        }
      }
    }
  } catch (e) {
    toast('麦克风切换失败');
    addLog('err', '麦克风切换失败: ' + e.message);
  } finally {
    state.micBusy = false;
  }
}

export function updateMicUI(on) {
  const btn = $('btn-mic'), label = $('self-mic');
  if (!btn || !label) return;
  btn.textContent = on ? '🎤' : '🎧';
  btn.style.background = on ? 'var(--accent-dim)' : 'var(--danger-dim)';
  label.textContent = on ? '发言中 · 单声道' : '收听中 · 立体声';
  label.style.color = on ? 'var(--accent)' : 'var(--danger)';
}

// ── 连接状态管理 ──
function setConnState(st) {
  const prev = state._connState;
  state._connState = st;
  addLog('conn', '状态: ' + prev + ' → ' + st);
  statusLog(st === 'connected' ? 'LiveKit已连接' : st === 'reconnecting' ? '重连中...' : '已断开');
  // 更新状态灯
  const dot = $('conn-dot');
  if (dot) {
    dot.style.display = (st === 'disconnected' && !state.currentRoom) ? 'none' : 'inline-block';
    const colors = { connected: '#16a34a', reconnecting: '#ea580c', connecting: '#ea580c', disconnected: '#e04949' };
    dot.style.background = colors[st] || '#e04949';
  }
}

// 指数退避重连
const MAX_RECONNECT_DELAY = 30000;
const BASE_RECONNECT_DELAY = 1000;

export async function reconnectLiveKit() {
  if (state._lkReconnecting || !state._lkRoomName || !state.currentRoom) return;
  state._lkReconnecting = true;
  state._lkReconnectAttempts++;
  setConnState('reconnecting');

  const delay = Math.min(BASE_RECONNECT_DELAY * Math.pow(2, state._lkReconnectAttempts - 1), MAX_RECONNECT_DELAY);
  const jitter = Math.random() * 1000;
  addLog('conn', '⏳ 重连 #' + state._lkReconnectAttempts + ' — 等待 ' + Math.round((delay + jitter) / 1000) + 's');

  await new Promise(r => setTimeout(r, delay + jitter));

  try {
    // 清理旧房间
    if (state._lkRoom) {
      try { state._lkRoom.disconnect(); } catch (e) {}
      state._lkRoom = null;
    }
    // 清理旧的 intervals
    stopPositionSync();
    stopDucking();
    state._dcIntervals = [];

    // 重新连接
    await connectLiveKit(state._lkRoomName);
    addLog('conn', '✅ 重连成功！');
    toast('已重新连接');
    state._lkReconnecting = false;
    state._lkReconnectAttempts = 0;
  } catch (e) {
    addLog('err', '❌ 重连失败: ' + e.message);
    state._lkReconnecting = false;
    // 继续尝试
    reconnectLiveKit();
  }
}

// ── 连接质量监控 ──
let _qualityTimer = null;

export function startQualityMonitor() {
  if (_qualityTimer) return;
  _qualityTimer = setInterval(async () => {
    if (!state._lkRoom || state._lkRoom.state !== 'connected') return;
    try {
      const stats = await state._lkRoom.engine.pcManager?.publisher?.getStats();
      if (!stats) return;
      let rtt = 0, lossRate = 0;
      for (const r of stats.values()) {
        if (r.type === 'candidate-pair' && r.state === 'succeeded') {
          rtt = r.currentRoundTripTime ? r.currentRoundTripTime * 1000 : rtt;
        }
        if (r.type === 'inbound-rtp' && r.kind === 'audio') {
          lossRate = r.packetsLost / (r.packetsReceived + r.packetsLost) * 100 || 0;
        }
      }
      // 质量评级
      let lvl;
      if (!rtt || rtt < 100 && lossRate < 2) lvl = 'good';
      else if (rtt < 300 && lossRate < 5) lvl = 'ok';
      else if (rtt < 500 && lossRate < 10) lvl = 'poor';
      else lvl = 'bad';

      if (state._qualityLevel !== lvl) {
        state._qualityLevel = lvl;
        const dot = $('conn-dot');
        if (dot) {
          const colors = { good: '#16a34a', ok: '#ca8a04', poor: '#ea580c', bad: '#e04949' };
          dot.style.background = colors[lvl];
          dot.title = { good: '连接良好', ok: '网络一般', poor: '网络较差', bad: '即将断连' }[lvl];
        }
      }
    } catch (e) { /* stats may fail silently */ }
  }, 3000);
}

export function stopQualityMonitor() {
  if (_qualityTimer) { clearInterval(_qualityTimer); _qualityTimer = null; }
}

// ── 5e. 连接LiveKit ──
export async function connectLiveKit(roomName) {
  state._lkRoomName = roomName;  // 保存房间名，断线重连用
  setConnState('connecting');
  statusLog('LiveKit连接中...');
  addLog('conn', '开始连接 LiveKit, room=' + roomName + ' peer=' + (state.myPeerId || '?').slice(0,8));

  if (!state.audioCtx) {
    state.audioCtx = new AudioContext();
    addLog('audio', 'AudioContext 已创建, state=' + state.audioCtx.state);
  }
  if (state.audioCtx.state === 'suspended') {
    await state.audioCtx.resume();
    addLog('audio', 'AudioContext 已恢复, state=' + state.audioCtx.state);
  }

  // 自动获取麦克风
  if (!state.localStream) {
    try {
      state.localStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, autoGainControl: true, noiseSuppression: true, channelCount: 1 } });
      state.localStream = applyNoiseGate(state.localStream);  // 噪声门
      if (navigator.audioSession) navigator.audioSession.type = 'play-and-record';
      updateMicUI(true);
      addLog('audio', '🎤 麦克风已获取, tracks=' + state.localStream.getAudioTracks().length);

      // 自检本地麦克风音量
      if (state.audioCtx) {
        const selfSrc = state.audioCtx.createMediaStreamSource(state.localStream);
        const selfA = state.audioCtx.createAnalyser();
        selfA.fftSize = 256;
        selfSrc.connect(selfA);
        const selfBuf = new Uint8Array(selfA.frequencyBinCount);
        let selfTicks = 0;
        const selfTimer = setInterval(() => {
          selfA.getByteFrequencyData(selfBuf);
          const avg = selfBuf.reduce((a,b)=>a+b,0)/selfBuf.length;
          if (selfTicks++ < 5) addLog('audio', '🎙️ 本地音量#' + selfTicks + ': ' + avg.toFixed(1));
          if (selfTicks >= 10) clearInterval(selfTimer);
        }, 500);
      }
    } catch (e) {
      addLog('err', '⚠️ 麦克风获取失败: ' + e.message);
      statusLog('麦克风失败: ' + e.message);
    }
  }

  const lkRoom = new Room();
  state._lkRoom = lkRoom;

  try {
    const jwt = await makeLKToken(state.myPeerId, roomName);
    addLog('conn', 'JWT已生成');
    await lkRoom.connect(LIVEKIT_URL, jwt);
    addLog('conn', '🔊 LiveKit 已连接');
    setConnState('connected');
    state._lkReconnectAttempts = 0;  // 重置重连计数

    // 发布本地音轨
    const tracks = state.localStream ? state.localStream.getAudioTracks() : [];
    addLog('conn', '本地音轨数: ' + tracks.length + ' readyState=' + (tracks[0]?.readyState || '?'));
    if (tracks.length > 0 && tracks[0].readyState === 'live') {
      const audioTrack = new LocalAudioTrack(tracks[0]);
      try {
        await lkRoom.localParticipant.publishTrack(audioTrack, { name: 'mic' });
        addLog('conn', '📤 本地音轨已发布');
      } catch (e) {
        addLog('err', '⚠️ 发布本地音轨失败: ' + e.message);
      }
    } else {
      addLog('err', '⚠️ 无可用本地音轨 (readyState=' + (tracks[0]?.readyState || 'none') + ')');
    }

    lkRoom.on('trackSubscribed', (track, pub, participant) => {
      const pname = (participant.name || participant.identity).slice(0,8);
      addLog('conn', '🎵 远端音轨: ' + pname
        + ' kind=' + track.kind
        + ' readyState=' + (track.mediaStreamTrack?.readyState || '?'));
      if (track.kind !== 'audio') return;
      const pid = participant.identity;
      const remoteStream = new MediaStream([track.mediaStreamTrack]);
      if (!state.peers.has(pid)) {
        state.peers.set(pid, {
          x: ROOM_SIZE / 2, y: ROOM_SIZE / 2,
          name: participant.name || pid.slice(-6),
          micOn: true, isSpeaking: false,
          color: COLORS[state.peers.size % COLORS.length],
          _snaps: [],  // 空快照，等位置数据填充
        });
        addLog('conn', '新建 peer (音轨): ' + pid.slice(0,8));
      }

      // BUGFIX 3: try-catch 保护，防止单个 peer 失败阻断后续
      const info = state.peers.get(pid);
      info._pub = pub;
      try {
        setupAudioNodes(pid, remoteStream);
      } catch (e) {
        addLog('err', '❌ setupAudioNodes 异常 [' + pid.slice(0,8) + ']: ' + e.message);
      }
    });

    lkRoom.on('participantDisconnected', p => {
      const pid = p.identity;
      addLog('conn', '👋 peer离开: ' + pid.slice(0,8));
      if (state.peers.has(pid)) { removePeer(pid); updateRoomCount(); }
    });

    lkRoom.on('participantConnected', p => {
      const pid = p.identity;
      if (pid === state.myPeerId || state.peers.has(pid)) return;
      addLog('conn', '👤 peer加入: ' + (p.name || pid).slice(0,8));
      state.peers.set(pid, {
        x: ROOM_SIZE / 2, y: ROOM_SIZE / 2,
        name: p.name || pid.slice(-6),
        micOn: true, isSpeaking: false,
        color: COLORS[state.peers.size % COLORS.length],
        _snaps: [],  // 空快照，等位置数据
      });
      updateRoomCount();
    });

    // 断线检测 + 自动重连
    lkRoom.on('disconnected', () => {
      if (!state._lkRoomName || !state.currentRoom) return;  // 用户主动离开
      addLog('err', '🔌 LiveKit 已断开！');
      setConnState('disconnected');
      stopPositionSync();
      stopDucking();
      stopQualityMonitor();
      state._dcIntervals = [];
      // 自动重连
      if (!state._lkReconnecting) {
        reconnectLiveKit();
      }
    });

    startPositionSync(lkRoom);
    addLog('pos', '位置同步已启动');

    sendProfile(lkRoom);
    addLog('avatar', '头像已发送 (首次)');
    setTimeout(() => {
      sendProfile(lkRoom);
      addLog('avatar', '头像已发送 (1s重试)');
    }, 1000);

    const subInterval = setInterval(() => {
      // 网络自适应：弱网时缩小可听范围，减轻带宽压力
      const q = state._qualityLevel;
      const subIn  = q === 'bad' ? 150 : q === 'poor' ? 280 : SUBSCRIBE_IN;
      const subOut = q === 'bad' ? 250 : q === 'poor' ? 380 : UNSUBSCRIBE_OUT;

      for (const [pid, p] of state.peers) {
        if (!p._pub) continue;
        const dist = Math.sqrt((p.x - state.myPos.x) ** 2 + (p.y - state.myPos.y) ** 2);
        // 滞后阈值：进入近→订阅，离开远→取消，防止边界反复横跳
        const wasSubbed = p._subbed === true;
        const shouldSub = wasSubbed ? dist <= subOut : dist <= subIn;
        if (shouldSub !== wasSubbed) {
          try { p._pub.setSubscribed(shouldSub); } catch (e) {}
          p._subbed = shouldSub;
        }
      }
    }, 300);  // 300ms 比之前的 500ms 更灵敏
    state._dcIntervals.push(subInterval);

    startDucking();
    startQualityMonitor();

    // JWT 自动刷新 (23小时后重建连接)
    const refreshMs = 23 * 3600 * 1000;
    state._jwtRefreshTimer = setTimeout(() => {
      addLog('conn', '🔄 JWT即将过期，触发重连刷新');
      reconnectLiveKit();
    }, refreshMs);

    $('game-bar').style.display = 'flex';
    $('map-wrap').style.display = 'block';
    import('./renderer.js').then(m => { m.resizeCanvas(); m.drawMap(); });

  } catch (e) {
    addLog('err', '❌ LiveKit连接失败: ' + e.message);
    statusLog('连接失败: ' + e.message);
  }
}

// ── 5f. peer清理 ──
export function removePeer(pid) {
  const p = state.peers.get(pid);
  if (p) {
    try { if (p.source) p.source.disconnect(); } catch (e) {}
    try { if (p.panner) p.panner.disconnect(); } catch (e) {}
    try { if (p.gainNode) p.gainNode.disconnect(); } catch (e) {}
    try { if (p._audioEl) { p._audioEl.srcObject = null; p._audioEl.remove(); } } catch (e) {}
    try { if (p._testEl) { p._testEl.srcObject = null; p._testEl.remove(); } } catch (e) {}
    try { if (p.pc) p.pc.close(); } catch (e) {}
    state.peers.delete(pid);
    addLog('audio', '已清理 peer: ' + pid.slice(0,8));
  }
  updateRoomCount();
}

// ── 5g. Ducking (非对称平滑) ──
export function startDucking() {
  if (state.duckTimer) return;
  state.duckTimer = setInterval(() => {
    let loudest = null, loudestVol = 0;
    for (const [pid, p] of state.peers) {
      const vol = p.smoothedVol || 0;
      if (vol > loudestVol) { loudestVol = vol; loudest = p; }
    }
    for (const [pid, p] of state.peers) {
      if (!p.gainNode) continue;
      const target = (loudestVol > 10 && p !== loudest) ? 0.25 : 1.0;
      const cur = p.gainNode.gain.value;
      // 非对称平滑: 压得快(0.45) 回得慢(0.08)，听觉更自然
      const speed = target < cur ? 0.45 : 0.08;
      p.gainNode.gain.value = cur + (target - cur) * speed;
    }
  }, 100);
}

export function stopDucking() {
  if (state.duckTimer) { clearInterval(state.duckTimer); state.duckTimer = null; }
}