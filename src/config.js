// ╔══════════════════════════════════════════╗
// ║  1. CONFIG — 常量，全模块可 import        ║
// ╚══════════════════════════════════════════╝

// MQTT Broker (自建服务器)
export const MQTT_URLS = [
  'ws://49.233.177.94:9001',
  'wss://broker.emqx.io:8084/mqtt',     // 备用
  'wss://mqtt.eclipseprojects.io:443/mqtt', // 备用
];
export const MQTT_URL = MQTT_URLS[0];

// 地图
export const ROOM_SIZE = 800;
export const MAP_IMG = 'map-bg.jpg';

// 房间主题 (房主可切换)
export const MAP_THEMES = [
  { id: 'default', name: '默认', src: 'map-bg.jpg' },
  { id: 'palace', name: '宫廷', src: 'maps/palace.png' },
  { id: 'courtyard', name: '庭院', src: 'maps/courtyard.png' },
  { id: 'courtyard-room', name: '庭院房间', src: 'maps/courtyard-room.png' },
];

// 玩家色板
export const COLORS = [
  '#4f46e5','#7c3aed','#db2777','#ea580c','#16a34a','#0891b2',
  '#ca8a04','#9333ea','#e11d48','#65a30d','#0d9488','#b45309',
  '#1d4ed8','#2563eb',
];

// LiveKit Cloud (密钥在 secrets.js，不入 git)
export { LIVEKIT_URL, LIVEKIT_KEY, LIVEKIT_SECRET } from './secrets.js';

// 移动速度
export const MOVE_SPEED = 2.64;  // +20%

// 空间音频 (对标 spatial-audio: 像素坐标直传)
export const PANNER_REF_DISTANCE   = 120;
export const PANNER_MAX_DISTANCE   = 600;
export const PANNER_ROLLOFF_FACTOR = 1.6;
export const EARSHOT_RADIUS = 600;
export const MOBILE_FALLOFF = 200;  // 移动端 exp(-dist/200)

// 选择性订阅滞后阈值 (防边界抖动)
// 订阅范围需大于音频衰减范围, 确保衰减到极小后オ切断
export const SUBSCRIBE_IN  = 500;  // 进入此距离 → 订阅
export const UNSUBSCRIBE_OUT = 700; // 超出此距离 → 取消订阅 ( > maxDistance=500)

// 死推算
export const DR_MAX_TIME = 500;    // 超过此时间无更新 → 冻结
export const DR_BLEND_SPEED = 0.15; // 从推算位置回弹到真实位置的速度

// 全场音乐歌单 (房主播放, 所有人同步)
// 把mp3放进 public/music/ 文件夹, 然后改下面的src
export const MUSIC_PLAYLIST = [
  { id:'huayuluo', name:'花雨落', src:'music/花雨落.mp3' },
  { id:'suyue', name:'诉月', src:'music/诉月.mp3' },
  { id:'jie', name:'劫', src:'music/劫.mp3' },
  { id:'juxia', name:'居夏而夏', src:'music/居夏而夏.mp3' },
];
