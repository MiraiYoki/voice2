// ╔══════════════════════════════════════════╗
// ║ 10. INIT — 启动入口                       ║
// ╚══════════════════════════════════════════╝
// 规则: main.js 是唯一有副作用的入口文件
//       所有模块只 export 函数，不自动执行

import { state } from './state.js';
import { $ } from './utils.js';
import { MAP_IMG } from './config.js';
import { connectRegistry } from './registry.js';
import { setupJoystick, onKeyDown, onKeyUp, moveTick } from './input.js';
import { wireUI } from './ui.js';
import { drawMap, resizeCanvas } from './renderer.js';

function init() {
  // ── DOM 缓存初始化 ──
  state.dom.canvas = $('map-canvas');
  if (state.dom.canvas) {
    state.dom.ctx = state.dom.canvas.getContext('2d');
  }

  // ── 图片初始化 ──
  state.avatarImg = new Image();
  if (state.profileAvatar) {
    state.avatarImg.src = state.profileAvatar;
  }
  state.avatarImg.onload = () => { /* render loop 自动刷新 */ };

  state.mapImg = new Image();
  state.mapImg.src = MAP_IMG;
  state.mapImg.onload = () => {
    state.worldW = state.mapImg.naturalWidth || 1600;
    state.worldH = state.mapImg.naturalHeight || 1200;
    // 玩家出生在世界中心
    state.myPos.x = state.worldW / 2;
    state.myPos.y = state.worldH / 2;
  };

  // ── MQTT 房间发现 ──
  connectRegistry();

  // ── 输入设备 ──
  setupJoystick();
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup', onKeyUp);

  // ── UI 事件绑定 ──
  wireUI();

  // ── 角色恢复 ──
  const hpn = $('home-profile-name');
  if (hpn) hpn.textContent = state.profileName || '未设置角色';
  if (state.profileAvatar) {
    $('home-avatar-ring').innerHTML = '<img src="' + state.profileAvatar + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%">';
    $('avatar-preview').innerHTML = '<img src="' + state.profileAvatar + '" style="width:100%;height:100%;object-fit:cover">';
    $('self-color').style.backgroundImage = 'url(' + state.profileAvatar + ')';
  }

  // ── Canvas 初始大小 + 渲染循环启动 ──
  setTimeout(() => resizeCanvas(), 100);
  drawMap();

  // ── 移动 tick (~60fps) ──
  setInterval(() => { if (state.currentRoom) moveTick(); }, 16);
}

// 启动!
init();
