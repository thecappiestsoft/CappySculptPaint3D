// Mouse / pen input on the 3D viewport: brush strokes, brush cursor, light rotation, drag & drop.
// LMB on the model paints (captured before OrbitControls), LMB on background / Alt+LMB orbits.
import * as THREE from 'three';
import { app } from '../app/state.js';
import { $ } from '../ui/dom.js';
import { importFile } from '../app/project.js';
import { updateUndo } from '../app/history.js';
import { ensurePaintLayer } from '../ui/layersPanel.js';
import { openRadial, closeRadial } from '../ui/radialMenu.js';
import { refreshOutputs } from '../ui/widgets.js';

const stroke = { active: false, last: null, lazy: null, acc: 0, invert: false, pointerId: null };
/** Last known pointer position over the viewport (shared with keyboard / radial menu). */
export const pointer = { x: 0, y: 0, inside: false };
let lightDrag = null, rmbDown = null;

export const isStroking = () => stroke.active;

/** Surface normal at a hit, taken from the rasterized normal map (smooth) or the face normal. */
function texelNormal(hit) {
  const ts = app.ts, R = ts.res;
  if (hit.uv) {
    const x = Math.min(R - 1, Math.max(0, Math.floor(hit.uv.x * R))), y = Math.min(R - 1, Math.max(0, Math.floor(hit.uv.y * R)));
    const k = y * R + x;
    if (ts.covered[k]) return new THREE.Vector3(ts.nrm[3 * k], ts.nrm[3 * k + 1], ts.nrm[3 * k + 2]);
  }
  return hit.faceNormal;
}

/** One brush dab at screen position (x, y). */
function dabAt(x, y, pressure) {
  const hit = app.vp.pick(x, y);
  if (!hit) return null;
  const cam = app.vp.camera;
  const N = texelNormal(hit);
  const V = hit.point.clone().sub(cam.position).normalize();
  const e = cam.matrixWorld.elements;
  const frame = { C: hit.point.toArray(), N: N.toArray(), V: V.toArray(), T: [e[0], e[1], e[2]], B: [e[4], e[5], e[6]] };
  const R = (app.brush.size / 2) * app.vp.worldPerPixel(hit.point);
  app.engine.dab(frame, R, pressure, stroke.invert);
  return hit;
}

const pressureOf = (e) => (e.pointerType === 'pen' ? (e.pressure || 0.0001) : 1);

/** Continue the stroke to (x, y): applies Lazy Mouse and places dabs at even spacing. */
function strokeTo(x, y, pressure) {
  const b = app.brush;
  let tx = x, ty = y;
  if (b.lazy > 0) {
    const L = stroke.lazy, dx = x - L.x, dy = y - L.y, d = Math.hypot(dx, dy);
    if (d <= b.lazy) return;
    L.x += (dx / d) * (d - b.lazy); L.y += (dy / d) * (d - b.lazy);
    tx = L.x; ty = L.y;
  }
  const last = stroke.last;
  const dx = tx - last.x, dy = ty - last.y, dist = Math.hypot(dx, dy);
  const step = Math.max(1, b.size * b.spacing); // adaptive dab spacing (proportional to radius)
  let travelled = step - stroke.acc;
  while (travelled <= dist) {
    const f = travelled / dist;
    dabAt(last.x + dx * f, last.y + dy * f, last.p + (pressure - last.p) * f);
    travelled += step;
  }
  stroke.acc = dist - (travelled - step);
  stroke.last = { x: tx, y: ty, p: pressure };
}

/** Move the circular brush cursor to the surface under (x, y). */
export function updateCursor(x = pointer.x, y = pointer.y, invert = false) {
  if (!app.vp?.mesh || !pointer.inside) return;
  const hit = app.vp.pick(x, y);
  if (!hit) { app.vp.hideCursor(); $('#gl').style.cursor = 'default'; return; }
  $('#gl').style.cursor = 'none';
  const R = (app.brush.size / 2) * app.vp.worldPerPixel(hit.point);
  const tool = app.brush.tool;
  const color = invert ? 0x4aa3ff : tool === 'sculpt' ? 0xffb066 : tool === 'erase' ? 0xff6b6b : 0xffffff;
  app.vp.showCursor(hit.point, texelNormal(hit), R, color);
}

export function setupViewportInput() {
  const cv = $('#gl');
  cv.addEventListener('contextmenu', (e) => e.preventDefault());

  // capture phase so painting wins over OrbitControls
  cv.addEventListener('pointerdown', (e) => {
    if (app.busy) { e.stopImmediatePropagation(); return; }
    closeRadial();
    if (e.button === 2) {
      e.stopImmediatePropagation();
      if (e.shiftKey) { lightDrag = { x: e.clientX, rot: app.vp.envRotation }; cv.setPointerCapture(e.pointerId); }
      else rmbDown = { x: e.clientX, y: e.clientY };
      return;
    }
    if (e.button !== 0 || e.altKey) return; // alt+LMB / MMB -> camera
    const hit = app.vp.pick(e.clientX, e.clientY);
    if (!hit) return; // background -> orbit
    e.stopImmediatePropagation();
    app.vp.controls.enabled = false;
    const L = ensurePaintLayer();
    if (app.brush.tool === 'fill') {
      if (app.engine.fillLayer(L, app.brush)) updateUndo();
      app.vp.controls.enabled = true;
      return;
    }
    cv.setPointerCapture(e.pointerId);
    stroke.active = true; stroke.pointerId = e.pointerId;
    stroke.invert = e.ctrlKey || e.metaKey;
    app.engine.beginStroke(L, app.brush);
    const p = pressureOf(e);
    stroke.last = { x: e.clientX, y: e.clientY, p }; stroke.lazy = { x: e.clientX, y: e.clientY }; stroke.acc = 0;
    dabAt(e.clientX, e.clientY, p);
  }, { capture: true });

  cv.addEventListener('pointermove', (e) => {
    Object.assign(pointer, { x: e.clientX, y: e.clientY, inside: true });
    if (lightDrag) {
      const rot = (lightDrag.rot + (e.clientX - lightDrag.x) * 0.5) % 360;
      app.vp.setEnvRotation((rot + 360) % 360); refreshOutputs();
      return;
    }
    if (stroke.active && e.pointerId === stroke.pointerId) {
      stroke.invert = e.ctrlKey || e.metaKey;
      const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      for (const ev of (evs.length ? evs : [e])) strokeTo(ev.clientX, ev.clientY, pressureOf(ev));
    }
    updateCursor(e.clientX, e.clientY, e.ctrlKey || e.metaKey);
  });

  const end = (e) => {
    if (lightDrag) { lightDrag = null; return; }
    if (e.button === 2 && rmbDown) {
      if (Math.hypot(e.clientX - rmbDown.x, e.clientY - rmbDown.y) < 6) openRadial(e.clientX, e.clientY, false);
      rmbDown = null;
      return;
    }
    if (stroke.active && e.pointerId === stroke.pointerId) {
      stroke.active = false;
      if (app.engine.endStroke()) updateUndo();
      app.vp.controls.enabled = true;
    }
  };
  cv.addEventListener('pointerup', end);
  cv.addEventListener('pointercancel', end);
  cv.addEventListener('pointerleave', () => { pointer.inside = false; if (!stroke.active) app.vp.hideCursor(); });
  cv.addEventListener('wheel', () => setTimeout(() => updateCursor(), 30), { passive: true });

  // drag & drop of model / project files
  const vpEl = $('#viewport');
  vpEl.addEventListener('dragover', (e) => { e.preventDefault(); $('#dropHint').hidden = false; });
  vpEl.addEventListener('dragleave', () => { $('#dropHint').hidden = true; });
  vpEl.addEventListener('drop', (e) => {
    e.preventDefault(); $('#dropHint').hidden = true;
    const f = e.dataTransfer.files[0];
    if (f) importFile(f);
  });
}
