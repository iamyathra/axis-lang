// Renders a DOM render plan to real, server-rendered HTML - the page shows
// up with its first paint already correct, before any JavaScript runs.
// domClient.js then hydrates it: it doesn't rebuild the DOM, it just finds
// these already-rendered elements (by `data-axis-name`) and wires up events
// and live property mutation on top of them.

import { extensionUrl } from "./extensionUrl.js";
import { registeredElementTypes } from "../extensionRegistry.js";

function escapeHtml(text) {
  return String(text).replace(/[&<>]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[ch]));
}

function escapeAttr(text) {
  return String(text).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
}

function kebabCase(prop) {
  return prop.replace(/[A-Z]/g, (ch) => `-${ch.toLowerCase()}`);
}

function styleAttr(style) {
  const { __raw, ...rest } = style;
  const base = Object.entries(rest)
    .map(([prop, value]) => `${kebabCase(prop)}: ${value}`)
    .join("; ");
  if (!__raw) return base;
  return base ? `${base}; ${__raw}` : __raw;
}

export function childrenOf(nodes, parentName) {
  return nodes.filter((n) => n.parent === parentName);
}

// One entry per DOM element type this renderer knows about - "add a new
// element type" means adding one entry here, not a tag lookup plus a
// separate switch case to keep in sync. A container entry (`tag` only)
// nests its children under that real tag; a leaf entry (`render` only)
// is the whole element, attributes and all - each element type's actual
// HTML shape is different enough (a heading's level, a link's href, an
// input's value/placeholder/kind, ...) that a leaf's own `render`
// function is genuinely simpler than a second, generic "which attributes
// does this type have" data table would be.
//
// This registry is local to this file on purpose, not shared with
// pageRuntime.js's own analogous ELEMENT_TAGS table (see the note there) -
// string-building (this file, server-rendered HTML) and live DOM-building
// (the browser) are different enough shapes that forcing one shared
// implementation would cost more clarity than the small amount of
// duplication between the two actually costs.
const ELEMENT_RENDERERS = {
  container: { tag: "div" },
  form: { tag: "form" },
  list: { tag: "ul" },
  item: { tag: "li" },
  text: { render: (node, attrs) => `<div ${attrs}>${escapeHtml(node.content)}</div>` },
  heading: { render: (node, attrs) => `<h${node.level} ${attrs}>${escapeHtml(node.content)}</h${node.level}>` },
  paragraph: { render: (node, attrs) => `<p ${attrs}>${escapeHtml(node.content)}</p>` },
  button: { render: (node, attrs) => `<button ${attrs}>${escapeHtml(node.label)}</button>` },
  link: { render: (node, attrs) => `<a ${attrs} href="${escapeAttr(node.href)}">${escapeHtml(node.label)}</a>` },
  image: { render: (node, attrs) => `<img ${attrs} src="${escapeAttr(node.src)}" alt="${escapeAttr(node.alt)}">` },
  input: {
    render: (node, attrs) =>
      `<input ${attrs} type="${escapeAttr(node.kind)}" value="${escapeAttr(node.value ?? "")}" placeholder="${escapeAttr(node.placeholder ?? "")}">`,
  },
  // Empty on first paint (its box is still correctly sized, so layout
  // doesn't jump) - domClient.js mounts the actual 3D canvas into this div
  // once it hydrates. See docs/architecture/page-scene-fusion.md.
  viewport: { render: (node, attrs) => `<div ${attrs}></div>` },
};

export function renderNode(node, nodes) {
  const attrs = `data-axis-name="${escapeAttr(node.name)}" style="${escapeAttr(styleAttr(node.style))}"`;
  const entry = ELEMENT_RENDERERS[node.type];
  if (entry) {
    if (entry.tag) {
      const inner = childrenOf(nodes, node.name)
        .map((child) => renderNode(child, nodes))
        .join("");
      return `<${entry.tag} ${attrs}>${inner}</${entry.tag}>`;
    }
    return entry.render(node, attrs);
  }
  // Not a built-in type - a registerElementType extension (interpreter.js
  // already rejected anything that's neither, at build time), always the
  // same generic leaf shape: one tag, optional text `content`, nothing
  // more special-cased the way a built-in `link`'s `href` or `input`'s
  // `value`/`placeholder` are - see extensionRegistry.js's own note on
  // why this stays deliberately narrow.
  const registered = registeredElementTypes().get(node.type);
  if (!registered) return "";
  const content = node.content !== undefined ? escapeHtml(node.content) : "";
  return `<${registered.tag} ${attrs}>${content}</${registered.tag}>`;
}

// `responsive: { mobile: { ... } }` (interpreter.js/domPlan.js) - see
// docs/architecture/responsive-layout.md. Every OTHER style AXIS renders is
// a plain inline `style="..."` attribute (above), which beats *any*
// selector-based stylesheet rule on CSS specificity alone, media query or
// not - so a breakpoint override has no way to actually take effect unless
// it out-escalates that, which is exactly what `!important` is for. Used
// nowhere else in AXIS's own generated CSS (a base style is never
// `!important`), so this can't collide with anything.
const BREAKPOINT_MAX_WIDTH = { tablet: 1024, mobile: 640 };

function importantDeclarationsFor(style) {
  const { __raw, ...rest } = style;
  const base = Object.entries(rest)
    .map(([prop, value]) => `${kebabCase(prop)}: ${value} !important;`)
    .join(" ");
  if (!__raw) return base;
  // The raw `css:` escape hatch is free-form text (arbitrary declarations,
  // not a single {property: value} pair) - AXIS can't rewrite it to add
  // `!important` per-declaration without a real CSS parser, so it's
  // appended as authored. An author reaching for `responsive.<tier>.css`
  // to override something the modeled properties don't cover may need to
  // add `!important` themselves for the same reason every other responsive
  // override needs it here.
  return base ? `${base} ${__raw}` : __raw;
}

// One `<style>` block of real `@media` rules, tablet's before mobile's so
// a viewport narrow enough to match both (<=640px) has mobile's own
// declarations win on equal specificity - the ordinary CSS cascade, not
// anything AXIS has to arbitrate itself.
// `scopePrefix` (e.g. ".axis-abc123 ") - a mounted embedded instance's own
// per-instance class, prepended to every selector so its responsive rules
// can't leak onto (or collide with) another AXIS instance, or the host
// page, that happens to reuse the same element name - `data-axis-name`
// uniqueness is only guaranteed *within* one AXIS build, and a `<style>`
// tag applies document-wide regardless of where in the DOM it's inserted
// (unlike Shadow DOM, plain insertion position doesn't scope it). Empty for
// the standalone page renderer (renderPageHtml, below), which owns the
// whole document and has never needed this - see docs/architecture/
// embedding.md for the full isolation strategy.
export function buildResponsiveStyleBlock(rules, scopePrefix = "") {
  if (!rules || rules.length === 0) return "";
  let css = "";
  for (const tier of ["tablet", "mobile"]) {
    const tierRules = rules.filter((r) => r.tier === tier);
    if (tierRules.length === 0) continue;
    const body = tierRules
      .map((r) => `${scopePrefix}[data-axis-name="${escapeAttr(r.name)}"] { ${importantDeclarationsFor(r.style)} }`)
      .join(" ");
    css += `@media (max-width: ${BREAKPOINT_MAX_WIDTH[tier]}px) { ${body} }\n`;
  }
  return css ? `<style>\n${css}</style>\n` : "";
}

// The embedded-mount sibling of renderPageHtml's own inline <head><style>
// block (below): the same button/a/img/canvas reset, but scoped under the
// instance's own class instead of applying bare - an embedded AXIS
// component must never restyle every button/link/image/canvas in the host
// application (see docs/architecture/embedding.md's CSS isolation section).
// Deliberately omits the standalone block's `html, body { margin: 0; ... }`
// rule entirely - a page-level default has no embedded equivalent; the
// host owns its own body.
export function scopedResetStyle(scopeClass) {
  const p = `.${scopeClass} `;
  return `<style>${p}button { font: inherit; cursor: pointer; border: none; } ${p}a { text-decoration: none; color: inherit; } ${p}img { max-width: 100%; display: block; } ${p}canvas { display: block; }</style>\n`;
}

// Builds exactly the fragment `mount()` needs to plant into a host-supplied
// container - the same node markup + responsive `<style>` block
// renderPageHtml produces for a full document, minus everything that's
// meaningless (or actively harmful - Rule 4/7) outside of AXIS owning the
// whole page: no <!doctype>/<html>/<head>, no `window.__AXIS_PAGE_PLAN__`
// script (mount() already has the plan in hand, no need to round-trip it
// through global `window` state), no <script src="/domClient.js"> (the
// embedding runtime is already running). `scopeClass`, if given, scopes
// both the reset and the responsive rules under it - see
// buildResponsiveStyleBlock/scopedResetStyle, above.
export function renderPageFragment(plan, { scopeClass } = {}) {
  const body = childrenOf(plan.nodes, null)
    .map((node) => renderNode(node, plan.nodes))
    .join("");
  const scopePrefix = scopeClass ? `.${scopeClass} ` : "";
  const reset = scopeClass ? scopedResetStyle(scopeClass) : "";
  const responsiveStyle = buildResponsiveStyleBlock(plan.responsiveRules, scopePrefix);
  return reset + responsiveStyle + body;
}

// A viewport's embedded scene plan carries the exact same shape a
// whole-scene file's plan does, `repeat: Infinity` (`repeat: infinite`)
// included - JSON has no way to represent Infinity, so swap it for a
// string scene3d.js knows to check for, same as html.js does for a
// whole-scene file's own plan.
function planToJson(plan) {
  return JSON.stringify(plan, (_key, value) => (value === Infinity ? "infinite" : value)).replace(/</g, "\\u003c");
}

// Any viewport whose embedded scene needs a three.js addon (a `model` to
// load, or `camera { controls: "orbit" }`) - either means the page needs
// the import map below.
function needsImportMap(plan) {
  return (plan.nodes ?? []).some(
    (n) => n.type === "viewport" && (n.scene?.assets?.length > 0 || n.scene?.camera?.controls === "orbit")
  );
}

// `axis run` opts into this (never a static build) - see html.js's
// identical constant for the scene-renderer side, and cli.js's `run`
// command for the file watcher that triggers it.
const LIVE_RELOAD_SCRIPT = `<script>new EventSource("/__axis_reload__").onmessage = () => location.reload();</script>\n`;

// The shared document shell both renderPageHtml (a file with no `route`s -
// one page, `window.__AXIS_PAGE_PLAN__`) and renderRouterPageHtml (below -
// several, `window.__AXIS_ROUTER_PLAN__` plus which one this request
// server-rendered) wrap their own bootstrap `<script>` payload in - same
// `<head>`/reset/import-map/live-reload logic either way, so there's one
// template to keep correct, not two.
function renderHtmlDocument({ title, body, responsiveStyle, importMap, extensionScripts, bootstrapScript, liveReload }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title || "AXIS")}</title>
<style>
  html, body { margin: 0; min-height: 100%; font-family: system-ui, sans-serif; }
  button { font: inherit; cursor: pointer; border: none; }
  a { text-decoration: none; color: inherit; }
  img { max-width: 100%; display: block; }
  canvas { display: block; }
</style>
${responsiveStyle}</head>
<body>
${body}
${bootstrapScript}
${importMap}${extensionScripts}<script type="module" src="/domClient.js"></script>
${liveReload ? LIVE_RELOAD_SCRIPT : ""}</body>
</html>
`;
}

// Same reasoning as html.js's identical helper (see its own comment) - a
// runtime extension's own top-level registration call must have already
// run by the time domClient.js -> scene3d.js needs it, which document
// order among non-async module scripts guarantees as long as these tags
// come first.
function extensionScriptsFor(plan) {
  return (plan.extensions ?? []).map((ext) => `<script type="module" src="${extensionUrl(ext.name)}"></script>\n`).join("");
}

export function renderPageHtml(plan, { liveReload = false } = {}) {
  const body = childrenOf(plan.nodes, null)
    .map((node) => renderNode(node, plan.nodes))
    .join("");

  return renderHtmlDocument({
    title: plan.title,
    body,
    responsiveStyle: buildResponsiveStyleBlock(plan.responsiveRules),
    // Any three.js addon (served from three's own examples/jsm/, see
    // threeVendor.js) imports three itself via the bare specifier
    // `'three'`, not a relative path - browsers only resolve that through
    // an import map, so this only needs to exist when some viewport's
    // embedded scene actually needs one.
    importMap: needsImportMap(plan)
      ? `<script type="importmap">{"imports": {"three": "/vendor/three.module.js"}}</script>\n`
      : "",
    extensionScripts: extensionScriptsFor(plan),
    bootstrapScript: `<script>window.__AXIS_PAGE_PLAN__ = ${planToJson(plan)};</script>`,
    liveReload,
  });
}

// The routed sibling of renderPageHtml - server-renders the one page a
// request's URL actually matched (`resolvedPagePlan`, already merged with
// the program's shared `functions`/`sharedVariables` - see domPlan.js's
// `resolvedPagePlan`), but embeds the *whole* router plan
// (`window.__AXIS_ROUTER_PLAN__`) so the client can navigate to every
// other route with no further server round-trip - the same "ship the AST,
// interpret it everywhere" tradeoff the rest of AXIS already makes,
// documented (and its ceiling acknowledged) in
// docs/architecture/routing.md. `initialRoute` - `{pageName, pattern,
// params, query}` - is what domRouter.js reads to know this exact page was
// already rendered server-side, so hydration doesn't re-render (or worse,
// re-match a possibly-different route) on first paint.
export function renderRouterPageHtml(resolvedPagePlan, routerPlan, initialRoute, { liveReload = false } = {}) {
  const body = childrenOf(resolvedPagePlan.nodes, null)
    .map((node) => renderNode(node, resolvedPagePlan.nodes))
    .join("");

  const routerPlanJson = planToJson(routerPlan);
  const initialRouteJson = JSON.stringify(initialRoute).replace(/</g, "\\u003c");

  return renderHtmlDocument({
    title: resolvedPagePlan.title,
    body,
    responsiveStyle: buildResponsiveStyleBlock(resolvedPagePlan.responsiveRules),
    importMap: needsImportMap(resolvedPagePlan)
      ? `<script type="importmap">{"imports": {"three": "/vendor/three.module.js"}}</script>\n`
      : "",
    extensionScripts: extensionScriptsFor(routerPlan),
    bootstrapScript: `<script>window.__AXIS_ROUTER_PLAN__ = ${routerPlanJson}; window.__AXIS_INITIAL_ROUTE__ = ${initialRouteJson};</script>`,
    liveReload,
  });
}
