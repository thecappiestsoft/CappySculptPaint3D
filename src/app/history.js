// Undo / redo glue between the History (engine/brush.js) and the UI.
import { app } from './state.js';
import { $ } from '../ui/dom.js';
import { renderLayers } from '../ui/layersPanel.js';
import { updateFooter } from '../ui/statusBar.js';
import { isStroking } from '../viewport/paintInput.js';

/** Enable / disable the Undo and Redo buttons. Call after every change to the history. */
export function updateUndo() {
  $('#undoBtn').disabled = !app.history.canUndo;
  $('#redoBtn').disabled = !app.history.canRedo;
  updateFooter();
}

export function doUndo(redo = false) {
  if (isStroking() || app.busy) return;
  const ctx = { ts: app.ts, comp: app.comp, dirty: app.engine.dirty, full: false };
  const c = redo ? app.history.redo(ctx) : app.history.undo(ctx);
  if (!c) return;
  if (ctx.full) app.fullDirty = true;
  if (c.kind !== 'tiles' && !app.comp.layerById(app.activeLayerId)) app.activeLayerId = app.comp.layers.at(-1)?.id;
  renderLayers(); updateUndo();
}
