// ╔══════════════════════════════════════════╗
// ║  5. AudioController (LiveKit + 空间音频)   ║
// ╚══════════════════════════════════════════╝
// 对标 spatial-audio SpatialAudioController + NetcodeController
// 修复: 坐标系(像素直传) + iOS降级 + selective sub + 防爆音

import { Room } from 'livekit-client';
import { state } from './state.js';
import { $, toast } from './utils.js';
import { updateRoomCount } from './registry.js';
import { startPositionSync, sendProfile } from './netcode.js';
import {
  LIVEKIT_URL, LIVEKIT_KEY, LIVEKIT_SECRET,
  ROOM_SIZE, COLORS,
  PANNER_REF_DISTANCE, PANNER_MAX_DISTANCE, PANNER_ROLLOFF_FACTOR, EARSHOT_RADIUS,
} from './config.js';

// 调试: 写到顶部状态栏, 比 toast 可靠
function log(msg) { const s = $('status'); if (s) s.textContent = msg; console.log(msg); }

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
    log('Token失败: ' + e.message);
    throw e;
  }
}

// ── 5b. 空间音频管线 (对标 spatial-audio PublicationRenderer) ──
const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);

export function setupAudioNodes(pid, remoteStream) {
  if (!state.audioCtx) { log('无AudioContext'); return; }
  // 强制恢复 AudioContext (某些浏览器需要)
  if (state.audioCtx.state === 'suspended') {
    state.audioCtx.resume();
    log('AudioContext恢复中...(' + state.audioCtx.state + ')');
  }

  let info = state.peers.get(pid);
  if (!info) {
    info = { x: ROOM_SIZE / 2, y: ROOM_SIZE / 2 };
    state.peers.set(pid, info);
  }
  if (info.stream) return;
  info.stream = remoteStream;
  log('🎧 音频节点: ' + pid.slice(0,8) + ' ctx=' + state.audioCtx.state);

  // 检查远端音轨状态
  const audioTracks = remoteStream.getAudioTracks();
  log('音轨数: ' + audioTracks.length + ' 启用: ' + (audioTracks[0]?.enabled || false));

  // <audio muted> dual-track — spatial-audio 同款
  const audioEl = document.createElement('audio');
  audioEl.muted = true;
  audioEl.srcObject = remoteStream;
  audioEl.play().catch(e => log('audio.play失败: ' + e.message));
  info._audioEl = audioEl;

  // DEBUG: 旁路非静音播放，验证音轨是否有数据
  const testEl = document.createElement('audio');
  testEl.srcObject = remoteStream;
  testEl.play().catch(e => log('test.play失败: ' + e.message));
  info._testEl = testEl;

  const src = state.audioCtx.createMediaStreamSource(remoteStream);

  if (isIOS) {
    const gain = state.audioCtx.createGain();
    gain.gain.value = 1;
    src.connect(gain).connect(state.audioCtx.destination);
    info.gainNode = gain;
    info._isIOS = true;
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

// ── 5d. 推讲 (toggleMic) ──
export async function toggleMic() {
  if (state.micBusy) return;
  state.micBusy = true;
  try {
    if (state.localStream) {
      state.localStream.getAudioTracks().forEach(t => t.stop());
      state.localStream = null;
      updateMicUI(false);
    } else {
      if (!state.audioCtx) { state.audioCtx = new AudioContext(); state.audioCtx.resume(); }
      await new Promise(r => setTimeout(r, 150));
      state.localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (navigator.audioSession) navigator.audioSession.type = 'play-and-record';
      if (!state.audioCtx) { state.audioCtx = new AudioContext(); state.audioCtx.resume(); }
      updateMicUI(true);
    }
  } catch (e) {
    toast('麦克风切换失败');
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

// ── 5e. 连接LiveKit ──
export async function connectLiveKit(roomName) {
  log('LiveKit连接中...');
  if (!state.audioCtx) {
    state.audioCtx = new AudioContext();
  }
  if (state.audioCtx.state === 'suspended') {
    await state.audioCtx.resume();
    log('AudioContext: ' + state.audioCtx.state);
  }

  // 自动获取麦克风 (不需要手动点)
  if (!state.localStream) {
    try {
      state.localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (navigator.audioSession) navigator.audioSession.type = 'play-and-record';
      updateMicUI(true);
      log('🎤 麦克风已开启');
    } catch (e) {
      log('⚠️ 麦克风失败: ' + e.message);
    }
  }

  const lkRoom = new Room();
  state._lkRoom = lkRoom;

  makeLKToken(state.myPeerId, roomName).then(jwt => {
    lkRoom.connect(LIVEKIT_URL, jwt).then(() => {
      log('🔊 已连接');

      // 发布本地音轨
      const tracks = state.localStream ? state.localStream.getAudioTracks() : [];
      log('本地音轨: ' + tracks.length + ' 条');
      if (tracks.length > 0 && tracks[0].readyState === 'live') {
        lkRoom.localParticipant.publishTrack(tracks[0], { name: 'mic' })
          .then(() => log('📤 已发布'))
          .catch(e => log('⚠️ 发布失败: ' + e.message));
      } else {
        log('⚠️ 无可用音轨');
      }

      lkRoom.on('trackSubscribed', (track, pub, participant) => {
        log('🎵 音轨: ' + (participant.name || participant.identity).slice(0,8));
        if (track.kind !== 'audio') return;
        const pid = participant.identity;
        const remoteStream = new MediaStream([track.mediaStreamTrack]);
        if (!state.peers.has(pid)) {
          state.peers.set(pid, {
            x: ROOM_SIZE / 2, y: ROOM_SIZE / 2,
            name: participant.name || pid.slice(-6),
            micOn: true, isSpeaking: false,
            color: COLORS[state.peers.size % COLORS.length],
            _snaps: [{ x: ROOM_SIZE / 2, y: ROOM_SIZE / 2, t: Date.now() }],
          });
        }
        const info = state.peers.get(pid);
        info._pub = pub;
        setupAudioNodes(pid, remoteStream);
      });

      lkRoom.on('participantDisconnected', p => {
        const pid = p.identity;
        if (state.peers.has(pid)) { removePeer(pid); updateRoomCount(); }
      });

      lkRoom.on('participantConnected', p => {
        const pid = p.identity;
        if (pid === state.myPeerId || state.peers.has(pid)) return;
        state.peers.set(pid, {
          x: ROOM_SIZE / 2, y: ROOM_SIZE / 2,
          name: p.name || pid.slice(-6),
          micOn: true, isSpeaking: false,
          color: COLORS[state.peers.size % COLORS.length],
          _snaps: [{ x: ROOM_SIZE / 2, y: ROOM_SIZE / 2, t: Date.now() }],
        });
        updateRoomCount();
      });

      startPositionSync(lkRoom);
      sendProfile(lkRoom);

      const subInterval = setInterval(() => {
        for (const [pid, p] of state.peers) {
          if (!p._pub) continue;
          const dist = Math.sqrt((p.x - state.myPos.x) ** 2 + (p.y - state.myPos.y) ** 2);
          const hearable = dist <= EARSHOT_RADIUS;
          try { p._pub.setSubscribed(hearable); } catch (e) {}
        }
      }, 500);
      state._dcIntervals.push(subInterval);

      startDucking();

      $('game-bar').style.display = 'flex';
      $('map-wrap').style.display = 'block';
      import('./renderer.js').then(m => { m.resizeCanvas(); m.drawMap(); });

    }).catch(e => {
      log('⚠️ 连接失败: ' + e.message);
    });
  }).catch(e => {
    log('Token失败: ' + e.message);
  });
}

// ── 5f. peer清理 ──
export function removePeer(pid) {
  const p = state.peers.get(pid);
  if (p) {
    try { if (p.source) p.source.disconnect(); } catch (e) {}
    try { if (p.panner) p.panner.disconnect(); } catch (e) {}
    try { if (p.gainNode) p.gainNode.disconnect(); } catch (e) {}
    try { if (p._audioEl) { p._audioEl.srcObject = null; p._audioEl.remove(); } } catch (e) {}
    try { if (p.pc) p.pc.close(); } catch (e) {}
    state.peers.delete(pid);
  }
  updateRoomCount();
}

// ── 5g. Ducking ──
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
      const target = (loudestVol > 10 && p !== loudest) ? 0.3 : 1.0;
      const cur = p.gainNode.gain.value;
      p.gainNode.gain.value = cur + (target - cur) * 0.2;
    }
  }, 100);
}

export function stopDucking() {
  if (state.duckTimer) { clearInterval(state.duckTimer); state.duckTimer = null; }
}
