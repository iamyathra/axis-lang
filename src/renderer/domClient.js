// Runs in the browser, not in Node. The standalone-site bootstrap for
// `axis run`/`axis build` output: the page's HTML is already fully
// rendered by the server (domHtml.js), and this file's whole job is to
// start the shared page runtime (pageRuntime.js) hydrating it, against the
// plan domHtml.js embedded as `window.__AXIS_PAGE_PLAN__` and `document`
// as the container it owns. Every DOM/reactivity/lifecycle mechanism lives
// in pageRuntime.js now - this is the one thing that's actually different
// between a standalone site and an embedded AXIS instance (mount.js calls
// the exact same `createPageRuntime` with a host-supplied container
// instead) - see docs/architecture/embedding.md.
//
// A file with `route` declarations ships `window.__AXIS_ROUTER_PLAN__`
// instead (domHtml.js's renderRouterPageHtml) - domRouter.js is the one
// extra thing that needs, dynamically imported so a plain, non-routed
// page (still the common case, and every page before this feature
// existed) pays nothing for it. See docs/architecture/routing.md.
import { createPageRuntime } from "./pageRuntime.js";

if (window.__AXIS_ROUTER_PLAN__) {
  const { bootstrapRouter } = await import("./domRouter.js");
  await bootstrapRouter(window.__AXIS_ROUTER_PLAN__, window.__AXIS_INITIAL_ROUTE__);
} else {
  await createPageRuntime(window.__AXIS_PAGE_PLAN__, { container: document });
}
