// Inline SVG icons (stroke style, 24×24). Styled by the global `svg` rule in styles/base.css.

export const ICONS = {
  paint: '<svg viewBox="0 0 24 24"><path d="M18.4 2.6a2 2 0 0 1 2.9 2.9L12 14.8 9.2 12z"/><path d="M9.2 12c-2 0-3.7 1.6-3.7 3.6 0 1.6-1 2.9-2.5 3.4 1 .9 2.4 1.4 3.9 1.4 3.4 0 5.1-2.4 5.1-5.6"/></svg>',
  sculpt: '<svg viewBox="0 0 24 24"><path d="M2 19h20"/><path d="M3 19c2.5-1 3-6 6-6s3.5 3 5.5 3S17 8 20 7"/><circle cx="20" cy="7" r="1.2"/></svg>',
  smooth: '<svg viewBox="0 0 24 24"><path d="M3 9c3-3 6 3 9 0s6-3 9 0"/><path d="M3 15c3-1.5 6 1.5 9 0s6-1.5 9 0"/></svg>',
  erase: '<svg viewBox="0 0 24 24"><path d="m7 21-4-4a2 2 0 0 1 0-2.8L13.2 4a2 2 0 0 1 2.8 0l4 4a2 2 0 0 1 0 2.8L10 21z"/><path d="M8.5 8.7 15.3 15.5M7 21h14"/></svg>',
  fill: '<svg viewBox="0 0 24 24"><path d="m19 11-8-8-8.6 8.6a2 2 0 0 0 0 2.8l5.2 5.2a2 2 0 0 0 2.8 0z"/><path d="m5 2 5 5M2 13h15"/><path d="M22 20a2 2 0 1 1-4 0c0-1.6 2-4 2-4s2 2.4 2 4z"/></svg>',
  smudge: '<svg viewBox="0 0 24 24"><path d="M9 11V5.5a1.5 1.5 0 0 1 3 0V10"/><path d="M12 9.5a1.5 1.5 0 0 1 3 0V11"/><path d="M15 10.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-1.2a6 6 0 0 1-4.6-2.2L3.7 15.6a1.5 1.5 0 0 1 2.3-1.9L9 16"/></svg>',
  eye: '<svg viewBox="0 0 24 24"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  up: '<svg viewBox="0 0 24 24"><path d="m6 15 6-6 6 6"/></svg>',
  down: '<svg viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>',
  copy: '<svg viewBox="0 0 24 24"><rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></svg>',
};

/** Dot color per layer type (layers panel + node graph). */
export const LAYER_COLORS = { paint: '#ff7a2f', fill: '#3fb68b', procedural: '#7a5cff', adjust: '#2f9bff' };
