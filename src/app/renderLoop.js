// Per-frame loop: recomposite dirty tiles, upload textures, render, update FPS stats.
import { app } from './state.js';
import { updateStats } from '../ui/statusBar.js';

let fpsT = performance.now(), fpsN = 0;

function loop() {
  requestAnimationFrame(loop);
  const comp = app.comp;
  if (comp && app.engine) {
    if (app.fullDirty) {
      app.fullDirty = false; app.engine.dirty.clear();
      comp.compositeTiles(comp.allTiles());
      app.vp.uploadTextures();
    } else if (app.engine.dirty.size) {
      // only tiles touched by the brush since the last frame
      const tiles = [...app.engine.dirty]; app.engine.dirty.clear();
      comp.compositeTiles(tiles);
      app.vp.uploadTextures();
    }
  }
  app.vp.render();
  fpsN++;
  const now = performance.now();
  if (now - fpsT > 500) {
    updateStats(Math.round((fpsN * 1000) / (now - fpsT)));
    fpsN = 0; fpsT = now;
  }
}

export function startRenderLoop() { requestAnimationFrame(loop); }
