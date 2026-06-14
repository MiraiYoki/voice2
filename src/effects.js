// ╔══════════════════════════════════════════╗
// ║  11. EffectsController — 全屏粒子特效      ║
// ╚══════════════════════════════════════════╝

import { state } from './state.js';
import { $ } from './utils.js';

let canvas, ctx, particles = [], running = false, effectName = '';

export function initEffects() {
  canvas = $('fx-canvas');
  if (!canvas) return;
  ctx = canvas.getContext('2d');
  resizeFx();
}

export function resizeFx() {
  if (!canvas) return;
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}

export function triggerEffect(name) {
  effectName = name;
  particles = [];
  running = true;
  canvas.style.display = 'block';
  spawnParticles(name);
  setTimeout(() => { running = false; canvas.style.display = 'none'; particles = []; }, 6000);
}

// ── 粒子生成 ──
function spawnParticles(name) {
  const w = canvas.width, h = canvas.height;
  const count = 80;
  for (let i = 0; i < count; i++) {
    switch (name) {
      case 'petal': // 花瓣雨
        particles.push({
          x: Math.random() * w, y: -10 - Math.random() * h,
          vx: (Math.random() - 0.5) * 1.2, vy: 1 + Math.random() * 2,
          r: 3 + Math.random() * 4, rot: Math.random() * Math.PI * 2, rotV: (Math.random() - 0.5) * 0.1,
          color: ['#f472b6','#fb7185','#f9a8d4','#fda4af','#fbcfe8'][Math.floor(Math.random()*5)],
          life: 1,
        });
        break;
      case 'meteor': // 金色流星
        const angle = Math.random() * Math.PI * 0.5 + Math.PI * 0.25;
        const speed = 5 + Math.random() * 10;
        particles.push({
          x: Math.random() * w, y: Math.random() * h * 0.3,
          vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
          r: 1 + Math.random() * 2, len: 40 + Math.random() * 60,
          color: '#fbbf24', life: 1, trail: [],
        });
        break;
      case 'snow': // 雪花
        particles.push({
          x: Math.random() * w, y: -10 - Math.random() * h,
          vx: (Math.random() - 0.5) * 0.5, vy: 0.5 + Math.random() * 1.5,
          r: 2 + Math.random() * 4, rot: 0, rotV: (Math.random() - 0.5) * 0.03,
          color: '#fff', life: 1,
        });
        break;
      case 'firefly': // 萤火虫
        particles.push({
          x: Math.random() * w, y: Math.random() * h,
          vx: (Math.random() - 0.5) * 0.8, vy: -0.3 - Math.random() * 1,
          r: 2 + Math.random() * 3, wPhase: Math.random() * Math.PI * 2,
          color: '#fde047', life: 1,
        });
        break;
      case 'firework': // 烟花
        const cx = w * 0.3 + Math.random() * w * 0.4;
        const cy = h * 0.2 + Math.random() * h * 0.4;
        const colors = ['#f472b6','#fb923c','#fbbf24','#a3e635','#38bdf8','#c084fc'];
        for (let j = 0; j < 40; j++) {
          const a = Math.random() * Math.PI * 2;
          const spd = 2 + Math.random() * 4;
          particles.push({
            x: cx, y: cy,
            vx: Math.cos(a) * spd, vy: Math.sin(a) * spd,
            r: 1.5 + Math.random() * 2, life: 1,
            color: colors[Math.floor(Math.random() * colors.length)], friction: 0.98,
          });
        }
        break;
    }
  }
  // 持续补充粒子
  if (['petal','snow','meteor'].includes(name)) {
    const iv = setInterval(() => {
      if (!running || effectName !== name) { clearInterval(iv); return; }
      // small batch
      for (let i = 0; i < 10; i++) spawnParticles(name);
    }, 800);
  }
}

// ── 渲染循环 ──
let _fxAnim = null;

export function startFxLoop() {
  if (_fxAnim) return;
  function loop() {
    if (!running || !ctx) { _fxAnim = requestAnimationFrame(loop); return; }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx;
      p.y += p.vy;
      if (p.friction) { p.vx *= p.friction; p.vy *= p.friction; }
      p.life -= 0.002;
      if (p.life <= 0) { particles.splice(i, 1); continue; }

      const alpha = p.life < 0.3 ? p.life / 0.3 : 1;

      if (effectName === 'petal') {
        p.rot += p.rotV;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = p.color;
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.beginPath();
        ctx.ellipse(0, 0, p.r, p.r * 0.5, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      } else if (effectName === 'meteor') {
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = p.r;
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.vx / 10 * p.len, p.y - p.vy / 10 * p.len);
        ctx.stroke();
        // head glow
        ctx.fillStyle = '#fff';
        ctx.shadowBlur = 15;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * 1.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      } else if (effectName === 'snow') {
        p.rot += p.rotV;
        ctx.save();
        ctx.globalAlpha = alpha * 0.7;
        ctx.fillStyle = p.color;
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        // draw snowflake (6-pointed)
        for (let k = 0; k < 6; k++) {
          ctx.rotate(Math.PI / 3);
          ctx.fillRect(-p.r * 0.3, -p.r, p.r * 0.6, p.r * 2);
        }
        ctx.restore();
      } else if (effectName === 'firefly') {
        p.wPhase += 0.05;
        const glow = 0.3 + 0.7 * Math.abs(Math.sin(p.wPhase));
        ctx.save();
        ctx.globalAlpha = alpha * glow;
        const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 4);
        grad.addColorStop(0, 'rgba(253,224,71,0.8)');
        grad.addColorStop(0.3, 'rgba(253,224,71,0.3)');
        grad.addColorStop(1, 'rgba(253,224,71,0)');
        ctx.fillStyle = grad;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 4, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 0.5, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      } else if (effectName === 'firework') {
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = p.color;
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 4;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }
    }
    _fxAnim = requestAnimationFrame(loop);
  }
  _fxAnim = requestAnimationFrame(loop);
}