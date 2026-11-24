// Bottom panel (Pro mode): read-only node view of the layer stack -> PBR output. Click a node to select its layer.
import { app } from '../app/state.js';
import { t } from '../i18n/index.js';
import { rgb2hex } from '../utils/color.js';
import { $, $$ } from './dom.js';
import { LAYER_COLORS } from './icons.js';
import { renderLayers } from './layersPanel.js';

export function renderGraph() {
  const g = $('#graph'), comp = app.comp;
  if (!comp) return;
  const node = (cls, color, body, id) => `<div class="node ${cls}" ${id != null ? `data-id="${id}"` : ''}><div class="nh"><span class="dot" style="background:${color}"></span><span class="nt"></span></div><div class="nb">${body}</div></div>`;
  let html = node('', '#888', `${rgb2hex(comp.base.color)} · R ${comp.base.rough.toFixed(2)} · M ${comp.base.metal.toFixed(2)}`);
  const titles = [t('nodeBase')]; // set via textContent (layer names are user text)
  for (const L of comp.layers) {
    const parts = [`${t('blend_' + (L.blend || 'normal'))} · ${Math.round(L.opacity * 100)}%`];
    if (L.type === 'procedural') parts.push(t('gen_' + L.gen));
    if (L.mask && L.mask.type !== 'none') parts.push(`${t('nodeMask')}: ${t('mask_' + L.mask.type)}`);
    html += node((L.id === app.activeLayerId ? 'sel' : '') + (L.visible ? '' : ' off'), LAYER_COLORS[L.type], parts.join('<br>'), L.id);
    titles.push(L.name);
  }
  html += node('output', '#fff', 'Albedo · Height→Normal<br>Roughness · Metallic · AO');
  titles.push(t('nodeOutput'));
  g.innerHTML = html;
  $$('.node .nt', g).forEach((el, i) => (el.textContent = titles[i]));
  $$('.node[data-id]', g).forEach((n) => (n.onclick = () => { app.activeLayerId = +n.dataset.id; renderLayers(); }));
}
