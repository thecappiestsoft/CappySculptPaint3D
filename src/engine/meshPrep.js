// Mesh preparation: built-in models, import, normalization, welding, UV validation & auto-unwrap.
// The base mesh is treated as an immutable read-only asset after preparation (no topology edits).
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';

export const BUILTIN_MODELS = ['sphere', 'roundedCube', 'torus', 'torusKnot', 'vase', 'capsule'];

export function createBuiltin(name) {
  switch (name) {
    case 'roundedCube': return new RoundedBoxGeometry(1.4, 1.4, 1.4, 10, 0.22);
    case 'torus': return new THREE.TorusGeometry(0.8, 0.34, 96, 192);
    case 'torusKnot': return new THREE.TorusKnotGeometry(0.62, 0.2, 320, 40);
    case 'vase': {
      const pts = [];
      for (let i = 0; i <= 60; i++) {
        const t = i / 60;
        const r = 0.18 + 0.42 * Math.sin(t * Math.PI * 0.95 + 0.15) * (1 - 0.35 * t) + 0.06 * Math.sin(t * 18) * t;
        pts.push(new THREE.Vector2(Math.max(0.02, r), t * 1.8 - 0.9));
      }
      pts.unshift(new THREE.Vector2(0.0001, -0.9));
      return new THREE.LatheGeometry(pts, 160);
    }
    case 'capsule': return new THREE.CapsuleGeometry(0.5, 0.9, 32, 96);
    case 'sphere':
    default: return new THREE.SphereGeometry(1, 192, 128);
  }
}

/** Load a user file into a single BufferGeometry (positions, normals, optional uv). */
export async function loadModelFile(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  const buf = await file.arrayBuffer();
  let root;
  if (ext === 'obj') {
    root = new OBJLoader().parse(new TextDecoder().decode(buf));
  } else if (ext === 'gltf' || ext === 'glb') {
    const gltf = await new Promise((res, rej) => new GLTFLoader().parse(buf, '', res, rej));
    root = gltf.scene;
  } else if (ext === 'fbx') {
    root = new FBXLoader().parse(buf, '');
  } else {
    throw new Error('unsupported');
  }
  root.updateMatrixWorld(true);
  const geos = [];
  root.traverse((o) => {
    if (o.isMesh && o.geometry) {
      let g = o.geometry.clone();
      g.applyMatrix4(o.matrixWorld);
      g = g.index ? g.toNonIndexed() : g;
      const out = new THREE.BufferGeometry();
      out.setAttribute('position', g.getAttribute('position'));
      if (!g.getAttribute('normal')) g.computeVertexNormals();
      out.setAttribute('normal', g.getAttribute('normal'));
      if (g.getAttribute('uv')) out.setAttribute('uv', g.getAttribute('uv'));
      geos.push(out);
    }
  });
  if (!geos.length) throw new Error('nomesh');
  const hasAllUV = geos.every((g) => g.getAttribute('uv'));
  if (!hasAllUV) geos.forEach((g) => g.deleteAttribute('uv'));
  return mergeGeometries(geos, false);
}

/**
 * Normalize to unit bounding sphere centered at origin, convert to non-indexed and ensure normals.
 * Returns { geometry, hadUV }.
 */
export function prepareGeometry(src, { forceUnwrap = false, resolution = 1024 } = {}) {
  let g = src.index ? src.toNonIndexed() : src.clone();
  for (const name of Object.keys(g.attributes)) {
    if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
  }
  if (!g.getAttribute('normal')) g.computeVertexNormals();
  g.computeBoundingBox();
  const c = new THREE.Vector3();
  g.boundingBox.getCenter(c);
  g.translate(-c.x, -c.y, -c.z);
  g.computeBoundingSphere();
  const s = 1 / g.boundingSphere.radius;
  g.scale(s, s, s);
  g.computeBoundingBox();
  g.computeBoundingSphere();

  const uv = g.getAttribute('uv');
  let reason = null;
  if (forceUnwrap) reason = 'forced';
  else if (!uv) reason = 'missing';
  else if (!uvInUnitSquare(uv)) reason = 'outOfRange';
  else if (uvOverlapRatio(g) > 0.015) reason = 'overlap';
  const charts = reason ? autoUnwrap(g, resolution) : 0;
  return { geometry: g, unwrapReason: reason, charts };
}

function uvInUnitSquare(uv) {
  for (let i = 0; i < uv.count; i++) {
    const u = uv.getX(i), v = uv.getY(i);
    if (u < -0.001 || u > 1.001 || v < -0.001 || v > 1.001) return false;
  }
  return true;
}

/** Rasterize UV triangles at low res, return fraction of texels covered more than once. */
function uvOverlapRatio(g) {
  const R = 256;
  const cnt = new Uint8Array(R * R);
  const uv = g.getAttribute('uv');
  const tri = uv.count / 3;
  for (let t = 0; t < tri; t++) {
    const ax = uv.getX(3 * t) * R, ay = uv.getY(3 * t) * R;
    const bx = uv.getX(3 * t + 1) * R, by = uv.getY(3 * t + 1) * R;
    const cx = uv.getX(3 * t + 2) * R, cy = uv.getY(3 * t + 2) * R;
    const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (Math.abs(area) < 1e-9) continue;
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx))), x1 = Math.min(R - 1, Math.ceil(Math.max(ax, bx, cx)));
    const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy))), y1 = Math.min(R - 1, Math.ceil(Math.max(ay, by, cy)));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const px = x + 0.5, py = y + 0.5;
      const w0 = ((bx - px) * (cy - py) - (by - py) * (cx - px)) / area;
      const w1 = ((cx - px) * (ay - py) - (cy - py) * (ax - px)) / area;
      const w2 = 1 - w0 - w1;
      if (w0 > 0.02 && w1 > 0.02 && w2 > 0.02) { const k = y * R + x; if (cnt[k] < 255) cnt[k]++; }
    }
  }
  let covered = 0, over = 0;
  for (let i = 0; i < cnt.length; i++) { if (cnt[i]) covered++; if (cnt[i] > 1) over++; }
  return covered ? over / covered : 1;
}

/** Weld non-indexed vertices by position. Returns { weld: Int32Array(vertCount), uniqueCount, uniquePos }. */
export function weldPositions(g) {
  const pos = g.getAttribute('position');
  const map = new Map();
  const weld = new Int32Array(pos.count);
  const uniquePos = [];
  const q = 1e5;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const key = Math.round(x * q) + ',' + Math.round(y * q) + ',' + Math.round(z * q);
    let id = map.get(key);
    if (id === undefined) { id = uniquePos.length / 3; map.set(key, id); uniquePos.push(x, y, z); }
    weld[i] = id;
  }
  return { weld, uniqueCount: uniquePos.length / 3, uniquePos: new Float32Array(uniquePos) };
}

/**
 * Lightweight xatlas-like auto-unwrap: charts by dominant normal axis + connectivity,
 * planar projection, shelf packing with gutter. Uniform texel density across charts.
 */
export function autoUnwrap(g, resolution = 1024) {
  const pos = g.getAttribute('position');
  const triCount = pos.count / 3;
  const { weld } = weldPositions(g);
  const label = new Uint8Array(triCount);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
  for (let t = 0; t < triCount; t++) {
    a.fromBufferAttribute(pos, 3 * t); b.fromBufferAttribute(pos, 3 * t + 1); c.fromBufferAttribute(pos, 3 * t + 2);
    n.subVectors(b, a).cross(c.clone().sub(a));
    const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
    if (ax >= ay && ax >= az) label[t] = n.x >= 0 ? 0 : 1;
    else if (ay >= az) label[t] = n.y >= 0 ? 2 : 3;
    else label[t] = n.z >= 0 ? 4 : 5;
  }
  // union-find over shared edges with equal label
  const parent = new Int32Array(triCount);
  for (let i = 0; i < triCount; i++) parent[i] = i;
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const edges = new Map();
  for (let t = 0; t < triCount; t++) {
    for (let e = 0; e < 3; e++) {
      const v0 = weld[3 * t + e], v1 = weld[3 * t + ((e + 1) % 3)];
      const key = v0 < v1 ? v0 * 4194304 + v1 : v1 * 4194304 + v0;
      const other = edges.get(key);
      if (other === undefined) edges.set(key, t);
      else if (label[other] === label[t]) {
        const ra = find(other), rb = find(t);
        if (ra !== rb) parent[ra] = rb;
      }
    }
  }
  // project
  const uvArr = new Float32Array(pos.count * 2);
  const proj = (l, x, y, z) => {
    switch (l) {
      case 0: return [-z, y]; case 1: return [z, y];
      case 2: return [x, -z]; case 3: return [x, z];
      case 4: return [x, y]; default: return [-x, y];
    }
  };
  const charts = new Map();
  for (let t = 0; t < triCount; t++) {
    const r = find(t);
    let ch = charts.get(r);
    if (!ch) { ch = { tris: [], minU: Infinity, minV: Infinity, maxU: -Infinity, maxV: -Infinity }; charts.set(r, ch); }
    ch.tris.push(t);
    for (let k = 0; k < 3; k++) {
      const i = 3 * t + k;
      const [u, v] = proj(label[t], pos.getX(i), pos.getY(i), pos.getZ(i));
      uvArr[2 * i] = u; uvArr[2 * i + 1] = v;
      if (u < ch.minU) ch.minU = u; if (u > ch.maxU) ch.maxU = u;
      if (v < ch.minV) ch.minV = v; if (v > ch.maxV) ch.maxV = v;
    }
  }
  const list = [...charts.values()];
  list.forEach((ch) => { ch.w = Math.max(1e-6, ch.maxU - ch.minU); ch.h = Math.max(1e-6, ch.maxV - ch.minV); });
  list.sort((p, q) => q.h - p.h);
  const R = resolution, gutter = 6;
  const tryPack = (s) => {
    let x = 0, y = 0, shelfH = 0;
    for (const ch of list) {
      const w = ch.w * s + gutter * 2, h = ch.h * s + gutter * 2;
      if (w > R) return false;
      if (x + w > R) { y += shelfH; x = 0; shelfH = 0; }
      ch.px = x; ch.py = y;
      x += w; if (h > shelfH) shelfH = h;
      if (y + shelfH > R) return false;
    }
    return true;
  };
  let lo = 1, hi = R * 4;
  for (let i = 0; i < 28; i++) { const mid = (lo + hi) / 2; if (tryPack(mid)) lo = mid; else hi = mid; }
  tryPack(lo);
  const s = lo;
  for (const ch of list) {
    for (const t of ch.tris) for (let k = 0; k < 3; k++) {
      const i = 3 * t + k;
      uvArr[2 * i] = (ch.px + gutter + (uvArr[2 * i] - ch.minU) * s) / R;
      uvArr[2 * i + 1] = (ch.py + gutter + (uvArr[2 * i + 1] - ch.minV) * s) / R;
    }
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uvArr, 2));
  return list.length;
}

/** Per-welded-vertex smooth normals and mean curvature estimate (positive = convex). */
export function computeVertexCurvature(g, weldInfo) {
  const pos = g.getAttribute('position');
  const { weld, uniqueCount, uniquePos } = weldInfo;
  const nrm = new Float32Array(uniqueCount * 3);
  const triCount = pos.count / 3;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
  for (let t = 0; t < triCount; t++) {
    a.fromBufferAttribute(pos, 3 * t); b.fromBufferAttribute(pos, 3 * t + 1); c.fromBufferAttribute(pos, 3 * t + 2);
    e1.subVectors(b, a); e2.subVectors(c, a); e1.cross(e2); // area-weighted
    for (let k = 0; k < 3; k++) { const w = weld[3 * t + k]; nrm[3 * w] += e1.x; nrm[3 * w + 1] += e1.y; nrm[3 * w + 2] += e1.z; }
  }
  for (let i = 0; i < uniqueCount; i++) {
    const l = Math.hypot(nrm[3 * i], nrm[3 * i + 1], nrm[3 * i + 2]) || 1;
    nrm[3 * i] /= l; nrm[3 * i + 1] /= l; nrm[3 * i + 2] /= l;
  }
  const sum = new Float32Array(uniqueCount), cnt = new Float32Array(uniqueCount);
  for (let t = 0; t < triCount; t++) {
    for (let e = 0; e < 3; e++) {
      const i = weld[3 * t + e], j = weld[3 * t + ((e + 1) % 3)];
      const dx = uniquePos[3 * j] - uniquePos[3 * i], dy = uniquePos[3 * j + 1] - uniquePos[3 * i + 1], dz = uniquePos[3 * j + 2] - uniquePos[3 * i + 2];
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < 1e-14) continue;
      const dnx = nrm[3 * j] - nrm[3 * i], dny = nrm[3 * j + 1] - nrm[3 * i + 1], dnz = nrm[3 * j + 2] - nrm[3 * i + 2];
      const k = (dnx * dx + dny * dy + dnz * dz) / d2;
      sum[i] += k; cnt[i]++; sum[j] += k; cnt[j]++;
    }
  }
  const curv = new Float32Array(uniqueCount);
  const abs = [];
  for (let i = 0; i < uniqueCount; i++) { curv[i] = cnt[i] ? sum[i] / cnt[i] : 0; abs.push(Math.abs(curv[i])); }
  abs.sort((p, q) => p - q);
  const scale = abs[Math.floor(abs.length * 0.97)] || 1;
  for (let i = 0; i < uniqueCount; i++) curv[i] = Math.max(0, Math.min(1, 0.5 + 0.5 * curv[i] / scale));
  return { smoothNormals: nrm, curvature: curv };
}
