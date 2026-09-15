// Wraps a render plan in the smallest possible HTML page. The plan gets
// embedded straight into a <script> tag as JSON so client.js can read it
// without an extra network round trip.

import { extensionUrl } from "./extensionUrl.js";

// `axis run` opts into this (never a static build - see writeStaticSite in
// server.js, which never passes it) - an EventSource connection to the dev
// server's /__axis_reload__ route, reloading the page the moment cli.js's
// file watcher rebuilds successfully. See cli.js's `run` command.
const LIVE_RELOAD_SCRIPT = `<script>new EventSource("/__axis_reload__").onmessage = () => location.reload();</script>\n`;

export function renderHtml(plan, { liveReload = false } = {}) {
  // JSON can't represent Infinity (repeat: infinite), so swap it for a
  // string client.js knows to check for. Also escape "</script>" inside
  // the JSON so it can't break out of the tag.
  const planJson = JSON.stringify(plan, (_key, value) => (value === Infinity ? "infinite" : value)).replace(
    /</g,
    "\\u003c"
  );

  // Any three.js addon (GLTFLoader for a `model`, OrbitControls for
  // `camera { controls: "orbit" }` - served from three's own examples/jsm/,
  // see threeVendor.js) imports three itself via the bare specifier
  // `'three'`, not a relative path - browsers only resolve that through an
  // import map, so this only needs to exist when the scene actually uses
  // one of them.
  const needsImportMap = plan.assets?.length > 0 || plan.camera?.controls === "orbit";
  const importMap = needsImportMap
    ? `<script type="importmap">{"imports": {"three": "/vendor/three.module.js"}}</script>\n`
    : "";

  // One <script type="module"> per imported package that declared its own
  // `runtimeExtension` (see modules.js/docs/runtime-extensions.md) -
  // server.js serves the actual file at extensionUrl(name), reading it off
  // whatever path that package's own axis.json pointed to. Ordinary
  // (non-async) module scripts execute in document order, so placing these
  // BEFORE /client.js's own script tag is what actually makes "an
  // extension's top-level registerScalarProperty(...) call has already run
  // by the time scene3d.js needs it" true - not an implementation detail,
  // the one thing this ordering exists to guarantee. See
  // docs/runtime-extensions.md's "How extensions load" section.
  const extensionScripts = (plan.extensions ?? [])
    .map((ext) => `<script type="module" src="${extensionUrl(ext.name)}"></script>\n`)
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>AXIS</title>
<style>
  html, body { margin: 0; height: 100%; overflow: hidden; background: #111; }
  canvas { display: block; }
</style>
</head>
<body>
<script>window.__AXIS_PLAN__ = ${planJson};</script>
${importMap}${extensionScripts}<script type="module" src="/client.js"></script>
${liveReload ? LIVE_RELOAD_SCRIPT : ""}</body>
</html>
`;
}
