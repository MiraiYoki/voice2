// ╔══════════════════════════════════════════╗
// ║  8. NetcodeController — DataChannel位置同步 ║
// ╚══════════════════════════════════════════╝
// 对标 spatial-audio NetcodeController
// sendLock + LOSSY + 50ms + 快照插值接收 + 头像单独通道

import { DataPacket_Kind } from 'livekit-client';
import { state } from './state.js';
import { ROOM_SIZE, COLORS } from './config.js';
import { updateSpatialAudio } from './audio.js';

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
let sendLock = false;
let _room = null;

// ── 8a. 发送头像 (一次性, 可靠传输) ──
export function sendProfile(room) {
  if (!state.profileAvatar) return;
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

// ── 8b. 启动位置同步 (发 + 收) ──
export function startPositionSync(room) {
  _room = room;
  // 发送: 50ms 间隔 + sendLock
  const sendInterval = setInterval(() => {
    if (!state.currentRoom || sendLock) return;
    sendLock = true;
    try {
      const payload = textEncoder.encode(JSON.stringify({
        channelId: 'pos',
        payload: {
          x: state.myPos.x,
          y: state.myPos.y,
          micOn: state.micOn,
          name: state.profileName,
        },
      }));
      room.localParticipant.publishData(payload, DataPacket_Kind.LOSSY);
    } catch (e) { /* ignore */ }
    finally { sendLock = false; }
  }, 50);

  // 接收
  room.on('dataReceived', onDataReceived);
  state._dcIntervals.push(sendInterval);
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
    if (!p._snaps) p._snaps = [];
    p._snaps.push({ x: d.x, y: d.y, t: Date.now() });
    if (p._snaps.length > 40) p._snaps.shift();

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
