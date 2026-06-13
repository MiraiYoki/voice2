// ╔══════════════════════════════════════════╗
// ║  9. UIController — 面板流 + 加入/离开       ║
// ╚══════════════════════════════════════════╝

import { state } from './state.js';
import { $, toast, simpleHash, showPanel, renderAllLogs } from './utils.js';
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

  // 清理房间
  if (state.regMqtt && state.isRoomCreator) {
    state.regMqtt.publish('voice-registry/' + state.currentRoom, '', { retain: true });
  }

  // 断开 LiveKit (先标记离开，防止触发自动重连)
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
}
