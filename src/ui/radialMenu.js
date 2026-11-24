// Radial (pie) menu: opens on RMB click or while holding Space. Tools around, size/strength/color in the middle.
import { app } from '../app/state.js';
import { t } from '../i18n/index.js';
import { TOOLS } from '../engine/brush.js';
import { rgb2hex, hex2rgb } from '../utils/color.js';
import { $, $$ } from './dom.js';
import { ICONS } from './icons.js';
import { setTool, syncBrushInputs } from './brushPanel.js';
import { setColor } from './colorPicker.js';

let state = null; // { viaKey: boolean, hot: toolName | null } while open

export const getRadialState = () => state;

export function openRadial(x, y, viaKey) {
  const vpRect = $('#viewport').getBoundingClientRect();
  const el = $('#radial');
  const cx = Math.min(Math.max(x - vpRect.left, 140), vpRect.width - 140);
  const cy = Math.min(Math.max(y - vpRect.top, 140), vpRect.height - 140);
  el.style.left = `${cx}px`; el.style.top = `${cy}px`;
  const b = app.brush;
  let html = '<div class="ring"></div>';
  TOOLS.forEach((tool, i) => {
    const a = (i / TOOLS.length) * Math.PI * 2 - Math.PI / 2;
    html += `<div class="item${b.tool === tool ? ' hot' : ''}" data-tool="${tool}" style="left:${Math.cos(a) * 98}px;top:${Math.sin(a) * 98}px">${ICONS[tool]}<span>${t('tool_' + tool)}</span></div>`;
  });
  html += `<div class="center">
    <label>${t('radialSize')}</label><input type="range" min="4" max="400" value="${b.size}" data-r="size">
    <label>${t('radialStrength')}</label><input type="range" min="0.01" max="1" step="0.01" value="${b.strength}" data-r="strength">
    <input type="color" value="${rgb2hex(b.color)}" data-r="color" title="${t('radialColor')}">
  </div>`;
  el.innerHTML = html;
  el.hidden = false;
  state = { viaKey, hot: null };
  $$('.item', el).forEach((it) => {
    it.addEventListener('pointerenter', () => { state && (state.hot = it.dataset.tool); });
    it.addEventListener('pointerleave', () => { state && (state.hot = null); });
    it.addEventListener('click', () => { setTool(it.dataset.tool); closeRadial(); });
  });
  $$('[data-r]', el).forEach((inp) => inp.addEventListener('input', () => {
    if (inp.dataset.r === 'color') setColor(hex2rgb(inp.value));
    else { b[inp.dataset.r] = +inp.value; syncBrushInputs(); }
  }));
}

export function closeRadial() { $('#radial').hidden = true; state = null; }

/** Close when clicking anywhere outside the menu. */
export function setupRadialMenu() {
  document.addEventListener('pointerdown', (e) => { if (state && !e.target.closest('#radial')) closeRadial(); }, true);
}
