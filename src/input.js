// ╔══════════════════════════════════════════╗
// ║  7. InputController — 键盘 + 摇杆 + moveTick║
// ╚══════════════════════════════════════════╝

import { state } from './state.js';
import { $ } from './utils.js';
import { MOVE_SPEED, ROOM_SIZE } from './config.js';
import { updateSpatialAudio } from './audio.js';

// ── 7a. 键盘 ──
export function onKeyDown(e) {
  if (e.repeat) return;
  state.keysDown[e.key] = true;
  updateInputDir();
}

export function onKeyUp(e) {
  state.keysDown[e.key] = false;
  updateInputDir();
}

function updateInputDir() {
  let dx = 0, dy = 0;
  if (state.keysDown['w'] || state.keysDown['W'] || state.keysDown['ArrowUp'])    dy -= 1;
  if (state.keysDown['s'] || state.keysDown['S'] || state.keysDown['ArrowDown'])  dy += 1;
  if (state.keysDown['a'] || state.keysDown['A'] || state.keysDown['ArrowLeft'])  dx -= 1;
  if (state.keysDown['d'] || state.keysDown['D'] || state.keysDown['ArrowRight']) dx += 1;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len > 1) { dx /= len; dy /= len; }
  state.inputDir.x = dx;
  state.inputDir.y = dy;
  state.inputActive = len > 0.01;
}

// ── 7b. 摇杆 (nipplejs: Canvas渐变光环, 触摸+鼠标) ──
import nipplejs from 'nipplejs';

export function setupJoystick() {
  const zone = $('joystick-zone');
  if (!zone) return;

  const manager = nipplejs.create({
    zone,
    mode: 'static',
    position: { left: '50%', top: '50%' },
    color: '#9b4dff',
    size: 120,
    threshold: 0.15,
  });

  manager.on('move', (evt, data) => {
    state.inputDir.x = data.vector.x;
    state.inputDir.y = -data.vector.y; // nipplejs Y轴向上为正
    state.inputActive = data.distance > 8;
  });

  manager.on('end', () => {
    state.inputDir.x = 0;
    state.inputDir.y = 0;
    state.inputActive = false;
  });
}

// ── 7c. 移动tick (16ms ~60fps) ──
export function moveTick() {
  if (!state.inputActive || !state.currentRoom) return;
  const pad = 24;
  state.myPos.x = Math.max(pad, Math.min(state.myPos.x + state.inputDir.x * MOVE_SPEED, state.worldW - pad));
  state.myPos.y = Math.max(pad, Math.min(state.myPos.y + state.inputDir.y * MOVE_SPEED, state.worldH - pad));
  updateSpatialAudio();
}
