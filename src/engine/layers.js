// Non-destructive layer stack + per-tile compositor producing the final PBR channel buffers.
import { evalGenerator, fbm3 } from './noise.js';

let nextId = 1;
export const BLEND_MODES = ['normal', 'multiply', 'add', 'screen', 'overlay', 'linearBurn'];
export const MASK_TYPES = ['none', 'edgeWear', 'cavity', 'dirt', 'top', 'bottom', 'thickness', 'anchor'];

const defaultMask = () => ({ type: 'none', threshold: 0.5, softness: 0.15, invert: false, breakup: 0, anchorId: null });

export function createLayer(type, N, opts = {}) {
  const base = {
    id: nextId++, type, name: opts.name || type, visible: true, opacity: 1, blend: 'normal',
    mask: defaultMask(),
  };
  if (type === 'paint') {
    base.c = new Float32Array(N * 4); // rgb + coverage
    base.h = new Float32Array(N); // additive height
    base.m = new Float32Array(N * 4); // rough, roughCoverage, metal, metalCoverage
  } else if (type === 'fill') {
    Object.assign(base, { color: [0.62, 0.32, 0.18], rough: 0.7, metal: 0, height: 0, useColor: true, useRough: true, useMetal: true, useHeight: false });
  } else if (type === 'procedural') {
    Object.assign(base, {
      gen: 'perlin', scale: 4, seed: 0, colorA: [0.12, 0.1, 0.09], colorB: [0.55, 0.5, 0.45],
      roughA: 0.9, roughB: 0.5, metal: 0, heightAmt: 0.15, useColor: true, useRough: true, useHeight: true,
      cache: null, cacheDirty: true,
    });
  } else if (type === 'adjust') {
    Object.assign(base, { hue: 0, sat: 0, light: 0, contrast: 0 });
  }
  return base;
}

export function setLayerIdCounter(n) { nextId = Math.max(nextId, n); }

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (e0, e1, x) => { const t = clamp01((x - e0) / (e1 - e0 || 1e-6)); return t * t * (3 - 2 * t); };

function blendCh(mode, a, b) {
  switch (mode) {
    case 'multiply': return a * b;
    case 'add': return Math.min(1, a + b);
    case 'screen': return 1 - (1 - a) * (1 - b);
    case 'overlay': return a < 0.5 ? 2 * a * b : 1 - 2 * (1 - a) * (1 - b);
    case 'linearBurn': return Math.max(0, a + b - 1);
    default: return b;
  }
}

function rgb2hsl(r, g, b) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0; const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0); else if (max === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
    h /= 6;
  }
  return [h, s, l];
}
function hue2rgb(p, q, t) {
  if (t < 0) t += 1; if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}
function hsl2rgb(h, s, l) {
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  return [hue2rgb(p, q, h + 1 / 3), hue2rgb(p, q, h), hue2rgb(p, q, h - 1 / 3)];
}

export class Compositor {
  constructor(ts) {
    this.ts = ts;
    const N = ts.N;
    this.layers = [];
    this.base = { color: [0.72, 0.72, 0.72], rough: 0.55, metal: 0 };
    this.normalStrength = 1;
    this.albedo = new Uint8Array(N * 4);
    this.orm = new Uint8Array(N * 4);
    this.height = new Float32Array(N);
    this.normal = new Uint8Array(N * 4);
    this.colF = new Float32Array(N * 3); // composite color as float (smudge/eyedrop)
    for (let k = 0; k < N; k++) { this.normal[4 * k] = 128; this.normal[4 * k + 1] = 128; this.normal[4 * k + 2] = 255; this.normal[4 * k + 3] = 255; this.albedo[4 * k + 3] = 255; this.orm[4 * k + 3] = 255; }
  }

  layerById(id) { return this.layers.find((l) => l.id === id); }

  ensureProcCache(L) {
    if (!L.cacheDirty && L.cache) return;
    const ts = this.ts;
    if (!L.cache) L.cache = new Float32Array(ts.N);
    const P = ts.pos, items = ts.tileTexels;
    for (let i = 0; i < items.length; i++) {
      const k = items[i];
      L.cache[k] = evalGenerator(L.gen, P[3 * k], P[3 * k + 1], P[3 * k + 2], L.scale, L.seed);
    }
    L.cacheDirty = false;
  }

  maskValue(L, k) {
    const M = L.mask, ts = this.ts;
    if (M.type === 'none') return 1;
    let v;
    switch (M.type) {
      case 'edgeWear': v = ts.curv[k]; break;
      case 'cavity': v = 1 - ts.curv[k]; break;
      case 'dirt': v = 1 - ts.ao[k]; break;
      case 'top': v = ts.nrm[3 * k + 1] * 0.5 + 0.5; break;
      case 'bottom': v = 1 - (ts.pos[3 * k + 1] * 0.5 + 0.5); break;
      case 'thickness': v = 1 - ts.thick[k]; break;
      case 'anchor': {
        const A = M.anchorId != null ? this.layerById(M.anchorId) : null;
        v = A && A.h ? clamp01(Math.abs(A.h[k]) * 6) : 0;
        break;
      }
      default: v = 1;
    }
    if (M.breakup > 0) {
      const n = fbm3(ts.pos[3 * k] * 9, ts.pos[3 * k + 1] * 9, ts.pos[3 * k + 2] * 9, 3) * 0.5 + 0.5;
      v = v - M.breakup * 0.6 * (1 - n) + M.breakup * 0.15;
    }
    let m = smooth(M.threshold - M.softness, M.threshold + M.softness, v);
    if (M.invert) m = 1 - m;
    return m;
  }

  /** Composite the given tiles (Set or array of tile indices). */
  compositeTiles(tiles) {
    const ts = this.ts, Ls = this.layers.filter((l) => l.visible && l.opacity > 0);
    for (const L of Ls) if (L.type === 'procedural') this.ensureProcCache(L);
    const { albedo, orm, height, colF } = this;
    const bc = this.base.color, br = this.base.rough, bm = this.base.metal;
    for (const t of tiles) {
      const a = ts.tileTexStart[t], b = ts.tileTexStart[t + 1];
      for (let i = a; i < b; i++) {
        const k = ts.tileTexels[i];
        let r = bc[0], g = bc[1], bl = bc[2], h = 0, ro = br, me = bm;
        for (let li = 0; li < Ls.length; li++) {
          const L = Ls[li], op = L.opacity;
          if (L.type === 'paint') {
            const ca = L.c[4 * k + 3] * op;
            if (ca > 0) {
              r += (blendCh(L.blend, r, L.c[4 * k]) - r) * ca;
              g += (blendCh(L.blend, g, L.c[4 * k + 1]) - g) * ca;
              bl += (blendCh(L.blend, bl, L.c[4 * k + 2]) - bl) * ca;
            }
            h += L.h[k] * op;
            const ra = L.m[4 * k + 1] * op; if (ra > 0) ro += (L.m[4 * k] - ro) * ra;
            const ma = L.m[4 * k + 3] * op; if (ma > 0) me += (L.m[4 * k + 2] - me) * ma;
          } else if (L.type === 'fill') {
            const w = this.maskValue(L, k) * op;
            if (w <= 0) continue;
            if (L.useColor) {
              r += (blendCh(L.blend, r, L.color[0]) - r) * w;
              g += (blendCh(L.blend, g, L.color[1]) - g) * w;
              bl += (blendCh(L.blend, bl, L.color[2]) - bl) * w;
            }
            if (L.useRough) ro += (L.rough - ro) * w;
            if (L.useMetal) me += (L.metal - me) * w;
            if (L.useHeight) h += L.height * w;
          } else if (L.type === 'procedural') {
            const w = this.maskValue(L, k) * op;
            if (w <= 0) continue;
            const v = L.cache[k];
            if (L.useColor) {
              const cr = L.colorA[0] + (L.colorB[0] - L.colorA[0]) * v;
              const cg = L.colorA[1] + (L.colorB[1] - L.colorA[1]) * v;
              const cb = L.colorA[2] + (L.colorB[2] - L.colorA[2]) * v;
              r += (blendCh(L.blend, r, cr) - r) * w;
              g += (blendCh(L.blend, g, cg) - g) * w;
              bl += (blendCh(L.blend, bl, cb) - bl) * w;
            }
            if (L.useRough) ro += (L.roughA + (L.roughB - L.roughA) * v - ro) * w;
            if (L.metal > 0) me += (L.metal - me) * w;
            if (L.useHeight) h += (v - 0.5) * L.heightAmt * w;
          } else if (L.type === 'adjust') {
            const w = this.maskValue(L, k) * op;
            if (w <= 0) continue;
            let [hh, ss, ll] = rgb2hsl(r, g, bl);
            hh = (hh + L.hue / 360 + 1) % 1; ss = clamp01(ss * (1 + L.sat)); ll = clamp01(ll + L.light * 0.5);
            let [nr, ng, nb] = hsl2rgb(hh, ss, ll);
            const c = 1 + L.contrast;
            nr = clamp01((nr - 0.5) * c + 0.5); ng = clamp01((ng - 0.5) * c + 0.5); nb = clamp01((nb - 0.5) * c + 0.5);
            r += (nr - r) * w; g += (ng - g) * w; bl += (nb - bl) * w;
          }
        }
        r = clamp01(r); g = clamp01(g); bl = clamp01(bl);
        colF[3 * k] = r; colF[3 * k + 1] = g; colF[3 * k + 2] = bl;
        albedo[4 * k] = r * 255 + 0.5; albedo[4 * k + 1] = g * 255 + 0.5; albedo[4 * k + 2] = bl * 255 + 0.5;
        h = h < -1 ? -1 : h > 1 ? 1 : h;
        height[k] = h;
        orm[4 * k] = ts.ao[k] * 255 + 0.5; orm[4 * k + 1] = clamp01(ro) * 255 + 0.5; orm[4 * k + 2] = clamp01(me) * 255 + 0.5;
      }
    }
    this.computeNormals(tiles);
    this.pad(tiles);
  }

  /** Height-to-Normal conversion (tangent space, OpenGL Y+). */
  computeNormals(tiles) {
    const ts = this.ts, R = ts.res, H = this.height, cov = ts.covered, out = this.normal;
    const k0 = this.normalStrength * R / 6;
    for (const t of tiles) {
      const a = ts.tileTexStart[t], b = ts.tileTexStart[t + 1];
      for (let i = a; i < b; i++) {
        const k = ts.tileTexels[i];
        const x = k % R, y = (k / R) | 0, h = H[k];
        const hl = x > 0 && cov[k - 1] ? H[k - 1] : h, hr = x < R - 1 && cov[k + 1] ? H[k + 1] : h;
        const hd = y > 0 && cov[k - R] ? H[k - R] : h, hu = y < R - 1 && cov[k + R] ? H[k + R] : h;
        const nx = -(hr - hl) * 0.5 * k0, ny = -(hu - hd) * 0.5 * k0;
        const l = Math.sqrt(nx * nx + ny * ny + 1);
        out[4 * k] = (nx / l * 0.5 + 0.5) * 255 + 0.5;
        out[4 * k + 1] = (ny / l * 0.5 + 0.5) * 255 + 0.5;
        out[4 * k + 2] = (1 / l * 0.5 + 0.5) * 255 + 0.5;
      }
    }
  }

  /** UV seam padding / edge dilation (copy nearest island texel outward). */
  pad(tiles) {
    const ts = this.ts, { albedo, orm, normal, height, colF } = this;
    // padding sources may live in a neighbouring tile -> include the 8-neighbourhood
    const TX = ts.tilesX, set = new Set();
    for (const t of tiles) {
      const tx = t % TX, ty = (t / TX) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const x = tx + dx, y = ty + dy;
        if (x >= 0 && y >= 0 && x < TX && y < TX) set.add(y * TX + x);
      }
    }
    for (const t of set) {
      for (let i = ts.padStart[t]; i < ts.padStart[t + 1]; i++) {
        const d = ts.padDst[i], s = ts.padSrc[i];
        for (let c = 0; c < 4; c++) { albedo[4 * d + c] = albedo[4 * s + c]; orm[4 * d + c] = orm[4 * s + c]; normal[4 * d + c] = normal[4 * s + c]; }
        height[d] = height[s];
        colF[3 * d] = colF[3 * s]; colF[3 * d + 1] = colF[3 * s + 1]; colF[3 * d + 2] = colF[3 * s + 2];
      }
    }
  }

  allTiles() { return Array.from({ length: this.ts.tileCount }, (_, i) => i); }
}
