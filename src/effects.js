// ╔══════════════════════════════════════════╗
// ║  11. EffectsController — 全屏粒子特效      ║
// ╚══════════════════════════════════════════╝

import { state } from './state.js';
import { $ } from './utils.js';

let canvas, ctx, particles = [], running = false, effectName = '';
let _fxTimer = null, _fxInterval = null, _meteorTimer = null;
const MAX_PARTICLES = 200;

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
  if (_fxTimer) { clearTimeout(_fxTimer); _fxTimer = null; }
  if (_fxInterval) { clearInterval(_fxInterval); _fxInterval = null; }
  if (_meteorTimer) { clearInterval(_meteorTimer); _meteorTimer = null; }
  running = false;
  particles = [];
  effectName = name;
  running = true;
  canvas.style.display = 'block';
  spawnParticles(name);
  // 持续生成 (放这里确保执行, spawnParticles里的return会跳过后续代码)
  if (['petal','snow'].includes(name)) {
    _fxInterval = setInterval(() => {
      if (!running || effectName !== name) { clearInterval(_fxInterval); _fxInterval = null; return; }
      if (particles.length < MAX_PARTICLES) for (let i = 0; i < 8; i++) spawnParticles(name);
    }, 800);
  }
  if (name === 'meteor') {
    for (let i = 0; i < 3; i++) spawnParticles('meteor');
    _meteorTimer = setInterval(() => {
      if (!running || effectName !== name) { clearInterval(_meteorTimer); _meteorTimer = null; return; }
      spawnParticles('meteor');
    }, 1200);
  }
  if (name === 'firework') {
    for (let i = 0; i < 3; i++) spawnParticles('firework');
    _fxInterval = setInterval(() => {
      if (!running || effectName !== name) { clearInterval(_fxInterval); _fxInterval = null; return; }
      spawnParticles('firework');
    }, 900);
  }
  _fxTimer = setTimeout(() => { running = false; canvas.style.display = 'none'; particles = []; _fxTimer = null; }, 15000);
}

function spawnParticles(name) {
  if (!running || particles.length >= MAX_PARTICLES) return;
  const w = canvas.width, h = canvas.height;

  if (name === 'meteor') {
    if (particles.filter(p=>!p.trail).length >= 15) return; // 流星上限
    const fromLeft = Math.random() * w * 0.5;
    particles.push({
      x: fromLeft, y: -10 - Math.random() * 40,
      vx: 1.2 + Math.random() * 1.8, vy: 2.5 + Math.random() * 3,
      r: 1.5 + Math.random() * 2, len: 80 + Math.random() * 70,
      color: '#fbbf24', life: 0.5, trail: [],
    });
    return;
  }

  if (name === 'firework') {
    // 升空火箭: 从底部随机位置出发，竖直上升
    const launchX = w * 0.2 + Math.random() * w * 0.6;
    const colors = ['#f472b6','#fb923c','#fbbf24','#a3e635','#38bdf8','#c084fc'];
    const burstColor = colors[Math.floor(Math.random()*colors.length)];
    particles.push({
      x: launchX, y: h + 10,
      vx: (Math.random()-0.5) * 0.5, vy: -4 - Math.random() * 3,
      r: 2.5, life: 1, burstColor, phase: 'rise', // 'rise'→'burst'
      burstY: h * 0.15 + Math.random() * h * 0.35,
      friction: 1,
    });
    return;
  }

  const count = Math.min(80, MAX_PARTICLES - particles.length);
  for (let i = 0; i < count; i++) {
    switch (name) {
      case 'petal':
        particles.push({
          x: Math.random() * w, y: -10 - Math.random() * h,
          vx: (Math.random() - 0.5) * 0.7, vy: 0.6 + Math.random() * 1.2,
          r: 3 + Math.random() * 4, rot: Math.random() * Math.PI * 2, rotV: (Math.random() - 0.5) * 0.06,
          color: ['#f472b6','#fb7185','#f9a8d4','#fda4af','#fbcfe8'][Math.floor(Math.random()*5)],
          life: 1,
        });
        break;
      case 'snow':
        particles.push({
          x: Math.random() * w, y: -10 - Math.random() * h,
          vx: (Math.random() - 0.5) * 0.3, vy: 0.3 + Math.random() * 0.9,
          r: 2 + Math.random() * 4, rot: 0, rotV: (Math.random() - 0.5) * 0.02,
          color: '#fff', life: 1,
        });
        break;
      case 'firefly':
        particles.push({
          x: Math.random() * w, y: Math.random() * h,
          vx: (Math.random() - 0.5) * 0.5, vy: -0.2 - Math.random() * 0.6,
          r: 2 + Math.random() * 3, wPhase: Math.random() * Math.PI * 2,
          color: '#fde047', life: 1,
        });
        break;
      case 'firework':
        // burst particles (legacy, now handled above)
        break;
    }
  }
  // 持续补充 (在return之前就不会被执行, 移到triggerEffect里)
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
      if (p.friction && p.friction < 1) { p.vx *= p.friction; p.vy *= p.friction; }
      p.life -= 0.0008; // ~15s
      if (p.life <= 0) { particles.splice(i, 1); continue; }

      // 烟花升空 → 爆炸转换
      if (p.phase === 'rise' && p.y <= p.burstY) {
        // 爆炸!
        const colors = ['#f472b6','#fb923c','#fbbf24','#a3e635','#38bdf8','#c084fc'];
        for (let j = 0; j < 30; j++) {
          const a = Math.random() * Math.PI * 2;
          const spd = 2 + Math.random() * 4;
          particles.push({
            x: p.x, y: p.y, vx: Math.cos(a)*spd, vy: Math.sin(a)*spd,
            r: 1.5+Math.random()*2, life: 0.4, color: colors[Math.floor(Math.random()*colors.length)],
            friction: 0.9, phase: 'burst',
          });
        }
        // 移除火箭
        particles.splice(i, 1);
        continue;
      }

      const alpha = p.life < 0.3 ? p.life / 0.3 : 1;

      if (effectName === 'petal') {
        p.rot += p.rotV;
        ctx.save(); ctx.globalAlpha = alpha; ctx.fillStyle = p.color;
        ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.beginPath(); ctx.ellipse(0, 0, p.r, p.r*0.5, 0, 0, Math.PI*2); ctx.fill();
        ctx.restore();
      } else if (effectName === 'meteor') {
        ctx.save(); ctx.globalAlpha = alpha;
        // 金色渐变拖尾
        const tx = p.x - p.vx * 0.08 * p.len;
        const ty = p.y - p.vy * 0.08 * p.len;
        const grad = ctx.createLinearGradient(tx, ty, p.x, p.y);
        grad.addColorStop(0, 'rgba(251,191,36,0)');
        grad.addColorStop(0.4, 'rgba(251,191,36,0.5)');
        grad.addColorStop(1, 'rgba(255,255,255,0.9)');
        ctx.strokeStyle = grad; ctx.lineWidth = p.r * 2;
        ctx.shadowColor = '#fbbf24'; ctx.shadowBlur = 10;
        ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(p.x, p.y); ctx.stroke();
        // 头部光点
        ctx.fillStyle = '#fff'; ctx.shadowBlur = 20; ctx.shadowColor = '#fbbf24';
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 2.5, 0, Math.PI*2); ctx.fill();
        ctx.restore();
      } else if (effectName === 'snow') {
        p.rot += p.rotV;
        ctx.save(); ctx.globalAlpha = alpha*0.7; ctx.fillStyle = p.color;
        ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        for (let k=0;k<6;k++) { ctx.rotate(Math.PI/3); ctx.fillRect(-p.r*0.3,-p.r,p.r*0.6,p.r*2); }
        ctx.restore();
      } else if (effectName === 'firefly') {
        p.wPhase += 0.05; const glow = 0.3+0.7*Math.abs(Math.sin(p.wPhase));
        ctx.save(); ctx.globalAlpha = alpha*glow;
        const grad = ctx.createRadialGradient(p.x,p.y,0,p.x,p.y,p.r*4);
        grad.addColorStop(0,'rgba(253,224,71,0.8)'); grad.addColorStop(0.3,'rgba(253,224,71,0.3)'); grad.addColorStop(1,'rgba(253,224,71,0)');
        ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(p.x,p.y,p.r*4,0,Math.PI*2); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(p.x,p.y,p.r*0.5,0,Math.PI*2); ctx.fill();
        ctx.restore();
      } else if (effectName === 'firework') {
        ctx.save(); ctx.globalAlpha = alpha; ctx.fillStyle = p.color;
        ctx.shadowColor = p.color; ctx.shadowBlur = 4;
        ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,Math.PI*2); ctx.fill();
        ctx.restore();
      }
    }
    _fxAnim = requestAnimationFrame(loop);
  }
  _fxAnim = requestAnimationFrame(loop);
}