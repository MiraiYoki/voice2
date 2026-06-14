// ╔══════════════════════════════════════════╗
// ║  3. UTILS — 纯工具函数 + DOM 辅助 + 调试日志 ║
// ╚══════════════════════════════════════════╝

import { state } from './state.js';

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

// ── 调试日志系统 ──
const MAX_LOGS = 600;

export function addLog(cat, msg) {
  if (!state._logs) state._logs = [];
  const entry = { t: Date.now(), cat, msg };
  state._logs.push(entry);
  if (state._logs.length > MAX_LOGS) state._logs.splice(0, state._logs.length - MAX_LOGS);
  // 实时更新调试面板
  const panel = $('debug-list');
  if (panel && panel.style.display !== 'none') {
    appendLogDOM(entry);
  }
  console.log('[' + cat + ']', msg);
}

// 同时写 status bar + 日志
export function statusLog(msg) {
  const s = $('status');
  if (s) s.textContent = msg;
  console.log(msg);
  addLog('sys', msg);
}

function appendLogDOM(entry) {
  const panel = $('debug-list');
  if (!panel) return;
  const time = new Date(entry.t).toLocaleTimeString('zh-CN', { hour12: false });
  const tagColors = {
    conn: '#0891b2', audio: '#7c3aed', pos: '#16a34a',
    avatar: '#ea580c', sys: '#726d87', err: '#e04949',
  };
  const tagLabels = {
    conn: '连接', audio: '音频', pos: '位置',
    avatar: '头像', sys: '系统', err: '错误',
  };
  const c = tagColors[entry.cat] || '#726d87';
  const l = tagLabels[entry.cat] || entry.cat;
  const div = document.createElement('div');
  div.className = 'debug-line';
  div.style.cssText = 'padding:2px 0;font-size:11px;font-family:SF Mono,monospace;line-height:1.5';
  div.innerHTML = '<span style="color:#726d87">' + time + '</span> '
    + '<span style="display:inline-block;background:' + c + '22;color:' + c
    + ';padding:1px 5px;border-radius:3px;font-size:10px;margin-right:4px">' + l + '</span>'
    + '<span style="color:#e8e4f2">' + entry.msg + '</span>';
  panel.appendChild(div);
  // 自动滚到底部
  const wrap = $('debug-wrap');
  if (wrap) wrap.scrollTop = wrap.scrollHeight;
}

export function renderAllLogs(filter) {
  const panel = $('debug-list');
  if (!panel) return;
  panel.innerHTML = '';
  const logs = state._logs || [];
  const filtered = filter === 'all' ? logs : logs.filter(e => e.cat === filter);
  for (const e of filtered) appendLogDOM(e);
  const wrap = $('debug-wrap');
  if (wrap) wrap.scrollTop = wrap.scrollHeight;
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

// 聊天气泡 (每人最多4条, 超出挤掉最旧的)
export function addChatBubble(pid, text) {
  if (!state._chatBubbles) state._chatBubbles = [];
  // 统计此人现有气泡数
  const mine = state._chatBubbles.filter(b => b.pid === pid);
  if (mine.length >= 4) {
    // 移除最旧的一条
    const oldest = mine[0];
    const idx = state._chatBubbles.indexOf(oldest);
    if (idx !== -1) state._chatBubbles.splice(idx, 1);
  }
  state._chatBubbles.push({ pid, text, t: Date.now() });
  if (state._chatBubbles.length > 20) state._chatBubbles.shift();
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
