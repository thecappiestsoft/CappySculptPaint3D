// Top bar: menus, model / resolution / view selects, Simple|Pro, PL|EN, light|dark.
import { app } from '../app/state.js';
import { t, setLang } from '../i18n/index.js';
import { BUILTIN_MODELS } from '../engine/meshPrep.js';
import { VIEW_MODES } from '../viewport/viewport.js';
import { STORAGE } from '../config.js';
import { $, $$ } from './dom.js';
import { fillSelect } from './widgets.js';
import { drawCurve } from './brushPanel.js';
import { addLayer } from './layersPanel.js';
import { actions, changeModel, changeResolution } from '../app/actions.js';
import { importFile, openTxs } from '../app/project.js';

const appEl = () => $('#app');

export function syncModelSelect() {
  const sel = $('#modelSelect');
  const opts = BUILTIN_MODELS.map((m) => `<option value="${m}">${t('model_' + m)}</option>`);
  if (app.modelName === 'custom') opts.push(`<option value="custom">${app.customName || t('model_custom')}</option>`);
  sel.innerHTML = opts.join('');
  sel.value = app.modelName;
}

export function setViewMode(mode) {
  app.vp.setViewMode(mode);
  $('#viewSelect').value = mode;
  $('#vpBadge').textContent = t('view_' + mode);
}
export function cycleViewMode() { setViewMode(VIEW_MODES[(VIEW_MODES.indexOf(app.vp.viewMode) + 1) % VIEW_MODES.length]); }

/** Re-fill translated selects (on language change). */
export function refreshToolbarSelects() {
  fillSelect($('#viewSelect'), VIEW_MODES, 'view_', app.vp.viewMode);
  $('#vpBadge').textContent = t('view_' + app.vp.viewMode);
  syncModelSelect();
}

export function isProMode() { return appEl().classList.contains('mode-pro'); }
export function setMode(mode) {
  appEl().classList.toggle('mode-pro', mode === 'pro');
  appEl().classList.toggle('mode-simple', mode !== 'pro');
  $$('#modeSeg button').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
  localStorage.setItem(STORAGE.mode, mode);
  if (mode !== 'pro' && app.vp && app.vp.viewMode !== 'pbr') setViewMode('pbr'); // Simple mode always shows full PBR
}

export function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem(STORAGE.theme, theme);
  const vpColor = getComputedStyle(document.documentElement).getPropertyValue('--vp').trim();
  app.vp?.setClearColor(vpColor);
  drawCurve();
}

/** Hook up every static control declared in index.html. */
export function setupToolbar() {
  // [data-action="x"] buttons call actions.x()
  $$('[data-action]').forEach((b) => b.addEventListener('click', () => { $$('.menu.open').forEach((m) => m.classList.remove('open')); actions[b.dataset.action]?.(); }));
  $$('[data-menu-toggle]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); b.parentElement.classList.toggle('open'); }));
  document.addEventListener('click', (e) => { if (!e.target.closest('.menu')) $$('.menu.open').forEach((m) => m.classList.remove('open')); });
  $$('[data-add]').forEach((b) => b.addEventListener('click', () => addLayer(b.dataset.add)));
  $$('#modeSeg button').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
  $$('#langSeg button').forEach((b) => b.addEventListener('click', () => setLang(b.dataset.lang)));
  $('#themeBtn').addEventListener('click', () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));
  $('#modelFile').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) importFile(f); });
  $('#txsFile').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) openTxs(f); });
  $('#modelSelect').addEventListener('change', async (e) => {
    if (e.target.value === 'custom') return;
    if (!(await changeModel(e.target.value))) e.target.value = app.modelName;
  });
  $('#resSelect').addEventListener('change', async (e) => {
    if (!(await changeResolution(+e.target.value))) e.target.value = String(app.res);
  });
  $('#viewSelect').addEventListener('change', (e) => setViewMode(e.target.value));
}
