// Resolves any CSS-legal color string (a named color, "#rgb"/"#rrggbb" hex,
// rgb()/rgba()) to an [r, g, b] triple, so DOM `color`/`background`
// animation can interpolate component-wise the same way scene3d.js
// interpolates a material's THREE.Color - one shared per-change parse (see
// prepareColorChange, called once when an animation/timeline step is
// scheduled, not per frame), then a plain lerp back to a "#rrggbb" string
// each frame. Runs only in the browser (pageRuntime.js) - never imported by
// any Node-side plan-building code, which only ever passes strings through.
//
// Uses a detached <canvas> 2D context to do the actual parsing: assigning
// any legal CSS color to `fillStyle` and reading it back always normalizes
// to "#rrggbb" or "rgba(...)" - the browser's own color parser, not a
// hand-rolled one that would need to be kept in sync with what CSS actually
// accepts (named colors, hex, rgb(), hsl(), ...). This also sidesteps the
// unreliable-readback problem for `el.style.color` (an assigned "red" can
// come back as "rgb(255, 0, 0)" depending on the engine) - whatever format
// comes back, feeding it back through this same probe resolves it correctly.
let probe = null;

function resolveRgb(cssColor) {
  probe ??= document.createElement("canvas").getContext("2d");
  probe.fillStyle = "#000"; // reset - fillStyle silently keeps its old value if the next assignment is invalid CSS
  probe.fillStyle = cssColor;
  const resolved = probe.fillStyle;
  if (resolved[0] === "#") {
    return [parseInt(resolved.slice(1, 3), 16), parseInt(resolved.slice(3, 5), 16), parseInt(resolved.slice(5, 7), 16)];
  }
  const m = /rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)/.exec(resolved);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [0, 0, 0];
}

function toHex2(n) {
  return Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
}

// One-time parse for a scheduled color change - mirrors scene3d.js's own
// prepareChanges (precomputed THREE.Color instances rather than reallocated
// every frame).
export function prepareColorChange(change) {
  return { ...change, fromRgb: resolveRgb(change.from), toRgb: resolveRgb(change.to) };
}

export function lerpColorRgb(fromRgb, toRgb, t) {
  const r = fromRgb[0] + (toRgb[0] - fromRgb[0]) * t;
  const g = fromRgb[1] + (toRgb[1] - fromRgb[1]) * t;
  const b = fromRgb[2] + (toRgb[2] - fromRgb[2]) * t;
  return `#${toHex2(r)}${toHex2(g)}${toHex2(b)}`;
}
