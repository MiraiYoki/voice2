// ╔══════════════════════════════════════════╗
// ║  8. NetcodeController — DataChannel位置同步 ║
// ╚══════════════════════════════════════════╝
// 对标 spatial-audio NetcodeController
// sendLock + LOSSY + 100ms + 快照插值接收

import { DataPacket_Kind } from 'livekit-client';
import { state } from './state.js';
import { ROOM_SIZE, COLORS } from './config.js';
import { updateSpatialAudio } from './audio.js';

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
let sendLock = false;

// ── 8a. 启动位置同步 (发 + 收) ──
export function startPositionSync(room) {
  // 发送: 100ms 间隔 + sendLock
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
          avatar: state.profileAvatar,
        },
      }));
      room.localParticipant.publishData(payload, DataPacket_Kind.LOSSY);
    } catch (e) { /* ignore */ }
    finally { sendLock = false; }
  }, 100);

  // 接收: 快照写入 state.peers[pid]._snaps
  room.on('dataReceived', onDataReceived);

  state._dcIntervals.push(sendInterval);
}

// ── 8b. 数据接收处理 ──
function onDataReceived(data, participant) {
  try {
    const msg = JSON.parse(textDecoder.decode(data));
    if (msg.channelId !== 'pos') return;
    const d = msg.payload;
    const pid = participant.identity;
    if (pid === state.myPeerId || !d) return;

    // 新 peer (先收到位置再收到音轨)
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
    if (p._snaps.length > 20) p._snaps.shift();

    if (d.micOn !== undefined) p.micOn = d.micOn;
    if (d.name) p.name = d.name;
    if (d.avatar) p.avatar = d.avatar;

    updateSpatialAudio();
  } catch (e) { /* ignore malformed */ }
}

// ── 8c. 停止同步 ──
export function stopPositionSync() {
  state._dcIntervals.forEach(clearInterval);
  state._dcIntervals = [];
}
