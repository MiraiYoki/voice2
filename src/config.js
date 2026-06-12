// ╔══════════════════════════════════════════╗
// ║  1. CONFIG — 常量，全模块可 import        ║
// ╚══════════════════════════════════════════╝

// MQTT Broker
export const MQTT_URL = 'wss://broker.emqx.io:8084/mqtt';

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
