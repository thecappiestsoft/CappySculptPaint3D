// Commands triggered from menus / buttons (data-action="name" in index.html) and shortcuts.
import { app } from './state.js';
import { t } from '../i18n/index.js';
import { $, toast, progress, nextFrame } from '../ui/dom.js';
import { autoUnwrap } from '../engine/meshPrep.js';
import { bakeMaps } from '../engine/baker.js';
import { download, saveTXS } from '../engine/io.js';
import { FILE_PREFIX, DEFAULTS } from '../config.js';
import { setupModel, loadBuiltin, cloneGeometry } from './project.js';
import { doUndo } from './history.js';
import { openExport, openHelp } from '../ui/dialogs.js';

export const actions = {
  import: () => $('#modelFile').click(),
  export: () => openExport(),
  undo: () => doUndo(false),
  redo: () => doUndo(true),
  help: () => openHelp(),

  newProject: async () => {
    if (!confirm(t('confirmNew'))) return;
    app.activeLayerId = null;
    await loadBuiltin(DEFAULTS.model, false);
  },

  openTxs: () => $('#txsFile').click(),

  saveTxs: async () => {
    progress(t('saving'), 0.4); await nextFrame();
    try { download(await saveTXS(app), `${FILE_PREFIX}_${app.modelName}.txs`); toast(t('saved')); } finally { progress(null); }
  },

  unwrap: async () => {
    if (!confirm(t('confirmModel'))) return;
    progress(t('preparing'), 0.05); await nextFrame();
    const g = cloneGeometry();
    app.unwrapCharts = autoUnwrap(g, app.res);
    await setupModel(g, app.modelName, { unwrapReason: 'forced', keepLayers: app.comp.layers });
  },

  bake: async () => {
    app.busy = true;
    progress(t('baking'), 0);
    await bakeMaps(app.geometry, app.weldInfo, app.ts, { rays: DEFAULTS.bakeRaysManual, onProgress: (f) => progress(t('baking'), f) });
    app.vp.updateBaked(app.ts); app.fullDirty = true;
    progress(null); app.busy = false;
    toast(t('bakeDone'));
  },
};

/** Switch to a built-in model (asks first if there is something to lose). */
export async function changeModel(name) {
  if (app.history.undoStack.length && !confirm(t('confirmModel'))) return false;
  await loadBuiltin(name, true);
  return true;
}

/** Change texture resolution (re-rasterizes the mesh; paint layers are cleared). */
export async function changeResolution(res) {
  if (app.history.undoStack.length && !confirm(t('confirmRes'))) return false;
  app.res = res;
  progress(t('preparing'), 0.05); await nextFrame();
  await setupModel(cloneGeometry(), app.modelName, { keepLayers: app.comp.layers });
  return true;
}
