// I/O: PNG (8/16-bit) + OpenEXR (32-bit float) encoders, ZIP container (store) writer/reader,
// channel-packing export presets and the native .txs project archive.
import { TILE } from './texelSpace.js';

// ---------- CRC32 ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
export function crc32(buf, crc = 0) {
  crc = ~crc >>> 0;
  for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return ~crc >>> 0;
}

async function streamBytes(data, stream) {
  const s = new Blob([data]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(s).arrayBuffer());
}
export const deflateZlib = (d) => streamBytes(d, new CompressionStream('deflate'));
export const gzip = (d) => streamBytes(d, new CompressionStream('gzip'));
export const gunzip = (d) => streamBytes(d, new DecompressionStream('gzip'));

// ---------- PNG ----------
/**
 * channels: 1 (gray), 3 (RGB), 4 (RGBA); bitDepth 8 or 16.
 * getter(x, y, c) returns value in [0,1] for image row y (top row = 0).
 */
export async function encodePNG(width, height, channels, bitDepth, getter) {
  const bpc = bitDepth / 8, rowLen = 1 + width * channels * bpc;
  const raw = new Uint8Array(rowLen * height);
  const maxV = bitDepth === 16 ? 65535 : 255;
  for (let y = 0; y < height; y++) {
    let o = y * rowLen; raw[o++] = 0;
    for (let x = 0; x < width; x++) for (let c = 0; c < channels; c++) {
      let v = getter(x, y, c); v = v < 0 ? 0 : v > 1 ? 1 : v;
      const q = Math.round(v * maxV);
      if (bpc === 2) { raw[o++] = q >> 8; raw[o++] = q & 255; } else raw[o++] = q;
    }
  }
  const idat = await deflateZlib(raw);
  const colorType = channels === 1 ? 0 : channels === 3 ? 2 : 6;
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width); dv.setUint32(4, height); ihdr[8] = bitDepth; ihdr[9] = colorType;
  const chunk = (type, data) => {
    const out = new Uint8Array(12 + data.length), d = new DataView(out.buffer);
    d.setUint32(0, data.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    d.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
    return out;
  };
  return concat([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', new Uint8Array(0))]);
}

// ---------- OpenEXR (single channel "Y", 32-bit float, no compression, scanline) ----------
export function encodeEXR(width, height, getter) {
  const parts = [];
  const enc = new TextEncoder();
  const attr = (name, type, bytes) => { parts.push(enc.encode(name + '\0' + type + '\0')); const s = new Uint8Array(4); new DataView(s.buffer).setInt32(0, bytes.length, true); parts.push(s, bytes); };
  const i32 = (...v) => { const b = new Uint8Array(4 * v.length); const d = new DataView(b.buffer); v.forEach((x, i) => d.setInt32(4 * i, x, true)); return b; };
  const f32 = (...v) => { const b = new Uint8Array(4 * v.length); const d = new DataView(b.buffer); v.forEach((x, i) => d.setFloat32(4 * i, x, true)); return b; };
  parts.push(new Uint8Array([0x76, 0x2f, 0x31, 0x01, 2, 0, 0, 0]));
  attr('channels', 'chlist', concat([enc.encode('Y\0'), i32(2, 0, 1, 1), new Uint8Array([0])]));
  attr('compression', 'compression', new Uint8Array([0]));
  attr('dataWindow', 'box2i', i32(0, 0, width - 1, height - 1));
  attr('displayWindow', 'box2i', i32(0, 0, width - 1, height - 1));
  attr('lineOrder', 'lineOrder', new Uint8Array([0]));
  attr('pixelAspectRatio', 'float', f32(1));
  attr('screenWindowCenter', 'v2f', f32(0, 0));
  attr('screenWindowWidth', 'float', f32(1));
  parts.push(new Uint8Array([0]));
  const header = concat(parts);
  const lineBytes = 8 + width * 4;
  const tableBytes = height * 8;
  const out = new Uint8Array(header.length + tableBytes + lineBytes * height);
  out.set(header);
  const dv = new DataView(out.buffer);
  let off = header.length + tableBytes;
  for (let y = 0; y < height; y++) {
    dv.setBigUint64(header.length + y * 8, BigInt(off), true);
    dv.setInt32(off, y, true); dv.setInt32(off + 4, width * 4, true);
    for (let x = 0; x < width; x++) dv.setFloat32(off + 8 + x * 4, getter(x, y), true);
    off += lineBytes;
  }
  return out;
}

// ---------- ZIP (store) ----------
export function zipStore(files) {
  const enc = new TextEncoder();
  const locals = [], centrals = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name), data = f.data, crc = crc32(data);
    const lh = new Uint8Array(30 + name.length), d = new DataView(lh.buffer);
    d.setUint32(0, 0x04034b50, true); d.setUint16(4, 20, true); d.setUint16(8, 0, true);
    d.setUint32(14, crc, true); d.setUint32(18, data.length, true); d.setUint32(22, data.length, true);
    d.setUint16(26, name.length, true); lh.set(name, 30);
    const ch = new Uint8Array(46 + name.length), c = new DataView(ch.buffer);
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true);
    c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true);
    c.setUint16(28, name.length, true); c.setUint32(42, offset, true); ch.set(name, 46);
    locals.push(lh, data); centrals.push(ch);
    offset += lh.length + data.length;
  }
  const cd = concat(centrals);
  const end = new Uint8Array(22), e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
  e.setUint32(12, cd.length, true); e.setUint32(16, offset, true);
  return concat([...locals, cd, end]);
}

export function unzipStore(buf) {
  const u8 = new Uint8Array(buf), dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let eocd = -1;
  for (let i = u8.length - 22; i >= 0; i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('zip');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const out = new Map(), dec = new TextDecoder();
  for (let i = 0; i < count; i++) {
    const size = dv.getUint32(p + 20, true), nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
    const loc = dv.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nlen));
    const lnl = dv.getUint16(loc + 26, true), lxl = dv.getUint16(loc + 28, true);
    const start = loc + 30 + lnl + lxl;
    out.set(name, u8.slice(start, start + size));
    p += 46 + nlen + xlen + clen;
  }
  return out;
}

export function concat(arrs) {
  let n = 0; for (const a of arrs) n += a.length;
  const out = new Uint8Array(n); let o = 0;
  for (const a of arrs) { out.set(a, o); o += a.length; }
  return out;
}

export function download(bytes, filename, mime = 'application/octet-stream') {
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// ---------- Export presets (Channel Packing) ----------
export const EXPORT_PRESETS = ['ue5', 'unity', 'blender'];

/** comp: Compositor (final buffers). Returns array of {name, data}. */
export async function exportPreset(preset, comp, baseName = 'CappySculptPaint3D') {
  const ts = comp.ts, R = ts.res;
  const idx = (x, y) => (R - 1 - y) * R + x; // image top row = v=1
  const A = comp.albedo, O = comp.orm, Nn = comp.normal, H = comp.height;
  const s8 = (arr, x, y, c) => arr[4 * idx(x, y) + c] / 255;
  const h01 = (x, y) => H[idx(x, y)] * 0.5 + 0.5;
  const files = [];
  const png = async (name, ch, bits, get) => files.push({ name: `${baseName}_${name}.png`, data: await encodePNG(R, R, ch, bits, get) });
  if (preset === 'ue5') {
    await png('BaseColor', 3, 8, (x, y, c) => s8(A, x, y, c));
    await png('Normal', 3, 8, (x, y, c) => (c === 1 ? 1 - s8(Nn, x, y, 1) : s8(Nn, x, y, c))); // DirectX Y-
    await png('OcclusionRoughnessMetallic', 3, 8, (x, y, c) => s8(O, x, y, c));
    await png('Height', 1, 16, (x, y) => h01(x, y));
  } else if (preset === 'unity') {
    await png('BaseMap', 4, 8, (x, y, c) => (c === 3 ? 1 : s8(A, x, y, c)));
    // MaskMap: R=Metallic, G=AO, B=DetailMask, A=Smoothness (1-Roughness)
    await png('MaskMap', 4, 8, (x, y, c) => (c === 0 ? s8(O, x, y, 2) : c === 1 ? s8(O, x, y, 0) : c === 2 ? 1 : 1 - s8(O, x, y, 1)));
    await png('Normal', 3, 8, (x, y, c) => s8(Nn, x, y, c)); // OpenGL Y+
  } else {
    await png('Albedo', 3, 16, (x, y, c) => s8(A, x, y, c));
    await png('Roughness', 1, 16, (x, y) => s8(O, x, y, 1));
    await png('Metallic', 1, 16, (x, y) => s8(O, x, y, 2));
    await png('Normal_OpenGL', 3, 16, (x, y, c) => s8(Nn, x, y, c));
    files.push({ name: `${baseName}_Displacement.exr`, data: encodeEXR(R, R, (x, y) => H[idx(x, y)]) });
  }
  return files;
}

// ---------- Native .txs project archive ----------
const layerMeta = (L) => {
  const o = {};
  for (const [k, v] of Object.entries(L)) if (!['c', 'h', 'm', 'cache', 'cacheDirty'].includes(k)) o[k] = v;
  return o;
};

export async function saveTXS(app) {
  const { geometry, ts, comp } = app;
  const files = [];
  const enc = new TextEncoder();
  const P = geometry.getAttribute('position').array, Nn = geometry.getAttribute('normal').array, U = geometry.getAttribute('uv').array;
  const geoBin = concat([new Uint8Array(new Uint32Array([P.length / 3]).buffer), new Uint8Array(P.buffer.slice(P.byteOffset, P.byteOffset + P.byteLength)),
    new Uint8Array(Nn.buffer.slice(Nn.byteOffset, Nn.byteOffset + Nn.byteLength)), new Uint8Array(U.buffer.slice(U.byteOffset, U.byteOffset + U.byteLength))]);
  files.push({ name: 'mesh/geometry.bin', data: await gzip(geoBin) });
  const tiles = [];
  for (const L of comp.layers) {
    if (L.type !== 'paint') continue;
    for (let t = 0; t < ts.tileCount; t++) {
      const tx = t % ts.tilesX, ty = (t / ts.tilesX) | 0;
      const data = new Float32Array(TILE * TILE * 9);
      let nonEmpty = false, o = 0;
      for (let y = ty * TILE; y < Math.min(ts.res, ty * TILE + TILE); y++) for (let x = tx * TILE; x < Math.min(ts.res, tx * TILE + TILE); x++) {
        const k = y * ts.res + x;
        for (let c = 0; c < 4; c++) data[o++] = L.c[4 * k + c];
        data[o++] = L.h[k];
        for (let c = 0; c < 4; c++) data[o++] = L.m[4 * k + c];
        if (L.c[4 * k + 3] || L.h[k] || L.m[4 * k + 1] || L.m[4 * k + 3]) nonEmpty = true;
      }
      if (!nonEmpty) continue; // sparse: only non-empty tiles are stored
      const name = `tiles/layer_${L.id}_${tx}_${ty}.bin.gz`;
      tiles.push(name);
      files.push({ name, data: await gzip(new Uint8Array(data.buffer)) });
    }
  }
  const manifest = {
    format: 'txs', formatVersion: 1, engine: 'CappySculptPaint3D Web 1.0', resolution: ts.res, tileSize: TILE,
    channels: ['albedo', 'height', 'roughness', 'metallic', 'ao'], udim: [1001],
    base: comp.base, normalStrength: comp.normalStrength, modelName: app.modelName,
    layers: comp.layers.map(layerMeta), tiles,
  };
  files.unshift({ name: 'manifest.json', data: enc.encode(JSON.stringify(manifest, null, 2)) });
  return zipStore(files);
}

export async function readTXS(buf) {
  const entries = unzipStore(buf);
  const manifest = JSON.parse(new TextDecoder().decode(entries.get('manifest.json')));
  const geo = await gunzip(entries.get('mesh/geometry.bin'));
  const count = new Uint32Array(geo.buffer.slice(0, 4))[0];
  let o = 4;
  const take = (n) => { const a = new Float32Array(geo.buffer.slice(o, o + n * 4)); o += n * 4; return a; };
  const pos = take(count * 3), nrm = take(count * 3), uv = take(count * 2);
  const tiles = [];
  for (const name of manifest.tiles) {
    const m = name.match(/layer_(\d+)_(\d+)_(\d+)/);
    tiles.push({ layerId: +m[1], tx: +m[2], ty: +m[3], data: new Float32Array((await gunzip(entries.get(name))).buffer) });
  }
  return { manifest, pos, nrm, uv, tiles };
}
