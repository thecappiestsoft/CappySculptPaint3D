// Translation runtime (PL / EN).
// - Strings live in ./pl.js and ./en.js (same keys in both files).
// - In HTML use data-i18n="key" (text) or data-i18n-title="key" (tooltip).
// - In JS use t('key') or t('key', { n: 5 }) for "{n}" placeholders.
import { STORAGE } from '../config.js';
import pl from './pl.js';
import en from './en.js';

const dict = { pl, en };
export const LANGUAGES = Object.keys(dict);

let lang = localStorage.getItem(STORAGE.lang) || ((navigator.language || 'pl').toLowerCase().startsWith('pl') ? 'pl' : 'en');
const listeners = new Set();

export function t(key, vars) {
  let s = dict[lang][key] ?? dict.en[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, v);
  return s;
}
export function getLang() { return lang; }
export function setLang(l) {
  lang = l;
  localStorage.setItem(STORAGE.lang, l);
  document.documentElement.lang = l;
  applyStatic();
  listeners.forEach((f) => f(l));
}
export function onLangChange(f) { listeners.add(f); }
export function applyStatic(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  root.querySelectorAll('[data-i18n-title]').forEach((el) => { el.title = t(el.dataset.i18nTitle); });
}
