// CappySculptPaint3D – entry point. Creates the viewport, wires up the UI, loads the default model.
// Where to find things: see README.md -> "Struktura projektu / Project structure".
import './styles/index.css';
import { app } from './app/state.js';
import { loadBuiltin } from './app/project.js';
import { updateUndo } from './app/history.js';
import { startRenderLoop } from './app/renderLoop.js';
import { t, getLang, onLangChange, applyStatic } from './i18n/index.js';
import { Viewport } from './viewport/viewport.js';
import { setupViewportInput } from './viewport/paintInput.js';
import { $, $$ } from './ui/dom.js';
import { buildTools, setTool, refreshToolTitles, setupBrushPanel, refreshBrushSelects } from './ui/brushPanel.js';
import { setupColorPicker, setColor } from './ui/colorPicker.js';
import { renderLayers } from './ui/layersPanel.js';
import { setupProjectSettings, syncProjectInputs } from './ui/projectSettings.js';
import { setupRadialMenu } from './ui/radialMenu.js';
import { setupDialogs } from './ui/dialogs.js';
import { setupKeyboard } from './ui/keyboard.js';
import { setupToolbar, setMode, setTheme, refreshToolbarSelects } from './ui/toolbar.js';
import { updateFooter } from './ui/statusBar.js';
import { APP_NAME, STORAGE, DEFAULTS } from './config.js';

window[APP_NAME] = app; // handy for debugging in the browser console

/** Re-translate everything that is generated from JS (static HTML is handled by applyStatic). */
function refreshLanguage() {
  $$('#langSeg button').forEach((b) => b.classList.toggle('on', b.dataset.lang === getLang()));
  applyStatic();
  refreshToolTitles();
  refreshBrushSelects();
  refreshToolbarSelects();
  renderLayers();
  updateFooter();
}

async function boot() {
  const canvas = $('#gl');
  if (!canvas.getContext('webgl2')) { document.body.innerHTML = `<p style="padding:2rem">${t('noWebgl')}</p>`; return; }
  app.vp = new Viewport(canvas);

  buildTools();
  setupColorPicker();
  setupBrushPanel();
  setupProjectSettings();
  setupViewportInput();
  setupRadialMenu();
  setupDialogs();
  setupKeyboard();
  setupToolbar();

  setTheme(localStorage.getItem(STORAGE.theme) || DEFAULTS.theme);
  setMode(localStorage.getItem(STORAGE.mode) || DEFAULTS.mode);
  document.documentElement.lang = getLang();
  onLangChange(refreshLanguage);
  setTool(app.brush.tool);
  setColor(app.brush.color);
  refreshLanguage();

  startRenderLoop();
  await loadBuiltin(DEFAULTS.model, false);
  syncProjectInputs();
  updateUndo();
}

boot();
