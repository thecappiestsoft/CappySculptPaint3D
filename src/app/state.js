// Single shared application state. Every module imports `app` from here.
import { History, defaultBrush } from '../engine/brush.js';
import { DEFAULTS } from '../config.js';

export const app = {
  vp: null,          // Viewport (three.js scene, camera, textures)
  geometry: null,    // read-only base mesh (THREE.BufferGeometry)
  weldInfo: null,    // welded vertex info used by the baker
  ts: null,          // TexelSpace: position/normal maps + 3D lookup grid
  comp: null,        // Compositor: layer stack -> final PBR maps
  engine: null,      // BrushEngine: dabs, strokes, fill
  history: new History(DEFAULTS.undoSteps),
  brush: defaultBrush(),
  activeLayerId: null,
  modelName: DEFAULTS.model,
  customName: null,  // file name of an imported model
  unwrapCharts: null,
  res: DEFAULTS.resolution,
  fullDirty: false,  // true -> recomposite every tile next frame
  busy: false,       // true while loading / baking (input is ignored)
};

export const activeLayer = () => app.comp?.layerById(app.activeLayerId);
