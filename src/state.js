// ╔══════════════════════════════════════════╗
// ║  2. STATE — 唯一可变状态源                 ║
// ╚══════════════════════════════════════════╝
// 规则: 所有模块 import { state } from './state.js'
//       读: state.myPos   写: state.myPos.x = ...
//       禁止各模块各自声明全局变量

export const state = {
  // ── 身份 & 房间 ──
  myPeerId: null,
  currentRoom: null,
  isRoomCreator: false,

  // ── 角色 ──
  profileName:  localStorage.getItem('voice-profile-name') || '',
  profileAvatar: localStorage.getItem('voice-profile-avatar') || '',

  // ── MQTT ──
  regMqtt: null,

  // ── 音频 ──
  localStream: null,
  audioCtx: null,
  micOn: true,
  micBusy: false,

  // ── 地图 & 相机 ──
  worldW: 1600,
  worldH: 1200,
  camX: 0,
  camY: 0,
  myPos: { x: 400, y: 400 },

  // ── 输入 ──
  inputDir:    { x: 0, y: 0 },
  inputActive: false,
  keysDown: {},

  // ── Ducking ──
  duckTimer: null,

  // ── 集合 ──
  peers: new Map(),   // pid → {x,y,name,color,stream,panner,gainNode,source,_snaps,...}
  rooms: new Map(),   // roomName → {hasPassword,memberCount,_createdAt}

  // ── 图片 ──
  avatarImg: null,    // new Image() — 由 main.js 初始化
  mapImg:    null,    // new Image() — 由 main.js 初始化

  // ── LiveKit ──
  _lkRoom: null,
  _dcIntervals: [],

  // ── DOM 缓存 (初始化在 main.js) ──
  dom: {
    canvas: null,
    ctx: null,
    joystick: null,
    stick: null,
  },
};
