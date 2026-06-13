// ╔══════════════════════════════════════════╗
// ║  4. RoomRegistry — MQTT房间发现 + 人数同步 ║
// ╚══════════════════════════════════════════╝

import mqtt from 'mqtt';
import { MQTT_URLS } from './config.js';
import { state } from './state.js';
import { $, toast, addLog } from './utils.js';

// ── 4a. 连接MQTT + 订阅房间 (多broker容灾) ──
let _mqttIdx = 0;

export function connectRegistry() {
  const url = MQTT_URLS[_mqttIdx % MQTT_URLS.length];
  addLog('conn', 'MQTT连接: ' + url.replace('wss://','').split('/')[0]);

  state.regMqtt = mqtt.connect(url, {
    clean: true,
    connectTimeout: 8000,
    reconnectPeriod: 3000,
  });

  state.regMqtt.on('connect', () => {
    state.regMqtt.subscribe('voice-registry/#');
    addLog('conn', 'MQTT已连接');
    toast('MQTT已连接');
  });

  state.regMqtt.on('error', (e) => {
    addLog('err', 'MQTT错误: ' + e.message);
    // 连续错误超过阈值，切换 broker
    _mqttIdx++;
    if (_mqttIdx < MQTT_URLS.length * 3) {
      addLog('conn', 'MQTT将在3s后重试...');
    }
  });
  state.regMqtt.on('close', () => {
    addLog('conn', 'MQTT断开');
    // 如果长时间断开，尝试下一个 broker
    setTimeout(() => {
      if (!state.regMqtt?.connected) {
        _mqttIdx++;
        addLog('conn', 'MQTT切换broker: #' + (_mqttIdx % MQTT_URLS.length));
        connectRegistry();
      }
    }, 10000);
  });

  state.regMqtt.on('message', (topic, msg) => {
    const name = topic.replace('voice-registry/', '');
    if (!msg.toString()) {
      // 空消息 = 房间销毁
      state.rooms.delete(name);
      if (name === state.currentRoom) {
        toast('房间已被销毁');
        // leaveRoom 由 ui.js (R4) 提供 — 此处延迟导入避免循环
        import('./ui.js').then(m => m.leaveRoom()).catch(() => {
          state.currentRoom = null;
        });
      }
    } else {
      try {
        const d = JSON.parse(msg.toString());
        state.rooms.set(name, d);
        toast('发现房间: ' + name);
      } catch (e) { /* ignore malformed */ }
    }
    renderRoomList();
  });
}

// ── 4b. 渲染房间列表 ──
export function renderRoomList() {
  const search = ($('room-search')?.value || '').toLowerCase();
  const container = $('room-list');
  const empty = $('room-empty');

  const rooms = [...state.rooms.entries()]
    .filter(([n]) => n.toLowerCase().includes(search));

  if (rooms.length === 0) {
    empty.style.display = '';
    container.innerHTML = '';
    empty.textContent = search ? '没有匹配的房间' : '还没有房间 · 创建一个吧';
    return;
  }

  empty.style.display = 'none';
  container.innerHTML = rooms.map(([n, r]) =>
    '<div class="room-card">'
    + '<div class="room-icon">' + (r.hasPassword ? '🔒' : '🌐') + '</div>'
    + '<div class="room-info">'
    + '<div class="room-name">' + n + '</div>'
    + '<div class="room-meta">' + (r.hasPassword ? '需要密码' : '公开房间') + '</div>'
    + '</div>'
    + '<div class="room-count">' + (r.memberCount || 0) + '人</div>'
    + '</div>'
  ).join('');

  container.querySelectorAll('.room-card').forEach(card => {
    card.onclick = () => {
      const name = card.querySelector('.room-name').textContent;
      const room = state.rooms.get(name);
      if (room && room.hasPassword) {
        const pw = prompt('请输入房间密码');
        if (pw === null) return;
        $('create-pw').value = pw;
      }
      $('create-name').value = name;
      // joinRoom 由 ui.js (R4) 提供
      import('./ui.js').then(m => m.joinRoom(false));
    };
  });
}

// ── 4c. 更新房间人数 (从 audio.js 移入) ──
export function updateRoomCount() {
  if (!state.currentRoom || !state.regMqtt) return;
  const count = state.peers.size + 1;

  // 更新状态栏
  $('status').innerHTML = '<span class="room-badge"><span class="dot"></span>'
    + state.currentRoom + ' · ' + count + '人</span>';

  // 所有人更新 MQTT (不只是房主), 保活刷新
  const info = state.rooms.get(state.currentRoom);
  if (state.regMqtt?.connected) {
    state.regMqtt.publish('voice-registry/' + state.currentRoom,
      JSON.stringify({ hasPassword: info?.hasPassword || false, memberCount: count }),
      { retain: true });
  }
}
