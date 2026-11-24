// Footer info (mesh / texture stats, undo memory) and the FPS / memory readout in the top bar.
import { app } from '../app/state.js';
import { t } from '../i18n/index.js';
import { TILE } from '../engine/texelSpace.js';
import { $ } from './dom.js';

export function updateFooter() {
  if (!app.ts) return;
  const tris = app.geometry.getAttribute('position').count / 3;
  $('#footerInfo').textContent = t('footerInfo', { tris: tris.toLocaleString(), res: app.ts.res, tile: TILE, cov: Math.round((app.ts.coveredCount / app.ts.N) * 100) });
  $('#footerMem').textContent = t('undoMem', { n: app.history.undoStack.length, mb: (app.history.memoryBytes() / 1048576).toFixed(1) });
}

export function updateStats(fps) {
  if (!app.ts) return;
  const R2 = app.ts.N;
  const texMB = (R2 * (4 + 4 + 4 + 4 + 4)) / 1048576;
  const layerMB = app.comp.layers.filter((l) => l.type === 'paint').length * R2 * 36 / 1048576;
  $('#stats').textContent = `${fps} FPS · GPU ${texMB.toFixed(0)} MB · ${t('layers')} ${layerMB.toFixed(0)} MB`;
}
