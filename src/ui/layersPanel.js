// Right panel (Pro mode): layer list + layer inspector (properties, smart mask).
import { app, activeLayer } from '../app/state.js';
import { t } from '../i18n/index.js';
import { createLayer, BLEND_MODES, MASK_TYPES } from '../engine/layers.js';
import { GENERATORS } from '../engine/noise.js';
import { rgb2hex, hex2rgb } from '../utils/color.js';
import { $, $$, toast } from './dom.js';
import { ICONS, LAYER_COLORS } from './icons.js';
import { fillSelect } from './widgets.js';
import { renderGraph } from './nodeGraph.js';
import { updateUndo } from '../app/history.js';

// ---------- layer list
export function renderLayers() {
  const list = $('#layerList'), comp = app.comp;
  if (!comp) return;
  list.innerHTML = '';
  comp.layers.forEach((L, i) => {
    const li = document.createElement('li');
    li.className = 'layer' + (L.id === app.activeLayerId ? ' sel' : '');
    li.innerHTML = `<button class="eye ${L.visible ? '' : 'off'}" title="${t('toggleVis')}">${ICONS.eye}</button>
      <span class="dot" style="width:8px;height:8px;border-radius:50%;background:${LAYER_COLORS[L.type]}"></span>
      <span class="lname"></span><span class="ltype">${t('type_' + L.type)}</span>
      <button class="lbtn" data-a="up" title="${t('moveUp')}">${ICONS.up}</button>
      <button class="lbtn" data-a="down" title="${t('moveDown')}">${ICONS.down}</button>
      <button class="lbtn" data-a="del" title="${t('deleteLayer')}">${ICONS.trash}</button>`;
    $('.lname', li).textContent = L.name;
    li.onclick = (e) => {
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (e.target.closest('.eye')) { L.visible = !L.visible; app.fullDirty = true; renderLayers(); return; }
      if (a === 'up' && i < comp.layers.length - 1) { comp.layers.splice(i, 1); comp.layers.splice(i + 1, 0, L); app.fullDirty = true; }
      else if (a === 'down' && i > 0) { comp.layers.splice(i, 1); comp.layers.splice(i - 1, 0, L); app.fullDirty = true; }
      else if (a === 'del') { removeLayer(L); return; }
      app.activeLayerId = L.id;
      renderLayers();
    };
    list.appendChild(li);
  });
  renderInspector();
  renderGraph();
}

// ---------- layer operations (all undoable)
export function addLayer(type) {
  const comp = app.comp;
  const count = comp.layers.filter((l) => l.type === type).length + 1;
  const L = createLayer(type, app.ts.N, { name: `${t('defName_' + type)} ${count}` });
  if (type === 'fill') { L.mask.threshold = 0.62; L.mask.breakup = 0.4; }
  if (type === 'procedural') { L.opacity = 0.8; }
  const cur = comp.layers.findIndex((l) => l.id === app.activeLayerId);
  const idx = cur >= 0 ? cur + 1 : comp.layers.length;
  comp.layers.splice(idx, 0, L);
  app.history.push({ kind: 'layerAdd', layer: L, index: idx });
  app.activeLayerId = L.id;
  app.fullDirty = true;
  renderLayers(); updateUndo();
}

export function removeLayer(L) {
  const comp = app.comp, idx = comp.layers.indexOf(L);
  comp.layers.splice(idx, 1);
  app.history.push({ kind: 'layerRemove', layer: L, index: idx });
  if (app.activeLayerId === L.id) app.activeLayerId = comp.layers[Math.max(0, idx - 1)]?.id ?? null;
  app.fullDirty = true;
  renderLayers(); updateUndo();
}

export function duplicateLayer(L) {
  const comp = app.comp;
  const C = createLayer(L.type, app.ts.N);
  const id = C.id;
  for (const [k, v] of Object.entries(L)) {
    if (v instanceof Float32Array) C[k] = v.slice();
    else if (k === 'mask') C.mask = { ...v };
    else if (Array.isArray(v)) C[k] = [...v];
    else C[k] = v;
  }
  C.id = id; C.name = L.name + ' +';
  if (C.type === 'procedural') { C.cache = null; C.cacheDirty = true; }
  const idx = comp.layers.indexOf(L) + 1;
  comp.layers.splice(idx, 0, C);
  app.history.push({ kind: 'layerAdd', layer: C, index: idx });
  app.activeLayerId = C.id; app.fullDirty = true;
  renderLayers(); updateUndo();
}

/** Return the active paint layer, creating one if the active layer can't be painted on. */
export function ensurePaintLayer() {
  let L = activeLayer();
  if (L && L.type === 'paint') return L;
  L = createLayer('paint', app.ts.N, { name: `${t('defName_paint')} ${app.comp.layers.filter((l) => l.type === 'paint').length + 1}` });
  const idx = app.comp.layers.length;
  app.comp.layers.push(L);
  app.history.push({ kind: 'layerAdd', layer: L, index: idx });
  app.activeLayerId = L.id;
  renderLayers();
  toast(t('needPaintLayer'));
  return L;
}

// ---------- inspector
// Rows are described as data first, then turned into DOM. To add a property: push a row below.
function inspectorRows(L) {
  const rows = [];
  const slider = (key, label, min, max, step, obj = L, onCommitOnly = false) => rows.push({ kind: 'slider', key, label, min, max, step, obj, onCommitOnly });
  const color = (key, label, obj = L) => rows.push({ kind: 'color', key, label, obj });
  const select = (key, label, values, prefix, obj = L, cb) => rows.push({ kind: 'select', key, label, values, prefix, obj, cb });
  const check = (key, label, obj = L) => rows.push({ kind: 'check', key, label, obj });

  slider('opacity', 'opacity', 0, 1, 0.01);
  if (L.type !== 'adjust') select('blend', 'blendMode', BLEND_MODES, 'blend_');
  if (L.type === 'fill') {
    color('color', 'color'); check('useColor', 'useColor');
    slider('rough', 'roughness', 0, 1, 0.01); check('useRough', 'useRough');
    slider('metal', 'metallic', 0, 1, 0.01); check('useMetal', 'useMetal');
    slider('height', 'height', -0.5, 0.5, 0.01); check('useHeight', 'useHeight');
  } else if (L.type === 'procedural') {
    select('gen', 'generator', GENERATORS, 'gen_', L, () => (L.cacheDirty = true));
    slider('scale', 'scale', 0.5, 40, 0.1, L, true); slider('seed', 'seed', 0, 50, 1, L, true);
    color('colorA', 'colorA'); color('colorB', 'colorB'); check('useColor', 'useColor');
    slider('roughA', 'roughA', 0, 1, 0.01); slider('roughB', 'roughB', 0, 1, 0.01); check('useRough', 'useRough');
    slider('metal', 'metallic', 0, 1, 0.01);
    slider('heightAmt', 'heightAmt', -0.6, 0.6, 0.01); check('useHeight', 'useHeight');
  } else if (L.type === 'adjust') {
    slider('hue', 'hue', -180, 180, 1); slider('sat', 'saturation', -1, 1, 0.01);
    slider('light', 'lightness', -1, 1, 0.01); slider('contrast', 'contrast', -0.9, 1.5, 0.01);
  }
  if (L.type !== 'paint') {
    rows.push({ kind: 'head', label: 'mask' });
    select('type', 'mask', MASK_TYPES, 'mask_', L.mask, () => renderInspector());
    if (L.mask.type === 'anchor') {
      const anchors = app.comp.layers.filter((l) => l.type === 'paint');
      if (L.mask.anchorId == null && anchors[0]) L.mask.anchorId = anchors[0].id;
      rows.push({ kind: 'anchor', anchors });
    }
    if (L.mask.type !== 'none') {
      slider('threshold', 'threshold', 0, 1, 0.01, L.mask); slider('softness', 'softness', 0.01, 0.5, 0.01, L.mask);
      slider('breakup', 'breakup', 0, 1, 0.01, L.mask); check('invert', 'invert', L.mask);
    }
  }
  return rows;
}

export function renderInspector() {
  const box = $('#inspector'), L = activeLayer();
  if (!L) { box.innerHTML = ''; return; }
  const rows = inspectorRows(L);

  box.innerHTML = `<h4>${t('layerProps')}</h4>
    <div class="field"><label>${t('name')}</label><input class="name-input" id="lnameInput"></div>
    <div id="insRows"></div>
    <button class="btn small" id="dupBtn">${ICONS.copy}<span>${t('duplicate')}</span></button>`;
  $('#lnameInput').value = L.name;
  $('#lnameInput').oninput = (e) => { L.name = e.target.value; $$('#layerList .layer.sel .lname').forEach((s) => (s.textContent = L.name)); renderGraph(); };
  $('#dupBtn').onclick = () => duplicateLayer(L);
  const host = $('#insRows');
  const dirty = () => { app.fullDirty = true; renderGraph(); };
  for (const r of rows) {
    const d = document.createElement('div');
    if (r.kind === 'head') { d.innerHTML = `<h4 style="margin-top:10px">${t(r.label)}</h4>`; host.appendChild(d); continue; }
    if (r.kind === 'slider') {
      d.className = 'slider-row';
      d.innerHTML = `<label>${t(r.label)}</label><input type="range" min="${r.min}" max="${r.max}" step="${r.step}"><output></output>`;
      const inp = $('input', d), out = $('output', d);
      inp.value = r.obj[r.key];
      const fmt = () => (out.textContent = (+inp.value).toFixed(r.step >= 1 ? 0 : 2));
      fmt();
      inp.addEventListener(r.onCommitOnly ? 'change' : 'input', () => { r.obj[r.key] = +inp.value; if (L.type === 'procedural' && r.onCommitOnly) L.cacheDirty = true; dirty(); });
      inp.addEventListener('input', fmt);
    } else if (r.kind === 'color') {
      d.className = 'field';
      d.innerHTML = `<label>${t(r.label)}</label><input type="color">`;
      const inp = $('input', d); inp.value = rgb2hex(r.obj[r.key]);
      inp.addEventListener('input', () => { r.obj[r.key] = hex2rgb(inp.value); dirty(); });
    } else if (r.kind === 'select') {
      d.className = 'field';
      d.innerHTML = `<label>${t(r.label)}</label><select class="select"></select>`;
      const sel = $('select', d); fillSelect(sel, r.values, r.prefix, r.obj[r.key]);
      sel.addEventListener('change', () => { r.obj[r.key] = sel.value; r.cb?.(); dirty(); });
    } else if (r.kind === 'check') {
      d.innerHTML = `<label class="check"><input type="checkbox"> <span>${t(r.label)}</span></label>`;
      const inp = $('input', d); inp.checked = !!r.obj[r.key];
      inp.addEventListener('change', () => { r.obj[r.key] = inp.checked; dirty(); });
    } else if (r.kind === 'anchor') {
      d.className = 'field';
      d.innerHTML = `<label>${t('anchorLayer')}</label><select class="select">${r.anchors.map((a) => `<option value="${a.id}"></option>`).join('')}</select>`;
      const sel = $('select', d);
      $$('option', sel).forEach((o, i) => (o.textContent = r.anchors[i].name));
      sel.value = L.mask.anchorId;
      sel.addEventListener('change', () => { L.mask.anchorId = +sel.value; dirty(); });
    }
    host.appendChild(d);
  }
}
