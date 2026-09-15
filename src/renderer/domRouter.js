// Runs in the browser. The one thing domClient.js delegates to when a
// build actually has `route` declarations (window.__AXIS_ROUTER_PLAN__ is
// present) - matches the current URL, mounts the right page via the exact
// same createPageRuntime every standalone/embedded AXIS page already uses,
// and swaps to a different one on `navigate()`/link click/back-forward by
// destroying the old instance and creating a new one. No second page
// runtime, no virtual DOM, no separate "router state" store - see
// docs/architecture/routing.md for the full design and its boundaries.

import { createPageRuntime } from "./pageRuntime.js";
import { resolvedPagePlan } from "./domPlan.js";
import { matchRoute, parseQuery } from "./router.js";

function toAxisRecord(plainObject) {
  const record = { __axisType: "record" };
  for (const [key, value] of Object.entries(plainObject)) record[key] = value;
  return record;
}

export async function bootstrapRouter(routerPlan, initialRoute) {
  // Manual scroll restoration - see "Scroll behavior" in
  // docs/architecture/routing.md: every SPA-driven navigation (including
  // back/forward) resets to the top, a deliberately simple default rather
  // than per-URL scroll memory.
  if ("scrollRestoration" in window.history) window.history.scrollRestoration = "manual";

  let current = null; // { instance, pageName } - null only before the very first mountFor() below completes

  // `redirect "/old" "/new"` reuses matchRoute unchanged - a redirect entry
  // is shaped just enough like a route ({pattern, pageName: "" }) with
  // its target stashed separately, so router.js doesn't need a second
  // matching function. Dynamic redirect segments (`redirect "/p/:id" "/x"`)
  // aren't substituted into the target - `to` is used exactly as written -
  // a deliberately narrow v1 (static-to-static is the overwhelmingly common
  // case: an old URL retired in favor of a new one).
  function findRedirect(pathname) {
    const asRoutes = (routerPlan.redirects ?? []).map((r) => ({ pattern: r.from, to: r.to }));
    const matched = matchRoute(asRoutes, pathname);
    return matched ? matched.route.to : null;
  }

  async function mountFor(pathname, search, { isInitial }) {
    const redirectTarget = findRedirect(pathname);
    if (redirectTarget) {
      navigate(redirectTarget, { replace: true });
      return;
    }

    const matched = matchRoute(routerPlan.routes, pathname);
    if (!matched) {
      console.error(`[axis] no route matches '${pathname}', and no 'route "*" ...' catch-all page is declared`);
      return;
    }
    const { route, params } = matched;
    const query = parseQuery(search);

    if (isInitial && initialRoute && route.pageName !== initialRoute.pageName) {
      console.error(
        `[axis] router mismatch: the server rendered '${initialRoute.pageName}' for '${pathname}' but the client matched '${route.pageName}' - hydration is probably broken`
      );
    }

    const plan = resolvedPagePlan(routerPlan, route.pageName);

    // Carry forward every other shared `state`/`let` (app/global state
    // survives navigation) but never `params`/`query` themselves - those
    // must come from *this* match, not whatever the previous page's were.
    // See pageRuntime.js's getSharedState.
    let carried = {};
    if (current) {
      carried = current.instance.getSharedState();
      current.instance.destroy();
    }
    const inputs = { ...carried, params: toAxisRecord(params), query: toAxisRecord(query) };

    const instance = await createPageRuntime(plan, {
      // `document.body`, not `document` itself: a subsequent navigation's
      // `render: true` needs a real Element to set `.innerHTML` on and
      // `destroy()` needs one it can `.replaceChildren()` on to clear -
      // `Document` supports neither the way this needs (assigning
      // `document.innerHTML` is a silent no-op, not a DOM mutation) - see
      // docs/architecture/routing.md. Safe even on the very first
      // (hydrating, render:false) mount: that path only ever calls
      // `container.querySelectorAll(...)`, which works identically on
      // `document` or `document.body` since every AXIS node already lives
      // inside `<body>`.
      container: document.body,
      // The very first page was already server-rendered - hydrate it
      // (render:false, matching domClient.js's own non-router bootstrap).
      // Every subsequent navigation has no pre-existing markup for its
      // page and needs fresh DOM built client-side instead.
      render: !isInitial,
      inputs,
      navigate,
    });
    current = { instance, pageName: route.pageName };
    if (plan.title) document.title = plan.title;
    if (!isInitial) window.scrollTo(0, 0);
  }

  function navigate(path, { replace = false } = {}) {
    const url = new URL(path, window.location.href);
    const historyUrl = url.pathname + url.search;
    if (replace) window.history.replaceState(null, "", historyUrl);
    else window.history.pushState(null, "", historyUrl);
    mountFor(url.pathname, url.search, { isInitial: false });
  }

  window.addEventListener("popstate", () => {
    mountFor(window.location.pathname, window.location.search, { isInitial: false });
  });

  await mountFor(window.location.pathname, window.location.search, { isInitial: true });
}
