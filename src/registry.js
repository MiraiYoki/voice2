// ╔══════════════════════════════════════════╗
// ║  4. RoomRegistry — MQTT房间发现 + 人数同步 ║
// ╚══════════════════════════════════════════╝

import mqtt from 'mqtt';
import { MQTT_URLS } from './config.js';
import { state } from './state.js';
import { $, toast, addLog } from './utils.js';

// ── 4a. 连接MQTT + 订阅房间 (多broker容灾 + LWT遗嘱) ──
let _mqttIdx = 0;

function doConnect(url, willTopic) {
  const opts = {
    clean: true,
    connectTimeout: 8000,
    reconnectPeriod: 3000,
  };
  // LWT遗嘱: 客户端异常断开时自动清空房间
  if (willTopic) {
    opts.will = { topic: willTopic, payload: '', retain: true };
  }
  state.regMqtt = mqtt.connect(url, opts);
}

// 页面加载时调用: 无遗嘱连接
export function connectRegistry() {
  const url = MQTT_URLS[_mqttIdx % MQTT_URLS.length];
  addLog('conn', 'MQTT连接: ' + url.replace('wss://','').split('/')[0]);
  doConnect(url, null);
  _wireBaseHandlers();
  _wireMessageHandler();
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

// ── 4d. LWT遗嘱管理 ──
function _wireBaseHandlers() {
  state.regMqtt.on('connect', () => {
    state.regMqtt.subscribe('voice-registry/#');
    addLog('conn', 'MQTT已连接');
  });
  state.regMqtt.on('error', (e) => {
    addLog('err', 'MQTT错误: ' + e.message);
    _mqttIdx++;
  });
  state.regMqtt.on('close', () => {
    addLog('conn', 'MQTT断开');
    setTimeout(() => {
      if (!state.regMqtt?.connected) {
        _mqttIdx++;
        addLog('conn', 'MQTT切换broker');
        connectRegistry();
      }
    }, 10000);
  });
}

export function setRoomWill(roomName) {
  if (!state.regMqtt) return;
  const url = MQTT_URLS[_mqttIdx % MQTT_URLS.length];
  state.regMqtt.end(true);
  doConnect(url, 'voice-registry/' + roomName);
  _wireBaseHandlers();
  _wireMessageHandler();
}

export function clearRoomWill() {
  if (!state.regMqtt) return;
  const url = MQTT_URLS[_mqttIdx % MQTT_URLS.length];
  state.regMqtt.end(true);
  doConnect(url, null);
  _wireBaseHandlers();
  _wireMessageHandler();
}

function _wireMessageHandler() {
  state.regMqtt.on('message', (topic, msg) => {
    const name = topic.replace('voice-registry/', '');
    if (!msg.toString()) {
      state.rooms.delete(name);
      if (name === state.currentRoom && !state._closing) {
        toast('房间已被销毁');
        import('./ui.js').then(m => m.leaveRoom()).catch(() => { state.currentRoom = null; });
      }
    } else {
      try {
        const d = JSON.parse(msg.toString());
        state.rooms.set(name, d);
      } catch (e) { /* ignore malformed */ }
    }
    renderRoomList();
  });
}
