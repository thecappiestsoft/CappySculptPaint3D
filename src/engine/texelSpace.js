// Texel space: precomputed Position / Normal maps in UV space (the CPU analogue of the
// "PositionMap/NormalMap" read by CS_PaintBrushDab), a 3D spatial grid of texels for fast
// world-space brush queries, seam padding (edge dilation) lists and baked helper maps.

export const TILE = 64; // tile size in texels (dirty-tile tracking / tile-delta undo)

export class TexelSpace {
  constructor(geometry, res) {
    this.res = res;
    this.N = res * res;
    this.tilesX = Math.ceil(res / TILE);
    this.tileCount = this.tilesX * this.tilesX;
    this.covered = new Uint8Array(this.N);
    this.pos = new Float32Array(this.N * 3);
    this.nrm = new Float32Array(this.N * 3);
    this.tri = new Int32Array(this.N).fill(-1);
    this.bary = new Float32Array(this.N * 2);
    // baked maps (per texel), defaults until baked
    this.curv = new Float32Array(this.N).fill(0.5);
    this.ao = new Float32Array(this.N).fill(1);
    this.thick = new Float32Array(this.N).fill(0.5);
    this.rasterize(geometry);
    this.buildGrid();
    this.buildPadding(12);
  }

  rasterize(g) {
    const R = this.res;
    const P = g.getAttribute('position').array, Nn = g.getAttribute('normal').array, U = g.getAttribute('uv').array;
    const triCount = P.length / 9;
    const { covered, pos, nrm, tri, bary } = this;
    for (let t = 0; t < triCount; t++) {
      const i0 = 3 * t, i1 = i0 + 1, i2 = i0 + 2;
      const ax = U[2 * i0] * R, ay = U[2 * i0 + 1] * R;
      const bx = U[2 * i1] * R, by = U[2 * i1 + 1] * R;
      const cx = U[2 * i2] * R, cy = U[2 * i2 + 1] * R;
      const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
      if (Math.abs(area) < 1e-12) continue;
      const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx) - 1)), x1 = Math.min(R - 1, Math.ceil(Math.max(ax, bx, cx) + 1));
      const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy) - 1)), y1 = Math.min(R - 1, Math.ceil(Math.max(ay, by, cy) + 1));
      // conservative-ish: allow a small negative epsilon (in texels, normalized by edge length) to close hairline gaps
      const eps = -0.5 / Math.sqrt(Math.abs(area));
      for (let y = y0; y <= y1; y++) {
        const py = y + 0.5;
        for (let x = x0; x <= x1; x++) {
          const px = x + 0.5;
          const w0 = ((bx - px) * (cy - py) - (by - py) * (cx - px)) / area;
          const w1 = ((cx - px) * (ay - py) - (cy - py) * (ax - px)) / area;
          const w2 = 1 - w0 - w1;
          const inside = w0 >= 0 && w1 >= 0 && w2 >= 0;
          const k = y * R + x;
          if (!inside) {
            if (covered[k] || w0 < eps || w1 < eps || w2 < eps) continue;
          } else if (covered[k] === 2) continue;
          // clamp barycentrics for edge texels
          let a0 = Math.max(0, w0), a1 = Math.max(0, w1), a2 = Math.max(0, w2);
          const s = a0 + a1 + a2; a0 /= s; a1 /= s; a2 /= s;
          covered[k] = inside ? 2 : 1;
          tri[k] = t; bary[2 * k] = a0; bary[2 * k + 1] = a1;
          for (let c = 0; c < 3; c++) {
            pos[3 * k + c] = P[3 * i0 + c] * a0 + P[3 * i1 + c] * a1 + P[3 * i2 + c] * a2;
            nrm[3 * k + c] = Nn[3 * i0 + c] * a0 + Nn[3 * i1 + c] * a1 + Nn[3 * i2 + c] * a2;
          }
          const l = Math.hypot(nrm[3 * k], nrm[3 * k + 1], nrm[3 * k + 2]) || 1;
          nrm[3 * k] /= l; nrm[3 * k + 1] /= l; nrm[3 * k + 2] /= l;
        }
      }
    }
    let n = 0;
    for (let k = 0; k < this.N; k++) if (covered[k]) { covered[k] = 1; n++; }
    this.coveredCount = n;
    // list of covered texels per tile (for full-surface passes)
    const counts = new Int32Array(this.tileCount + 1);
    for (let k = 0; k < this.N; k++) if (covered[k]) counts[this.tileOf(k) + 1]++;
    for (let i = 0; i < this.tileCount; i++) counts[i + 1] += counts[i];
    const fill = counts.slice(0, this.tileCount);
    this.tileTexStart = counts;
    this.tileTexels = new Int32Array(n);
    for (let k = 0; k < this.N; k++) if (covered[k]) this.tileTexels[fill[this.tileOf(k)]++] = k;
  }

  tileOf(k) {
    const x = k % this.res, y = (k / this.res) | 0;
    return ((y / TILE) | 0) * this.tilesX + ((x / TILE) | 0);
  }

  buildGrid() {
    const G = 64;
    this.G = G;
    this.gMin = -1.001; this.gSize = 2.002 / G;
    const cellOf = (k) => {
      const cx = Math.min(G - 1, Math.max(0, ((this.pos[3 * k] - this.gMin) / this.gSize) | 0));
      const cy = Math.min(G - 1, Math.max(0, ((this.pos[3 * k + 1] - this.gMin) / this.gSize) | 0));
      const cz = Math.min(G - 1, Math.max(0, ((this.pos[3 * k + 2] - this.gMin) / this.gSize) | 0));
      return (cz * G + cy) * G + cx;
    };
    const start = new Int32Array(G * G * G + 1);
    for (let k = 0; k < this.N; k++) if (this.covered[k]) start[cellOf(k) + 1]++;
    for (let i = 0; i < G * G * G; i++) start[i + 1] += start[i];
    const fill = start.slice(0, G * G * G);
    const items = new Int32Array(this.coveredCount);
    for (let k = 0; k < this.N; k++) if (this.covered[k]) items[fill[cellOf(k)]++] = k;
    this.cellStart = start; this.cellItems = items;
  }

  /** Call fn(k) for every covered texel inside the axis-aligned box. */
  queryBox(minX, minY, minZ, maxX, maxY, maxZ, fn) {
    const G = this.G, m = this.gMin, s = this.gSize;
    const c = (v) => Math.min(G - 1, Math.max(0, Math.floor((v - m) / s)));
    const x0 = c(minX), x1 = c(maxX), y0 = c(minY), y1 = c(maxY), z0 = c(minZ), z1 = c(maxZ);
    const { cellStart, cellItems } = this;
    for (let z = z0; z <= z1; z++) for (let y = y0; y <= y1; y++) {
      const row = (z * G + y) * G;
      const a = cellStart[row + x0], b = cellStart[row + x1 + 1];
      for (let i = a; i < b; i++) fn(cellItems[i]);
    }
  }

  /** BFS edge dilation: every uncovered texel within `dist` px copies its nearest covered texel. */
  buildPadding(dist) {
    const R = this.res, N = this.N;
    const src = new Int32Array(N).fill(-1);
    let frontier = [];
    for (let k = 0; k < N; k++) if (this.covered[k]) { src[k] = k; frontier.push(k); }
    const dst = [], from = [];
    for (let d = 0; d < dist; d++) {
      const next = [];
      for (const k of frontier) {
        const x = k % R, y = (k / R) | 0;
        const nb = [x > 0 ? k - 1 : -1, x < R - 1 ? k + 1 : -1, y > 0 ? k - R : -1, y < R - 1 ? k + R : -1];
        for (const q of nb) {
          if (q >= 0 && src[q] < 0) { src[q] = src[k]; next.push(q); dst.push(q); from.push(src[k]); }
        }
      }
      frontier = next;
    }
    // group by tile
    const counts = new Int32Array(this.tileCount + 1);
    for (const q of dst) counts[this.tileOf(q) + 1]++;
    for (let i = 0; i < this.tileCount; i++) counts[i + 1] += counts[i];
    const fill = counts.slice(0, this.tileCount);
    const pd = new Int32Array(dst.length), ps = new Int32Array(dst.length);
    for (let i = 0; i < dst.length; i++) { const t = this.tileOf(dst[i]); const j = fill[t]++; pd[j] = dst[i]; ps[j] = from[i]; }
    this.padStart = counts; this.padDst = pd; this.padSrc = ps;
  }

  /** Re-interpolate per-welded-vertex attributes (AO, curvature, thickness) into texel maps. */
  applyVertexAttribute(target, weld, values) {
    for (let k = 0; k < this.N; k++) {
      const t = this.tri[k];
      if (t < 0 || !this.covered[k]) continue;
      const a0 = this.bary[2 * k], a1 = this.bary[2 * k + 1], a2 = 1 - a0 - a1;
      target[k] = values[weld[3 * t]] * a0 + values[weld[3 * t + 1]] * a1 + values[weld[3 * t + 2]] * a2;
    }
  }
}
