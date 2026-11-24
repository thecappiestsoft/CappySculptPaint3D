// "Base material & viewport" section (right panel, Pro mode).
import { app } from '../app/state.js';
import { hex2rgb, rgb2hex } from '../utils/color.js';
import { $ } from './dom.js';
import { bindSlider, refreshOutputs } from './widgets.js';
import { renderGraph } from './nodeGraph.js';

export function setupProjectSettings() {
  const dirty = () => (app.fullDirty = true);
  $('#baseColor').addEventListener('input', (e) => { app.comp.base.color = hex2rgb(e.target.value); dirty(); renderGraph(); });
  bindSlider('baseRough', () => app.comp?.base.rough ?? 0.55, (v) => { app.comp.base.rough = v; dirty(); }, (v) => v.toFixed(2));
  bindSlider('baseMetal', () => app.comp?.base.metal ?? 0, (v) => { app.comp.base.metal = v; dirty(); }, (v) => v.toFixed(2));
  bindSlider('normalStrength', () => app.comp?.normalStrength ?? 1, (v) => { app.comp.normalStrength = v; dirty(); }, (v) => v.toFixed(2));
  bindSlider('dispScale', () => app.vp.dispScale, (v) => { app.vp.dispScale = v; app.vp.applyDisplacement(); }, (v) => v.toFixed(3));
  bindSlider('envRot', () => app.vp.envRotation, (v) => app.vp.setEnvRotation(v), (v) => `${v}°`);
  bindSlider('exposure', () => app.vp.renderer.toneMappingExposure, (v) => (app.vp.renderer.toneMappingExposure = v), (v) => v.toFixed(2));
  $('#trueDisp').addEventListener('change', (e) => { app.vp.trueDisplacement = e.target.checked; app.vp.applyDisplacement(); });
}

/** Push project values (after loading a .txs) back into the inputs. */
export function syncProjectInputs() {
  $('#baseColor').value = rgb2hex(app.comp.base.color);
  refreshOutputs();
}
