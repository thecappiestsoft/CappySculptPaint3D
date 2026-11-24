// HSV color wheel, brightness slider, hex input and swatch palette (left panel).
import { app } from '../app/state.js';
import { hex2rgb, rgb2hex, hsv2rgb, rgb2hsv } from '../utils/color.js';
import { $, $$ } from './dom.js';

const PALETTE = ['#c8342a', '#e8742c', '#f2c14e', '#7bb04b', '#2e8b6e', '#2f7fd1', '#5b4bc4', '#a04aa8', '#f2d6c4', '#8a5a3c',
  '#4a2f22', '#6e6e6e', '#b7b7b7', '#ffffff', '#111111', '#b87333', '#c9ae5d', '#8c9aa6', '#3f4f3a', '#7a1f1f'];

const hsv = { h: 0, s: 0.8, v: 0.78 };

function drawWheel() {
  const cv = $('#colorWheel'), ctx = cv.getContext('2d'), W = cv.width, r = W / 2;
  const img = ctx.createImageData(W, W);
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
    const dx = x - r + 0.5, dy = y - r + 0.5, d = Math.hypot(dx, dy) / r;
    const i = 4 * (y * W + x);
    if (d > 1) { img.data[i + 3] = 0; continue; }
    const h = (Math.atan2(dy, dx) / (Math.PI * 2) + 1) % 1;
    const [cr, cg, cb] = hsv2rgb(h, d, hsv.v);
    img.data[i] = cr * 255; img.data[i + 1] = cg * 255; img.data[i + 2] = cb * 255;
    img.data[i + 3] = d > 0.985 ? (1 - d) / 0.015 * 255 : 255;
  }
  ctx.putImageData(img, 0, 0);
  const a = hsv.h * Math.PI * 2, mx = r + Math.cos(a) * hsv.s * r, my = r + Math.sin(a) * hsv.s * r;
  ctx.lineWidth = 2.5; ctx.strokeStyle = hsv.v > 0.5 ? '#000' : '#fff';
  ctx.beginPath(); ctx.arc(mx, my, 6, 0, Math.PI * 2); ctx.stroke();
  ctx.lineWidth = 1.5; ctx.strokeStyle = '#fff';
  ctx.beginPath(); ctx.arc(mx, my, 4.5, 0, Math.PI * 2); ctx.stroke();
}

/** Set the brush color (rgb floats 0..1) and update every color widget. */
export function setColor(rgb, fromWheel = false) {
  app.brush.color = rgb;
  if (!fromWheel) Object.assign(hsv, rgb2hsv(rgb));
  $('#valueSlider').value = hsv.v;
  $('#swatch').style.background = rgb2hex(rgb);
  if (document.activeElement !== $('#hexInput')) $('#hexInput').value = rgb2hex(rgb);
  drawWheel();
}

export function setupColorPicker() {
  const cv = $('#colorWheel');
  const pickAt = (e) => {
    const r = cv.getBoundingClientRect();
    const dx = e.clientX - r.left - r.width / 2, dy = e.clientY - r.top - r.height / 2;
    hsv.h = (Math.atan2(dy, dx) / (Math.PI * 2) + 1) % 1;
    hsv.s = Math.min(1, Math.hypot(dx, dy) / (r.width / 2));
    setColor(hsv2rgb(hsv.h, hsv.s, hsv.v), true);
  };
  cv.addEventListener('pointerdown', (e) => { cv.setPointerCapture(e.pointerId); pickAt(e); });
  cv.addEventListener('pointermove', (e) => { if (e.buttons & 1) pickAt(e); });
  $('#valueSlider').addEventListener('input', (e) => { hsv.v = +e.target.value; setColor(hsv2rgb(hsv.h, hsv.s, hsv.v), true); });
  $('#hexInput').addEventListener('change', (e) => { const v = e.target.value.trim(); if (/^#?[0-9a-f]{6}$/i.test(v)) setColor(hex2rgb(v.startsWith('#') ? v : '#' + v)); });
  $('#swatches').innerHTML = PALETTE.map((c) => `<button style="background:${c}" data-c="${c}" title="${c}"></button>`).join('');
  $$('#swatches button').forEach((b) => b.addEventListener('click', () => setColor(hex2rgb(b.dataset.c))));
}
