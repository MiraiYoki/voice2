// ╔══════════════════════════════════════════╗
// ║  2. STATE — 唯一可变状态源                 ║
// ╚══════════════════════════════════════════╝
// 规则: 所有模块 import { state } from './state.js'
//       读: state.myPos   写: state.myPos.x = ...
//       禁止各模块各自声明全局变量
//
// 调试: URL 加 ?debug 或 localStorage.voice-debug=1
//       所有 state 变更自动 console.trace 调用栈

const DEBUG = (() => {
  if (typeof URLSearchParams !== 'undefined') {
    const q = new URLSearchParams(location.search);
    if (q.get('debug') !== null) return true;
  }
  try { if (localStorage.getItem('voice-debug') === '1') return true; } catch (e) {}
  return false;
})();

// 原生对象类型，不递归代理
const RAW_TYPES = new Set([
  'Image', 'AudioContext', 'MediaStream', 'MediaStreamTrack',
  'HTMLCanvasElement', 'CanvasRenderingContext2D',
  'HTMLDivElement', 'HTMLElement', 'HTMLInputElement',
  'RTCPeerConnection', 'MediaStreamSource', 'PannerNode',
  'GainNode', 'AnalyserNode', 'AudioNode',
  'Room', 'LocalAudioTrack', 'LocalParticipant',
  'MqttClient',
]);

function isRaw(val) {
  if (val === null || val === undefined) return true;
  if (val instanceof Node) return true;  // DOM
  const name = val.constructor?.name;
  if (name && RAW_TYPES.has(name)) return true;
  return false;
}

function wrapMap(map, path) {
  const orig = { set: map.set, delete: map.delete, clear: map.clear };
  map.set = function (key, value) {
    if (DEBUG) console.trace(`[state] ${path}.set("${String(key)}")`);
    return orig.set.call(this, key, value);
  };
  map.delete = function (key) {
    if (DEBUG) console.trace(`[state] ${path}.delete("${String(key)}")`);
    return orig.delete.call(this, key);
  };
  map.clear = function () {
    if (DEBUG) console.trace(`[state] ${path}.clear()`);
    return orig.clear.call(this);
  };
  return map;
}

function createDebugProxy(target, path = 'state') {
  if (isRaw(target)) return target;
  if (target instanceof Map) return wrapMap(target, path);

  return new Proxy(target, {
    get(t, prop, recv) {
      const val = Reflect.get(t, prop, recv);
      if (typeof val === 'function') return val.bind(t);
      if (prop === 'constructor') return val;
      if (isRaw(val)) return val;
      if (val instanceof Map) return wrapMap(val, `${path}.${String(prop)}`);
      if (typeof val === 'object' && val !== null) {
        return createDebugProxy(val, `${path}.${String(prop)}`);
      }
      return val;
    },
    set(t, prop, value, recv) {
      const full = `${path}.${String(prop)}`;
      if (DEBUG && t[prop] !== value) console.trace(`[state] ${full} =`, value);
      return Reflect.set(t, prop, value, recv);
    },
    deleteProperty(t, prop) {
      if (DEBUG) console.trace(`[state] delete ${path}.${String(prop)}`);
      return Reflect.deleteProperty(t, prop);
    },
  });
}

const _rawState = {
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
  peers: wrapMap(new Map(), 'peers'),   // pid → {x,y,name,color,stream,panner,gainNode,source,_snaps,...}
  rooms: wrapMap(new Map(), 'rooms'),   // roomName → {hasPassword,memberCount,_createdAt}

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

export const state = DEBUG ? createDebugProxy(_rawState) : _rawState;
