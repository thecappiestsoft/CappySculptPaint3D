// Left panel: tool buttons, brush sliders, channels, alpha library, brush settings, tablet curve, symmetry.
import { app } from '../app/state.js';
import { t } from '../i18n/index.js';
import { TOOLS } from '../engine/brush.js';
import { ALPHAS, evalAlpha } from '../engine/noise.js';
import { $, $$ } from './dom.js';
import { ICONS } from './icons.js';
import { bindSlider, refreshOutputs, fillSelect } from './widgets.js';
import { updateCursor } from '../viewport/paintInput.js';

// ---------- tools
export function buildTools() {
  $('#tools').innerHTML = TOOLS.map((tool, i) => `<button class="tool" data-tool="${tool}">${ICONS[tool]}<span data-i18n="tool_${tool}"></span><kbd>${i + 1}</kbd></button>`).join('');
  $$('#tools .tool').forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool)));
}
export function setTool(tool) {
  app.brush.tool = tool;
  $$('#tools .tool').forEach((b) => b.classList.toggle('on', b.dataset.tool === tool));
  updateCursor();
}
export function refreshToolTitles() { $$('#tools .tool').forEach((b) => { b.title = t('tip_' + b.dataset.tool); }); }

/** Call after changing app.brush from code (keyboard, radial menu). */
export function syncBrushInputs() { refreshOutputs(); updateCursor(); }

// ---------- symmetry
export function toggleSym(axis) {
  app.brush.symmetry[axis] = !app.brush.symmetry[axis];
  $$('.sym-btn').forEach((btn) => btn.classList.toggle('on', app.brush.symmetry[btn.dataset.sym]));
}

// ---------- pressure curve preview
export function drawCurve() {
  const cv = $('#curveCanvas'), ctx = cv.getContext('2d'), W = cv.width, H = cv.height;
  ctx.clearRect(0, 0, W, H);
  ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--border'); ctx.lineWidth = 1;
  for (let i = 1; i < 4; i++) { ctx.beginPath(); ctx.moveTo((W * i) / 4, 0); ctx.lineTo((W * i) / 4, H); ctx.stroke(); }
  ctx.strokeStyle = '#ff7a2f'; ctx.lineWidth = 2.5; ctx.beginPath();
  for (let i = 0; i <= 60; i++) { const x = i / 60, y = Math.pow(x, app.brush.pressureGamma); const px = x * W, py = H - 6 - y * (H - 12); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
  ctx.stroke();
}

/** Re-fill translated <select>s of the brush settings (on language change). */
export function refreshBrushSelects() {
  fillSelect($('#projSelect'), ['tangent', 'planar'], 'proj_', app.brush.projection);
  fillSelect($('#haSelect'), ['none', 'cavities', 'peaks'], 'ha_', app.brush.heightAware);
}

export function setupBrushPanel() {
  const b = app.brush;
  bindSlider('sizeSlider', () => b.size, (v) => { b.size = v; updateCursor(); }, (v) => `${v}`);
  bindSlider('strengthSlider', () => b.strength, (v) => (b.strength = v), (v) => v.toFixed(2));
  bindSlider('depthSlider', () => b.depth, (v) => (b.depth = v), (v) => v.toFixed(2));
  bindSlider('roughSlider', () => b.rough, (v) => (b.rough = v), (v) => v.toFixed(2));
  bindSlider('metalSlider', () => b.metal, (v) => (b.metal = v), (v) => v.toFixed(2));
  bindSlider('hardSlider', () => b.hardness, (v) => (b.hardness = v), (v) => v.toFixed(2));
  bindSlider('spacingSlider', () => b.spacing, (v) => (b.spacing = v), (v) => v.toFixed(2));
  bindSlider('lazySlider', () => b.lazy, (v) => (b.lazy = v), (v) => `${v}px`);
  bindSlider('radialSlider', () => b.radial, (v) => (b.radial = v), (v) => `×${v}`);
  bindSlider('gammaSlider', () => b.pressureGamma, (v) => { b.pressureGamma = v; drawCurve(); }, (v) => v.toFixed(2));
  $('#pSize').checked = b.pressureSize; $('#pSize').onchange = (e) => (b.pressureSize = e.target.checked);
  $('#pStrength').checked = b.pressureStrength; $('#pStrength').onchange = (e) => (b.pressureStrength = e.target.checked);

  // multi-channel toggles
  const chans = [['color', 'ch_color'], ['height', 'ch_height'], ['rough', 'ch_rough'], ['metal', 'ch_metal']];
  $('#chanGrid').innerHTML = chans.map(([k, l]) => `<button class="btn toggle" data-ch="${k}" data-i18n="${l}"></button>`).join('');
  $$('#chanGrid button').forEach((btn) => {
    btn.classList.toggle('on', b.channels[btn.dataset.ch]);
    btn.onclick = () => { b.channels[btn.dataset.ch] = !b.channels[btn.dataset.ch]; btn.classList.toggle('on', b.channels[btn.dataset.ch]); };
  });

  // alpha (stamp) library with generated previews
  $('#alphaGrid').innerHTML = ALPHAS.map((a) => `<button data-alpha="${a}"><canvas width="44" height="44"></canvas></button>`).join('');
  $$('#alphaGrid button').forEach((btn) => {
    const cv = $('canvas', btn), ctx = cv.getContext('2d'), img = ctx.createImageData(44, 44);
    for (let y = 0; y < 44; y++) for (let x = 0; x < 44; x++) {
      const u = (x / 43) * 2 - 1, v = (y / 43) * 2 - 1, d = Math.hypot(u, v);
      const f = d > 1 ? 0 : (1 - Math.max(0, d - 0.6) / 0.4);
      const val = Math.max(0, Math.min(1, evalAlpha(btn.dataset.alpha, u, v))) * f * 255;
      const i = 4 * (y * 44 + x); img.data[i] = img.data[i + 1] = img.data[i + 2] = val; img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    btn.onclick = () => { b.alpha = btn.dataset.alpha; $$('#alphaGrid button').forEach((x) => x.classList.toggle('on', x === btn)); };
    btn.classList.toggle('on', b.alpha === btn.dataset.alpha);
  });

  $('#projSelect').onchange = (e) => (b.projection = e.target.value);
  $('#haSelect').onchange = (e) => (b.heightAware = e.target.value);
  $$('.sym-btn').forEach((btn) => btn.addEventListener('click', () => toggleSym(btn.dataset.sym)));
  drawCurve();
}
