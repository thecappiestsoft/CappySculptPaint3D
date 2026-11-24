// 3D World-Space Volumetric Brush engine + Tile-Delta Undo/Redo.
// CPU port of the CS_PaintBrushDab idea: for every texel whose precomputed 3D position lies
// inside the brush volume, evaluate falloff/alpha in 3D => no UV seams, no stretching.
import { TILE } from './texelSpace.js';
import { evalAlpha } from './noise.js';

export const TOOLS = ['paint', 'sculpt', 'smooth', 'erase', 'fill', 'smudge'];

export function defaultBrush() {
  return {
    tool: 'paint', size: 60, strength: 0.6, depth: 0.35,
    color: [0.78, 0.2, 0.16], rough: 0.45, metal: 0,
    channels: { color: true, height: false, rough: false, metal: false },
    hardness: 0.35, spacing: 0.12, alpha: 'round', projection: 'tangent', heightAware: 'none',
    symmetry: { x: false, y: false, z: false }, radial: 1, lazy: 0,
    pressureSize: true, pressureStrength: true, pressureGamma: 1, angleCutoff: 0.1,
  };
}

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };

export class History {
  constructor(limit = 60) { this.undoStack = []; this.redoStack = []; this.limit = limit; this.cur = null; }
  clear() { this.undoStack = []; this.redoStack = []; this.cur = null; }

  begin(layer, ts) {
    this.cur = { kind: 'tiles', layer, tiles: new Map(), touched: new Uint8Array(ts.tileCount), ts };
  }
  touchTile(t) {
    const c = this.cur;
    if (!c || c.touched[t]) return;
    c.touched[t] = 1;
    c.tiles.set(t, snapshotTile(c.layer, c.ts, t));
  }
  end() {
    const c = this.cur; this.cur = null;
    if (!c || c.tiles.size === 0) return false;
    delete c.touched; delete c.ts;
    this.push(c);
    return true;
  }
  push(cmd) {
    this.undoStack.push(cmd);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack = [];
  }
  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }
  /** Returns the command so the caller can refresh what changed. */
  undo(ctx) { const c = this.undoStack.pop(); if (!c) return null; applyCmd(c, ctx, true); this.redoStack.push(c); return c; }
  redo(ctx) { const c = this.redoStack.pop(); if (!c) return null; applyCmd(c, ctx, false); this.undoStack.push(c); return c; }
  memoryBytes() {
    let b = 0;
    for (const c of [...this.undoStack, ...this.redoStack]) if (c.kind === 'tiles') for (const s of c.tiles.values()) b += s.byteLength;
    return b;
  }
}

function tileRange(ts, t) {
  const tx = t % ts.tilesX, ty = (t / ts.tilesX) | 0;
  return { x0: tx * TILE, y0: ty * TILE, x1: Math.min(ts.res, tx * TILE + TILE), y1: Math.min(ts.res, ty * TILE + TILE) };
}

function snapshotTile(L, ts, t) {
  const { x0, y0, x1, y1 } = tileRange(ts, t), R = ts.res;
  const w = x1 - x0, n = w * (y1 - y0);
  const out = new Float32Array(n * 9);
  let o = 0;
  for (let y = y0; y < y1; y++) {
    const k = y * R + x0;
    out.set(L.c.subarray(4 * k, 4 * (k + w)), o); o += 4 * w;
    out.set(L.h.subarray(k, k + w), o); o += w;
    out.set(L.m.subarray(4 * k, 4 * (k + w)), o); o += 4 * w;
  }
  return out;
}
function restoreTile(L, ts, t, data) {
  const { x0, y0, x1, y1 } = tileRange(ts, t), R = ts.res;
  const w = x1 - x0;
  let o = 0;
  for (let y = y0; y < y1; y++) {
    const k = y * R + x0;
    L.c.set(data.subarray(o, o + 4 * w), 4 * k); o += 4 * w;
    L.h.set(data.subarray(o, o + w), k); o += w;
    L.m.set(data.subarray(o, o + 4 * w), 4 * k); o += 4 * w;
  }
}

function applyCmd(c, ctx, isUndo) {
  if (c.kind === 'tiles') {
    for (const [t, data] of c.tiles) {
      const cur = snapshotTile(c.layer, ctx.ts, t);
      restoreTile(c.layer, ctx.ts, t, data);
      c.tiles.set(t, cur);
      ctx.dirty.add(t);
    }
  } else if (c.kind === 'layerAdd' || c.kind === 'layerRemove') {
    const add = (c.kind === 'layerAdd') !== isUndo;
    const arr = ctx.comp.layers;
    if (add) arr.splice(c.index, 0, c.layer); else arr.splice(arr.indexOf(c.layer), 1);
    ctx.full = true;
  } else if (c.kind === 'layerProps') {
    const tmp = { ...c.layer }; // swap property bag
    for (const key of Object.keys(c.props)) { const v = c.layer[key]; c.layer[key] = c.props[key]; c.props[key] = v; }
    void tmp;
    ctx.full = true;
  }
}

export class BrushEngine {
  constructor(ts, comp, history) {
    this.ts = ts; this.comp = comp; this.history = history;
    this.dirty = new Set();
    this.pickup = null;
    this._ks = new Int32Array(1 << 16); this._ws = new Float32Array(1 << 16);
  }

  beginStroke(layer, brush) {
    this.layer = layer; this.brush = brush; this.pickup = null;
    this.history.begin(layer, this.ts);
  }
  endStroke() { return this.history.end(); }

  /** Build all symmetric / radial instances of a dab frame. */
  instances(frame) {
    const b = this.brush, list = [];
    const axes = [[1, 1, 1]];
    if (b.symmetry.x) axes.push(...axes.map((m) => [-m[0], m[1], m[2]]));
    if (b.symmetry.y) axes.push(...axes.map((m) => [m[0], -m[1], m[2]]));
    if (b.symmetry.z) axes.push(...axes.map((m) => [m[0], m[1], -m[2]]));
    const n = Math.max(1, b.radial | 0);
    for (const m of axes) {
      for (let r = 0; r < n; r++) {
        const a = (r / n) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
        const tf = (v) => { const x = v[0] * m[0], y = v[1] * m[1], z = v[2] * m[2]; return [x * ca + z * sa, y, -x * sa + z * ca]; };
        list.push({ C: tf(frame.C), N: tf(frame.N), V: tf(frame.V), T: tf(frame.T), B: tf(frame.B) });
      }
    }
    return list;
  }

  /**
   * frame: { C:[x,y,z] hit point, N: hit normal, V: view dir (camera->point), T, B: screen right/up }
   */
  dab(frame, R, pressure, invert) {
    const b = this.brush, L = this.layer, ts = this.ts;
    if (!L || L.type !== 'paint') return;
    const pg = Math.pow(clamp(pressure, 0, 1), b.pressureGamma);
    const radius = R * (b.pressureSize ? 0.35 + 0.65 * pg : 1);
    const strength = b.strength * (b.pressureStrength ? pg : 1);
    for (const inst of this.instances(frame)) this.dabInstance(inst, radius, strength, invert, L);
  }

  dabInstance(f, R, strength, invert, L) {
    const b = this.brush, ts = this.ts, P = ts.pos, Nn = ts.nrm;
    const planar = b.projection === 'planar';
    let T = f.T, B = f.B;
    const Nc = f.N, V = f.V;
    if (!planar) {
      // tangent frame aligned with screen-right projected on the surface
      const d = T[0] * Nc[0] + T[1] * Nc[1] + T[2] * Nc[2];
      let tx = T[0] - Nc[0] * d, ty = T[1] - Nc[1] * d, tz = T[2] - Nc[2] * d;
      const l = Math.hypot(tx, ty, tz) || 1; tx /= l; ty /= l; tz /= l;
      T = [tx, ty, tz];
      B = [Nc[1] * tz - Nc[2] * ty, Nc[2] * tx - Nc[0] * tz, Nc[0] * ty - Nc[1] * tx];
    }
    const C = f.C, ext = planar ? R * 1.6 : R;
    const hard = clamp(b.hardness, 0, 0.98), cut = b.angleCutoff;
    const alphaRound = b.alpha === 'round';
    let n = 0;
    const ks = this._ks, ws = this._ws;
    const cap = ks.length;
    ts.queryBox(C[0] - ext, C[1] - ext, C[2] - ext, C[0] + ext, C[1] + ext, C[2] + ext, (k) => {
      if (n >= cap) return;
      const dx = P[3 * k] - C[0], dy = P[3 * k + 1] - C[1], dz = P[3 * k + 2] - C[2];
      let dist, px = dx, py = dy, pz = dz;
      const nx = Nn[3 * k], ny = Nn[3 * k + 1], nz = Nn[3 * k + 2];
      if (planar) {
        const along = dx * V[0] + dy * V[1] + dz * V[2];
        if (along > R * 1.5 || along < -R * 1.5) return;
        if (-(nx * V[0] + ny * V[1] + nz * V[2]) < cut) return;
        px = dx - V[0] * along; py = dy - V[1] * along; pz = dz - V[2] * along;
        dist = Math.sqrt(px * px + py * py + pz * pz);
      } else {
        dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (nx * Nc[0] + ny * Nc[1] + nz * Nc[2] < cut) return; // backface & grazing-angle culling
      }
      if (dist > R) return;
      const t = dist / R;
      const fall = t <= hard ? 1 : 1 - smooth(hard, 1, t);
      let a = 1;
      if (!alphaRound) {
        const u = (px * T[0] + py * T[1] + pz * T[2]) / R, v = (px * B[0] + py * B[1] + pz * B[2]) / R;
        a = evalAlpha(b.alpha, u, v);
      }
      const w = a * fall * strength;
      if (w <= 0.0005) return;
      ks[n] = k; ws[n] = w; n++;
    });
    if (!n) return;

    // Height-aware dynamic brush: restrict to cavities or peaks of the existing composite height
    if (b.heightAware !== 'none') {
      const H = this.comp.height;
      let avg = 0, sw = 0;
      for (let i = 0; i < n; i++) { avg += H[ks[i]] * ws[i]; sw += ws[i]; }
      avg /= sw || 1;
      const gain = 25, sign = b.heightAware === 'cavities' ? -1 : 1;
      for (let i = 0; i < n; i++) ws[i] *= clamp((H[ks[i]] - avg) * sign * gain, 0, 1);
    }

    const hist = this.history, dirty = this.dirty;
    let lastTile = -1;
    const touch = (k) => { const tl = ts.tileOf(k); if (tl !== lastTile) { hist.touchTile(tl); dirty.add(tl); lastTile = tl; } };
    const c = L.c, h = L.h, m = L.m, ch = b.channels;
    const sgn = invert ? -1 : 1;
    switch (b.tool) {
      case 'paint': {
        const [cr, cg, cb] = b.color;
        for (let i = 0; i < n; i++) {
          const k = ks[i], w = ws[i];
          touch(k);
          if (ch.color) blendInto(c, k, cr, cg, cb, w);
          if (ch.height && b.depth) h[k] = clamp(h[k] + sgn * b.depth * w * 0.04, -1, 1);
          if (ch.rough) blendScalar(m, k, 0, b.rough, w);
          if (ch.metal) blendScalar(m, k, 2, b.metal, w);
        }
        break;
      }
      case 'sculpt': {
        const amt = sgn * Math.max(0.02, b.depth) * 0.05;
        for (let i = 0; i < n; i++) { const k = ks[i]; touch(k); h[k] = clamp(h[k] + amt * ws[i], -1, 1); }
        break;
      }
      case 'smooth': {
        const Rr = ts.res, cov = ts.covered;
        const tmp = new Float32Array(n);
        for (let i = 0; i < n; i++) {
          const k = ks[i]; let s = h[k], cnt = 1;
          if (cov[k - 1]) { s += h[k - 1]; cnt++; } if (cov[k + 1]) { s += h[k + 1]; cnt++; }
          if (k >= Rr && cov[k - Rr]) { s += h[k - Rr]; cnt++; } if (cov[k + Rr]) { s += h[k + Rr]; cnt++; }
          tmp[i] = s / cnt;
        }
        for (let i = 0; i < n; i++) {
          const k = ks[i], w = Math.min(1, ws[i] * 1.5);
          touch(k); h[k] += (tmp[i] - h[k]) * w;
          if (ch.color && c[4 * k + 3] > 0) {
            // soften colour coverage edges too
            c[4 * k + 3] = c[4 * k + 3] * (1 - w * 0.15);
          }
        }
        break;
      }
      case 'erase': {
        for (let i = 0; i < n; i++) {
          const k = ks[i], w = Math.min(1, ws[i] * 1.5), keep = 1 - w;
          touch(k);
          c[4 * k + 3] *= keep; h[k] *= keep; m[4 * k + 1] *= keep; m[4 * k + 3] *= keep;
        }
        break;
      }
      case 'smudge': {
        const F = this.comp.colF;
        let ar = 0, ag = 0, ab = 0, sw = 0;
        for (let i = 0; i < n; i++) { const k = ks[i], w = ws[i]; ar += F[3 * k] * w; ag += F[3 * k + 1] * w; ab += F[3 * k + 2] * w; sw += w; }
        ar /= sw; ag /= sw; ab /= sw;
        if (!this.pickup) this.pickup = [ar, ag, ab];
        const [pr, pg2, pb] = this.pickup;
        for (let i = 0; i < n; i++) { const k = ks[i]; touch(k); blendInto(c, k, pr, pg2, pb, ws[i] * 0.8); }
        const mix = 0.3;
        this.pickup = [pr + (ar - pr) * mix, pg2 + (ag - pg2) * mix, pb + (ab - pb) * mix];
        break;
      }
      default: break;
    }
  }

  /** Fill tool: flood the whole paint layer with the active channels. */
  fillLayer(layer, brush) {
    const ts = this.ts;
    this.history.begin(layer, ts);
    for (let t = 0; t < ts.tileCount; t++) if (ts.tileTexStart[t + 1] > ts.tileTexStart[t]) { this.history.touchTile(t); this.dirty.add(t); }
    const ch = brush.channels, [cr, cg, cb] = brush.color;
    const items = ts.tileTexels;
    for (let i = 0; i < items.length; i++) {
      const k = items[i];
      if (ch.color) { layer.c[4 * k] = cr; layer.c[4 * k + 1] = cg; layer.c[4 * k + 2] = cb; layer.c[4 * k + 3] = brush.strength; }
      if (ch.rough) { layer.m[4 * k] = brush.rough; layer.m[4 * k + 1] = 1; }
      if (ch.metal) { layer.m[4 * k + 2] = brush.metal; layer.m[4 * k + 3] = 1; }
      if (ch.height && brush.depth) layer.h[k] = clamp(brush.depth * 0.2, -1, 1);
    }
    return this.history.end();
  }
}

function blendInto(c, k, r, g, b, w) {
  const a = c[4 * k + 3];
  const na = a + w * (1 - a);
  if (na <= 0) return;
  const f = w / na;
  c[4 * k] += (r - c[4 * k]) * (a > 0 ? f : 1);
  c[4 * k + 1] += (g - c[4 * k + 1]) * (a > 0 ? f : 1);
  c[4 * k + 2] += (b - c[4 * k + 2]) * (a > 0 ? f : 1);
  c[4 * k + 3] = na;
}
function blendScalar(m, k, off, v, w) {
  const a = m[4 * k + off + 1];
  const na = a + w * (1 - a);
  m[4 * k + off] += (v - m[4 * k + off]) * (a > 0 ? w / na : 1);
  m[4 * k + off + 1] = na;
}
