// ╔══════════════════════════════════════════╗
// ║  7. InputController — 键盘 + 摇杆 + moveTick║
// ╚══════════════════════════════════════════╝

import { state } from './state.js';
import { $ } from './utils.js';
import { MOVE_SPEED, ROOM_SIZE } from './config.js';
import { updateSpatialAudio, checkSubscriptions } from './audio.js';

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

// ── 7b. 摇杆 (移动端 touch + 桌面端 mouse) ──
export function setupJoystick() {
  const joy = $('joystick'), stick = $('joystick-stick');
  state.dom.joystick = joy;
  state.dom.stick = stick;
  if (!joy || !stick) return;

  const maxR = 40;
  let active = false;

  function move(e) {
    const t = e.touches ? e.touches[0] : e;
    const rect = joy.getBoundingClientRect();
    let dx = t.clientX - (rect.left + rect.width / 2);
    let dy = t.clientY - (rect.top + rect.height / 2);
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > maxR) { dx = dx / dist * maxR; dy = dy / dist * maxR; }
    stick.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
    if (dist > 8) {
      joy.classList.add('active');
      state.inputDir.x = dx / maxR;
      state.inputDir.y = dy / maxR;
      state.inputActive = true;
    } else {
      joy.classList.remove('active');
      state.inputDir.x = 0;
      state.inputDir.y = 0;
      state.inputActive = false;
    }
  }

  function up() {
    stick.style.transform = 'translate(0,0)';
    joy.classList.remove('active');
    state.inputDir.x = 0;
    state.inputDir.y = 0;
    state.inputActive = false;
  }

  // Touch
  joy.addEventListener('touchstart', e => { e.preventDefault(); active = true; move(e); }, { passive: false });
  joy.addEventListener('touchmove',  e => { e.preventDefault(); if (active) move(e); }, { passive: false });
  joy.addEventListener('touchend',   e => { e.preventDefault(); active = false; up(); }, { passive: false });
  joy.addEventListener('touchcancel', e => { active = false; up(); });
  // Mouse (桌面)
  joy.addEventListener('mousedown', e => { e.preventDefault(); active = true; move(e); });
  document.addEventListener('mousemove', e => { if (active) move(e); });
  document.addEventListener('mouseup', e => { active = false; up(); });
}

// ── 7c. 移动tick (16ms ~60fps) ──
export function moveTick() {
  if (!state.inputActive || !state.currentRoom) return;
  const pad = 24;
  state.myPos.x = Math.max(pad, Math.min(state.myPos.x + state.inputDir.x * MOVE_SPEED, state.worldW - pad));
  state.myPos.y = Math.max(pad, Math.min(state.myPos.y + state.inputDir.y * MOVE_SPEED, state.worldH - pad));
  updateSpatialAudio();
  checkSubscriptions();  // 响应式：我移动了，检查订阅
}
