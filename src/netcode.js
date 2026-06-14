// ╔══════════════════════════════════════════╗
// ║  8. NetcodeController — DataChannel位置同步 ║
// ╚══════════════════════════════════════════╝
// 对标 spatial-audio NetcodeController
// sendLock + LOSSY + 50ms + 快照插值接收 + 头像单独通道

import { DataPacket_Kind } from 'livekit-client';
import { state } from './state.js';
import { ROOM_SIZE, COLORS } from './config.js';
import { updateSpatialAudio } from './audio.js';
import { addChatBubble } from './utils.js';
import { MUSIC_PLAYLIST, MAP_THEMES } from './config.js';
import { triggerEffect } from './effects.js';

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
let sendLock = false;
let _room = null;

// ── 8a. 发送头像 (一次性, 可靠传输) ──
export function sendProfile(room) {
  if (!room || !state.profileAvatar) return;
  // 头像超过 50KB 跳过 (DataChannel 上限约 64KB)
  if (state.profileAvatar.length > 50000) {
    console.warn('头像过大，跳过发送: ' + state.profileAvatar.length + ' bytes');
    return;
  }
  try {
    const payload = textEncoder.encode(JSON.stringify({
      channelId: 'profile',
      payload: {
        name: state.profileName,
        avatar: state.profileAvatar,
      },
    }));
    room.localParticipant.publishData(payload, { reliable: true });
  } catch (e) { /* ignore */ }
}

// ── 8b. 启动位置同步 (发 + 收) — 自适应频率 ──
export function startPositionSync(room) {
  _room = room;
  let _lastSentX = state.myPos.x;
  let _lastSentY = state.myPos.y;
  let _lastSentTime = 0;
  let _lastSentName = state.profileName;
  let _lastNameTime = 0;

  const sendInterval = setInterval(() => {
    if (!state.currentRoom || sendLock) return;

    const dx = Math.abs(state.myPos.x - _lastSentX);
    const dy = Math.abs(state.myPos.y - _lastSentY);
    const moved = Math.sqrt(dx * dx + dy * dy);
    const sinceLast = Date.now() - _lastSentTime;

    // 自适应：移动大→50ms, 移动小→100ms, 静止→500ms
    let shouldSend = false;
    if (moved > 2) shouldSend = true;               // 明显移动，每 tick 都发
    else if (moved > 0.5 && sinceLast >= 100) shouldSend = true;  // 慢移动 100ms
    else if (sinceLast >= 500) shouldSend = true;    // 静止保活 500ms

    if (!shouldSend) return;

    // 名字去重：只在变更时或每2秒发一次（供晚加入的 peer）
    const now = Date.now();
    const nameChanged = state.profileName !== _lastSentName;
    const nameRefresh = (now - _lastNameTime) > 2000;
    const sendName = nameChanged || nameRefresh;

    sendLock = true;
    try {
      const pld = { x: state.myPos.x, y: state.myPos.y, micOn: state.micOn };
      if (sendName) { pld.name = state.profileName; _lastSentName = state.profileName; _lastNameTime = now; }
      const payload = textEncoder.encode(JSON.stringify({
        channelId: 'pos',
        payload: pld,
      }));
      room.localParticipant.publishData(payload, DataPacket_Kind.LOSSY);
      _lastSentX = state.myPos.x;
      _lastSentY = state.myPos.y;
      _lastSentTime = Date.now();
    } catch (e) { /* ignore */ }
    finally { sendLock = false; }
  }, 50);

  // 接收
  room.on('dataReceived', onDataReceived);
  state._dcIntervals.push(sendInterval);
}

// ── 广播辅助 (与位置同步同格式) ──
export function broadcast(channelId, payload) {
  if (!state._lkRoom?.localParticipant) return;
  const data = textEncoder.encode(JSON.stringify({ channelId, payload }));
  state._lkRoom.localParticipant.publishData(data, DataPacket_Kind.RELIABLE);
}

// ── 8c. 数据接收处理 ──
function onDataReceived(data, participant) {
  try {
    const msg = JSON.parse(textDecoder.decode(data));
    const pid = participant.identity;
    if (pid === state.myPeerId) return;

    // 头像通道
    if (msg.channelId === 'profile') {
      const d = msg.payload;
      if (!d) return;
      let p = state.peers.get(pid);
      if (!p) {
        p = { x: ROOM_SIZE / 2, y: ROOM_SIZE / 2, micOn: true, isSpeaking: false,
          color: COLORS[state.peers.size % COLORS.length], _snaps: [] };
        state.peers.set(pid, p);
      }
      if (d.name) p.name = d.name;
      if (d.avatar) { p.avatar = d.avatar; p._avatarImg = null; }
      return;
    }

    // 聊天通道
    if (msg.channelId === 'chat') {
      if (msg.payload?.text) addChatBubble(pid, msg.payload.text);
      return;
    }
    // 主题同步通道
    if (msg.channelId === 'theme') {
      const t = MAP_THEMES.find(th => th.id === msg.payload?.map);
      if (t) {
        state.mapTheme = t.id;
        state.mapImg.src = t.src;
        state.mapImg.onload = () => {
          state.worldW = state.mapImg.naturalWidth || 1600;
          state.worldH = state.mapImg.naturalHeight || 1200;
          state.myPos.x = state.worldW / 2;
          state.myPos.y = state.worldH / 2;
        };
      }
      return;
    }
    // 特效通道
    if (msg.channelId === 'fx') {
      if (msg.payload?.fx) triggerEffect(msg.payload.fx);
      return;
    }
    // 音效通道 (AudioContext播放, 突破自动播放限制)
    if (msg.channelId === 'sfx') {
      if (msg.payload?.src && state.audioCtx) {
        state.audioCtx.resume();
        fetch(msg.payload.src).then(r => r.arrayBuffer()).then(buf =>
          state.audioCtx.decodeAudioData(buf)
        ).then(audioBuf => {
          const src = state.audioCtx.createBufferSource();
          const gain = state.audioCtx.createGain();
          gain.gain.value = state._sfxVol;
          src.buffer = audioBuf;
          src.connect(gain).connect(state.audioCtx.destination);
          src.start();
        }).catch(()=>{});
      }
      return;
    }
    // 音乐同步通道
    if (msg.channelId === 'music') {
      const d = msg.payload;
      if (d?.action === 'play') playMusicRemote(d.songId, d.ts);
      else if (d?.action === 'stop') stopMusicRemote();
      else if (d?.action === 'pause') pauseMusicRemote();
      else if (d?.action === 'resume') resumeMusicRemote();
      return;
    }
    // 位置通道
    if (msg.channelId !== 'pos') return;
    const d = msg.payload;
    if (!d) return;

    if (!state.peers.has(pid)) {
      state.peers.set(pid, {
        x: d.x || ROOM_SIZE / 2, y: d.y || ROOM_SIZE / 2,
        name: d.name || pid.slice(-6),
        micOn: true, isSpeaking: false,
        color: COLORS[state.peers.size % COLORS.length],
        _snaps: [],
      });
    }

    const p = state.peers.get(pid);
    // 只更新位置相关字段，不覆盖 _pub/_subbed/stream 等音频字段
    if (!p._snaps) p._snaps = [];

    // 首包位置：立即吸附，避免从地图中心 lerp 过来造成跳跃
    const isFirstSnap = p._snaps.length === 0;

    p._snaps.push({ x: d.x, y: d.y, t: Date.now() });
    if (p._snaps.length > 40) p._snaps.shift();

    if (isFirstSnap) {
      p.x = d.x;
      p.y = d.y;
    }

    if (d.micOn !== undefined) p.micOn = d.micOn;
    if (d.name) p.name = d.name;

    updateSpatialAudio();
  } catch (e) { /* ignore malformed */ }
}

// ── 8d. 停止同步 ──
export function stopPositionSync() {
  state._dcIntervals.forEach(clearInterval);
  state._dcIntervals = [];
}

// ── 8e. 全场音乐同步 ──
export function playMusicRemote(songId, ts) {
  const song = MUSIC_PLAYLIST.find(s => s.id === songId);
  if (!song || !state.audioCtx) return;
  stopMusicRemote();
  state.audioCtx.resume();
  if (state._musicGain) { try { state._musicGain.disconnect(); } catch(e) {} }
  fetch(song.src).then(r => r.arrayBuffer()).then(buf =>
    state.audioCtx.decodeAudioData(buf)
  ).then(audioBuf => {
    const src = state.audioCtx.createBufferSource();
    const gain = state.audioCtx.createGain();
    gain.gain.value = state._musicVol;
    state._musicGain = gain;
    src.buffer = audioBuf;
    src.loop = true;
    src.connect(gain).connect(state.audioCtx.destination);
    src.start();
    state._musicEl = { stop: () => { try { src.stop(); src.disconnect(); gain.disconnect(); state._musicGain = null; } catch(e) {} } };
    state._musicPlaying = true;
  }).catch(e => { console.warn('music play failed:', e.message); });
}

export function stopMusicRemote() {
  if (state._musicEl) {
    try { if (state._musicEl.stop) state._musicEl.stop(); else { state._musicEl.pause(); state._musicEl.remove(); } } catch(e) {}
    state._musicEl = null;
  }
  state._musicPlaying = false;
}

function pauseMusicRemote() {
  if (state._musicEl) { try { state._musicEl.stop(); } catch(e) {} state._musicEl = null; state._musicPlaying = false; }
}

function resumeMusicRemote() {
  // BufferSource can't resume, re-trigger playMusicRemote from the last state
}
