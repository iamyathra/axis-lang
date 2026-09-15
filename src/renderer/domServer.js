// The DOM sibling of server.js: serves a page's server-rendered HTML plus
// the handful of files the browser needs to hydrate it (the DOM client,
// the style mapping it shares with domPlan.js, and the language runtime
// itself so `on click { ... }` handlers can run live). When the page embeds
// one or more `viewport`s (see docs/architecture/page-scene-fusion.md),
// this also serves three.js and whatever addons/assets those embedded
// scenes actually need - the same threeVendor.js logic server.js uses for
// a whole-scene file, gated so a page with no viewport pays nothing for it.

import http from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { renderPageHtml, renderRouterPageHtml } from "./domHtml.js";
import { extensionUrl } from "./extensionUrl.js";
import { resolveAssetFiles, serveThreeRequest, writeThreeVendorFiles, neededJsmFilesFor } from "./threeVendor.js";
import { createLiveReloadHub } from "./liveReload.js";
import { resolvedPagePlan } from "./domPlan.js";
import { matchRoute, parseQuery, isStaticPattern } from "./router.js";

const SRC_DIR = fileURLToPath(new URL("..", import.meta.url));

const STATIC_FILES = {
  "/domClient.js": "renderer/domClient.js",
  "/pageRuntime.js": "renderer/pageRuntime.js",
  "/domHtml.js": "renderer/domHtml.js",
  "/scene3d.js": "renderer/scene3d.js",
  "/domStyle.js": "renderer/domStyle.js",
  "/domAnimate.js": "renderer/domAnimate.js",
  "/colorLerp.js": "renderer/colorLerp.js",
  "/easing.js": "renderer/easing.js",
  "/tween.js": "renderer/tween.js",
  "/evaluator.js": "evaluator.js",
  "/globals.js": "globals.js",
  "/suggest.js": "suggest.js",
  "/assetPath.js": "assetPath.js",
  "/urlSafety.js": "urlSafety.js",
  // Only ever *imported* by domClient.js when a page actually has a
  // reactive `if`/`for` (see the dynamic import there) - served
  // unconditionally here, same as every other static file, since it's
  // cheap and keeps this table (and writeDomStaticSite's copy of it, which
  // just iterates this same object) a single source of truth. domPlan.js
  // pulls in plan.js (buildScenePlan/buildChange, for a reactive block that
  // happens to declare a `viewport`) - both are pure, Node-free files
  // already, same reason evaluator.js/globals.js are servable as-is.
  "/interpreter.js": "interpreter.js",
  "/domPlan.js": "renderer/domPlan.js",
  "/plan.js": "renderer/plan.js",
  // Only ever *imported* (dynamically, by domClient.js) when a file
  // actually has `route` declarations - served unconditionally here for
  // the same single-source-of-truth reason as every other entry above.
  "/router.js": "renderer/router.js",
  "/domRouter.js": "renderer/domRouter.js",
  // The public registration surface a runtime extension's own script
  // imports from - see extensionRegistry.js's own header,
  // docs/runtime-extensions.md, and server.js's identical entry (the
  // scene-renderer sibling of this file). scene3d.js imports this
  // unconditionally, so it needs to be servable here too, not just from a
  // whole-scene file's own dev server - a page's embedded `viewport`
  // shares the exact same scene3d.js.
  "/extensionRegistry.js": "extensionRegistry.js",
  // domHtml.js (above) imports this - and domHtml.js itself is dual-use
  // (server-side here, but also dynamically imported client-side by
  // domClient.js to re-render a reactive `if`/`for` block's own subtree),
  // so anything domHtml.js imports needs to be servable too, the same
  // "Node-free, so servable as-is" reasoning this file's own header
  // already applies to domPlan.js/plan.js.
  "/extensionUrl.js": "renderer/extensionUrl.js",
};

// name -> absolute disk path, for whichever runtime extensions the given
// plan's own imported packages declared - see server.js's identical
// helper for the scene-renderer side and docs/runtime-extensions.md for
// the full contract. `extensions` is hoisted onto a router plan's own top
// level (buildDomRouterPlan/resolvedPagePlan - domPlan.js), so one call
// covers every routed page, not just the plan passed in.
function extensionRoutes(plan) {
  const routes = {};
  for (const ext of plan.extensions ?? []) routes[extensionUrl(ext.name)] = ext.jsFile;
  return routes;
}

// Every page a router plan actually renders, as a real single-page plan
// (resolvedPagePlan) - the three helpers just below each take one page's
// plan; a router build applies them to every one of these and unions the
// result, so it pays for three.js/an asset only when *some* routed page
// actually needs it, the same "pay nothing unless you use it" guarantee
// the single-page server already had, summed across however many pages
// this build has instead of assuming there's only one.
function allPagePlans(routerPlan) {
  return Object.keys(routerPlan.pages).map((name) => resolvedPagePlan(routerPlan, name));
}

function hasAnyViewportAcrossPages(pagePlans) {
  return pagePlans.some(hasAnyViewport);
}

function collectEmbeddedAssetsAcrossPages(pagePlans) {
  return [...new Set(pagePlans.flatMap(collectEmbeddedAssets))];
}

function collectNeededJsmFilesAcrossPages(pagePlans) {
  const urls = new Set();
  for (const plan of pagePlans) for (const url of collectNeededJsmFiles(plan)) urls.add(url);
  return urls;
}

function hasAnyViewport(plan) {
  return (plan.nodes ?? []).some((n) => n.type === "viewport");
}

// Every distinct model src *and* material.map texture src across every
// viewport this page embeds, deduped - a page can have several viewports,
// each with its own scene, each with its own models/textures. Kept as one
// merged list here (unlike plan.js's own `assets`/`textures` split, which
// exists only so neededJsmFilesFor's GLTFLoader gating can tell them apart)
// - resolveAssetFiles/serveThreeRequest don't care which kind of asset a
// path is, only that it needs to be served.
function collectEmbeddedAssets(plan) {
  const srcs = [];
  for (const node of plan.nodes ?? []) {
    if (node.type === "viewport" && node.scene) srcs.push(...(node.scene.assets ?? []), ...(node.scene.textures ?? []));
  }
  return [...new Set(srcs)];
}

// The union of every embedded viewport's own neededJsmFilesFor - a page can
// have several viewports, each needing a different subset of addons (one
// with a model, one with orbit controls, one with neither).
function collectNeededJsmFiles(plan) {
  const urls = new Set();
  for (const node of plan.nodes ?? []) {
    if (node.type === "viewport" && node.scene) for (const url of neededJsmFilesFor(node.scene)) urls.add(url);
  }
  return urls;
}

// `liveReload: true` (only `axis run` passes this) - see server.js's
// identical mechanism for the scene-renderer side.
export function startDomServer(plan, { port = 0, baseDir, liveReload = false } = {}) {
  let html = renderPageHtml(plan, { liveReload });
  let hasViewports = hasAnyViewport(plan);
  let embeddedAssets = collectEmbeddedAssets(plan);
  let assetFiles = resolveAssetFiles(embeddedAssets, baseDir);
  let neededJsmFiles = collectNeededJsmFiles(plan);
  let extensionFiles = extensionRoutes(plan);
  const reloadHub = liveReload ? createLiveReloadHub() : null;

  const server = http.createServer(async (req, res) => {
    try {
      if (reloadHub && reloadHub.handleRequest(req, res)) return;

      if (req.url === "/") {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(html);
        return;
      }

      if (STATIC_FILES[req.url]) {
        const js = await readFile(path.join(SRC_DIR, STATIC_FILES[req.url]), "utf8");
        res.writeHead(200, { "Content-Type": "text/javascript" });
        res.end(js);
        return;
      }

      if (extensionFiles[req.url]) {
        const js = await readFile(extensionFiles[req.url], "utf8");
        res.writeHead(200, { "Content-Type": "text/javascript" });
        res.end(js);
        return;
      }

      if (hasViewports && (await serveThreeRequest(req, res, { neededJsmFiles, assetFiles }))) return;

      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("not found");
    } catch (err) {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end(`server error: ${err.message}`);
    }
  });

  if (liveReload) {
    server.updatePlan = (newPlan, newBaseDir = baseDir) => {
      html = renderPageHtml(newPlan, { liveReload: true });
      hasViewports = hasAnyViewport(newPlan);
      embeddedAssets = collectEmbeddedAssets(newPlan);
      assetFiles = resolveAssetFiles(embeddedAssets, newBaseDir);
      neededJsmFiles = collectNeededJsmFiles(newPlan);
      extensionFiles = extensionRoutes(newPlan);
    };
    server.notifyReload = () => reloadHub.notify();
  }

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "localhost", () => resolve(server));
  });
}

// Writes the exact same set of files `startDomServer` would serve to disk,
// so a page can be hosted as plain static files instead of needing `axis
// run`.
export async function writeDomStaticSite(plan, outDir, { baseDir } = {}) {
  await mkdir(outDir, { recursive: true });

  await writeFile(path.join(outDir, "index.html"), renderPageHtml(plan));

  for (const [urlPath, relPath] of Object.entries(STATIC_FILES)) {
    const contents = await readFile(path.join(SRC_DIR, relPath), "utf8");
    await writeFile(path.join(outDir, urlPath.slice(1)), contents);
  }

  for (const [urlPath, absPath] of Object.entries(extensionRoutes(plan))) {
    const contents = await readFile(absPath, "utf8");
    const outPath = path.join(outDir, urlPath.slice(1));
    await mkdir(path.dirname(outPath), { recursive: true });
    await writeFile(outPath, contents);
  }

  if (hasAnyViewport(plan)) {
    const embeddedAssets = collectEmbeddedAssets(plan);
    const assetFiles = resolveAssetFiles(embeddedAssets, baseDir);
    await writeThreeVendorFiles(outDir, { neededJsmFiles: collectNeededJsmFiles(plan), assetFiles });
  }

  return outDir;
}

// `redirect`s reuse matchRoute unchanged: shaped just enough like a route
// ({pattern, to} instead of {pattern, pageName}) for matchRoute to not
// need to know or care which kind of entry it matched.
function findRedirectTarget(routerPlan, pathname) {
  const asRoutes = (routerPlan.redirects ?? []).map((r) => ({ pattern: r.from, to: r.to }));
  const matched = matchRoute(asRoutes, pathname);
  return matched ? matched.route.to : null;
}

// The router sibling of startDomServer: a real dev server that server-
// renders whichever page the *request's own* URL matches, per request -
// unlike a static build (writeDomRouterStaticSite, below), this can render
// a dynamic route (`/projects/:id`) correctly too, since there's a real
// server here to match it against, live. `liveReload: true` (only `axis
// run` passes this) works exactly like the single-page server's own.
export function startDomRouterServer(routerPlan, { port = 0, baseDir, liveReload = false } = {}) {
  let plan = routerPlan;
  let pagePlans = allPagePlans(plan);
  let hasViewports = hasAnyViewportAcrossPages(pagePlans);
  let embeddedAssets = collectEmbeddedAssetsAcrossPages(pagePlans);
  let assetFiles = resolveAssetFiles(embeddedAssets, baseDir);
  let neededJsmFiles = collectNeededJsmFilesAcrossPages(pagePlans);
  let extensionFiles = extensionRoutes(plan);
  const reloadHub = liveReload ? createLiveReloadHub() : null;

  const server = http.createServer(async (req, res) => {
    try {
      if (reloadHub && reloadHub.handleRequest(req, res)) return;

      const url = new URL(req.url, "http://localhost");

      if (STATIC_FILES[url.pathname]) {
        const js = await readFile(path.join(SRC_DIR, STATIC_FILES[url.pathname]), "utf8");
        res.writeHead(200, { "Content-Type": "text/javascript" });
        res.end(js);
        return;
      }

      if (extensionFiles[url.pathname]) {
        const js = await readFile(extensionFiles[url.pathname], "utf8");
        res.writeHead(200, { "Content-Type": "text/javascript" });
        res.end(js);
        return;
      }

      const redirectTarget = findRedirectTarget(plan, url.pathname);
      if (redirectTarget) {
        res.writeHead(302, { Location: redirectTarget });
        res.end();
        return;
      }

      const matched = matchRoute(plan.routes, url.pathname);
      if (matched) {
        const pagePlan = resolvedPagePlan(plan, matched.route.pageName);
        const html = renderRouterPageHtml(
          pagePlan,
          plan,
          { pageName: matched.route.pageName, pattern: matched.route.pattern, params: matched.params, query: parseQuery(url.search) },
          { liveReload }
        );
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(html);
        return;
      }

      if (hasViewports && (await serveThreeRequest(req, res, { neededJsmFiles, assetFiles }))) return;

      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("not found");
    } catch (err) {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end(`server error: ${err.message}`);
    }
  });

  if (liveReload) {
    server.updatePlan = (newPlan, newBaseDir = baseDir) => {
      plan = newPlan;
      pagePlans = allPagePlans(plan);
      hasViewports = hasAnyViewportAcrossPages(pagePlans);
      embeddedAssets = collectEmbeddedAssetsAcrossPages(pagePlans);
      assetFiles = resolveAssetFiles(embeddedAssets, newBaseDir);
      neededJsmFiles = collectNeededJsmFilesAcrossPages(pagePlans);
      extensionFiles = extensionRoutes(plan);
    };
    server.notifyReload = () => reloadHub.notify();
  }

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "localhost", () => resolve(server));
  });
}

// The router sibling of writeDomStaticSite. Only a *static* route pattern
// (no `:param`, not `"*"`) gets its own pre-rendered HTML file - a dynamic
// route has no fixed URL to write one at, and is handled entirely by the
// client-side router once any page's JS has loaded (every page's plan is
// embedded in each of them - see domHtml.js's renderRouterPageHtml). A
// `"*"` catch-all page, if declared, is additionally written to
// `404.html` - the filename most static hosts (GitHub Pages, Netlify, S3)
// already look for automatically on an unmatched path. See
// docs/architecture/routing.md's "Server fallback" section for what a real
// deployment still needs to configure - AXIS can't reach into an arbitrary
// host's own routing config from here.
export async function writeDomRouterStaticSite(routerPlan, outDir, { baseDir } = {}) {
  await mkdir(outDir, { recursive: true });

  const pagePlans = allPagePlans(routerPlan);

  for (const route of routerPlan.routes) {
    if (!isStaticPattern(route.pattern)) continue;
    const pagePlan = resolvedPagePlan(routerPlan, route.pageName);
    const html = renderRouterPageHtml(pagePlan, routerPlan, {
      pageName: route.pageName,
      pattern: route.pattern,
      params: {},
      query: {},
    });
    const segments = route.pattern.split("/").filter(Boolean);
    const routeDir = segments.length === 0 ? outDir : path.join(outDir, ...segments);
    await mkdir(routeDir, { recursive: true });
    await writeFile(path.join(routeDir, "index.html"), html);
  }

  const catchAll = routerPlan.routes.find((r) => r.pattern === "*");
  if (catchAll) {
    const pagePlan = resolvedPagePlan(routerPlan, catchAll.pageName);
    const html = renderRouterPageHtml(pagePlan, routerPlan, { pageName: catchAll.pageName, pattern: "*", params: {}, query: {} });
    await writeFile(path.join(outDir, "404.html"), html);
  }

  for (const [urlPath, relPath] of Object.entries(STATIC_FILES)) {
    const contents = await readFile(path.join(SRC_DIR, relPath), "utf8");
    await writeFile(path.join(outDir, urlPath.slice(1)), contents);
  }

  for (const [urlPath, absPath] of Object.entries(extensionRoutes(routerPlan))) {
    const contents = await readFile(absPath, "utf8");
    const outPath = path.join(outDir, urlPath.slice(1));
    await mkdir(path.dirname(outPath), { recursive: true });
    await writeFile(outPath, contents);
  }

  if (hasAnyViewportAcrossPages(pagePlans)) {
    const embeddedAssets = collectEmbeddedAssetsAcrossPages(pagePlans);
    const assetFiles = resolveAssetFiles(embeddedAssets, baseDir);
    await writeThreeVendorFiles(outDir, { neededJsmFiles: collectNeededJsmFilesAcrossPages(pagePlans), assetFiles });
  }

  return outDir;
}
