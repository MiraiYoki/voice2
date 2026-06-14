// ╔══════════════════════════════════════════╗
// ║ 10. INIT — 启动入口                       ║
// ╚══════════════════════════════════════════╝
// 规则: main.js 是唯一有副作用的入口文件
//       所有模块只 export 函数，不自动执行

import { state } from './state.js';
import { $ } from './utils.js';
import { MAP_THEMES } from './config.js';
import { connectRegistry } from './registry.js';
import { setupJoystick, onKeyDown, onKeyUp, moveTick } from './input.js';
import { wireUI } from './ui.js';
import { drawMap, resizeCanvas } from './renderer.js';
import { initEffects, startFxLoop, resizeFx } from './effects.js';

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

  // 地图主题 (localStorage 持久化)
  try { state.mapTheme = localStorage.getItem('voice-map-theme') || 'default'; } catch(e) {}
  try { state._musicVol = parseFloat(localStorage.getItem('voice-music-vol')) || 0.25; } catch(e) {}
  try { state._sfxVol = parseFloat(localStorage.getItem('voice-sfx-vol')) || 0.5; } catch(e) {}
  const theme = MAP_THEMES.find(t => t.id === state.mapTheme) || MAP_THEMES[0];

  state.mapImg = new Image();
  state.mapImg.onerror = () => { state.worldW = 1600; state.worldH = 1200; state.myPos.x = 800; state.myPos.y = 600; };
  state.mapImg.src = theme.src;
  state.mapImg.onload = () => {
    state.worldW = state.mapImg.naturalWidth || 1600;
    state.worldH = state.mapImg.naturalHeight || 1200;
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
  initEffects();
  startFxLoop();

  // ── 角色恢复 ──
  const hpn = $('home-profile-name');
  if (hpn) hpn.textContent = state.profileName || '未设置角色';
  // 清除旧版超大头像 (>50KB 无法通过 DataChannel 发送)
  if (state.profileAvatar && state.profileAvatar.length > 50000) {
    localStorage.removeItem('voice-profile-avatar');
    state.profileAvatar = '';
  }
  if (state.profileAvatar) {
    $('home-avatar-ring').innerHTML = '<img src="' + state.profileAvatar + '" alt="头像" style="width:100%;height:100%;object-fit:cover;border-radius:50%">';
    $('avatar-preview').innerHTML = '<img src="' + state.profileAvatar + '" alt="头像预览" style="width:100%;height:100%;object-fit:cover">';
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
