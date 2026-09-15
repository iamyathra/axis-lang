// Pure route matching - no Node.js APIs, no DOM. Used both server-side
// (domServer.js's dev server picks which page to server-render per
// request; writeDomStaticSite enumerates which routes can be pre-rendered
// to disk) and client-side (domRouter.js, the browser's own navigation).
// One implementation, same reason evaluator.js/globals.js/plan.js are
// shared this way already - see docs/architecture/routing.md.

// "/projects/:id" -> ["projects", ":id"]. A leading/trailing slash (or a
// doubled one) doesn't change the match - "/about" and "about/" and
// "//about" all produce the same one segment.
function segmentsOf(pattern) {
  return pattern.split("/").filter(Boolean);
}

export function isDynamicPattern(pattern) {
  return segmentsOf(pattern).some((s) => s.startsWith(":"));
}

// A pattern `axis build` can pre-render to a static file: no `:param`
// segments, and not the `"*"` catch-all (which has no single URL of its
// own to write a file at).
export function isStaticPattern(pattern) {
  return pattern !== "*" && !isDynamicPattern(pattern);
}

// routes: [{pattern, pageName}] (or redirect entries with `to` instead of
// `pageName` - matchRoute doesn't care which, it just returns whichever
// route object matched). Static/dynamic routes are tried in declaration
// order; `"*"` is always tried last, regardless of where it was declared,
// so a real route never loses to an accidentally-earlier catch-all.
// Returns { route, params } or null.
export function matchRoute(routes, pathname) {
  const pathSegments = segmentsOf(pathname);

  for (const route of routes) {
    if (route.pattern === "*") continue;
    const patternSegments = segmentsOf(route.pattern);
    if (patternSegments.length !== pathSegments.length) continue;

    const params = {};
    let matched = true;
    for (let i = 0; i < patternSegments.length; i++) {
      const seg = patternSegments[i];
      if (seg.startsWith(":")) {
        params[seg.slice(1)] = decodeURIComponent(pathSegments[i]);
      } else if (seg !== pathSegments[i]) {
        matched = false;
        break;
      }
    }
    if (matched) return { route, params };
  }

  const fallback = routes.find((r) => r.pattern === "*");
  return fallback ? { route: fallback, params: {} } : null;
}

// "?id=42&tag=a&tag=b" -> { id: "42", tag: ["a", "b"] } - a repeated key
// becomes an array, same shape `for tag in query.tag { ... }` would expect;
// a key with no repeats stays a plain string rather than a one-item array,
// which is the common case and what most code actually wants to read.
export function parseQuery(search) {
  const query = {};
  const params = new URLSearchParams(search);
  for (const key of params.keys()) {
    if (key in query) continue; // already collected via getAll below
    const values = params.getAll(key);
    query[key] = values.length > 1 ? values : values[0];
  }
  return query;
}
