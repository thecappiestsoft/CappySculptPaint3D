// Modal dialogs: texture export presets and keyboard-shortcut help.
import { app } from '../app/state.js';
import { t, getLang } from '../i18n/index.js';
import { EXPORT_PRESETS, exportPreset, zipStore, download } from '../engine/io.js';
import { FILE_PREFIX } from '../config.js';
import { $, toast, progress, nextFrame } from './dom.js';

// ---------- export
export function openExport() {
  $('#presetList').innerHTML = EXPORT_PRESETS.map((p, i) => `<label class="preset"><input type="radio" name="preset" value="${p}" ${i === 0 ? 'checked' : ''}><span><b>${t('preset_' + p)}</b><small>${t('preset_' + p + '_desc')}</small></span></label>`).join('');
  $('#exportDialog').showModal();
}

async function runExport(preset) {
  progress(t('exporting'), 0.3); await nextFrame();
  try {
    const name = `${FILE_PREFIX}_${app.modelName}`;
    const files = await exportPreset(preset, app.comp, name);
    download(zipStore(files), `${name}_${preset}.zip`, 'application/zip');
    toast(t('exported', { n: files.length }));
  } catch (e) { console.error(e); toast(e.message, true); } finally { progress(null); }
}

// ---------- help
const SHORTCUTS = [
  ['1 – 6', 'k_tools'], ['[ &nbsp; ]', 'k_size'], ['Ctrl', 'k_invert'], ['Space / PPM', 'k_radial'], ['Shift + PPM', 'k_light'],
  ['Ctrl+Z / Ctrl+Y', 'k_undo'], ['Tab', 'k_mode'], ['C', 'k_view'], ['X', 'k_sym'], ['F', 'k_frame'], ['Alt + LPM', 'k_orbit'], ['ŚPM', 'k_pan'],
];

export function openHelp() {
  const en = getLang() === 'en';
  $('#keysTable').innerHTML = SHORTCUTS.map(([k, d]) => `<tr><td><kbd>${en ? k.replace('PPM', 'RMB').replace('LPM', 'LMB').replace('ŚPM', 'MMB') : k}</kbd></td><td>${t(d)}</td></tr>`).join('');
  $('#helpDialog').showModal();
}

export function setupDialogs() {
  $('#exportDialog').addEventListener('close', () => {
    if ($('#exportDialog').returnValue === 'ok') runExport($('input[name=preset]:checked', $('#exportDialog')).value);
  });
}
