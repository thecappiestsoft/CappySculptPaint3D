// Integrated mesh map baker: Curvature, Ambient Occlusion (stochastic hemisphere ray tracing
// on a BVH), Thickness (inverted rays), World Normal & Position (already in TexelSpace).
import * as THREE from 'three';
import { DoubleSide } from 'three';
import { computeVertexCurvature } from './meshPrep.js';

export async function bakeMaps(geometry, weldInfo, ts, { rays = 32, onProgress } = {}) {
  const { smoothNormals, curvature } = computeVertexCurvature(geometry, weldInfo);
  ts.applyVertexAttribute(ts.curv, weldInfo.weld, curvature);

  const bvh = geometry.boundsTree;
  const n = weldInfo.uniqueCount, P = weldInfo.uniquePos;
  const ao = new Float32Array(n), thick = new Float32Array(n);
  const ray = new THREE.Ray();
  const maxDist = 0.6;
  // fixed low-discrepancy hemisphere directions (cosine weighted, Fibonacci)
  const dirs = [];
  for (let i = 0; i < rays; i++) {
    const u = (i + 0.5) / rays, phi = i * 2.399963229728653;
    const r = Math.sqrt(u), z = Math.sqrt(1 - u);
    dirs.push([r * Math.cos(phi), r * Math.sin(phi), z]);
  }
  const tA = new THREE.Vector3(), tB = new THREE.Vector3(), nn = new THREE.Vector3();
  const chunk = 1500;
  for (let s = 0; s < n; s += chunk) {
    const e = Math.min(n, s + chunk);
    for (let i = s; i < e; i++) {
      nn.set(smoothNormals[3 * i], smoothNormals[3 * i + 1], smoothNormals[3 * i + 2]);
      if (Math.abs(nn.x) < 0.9) tA.set(1, 0, 0); else tA.set(0, 1, 0);
      tA.cross(nn).normalize(); tB.crossVectors(nn, tA);
      let occ = 0, thk = 0;
      for (let j = 0; j < rays; j++) {
        const d = dirs[j];
        const dx = tA.x * d[0] + tB.x * d[1] + nn.x * d[2];
        const dy = tA.y * d[0] + tB.y * d[1] + nn.y * d[2];
        const dz = tA.z * d[0] + tB.z * d[1] + nn.z * d[2];
        // AO: outward hemisphere
        ray.origin.set(P[3 * i] + nn.x * 1e-3, P[3 * i + 1] + nn.y * 1e-3, P[3 * i + 2] + nn.z * 1e-3);
        ray.direction.set(dx, dy, dz);
        const hit = bvh.raycastFirst(ray, DoubleSide, 0, maxDist);
        if (hit) occ += 1 - hit.distance / maxDist;
        // Thickness: inward hemisphere
        if (j % 2 === 0) {
          ray.origin.set(P[3 * i] - nn.x * 1e-3, P[3 * i + 1] - nn.y * 1e-3, P[3 * i + 2] - nn.z * 1e-3);
          ray.direction.set(-dx, -dy, -dz);
          const h2 = bvh.raycastFirst(ray, DoubleSide, 0, 2);
          thk += h2 ? Math.min(1, h2.distance / 0.8) : 1;
        }
      }
      ao[i] = 1 - Math.min(1, (occ / rays) * 1.6);
      thick[i] = thk / Math.ceil(rays / 2);
    }
    onProgress?.(e / n);
    await new Promise((r) => setTimeout(r, 0));
  }
  ts.applyVertexAttribute(ts.ao, weldInfo.weld, ao);
  ts.applyVertexAttribute(ts.thick, weldInfo.weld, thick);
  ts.baked = true;
}
