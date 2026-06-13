// ╔══════════════════════════════════════════╗
// ║  1. CONFIG — 常量，全模块可 import        ║
// ╚══════════════════════════════════════════╝

// MQTT Broker (多级容灾)
export const MQTT_URLS = [
  'wss://broker.emqx.io:8084/mqtt',
  'wss://mqtt.eclipseprojects.io:443/mqtt',
  'wss://test.mosquitto.org:8081/mqtt',
];
export const MQTT_URL = MQTT_URLS[0];

// 地图
export const ROOM_SIZE = 800;
export const MAP_IMG = 'map-bg.jpg';

// 玩家色板
export const COLORS = [
  '#4f46e5','#7c3aed','#db2777','#ea580c','#16a34a','#0891b2',
  '#ca8a04','#9333ea','#e11d48','#65a30d','#0d9488','#b45309',
  '#1d4ed8','#2563eb',
];

// LiveKit Cloud (密钥在 secrets.js，不入 git)
export { LIVEKIT_URL, LIVEKIT_KEY, LIVEKIT_SECRET } from './secrets.js';

// 移动速度
export const MOVE_SPEED = 2.2;

// 空间音频 (对标 spatial-audio: 像素坐标直传)
export const PANNER_REF_DISTANCE   = 100;
export const PANNER_MAX_DISTANCE   = 500;
export const PANNER_ROLLOFF_FACTOR = 2;
export const EARSHOT_RADIUS = 500;  // 可听范围 (同 maxDistance)

// 选择性订阅滞后阈值 (防边界抖动)
// 订阅范围需大于音频衰减范围, 确保衰减到极小后オ切断
export const SUBSCRIBE_IN  = 500;  // 进入此距离 → 订阅
export const UNSUBSCRIBE_OUT = 700; // 超出此距离 → 取消订阅 ( > maxDistance=500)

// 死推算
export const DR_MAX_TIME = 500;    // 超过此时间无更新 → 冻结
export const DR_BLEND_SPEED = 0.15; // 从推算位置回弹到真实位置的速度
