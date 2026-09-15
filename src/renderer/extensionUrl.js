// The one place that decides a runtime extension's own served URL -
// shared by html.js and domHtml.js (which <script> tag to emit) and
// server.js and domServer.js (which request path to match against it).
// A package name is already a filesystem directory name
// (axis_modules/<name>/), so the encoding here is defensive, not
// load-bearing for the common case. See docs/runtime-extensions.md.
export function extensionUrl(packageName) {
  return `/extensions/${encodeURIComponent(packageName)}.js`;
}
