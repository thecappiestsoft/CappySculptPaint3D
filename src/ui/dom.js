// Small DOM helpers shared by all UI modules.

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

/** Show a short notification in the bottom-right corner. */
export function toast(msg, err = false) {
  const el = document.createElement('div');
  el.className = 'toast' + (err ? ' err' : '');
  el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), err ? 6000 : 3800);
}

/** Progress overlay over the viewport. progress(null) hides it. */
export function progress(label, frac) {
  const p = $('#progress');
  if (label === null) { p.hidden = true; return; }
  p.hidden = false;
  $('#progressLabel').textContent = label;
  $('#progressBar').style.width = `${Math.round((frac ?? 0) * 100)}%`;
}

/** Wait one frame so the browser can repaint (e.g. show the progress overlay) before heavy work. */
export const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
