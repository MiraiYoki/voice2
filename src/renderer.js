// ╔══════════════════════════════════════════╗
// ║  6. RenderController — Canvas 2D 地图渲染  ║
// ╚══════════════════════════════════════════╝
// 对标 spatial-audio GameView + Camera + Character
// 新增: 远程头像渲染 (从 DataChannel avatar 字段)

import { state } from './state.js';
import { $, shadeColor } from './utils.js';
import { DR_MAX_TIME, DR_BLEND_SPEED } from './config.js';

// ── 6a. 坐标转换 & 相机 ──
export function resizeCanvas() {
  const wrap = $('map-wrap');
  if (!wrap || !state.dom.canvas) return;
  const w = wrap.clientWidth, h = wrap.clientHeight;
  state.dom.canvas.width = w * devicePixelRatio;
  state.dom.canvas.height = h * devicePixelRatio;
  state.dom.ctx.setTransform(1, 0, 0, 1, 0, 0);
  state.dom.ctx.scale(devicePixelRatio, devicePixelRatio);
}

function w2s(wx, wy) {
  return {
    x: wx - state.camX,
    y: wy - state.camY,
  };
}

function updateCam() {
  if (!state.dom.canvas) return;
  const cw = state.dom.canvas.width / devicePixelRatio;
  const ch = state.dom.canvas.height / devicePixelRatio;
  if (cw <= 0 || ch <= 0) return;

  // 目标位置：玩家居中
  let tx = state.myPos.x - cw / 2;
  let ty = state.myPos.y - ch / 2;

  // 钳制：viewport 不超出世界边界
  // 当 viewport 比世界大时，居中显示世界
  if (cw >= state.worldW) {
    tx = (state.worldW - cw) / 2;
  } else {
    tx = Math.max(0, Math.min(tx, state.worldW - cw));
  }
  if (ch >= state.worldH) {
    ty = (state.worldH - ch) / 2;
  } else {
    ty = Math.max(0, Math.min(ty, state.worldH - ch));
  }

  // 平滑跟随
  state.camX += (tx - state.camX) * 0.12;
  state.camY += (ty - state.camY) * 0.12;

  // 硬钳制：确保 lerp 不会越界
  if (cw < state.worldW) {
    state.camX = Math.max(0, Math.min(state.camX, state.worldW - cw));
  }
  if (ch < state.worldH) {
    state.camY = Math.max(0, Math.min(state.camY, state.worldH - ch));
  }
}

// ── 6b. 主渲染循环 ──
export function drawMap() {
  if (!state.dom.ctx) return;

  // 自愈: 检测 canvas 尺寸是否匹配容器，不匹配就 resize
  const wrap = document.getElementById('map-wrap');
  if (wrap) {
    const w = wrap.clientWidth * devicePixelRatio;
    const h = wrap.clientHeight * devicePixelRatio;
    if (w > 0 && h > 0 && (state.dom.canvas.width !== w || state.dom.canvas.height !== h)) {
      resizeCanvas();
    }
  }

  const ctx = state.dom.ctx;
  const cw = state.dom.canvas.width / devicePixelRatio;
  const ch = state.dom.canvas.height / devicePixelRatio;
  if (cw <= 0 || ch <= 0) return; // 还没显示，跳过这帧

  updateCam();

  // 背景
  ctx.fillStyle = '#1a1730';
  ctx.fillRect(0, 0, cw, ch);
  if (state.mapImg && state.mapImg.complete && state.mapImg.naturalWidth) {
    ctx.drawImage(state.mapImg, -state.camX, -state.camY, state.worldW, state.worldH);
  }

  // 网格
  ctx.strokeStyle = 'rgba(155,77,255,0.04)';
  ctx.lineWidth = 0.5;
  const gs = 80;
  const sx = ((-state.camX % gs) + gs) % gs;
  const sy = ((-state.camY % gs) + gs) % gs;
  for (let x = sx; x < cw; x += gs) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, ch); ctx.stroke(); }
  for (let y = sy; y < ch; y += gs) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(cw, y); ctx.stroke(); }

  // 边界 + 边界外遮罩
  ctx.strokeStyle = 'rgba(155,77,255,0.12)';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(-state.camX, -state.camY, state.worldW, state.worldH);
  // 世界外区域涂黑，视觉上明确边界
  ctx.fillStyle = '#0d0a1a';
  if (-state.camX > 0) ctx.fillRect(0, 0, -state.camX, ch);
  if (-state.camX + state.worldW < cw) ctx.fillRect(-state.camX + state.worldW, 0, cw, ch);
  if (-state.camY > 0) ctx.fillRect(0, 0, cw, -state.camY);
  if (-state.camY + state.worldH < ch) ctx.fillRect(0, -state.camY + state.worldH, cw, ch);

  const now = Date.now();
  const renderDelay = 100;

  // 绘制 peers (100ms 快照插值 + 死推算)
  for (const [pid, p] of state.peers) {
    if (!p._snaps || p._snaps.length === 0) { /* 无位置数据，留原地 */ }
    else {
      const targetTime = now - renderDelay;
      const snaps = p._snaps;
      let i = 0;
      while (i < snaps.length - 1 && snaps[i + 1].t < targetTime) i++;
      let rx, ry;

      if (i >= snaps.length - 1) {
        // 没有能包围 targetTime 的快照对 → 死推算 or 取最后位置
        const last = snaps[snaps.length - 1];
        const age = now - last.t;

        // 计算速度（从最后两个快照）
        if (!p._drVx) p._drVx = 0;
        if (!p._drVy) p._drVy = 0;
        if (snaps.length >= 2) {
          const a = snaps[snaps.length - 2];
          const b = last;
          const dv = (b.t - a.t) || 50;
          p._drVx = (b.x - a.x) / dv;
          p._drVy = (b.y - a.y) / dv;
        }

        if (age < DR_MAX_TIME) {
          // 死推算：沿速度方向外推
          const dt = (targetTime - last.t);
          rx = last.x + p._drVx * dt;
          ry = last.y + p._drVy * dt;
        } else {
          // 太久没更新，冻结在最后位置
          rx = last.x;
          ry = last.y;
        }
      } else {
        // 正常插值
        const a = snaps[i], b = snaps[i + 1];
        const dt = b.t - a.t || 16;
        const t = Math.max(0, Math.min(1, (targetTime - a.t) / dt));
        rx = a.x + (b.x - a.x) * t;
        ry = a.y + (b.y - a.y) * t;
        // 插值可用时重置死推算速度（新数据到了）
        p._drVx = 0;
        p._drVy = 0;
      }

      // 从推算/插值位置平滑回弹
      const errDist = Math.sqrt((rx - p.x) ** 2 + (ry - p.y) ** 2);
      if (errDist > 8) {
        // DR 过度外推，直接吸附避免可见回弹
        p.x = rx;
        p.y = ry;
      } else {
        const speed = p._drVx !== 0 || p._drVy !== 0 ? DR_BLEND_SPEED : 0.3;
        p.x += (rx - p.x) * speed;
        p.y += (ry - p.y) * speed;
      }
    }
    drawPeer(ctx, pid, p);
  }

  // 自己
  drawSelf(ctx);

  // 聊天气泡 DOM
  renderChatBubbles();

  requestAnimationFrame(drawMap);
}

// ── 聊天气泡渲染 (堆叠, 15s渐消上移) ──
function renderChatBubbles() {
  const wrap = document.querySelector('.app');
  if (!wrap) return;
  const mapWrap = document.getElementById('map-wrap');
  const mapRect = mapWrap ? mapWrap.getBoundingClientRect() : null;
  const now = Date.now();
  const bubbles = state._chatBubbles || [];

  // 清理过期 (>15s)
  for (let i = bubbles.length - 1; i >= 0; i--) {
    if (now - bubbles[i].t > 10000) bubbles.splice(i, 1);
  }

  // 清理旧 DOM
  document.querySelectorAll('.chat-bubble').forEach(el => el.remove());

  // 按 pid 分组, 计算层叠偏移
  const groups = {};
  for (const bub of bubbles) {
    if (!groups[bub.pid]) groups[bub.pid] = [];
    groups[bub.pid].push(bub);
  }

  for (const bub of bubbles) {
    let wx, wy;
    if (bub.pid === state.myPeerId) {
      wx = state.myPos.x; wy = state.myPos.y;
    } else {
      const p = state.peers.get(bub.pid);
      if (!p) continue;
      wx = p.x; wy = p.y;
    }
    // 世界坐标 → 地图内屏幕坐标 → app内绝对坐标
    const sp = w2s(wx, wy);
    const px = (mapRect ? mapRect.left : 0) + sp.x;
    const py = (mapRect ? mapRect.top : 0) + sp.y - 55;
    // 层叠偏移
    const pidBubs = groups[bub.pid] || [bub];
    const idx = pidBubs.indexOf(bub);
    const stackOffset = (pidBubs.length - 1 - idx) * 28;

    const el = document.createElement('div');
    el.className = 'chat-bubble';
    el.style.left = px + 'px';
    el.style.top = (py - stackOffset) + 'px';
    el.textContent = bub.text;
    wrap.appendChild(el);
  }
}

// ── 6c. 远程玩家 ──
function drawPeer(ctx, pid, p) {
  const sp = w2s(p.x, p.y), r = 18;
  const isSpk = p.smoothedVol > 3;

  // 说话光环
  if (isSpk) {
    const g = ctx.createRadialGradient(sp.x, sp.y, r * 0.5, sp.x, sp.y, r * 2);
    g.addColorStop(0, 'rgba(255,255,255,.7)');
    g.addColorStop(0.5, 'rgba(155,77,255,.3)');
    g.addColorStop(1, 'rgba(155,77,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(sp.x, sp.y, r * 2, 0, Math.PI * 2); ctx.fill();

    // ping 波纹
    if (!p._pingP) p._pingP = 0;
    p._pingP += 0.03;
    if (p._pingP > 1) p._pingP = 0;
    ctx.strokeStyle = 'rgba(155,77,255,' + (0.5 * (1 - p._pingP)) + ')';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(sp.x, sp.y, r * (1 + p._pingP * 1.5), 0, Math.PI * 2); ctx.stroke();
  }

  // 头像 or 色块回退
  if (p.avatar) {
    if (!p._avatarImg) { p._avatarImg = new Image(); p._avatarImg.src = p.avatar; }
    if (p._avatarImg.complete && p._avatarImg.naturalWidth) {
      ctx.save();
      ctx.beginPath(); ctx.arc(sp.x, sp.y, r, 0, Math.PI * 2); ctx.clip();
      ctx.drawImage(p._avatarImg, sp.x - r, sp.y - r, r * 2, r * 2);
      ctx.restore();
    } else {
      drawPeerColor(ctx, sp, r, isSpk, p, pid);
    }
  } else {
    drawPeerColor(ctx, sp, r, isSpk, p, pid);
  }

  // mic 状态环 (绿=开, 红=关)
  if (p.micOn === false) {
    ctx.strokeStyle = 'rgba(224,73,73,0.4)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(sp.x, sp.y, r + 3, 0, Math.PI * 2); ctx.stroke();
  } else {
    ctx.strokeStyle = 'rgba(34,197,94,0.3)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(sp.x, sp.y, r + 3, 0, Math.PI * 2); ctx.stroke();
  }

  // 名字
  ctx.fillStyle = 'rgba(255,255,255,.85)';
  ctx.font = '10px -apple-system,system-ui,sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText((p.name || pid || '').slice(-8), sp.x, sp.y + r + 12);
}

function drawPeerColor(ctx, sp, r, isSpk, p, pid) {
  const color = p.color || '#7c3aed';
  const grad = ctx.createLinearGradient(sp.x - r, sp.y - r, sp.x + r, sp.y + r);
  grad.addColorStop(0, color);
  grad.addColorStop(1, shadeColor(color, -30));
  ctx.fillStyle = grad;
  ctx.beginPath(); ctx.arc(sp.x, sp.y, r, 0, Math.PI * 2); ctx.fill();

  ctx.strokeStyle = isSpk ? '#fff' : 'rgba(255,255,255,.2)';
  ctx.lineWidth = isSpk ? 2.5 : 1.5;
  ctx.beginPath(); ctx.arc(sp.x, sp.y, r, 0, Math.PI * 2); ctx.stroke();

  ctx.fillStyle = '#fff';
  ctx.font = 'bold 14px -apple-system,system-ui,sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText((p.name || pid || '?')[0].toUpperCase(), sp.x, sp.y);
}

// ── 6d. 自己 ──
function drawSelf(ctx) {
  const mp = w2s(state.myPos.x, state.myPos.y), mr = 20;
  const selfSpk = (state.localVol || 0) > 5;

  // 说话光环 (自己)
  if (selfSpk) {
    const sg = ctx.createRadialGradient(mp.x, mp.y, mr * 0.5, mp.x, mp.y, mr * 2.5);
    sg.addColorStop(0, 'rgba(255,255,255,.6)');
    sg.addColorStop(0.5, 'rgba(34,197,94,.25)');
    sg.addColorStop(1, 'rgba(34,197,94,0)');
    ctx.fillStyle = sg;
    ctx.beginPath(); ctx.arc(mp.x, mp.y, mr * 2.5, 0, Math.PI * 2); ctx.fill();
  }

  // 常驻光环
  const mg = ctx.createRadialGradient(mp.x, mp.y, mr * 0.3, mp.x, mp.y, mr * 2.2);
  mg.addColorStop(0, 'rgba(255,255,255,.4)');
  mg.addColorStop(1, 'rgba(155,77,255,0)');
  ctx.fillStyle = mg;
  ctx.beginPath(); ctx.arc(mp.x, mp.y, mr * 2.2, 0, Math.PI * 2); ctx.fill();

  // 圆
  const myGrad = ctx.createLinearGradient(mp.x - mr, mp.y - mr, mp.x + mr, mp.y + mr);
  myGrad.addColorStop(0, '#9b4dff');
  myGrad.addColorStop(1, '#6d28d9');
  ctx.fillStyle = myGrad;
  ctx.beginPath(); ctx.arc(mp.x, mp.y, mr, 0, Math.PI * 2); ctx.fill();

  // 边框
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(mp.x, mp.y, mr, 0, Math.PI * 2); ctx.stroke();

  // 头像/首字母
  if (state.avatarImg && state.avatarImg.complete && state.avatarImg.src && state.profileAvatar) {
    ctx.save();
    ctx.beginPath(); ctx.arc(mp.x, mp.y, mr, 0, Math.PI * 2); ctx.clip();
    ctx.drawImage(state.avatarImg, mp.x - mr, mp.y - mr, mr * 2, mr * 2);
    ctx.restore();
  } else {
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 15px -apple-system,system-ui,sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText((state.profileName || '我')[0], mp.x, mp.y);
  }

  // 名字
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 11px -apple-system,system-ui,sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(state.profileName || '我', mp.x, mp.y + mr + 14);
}
