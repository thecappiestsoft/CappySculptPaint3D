// Reusable form helpers: range sliders with <output> readouts and translated <select>s.
import { t } from '../i18n/index.js';
import { $, $$ } from './dom.js';

/**
 * Wire an <input type="range" id="..."> (optionally followed by <output>) to a value.
 * @param get  () => current value      @param set  (v) => apply value      @param fmt  (v) => readout text
 */
export function bindSlider(id, get, set, fmt = (v) => v) {
  const el = $('#' + id), out = el.nextElementSibling;
  el.value = get();
  const upd = () => { if (out && out.tagName === 'OUTPUT') out.textContent = fmt(+el.value); };
  el.addEventListener('input', () => { set(+el.value); upd(); });
  el._refresh = () => { el.value = get(); upd(); };
  upd();
}

/** Re-read every bound slider from its getter (after state changed from code). */
export function refreshOutputs() { $$('input[type=range]').forEach((el) => el._refresh?.()); }

/** Fill a <select> with options whose labels are t(prefix + value). */
export function fillSelect(sel, values, prefix, current) {
  sel.innerHTML = values.map((v) => `<option value="${v}">${t(prefix + v)}</option>`).join('');
  if (current !== undefined) sel.value = current;
}
