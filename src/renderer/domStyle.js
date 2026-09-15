// Maps AXIS's page-element properties to real CSS. Shared between the
// Node-side render-plan builder (domPlan.js, computing each node's initial
// style) and the browser client (domClient.js, applying a live style change
// when a handler mutates a property) - same reason evaluator.js/globals.js
// are environment-agnostic: one mapping, everywhere it's needed.

const ALIGN_MAP = {
  start: "flex-start",
  center: "center",
  end: "flex-end",
  between: "space-between",
  around: "space-around",
  stretch: "stretch",
};

function sizeValue(value) {
  return typeof value === "number" ? `${value}px` : value;
}

// Returns a plain {cssProperty: cssValue} object for one AXIS property.
// `elementType` disambiguates properties that mean different things on
// different elements (`align` is text-align on `text`, align-items
// elsewhere).
export function cssForProperty(elementType, key, value) {
  switch (key) {
    case "width":
      return { width: sizeValue(value) };
    case "height":
      return { height: sizeValue(value) };
    case "padding":
      return { padding: sizeValue(value) };
    case "gap":
      return { gap: sizeValue(value) };
    case "radius":
      return { borderRadius: sizeValue(value) };
    case "background":
      return { background: value };
    case "color":
      return { color: value };
    case "direction":
      return { display: "flex", flexDirection: value };
    case "align":
      return elementType === "text" ? { textAlign: value } : { alignItems: ALIGN_MAP[value] ?? value };
    case "justify":
      return { justifyContent: ALIGN_MAP[value] ?? value };
    case "size":
      return { fontSize: sizeValue(value) };
    case "weight":
      return { fontWeight: value };
    case "border":
      return { border: value };
    case "shadow":
      return { boxShadow: value };
    case "opacity":
      return { opacity: value };
    case "cursor":
      return { cursor: value };
    case "position":
      return { position: value };
    case "top":
      return { top: sizeValue(value) };
    case "left":
      return { left: sizeValue(value) };
    case "right":
      return { right: sizeValue(value) };
    case "bottom":
      return { bottom: sizeValue(value) };
    case "z":
      return { zIndex: value };
    default:
      return {};
  }
}

// Fields on a page-graph node that describe content or identity rather than
// styling - everything else gets run through cssForProperty. `css` is
// handled separately below (it's raw CSS text, not a {property: value}
// pair); `bindings` is domPlan.js/domClient.js bookkeeping, not a style.
const NON_STYLE_KEYS = new Set([
  "type", "name", "parent", "content", "label", "href", "src", "alt",
  "level", "kind", "value", "placeholder", "bindings", "css",
]);

export function buildStyle(node) {
  const style = {};
  for (const key of Object.keys(node)) {
    if (NON_STYLE_KEYS.has(key)) continue;
    Object.assign(style, cssForProperty(node.type, key, node[key]));
  }
  // the `css` escape hatch: raw declarations appended verbatim after
  // everything else, so it can override a modeled property too.
  if (node.css) style.__raw = node.css;
  return style;
}
