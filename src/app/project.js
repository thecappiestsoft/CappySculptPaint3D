// Model / project lifecycle: load a built-in model, import a 3D file, open a .txs project.
import * as THREE from 'three';
import { app } from './state.js';
import { t } from '../i18n/index.js';
import { $, toast, progress, nextFrame } from '../ui/dom.js';
import { createBuiltin, loadModelFile, prepareGeometry, weldPositions } from '../engine/meshPrep.js';
import { TexelSpace, TILE } from '../engine/texelSpace.js';
import { Compositor, createLayer, setLayerIdCounter } from '../engine/layers.js';
import { BrushEngine } from '../engine/brush.js';
import { bakeMaps } from '../engine/baker.js';
import { readTXS } from '../engine/io.js';
import { DEFAULTS } from '../config.js';
import { renderLayers } from '../ui/layersPanel.js';
import { syncModelSelect } from '../ui/toolbar.js';
import { updateFooter } from '../ui/statusBar.js';
import { syncProjectInputs } from '../ui/projectSettings.js';
import { updateUndo } from './history.js';

/**
 * Build all per-model data (texel space, compositor, brush engine), upload textures and bake helper maps.
 * @param keepLayers  carry layers over from the previous model (paint layers are re-allocated empty)
 * @param restore     callback that fills the compositor from a saved project instead
 */
export async function setupModel(geometry, name, { unwrapReason = null, keepLayers = null, restore = null } = {}) {
  app.busy = true;
  progress(t('rasterizing'), 0.15);
  await nextFrame();
  app.geometry = geometry;
  app.weldInfo = weldPositions(geometry);
  app.ts = new TexelSpace(geometry, app.res);
  app.comp = new Compositor(app.ts);
  app.history.clear();
  app.engine = new BrushEngine(app.ts, app.comp, app.history);
  app.modelName = name;
  const N = app.ts.N;
  if (restore) {
    restore(app.comp);
  } else if (keepLayers && keepLayers.length) {
    app.comp.layers = keepLayers.map((L) => {
      if (L.type !== 'paint') { if (L.type === 'procedural') { L.cache = null; L.cacheDirty = true; } return L; }
      return Object.assign(createLayer('paint', N), { id: L.id, name: L.name, visible: L.visible, opacity: L.opacity, blend: L.blend });
    });
  } else {
    app.comp.layers = [createLayer('paint', N, { name: `${t('defName_paint')} 1` })];
  }
  if (!app.comp.layerById(app.activeLayerId)) app.activeLayerId = app.comp.layers.filter((l) => l.type === 'paint').pop()?.id ?? app.comp.layers[0]?.id;
  app.vp.setModel(geometry, app.comp, app.ts);
  app.comp.compositeTiles(app.comp.allTiles());
  app.vp.uploadTextures();
  if (unwrapReason) toast(t('unwrapped', { n: app.unwrapCharts ?? '?', r: t('reason_' + unwrapReason) }));
  renderLayers(); updateUndo(); updateFooter(); syncModelSelect();
  progress(t('baking'), 0.3);
  await bakeMaps(geometry, app.weldInfo, app.ts, { rays: DEFAULTS.bakeRaysOnLoad, onProgress: (f) => progress(t('baking'), 0.3 + f * 0.7) });
  app.vp.updateBaked(app.ts);
  app.fullDirty = true;
  progress(null);
  app.busy = false;
}

/** Clone the current mesh (without its BVH) so it can be re-prepared. */
export function cloneGeometry() {
  const g = app.geometry.clone();
  g.disposeBoundsTree?.();
  delete g.boundsTree;
  return g;
}

export async function loadBuiltin(name, keep = true) {
  progress(t('preparing'), 0.05);
  await nextFrame();
  const { geometry } = prepareGeometry(createBuiltin(name), { forceUnwrap: true, resolution: app.res });
  await setupModel(geometry, name, { keepLayers: keep ? app.comp?.layers : null });
}

/** Import .obj / .fbx / .gltf / .glb (or .txs, which is forwarded to openTxs). */
export async function importFile(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  if (ext === 'txs') return openTxs(file);
  try {
    progress(t('preparing'), 0.05);
    await nextFrame();
    const src = await loadModelFile(file);
    const { geometry, unwrapReason, charts } = prepareGeometry(src, { resolution: app.res });
    app.unwrapCharts = charts;
    app.customName = file.name;
    await setupModel(geometry, 'custom', { unwrapReason, keepLayers: app.comp?.layers });
    toast(t('imported', { n: file.name }));
  } catch (e) {
    console.error(e);
    progress(null); app.busy = false;
    toast(t('importError', { e: e.message }), true);
  }
}

/** Open a saved .txs project (geometry + layer stack + sparse tiles). */
export async function openTxs(file) {
  try {
    progress(t('loadingTxs'), 0.1);
    await nextFrame();
    const { manifest, pos, nrm, uv, tiles } = await readTXS(await file.arrayBuffer());
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.computeBoundingBox(); g.computeBoundingSphere();
    app.res = manifest.resolution;
    $('#resSelect').value = String(app.res);
    app.customName = file.name;
    await setupModel(g, manifest.modelName || 'custom', {
      restore: (comp) => {
        comp.base = manifest.base; comp.normalStrength = manifest.normalStrength ?? 1;
        let maxId = 0;
        comp.layers = manifest.layers.map((meta) => {
          const L = createLayer(meta.type, comp.ts.N);
          Object.assign(L, meta);
          if (L.type === 'procedural') { L.cache = null; L.cacheDirty = true; }
          maxId = Math.max(maxId, L.id);
          return L;
        });
        setLayerIdCounter(maxId + 1);
        const R = comp.ts.res, T = manifest.tileSize || TILE;
        for (const tile of tiles) {
          const L = comp.layerById(tile.layerId);
          if (!L) continue;
          let o = 0;
          for (let y = tile.ty * T; y < tile.ty * T + T; y++) for (let x = tile.tx * T; x < tile.tx * T + T; x++) {
            const k = y * R + x;
            for (let c = 0; c < 4; c++) L.c[4 * k + c] = tile.data[o++];
            L.h[k] = tile.data[o++];
            for (let c = 0; c < 4; c++) L.m[4 * k + c] = tile.data[o++];
          }
        }
        app.activeLayerId = comp.layers.filter((l) => l.type === 'paint').pop()?.id;
      },
    });
    syncProjectInputs();
    toast(t('loaded'));
  } catch (e) {
    console.error(e);
    progress(null); app.busy = false;
    toast(t('txsError'), true);
  }
}
