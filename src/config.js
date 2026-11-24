// Global app constants. Change the product name or default settings here.

export const APP_NAME = 'CappySculptPaint3D';
export const APP_VERSION = '1.0';
/** Prefix used for downloaded files: <prefix>_<model>.txs, <prefix>_<model>_<preset>.zip */
export const FILE_PREFIX = 'CappySculptPaint3D';

/** localStorage keys for user preferences. */
export const STORAGE = {
  lang: 'cappysculptpaint3d.lang',
  theme: 'cappysculptpaint3d.theme',
  mode: 'cappysculptpaint3d.mode',
};

/** Defaults on first start. */
export const DEFAULTS = {
  model: 'sphere',
  resolution: 1024,
  theme: 'dark',
  mode: 'simple',
  undoSteps: 60,
  bakeRaysOnLoad: 32,
  bakeRaysManual: 64,
};
