// Procedural noise library (3D, evaluated in world/object space => seamless, UV-independent).

const PERM = new Uint8Array(512);
(function seed(s = 1337) {
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    s = (s * 16807) % 2147483647;
    const j = s % (i + 1);
    const t = p[i]; p[i] = p[j]; p[j] = t;
  }
  for (let i = 0; i < 512; i++) PERM[i] = p[i & 255];
})();

const G3 = [
  [1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0], [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1],
  [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1], [1, 1, 0], [-1, 1, 0], [0, -1, 1], [0, -1, -1],
];

const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a, b, t) => a + (b - a) * t;

function grad(h, x, y, z) {
  const g = G3[h & 15];
  return g[0] * x + g[1] * y + g[2] * z;
}

/** Classic Perlin gradient noise, returns approx [-1, 1]. */
export function perlin3(x, y, z) {
  const X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z);
  x -= X; y -= Y; z -= Z;
  const xi = X & 255, yi = Y & 255, zi = Z & 255;
  const u = fade(x), v = fade(y), w = fade(z);
  const A = PERM[xi] + yi, AA = PERM[A] + zi, AB = PERM[A + 1] + zi;
  const B = PERM[xi + 1] + yi, BA = PERM[B] + zi, BB = PERM[B + 1] + zi;
  return lerp(
    lerp(lerp(grad(PERM[AA], x, y, z), grad(PERM[BA], x - 1, y, z), u),
      lerp(grad(PERM[AB], x, y - 1, z), grad(PERM[BB], x - 1, y - 1, z), u), v),
    lerp(lerp(grad(PERM[AA + 1], x, y, z - 1), grad(PERM[BA + 1], x - 1, y, z - 1), u),
      lerp(grad(PERM[AB + 1], x, y - 1, z - 1), grad(PERM[BB + 1], x - 1, y - 1, z - 1), u), v),
    w);
}

export function fbm3(x, y, z, octaves = 5) {
  let a = 0.5, f = 1, s = 0, n = 0;
  for (let i = 0; i < octaves; i++) {
    s += a * perlin3(x * f, y * f, z * f);
    n += a; a *= 0.5; f *= 2.03;
  }
  return s / n;
}

export function ridged3(x, y, z, octaves = 5) {
  let a = 0.5, f = 1, s = 0, n = 0, prev = 1;
  for (let i = 0; i < octaves; i++) {
    let r = 1 - Math.abs(perlin3(x * f, y * f, z * f));
    r *= r;
    s += r * a * prev;
    prev = r;
    n += a; a *= 0.5; f *= 2.1;
  }
  return s / n;
}

function hash3(x, y, z) {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Cellular (Worley) noise. Returns [F1, F2] distances. */
export function voronoi3(x, y, z) {
  const X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z);
  let f1 = 9, f2 = 9;
  for (let k = -1; k <= 1; k++) for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const cx = X + i, cy = Y + j, cz = Z + k;
    const px = cx + hash3(cx, cy, cz), py = cy + hash3(cx + 17, cy, cz), pz = cz + hash3(cx, cy + 31, cz);
    const dx = px - x, dy = py - y, dz = pz - z;
    const d = dx * dx + dy * dy + dz * dz;
    if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) f2 = d;
  }
  return [Math.sqrt(f1), Math.sqrt(f2)];
}

export const GENERATORS = ['perlin', 'simplex', 'voronoi', 'ridged', 'brushed', 'weave', 'gabor'];

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Evaluate generator at object-space point. Returns value in [0, 1]. */
export function evalGenerator(type, x, y, z, scale, seed = 0) {
  const sx = x * scale + seed * 13.17, sy = y * scale + seed * 7.31, sz = z * scale + seed * 3.77;
  switch (type) {
    case 'perlin': return clamp01(fbm3(sx, sy, sz, 5) * 0.9 + 0.5);
    case 'simplex': return clamp01(perlin3(sx * 1.7, sy * 1.7, sz * 1.7) * 0.7 + 0.5);
    case 'voronoi': { const [f1, f2] = voronoi3(sx, sy, sz); return clamp01((f2 - f1) * 1.6); }
    case 'ridged': return clamp01(ridged3(sx, sy, sz, 5) * 1.25);
    case 'brushed': {
      const v = fbm3(sx * 0.15, sy * 40, sz * 0.15, 3);
      return clamp01(0.5 + v * 0.8);
    }
    case 'weave': {
      const a = Math.sin(sx * 6.283) * 0.5 + 0.5, b = Math.sin(sz * 6.283 + Math.PI / 2) * 0.5 + 0.5;
      const c = Math.sin(sy * 6.283) * 0.5 + 0.5;
      const checker = (Math.floor(sx) + Math.floor(sy) + Math.floor(sz)) & 1;
      return clamp01((checker ? a * c : b * c) * 0.85 + fbm3(sx * 4, sy * 4, sz * 4, 2) * 0.15 + 0.1);
    }
    case 'gabor': {
      // Sparse-convolution approximation: oriented sinusoid modulated by noise
      const n = perlin3(sx * 0.5, sy * 0.5, sz * 0.5);
      const ang = n * Math.PI;
      const u = sx * Math.cos(ang) + sy * Math.sin(ang) + sz * 0.3;
      return clamp01(0.5 + 0.5 * Math.sin(u * 9) * (0.6 + 0.4 * fbm3(sx, sy, sz, 2)));
    }
    default: return 0.5;
  }
}

/** Brush alpha (stamp) functions in brush-plane coordinates u,v in [-1, 1]. */
export const ALPHAS = ['round', 'square', 'noise', 'pores', 'cracks', 'scales', 'rivets'];

export function evalAlpha(type, u, v) {
  switch (type) {
    case 'round': return 1;
    case 'square': return Math.max(Math.abs(u), Math.abs(v)) < 0.72 ? 1 : 0;
    case 'noise': return clamp01(fbm3(u * 3 + 11, v * 3 + 5, 0.5, 4) * 1.4 + 0.5);
    case 'pores': { const [f1] = voronoi3(u * 6 + 3, v * 6 + 7, 1.3); return f1 < 0.22 ? 1 - f1 / 0.22 : 0; }
    case 'cracks': { const [f1, f2] = voronoi3(u * 3 + 1, v * 3 + 9, 2.7); const e = f2 - f1; return e < 0.08 ? 1 - e / 0.08 : 0; }
    case 'scales': {
      const gu = u * 4, gv = v * 4;
      const row = Math.floor(gv), off = (row & 1) * 0.5;
      const fu = gu + off - Math.floor(gu + off) - 0.5, fv = gv - row;
      const d = Math.sqrt(fu * fu + fv * fv * 0.9);
      return clamp01(1 - d * 1.6);
    }
    case 'rivets': {
      const gu = u * 2.5, gv = v * 2.5;
      const fu = gu - Math.round(gu), fv = gv - Math.round(gv);
      const d = Math.sqrt(fu * fu + fv * fv);
      return d < 0.22 ? Math.sqrt(1 - (d / 0.22) ** 2) : 0;
    }
    default: return 1;
  }
}
