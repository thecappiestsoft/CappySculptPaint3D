// Keyboard shortcuts. The list shown in the Help dialog is in ui/dialogs.js (SHORTCUTS).
import { app } from '../app/state.js';
import { TOOLS } from '../engine/brush.js';
import { $ } from './dom.js';
import { setTool, toggleSym, syncBrushInputs } from './brushPanel.js';
import { openRadial, closeRadial, getRadialState } from './radialMenu.js';
import { setMode, isProMode, cycleViewMode } from './toolbar.js';
import { actions } from '../app/actions.js';
import { doUndo } from '../app/history.js';
import { pointer, isStroking, updateCursor } from '../viewport/paintInput.js';

export function setupKeyboard() {
  window.addEventListener('keydown', (e) => {
    const tag = e.target.tagName;
    const typing = (tag === 'INPUT' && !['range', 'checkbox', 'radio', 'color'].includes(e.target.type)) || tag === 'SELECT' || tag === 'TEXTAREA';
    if (typing || $('dialog[open]')) return;
    const k = e.key.toLowerCase();
    const mod = e.ctrlKey || e.metaKey;
    if (mod && k === 'z') { e.preventDefault(); doUndo(e.shiftKey); return; }
    if (mod && k === 'y') { e.preventDefault(); doUndo(true); return; }
    if (mod && k === 's') { e.preventDefault(); actions.saveTxs(); return; }
    if (mod || e.altKey) { if (e.key === 'Control') updateCursor(pointer.x, pointer.y, true); return; }
    if (k >= '1' && k <= '6') { setTool(TOOLS[+k - 1]); return; }
    if (k === '[') { app.brush.size = Math.max(4, Math.round(app.brush.size / 1.15)); syncBrushInputs(); return; }
    if (k === ']') { app.brush.size = Math.min(400, Math.round(app.brush.size * 1.15)); syncBrushInputs(); return; }
    if (e.key === 'Tab') { e.preventDefault(); setMode(isProMode() ? 'simple' : 'pro'); return; }
    if (k === 'c') { cycleViewMode(); return; }
    if (k === 'x') { toggleSym('x'); return; }
    if (k === 'f') { app.vp.frame(); return; }
    if (e.key === 'Escape') { closeRadial(); return; }
    if (e.key === ' ' && !e.repeat) {
      e.preventDefault();
      if (pointer.inside && !isStroking()) openRadial(pointer.x, pointer.y, true);
    }
  });

  window.addEventListener('keyup', (e) => {
    if (e.key === 'Control') updateCursor(pointer.x, pointer.y, false);
    const radial = getRadialState();
    if (e.key === ' ' && radial?.viaKey) {
      // releasing Space over a tool selects it
      if (radial.hot) { setTool(radial.hot); closeRadial(); return; }
      const over = document.elementFromPoint(pointer.x, pointer.y);
      if (!over?.closest('#radial .center')) closeRadial();
    }
  });

  document.addEventListener('pointermove', (e) => { if (getRadialState()) { pointer.x = e.clientX; pointer.y = e.clientY; } });
}
