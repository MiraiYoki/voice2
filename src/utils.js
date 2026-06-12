// ╔══════════════════════════════════════════╗
// ║  3. UTILS — 纯工具函数 + DOM 辅助         ║
// ╚══════════════════════════════════════════╝

// DOM 快捷查询
export const $ = (id) => document.getElementById(id);

// Toast 消息
export function toast(msg) {
  const t = document.createElement('div');
  t.textContent = msg;
  t.style.cssText = [
    'position:fixed;bottom:80px;left:50%;transform:translateX(-50%)',
    'background:var(--text);color:var(--bg)',
    'padding:10px 20px;border-radius:20px;font-size:13px;font-weight:500',
    'z-index:100;pointer-events:none',
  ].join(';');
  document.body.appendChild(t);
  setTimeout(() => {
    t.style.opacity = '0';
    t.style.transition = 'opacity .3s';
    setTimeout(() => t.remove(), 300);
  }, 2000);
}

// 字符串哈希 → 用作 peerId
export function simpleHash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}

// 面板切换 (同时只显示一个)
const PANEL_IDS = ['home-panel','room-panel','profile-panel','create-panel'];
export function showPanel(name) {
  PANEL_IDS.forEach(id => { const p = $(id); if (p) p.style.display = 'none'; });
  const p = $(name);
  if (p) p.style.display = '';
}

// 颜色加深/变浅 (给头像渐变用)
export function shadeColor(c, pct) {
  const n = parseInt(c.replace('#', ''), 16);
  const a = Math.round(2.55 * pct);
  const R = Math.max(0, Math.min(255, (n >> 16) + a));
  const G = Math.max(0, Math.min(255, (n >> 8 & 0xFF) + a));
  const B = Math.max(0, Math.min(255, (n & 0xFF) + a));
  return '#' + (0x1000000 + R * 0x10000 + G * 0x100 + B).toString(16).slice(1);
}
