// A deliberately tiny static server - just enough to hand the browser the
// generated page, the client runtime, the shared language evaluator (so
// interaction handlers can run live), three.js itself, and - when a scene
// has one - a `model`'s .glb/.gltf file plus the loader that reads it. No
// framework; Node's built-in http module is plenty for a handful of files.

import http from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { renderHtml } from "./html.js";
import { extensionUrl } from "./extensionUrl.js";
import { resolveAssetFiles, serveThreeRequest, writeThreeVendorFiles, neededJsmFilesFor } from "./threeVendor.js";
import { createLiveReloadHub } from "./liveReload.js";

const SRC_DIR = fileURLToPath(new URL("..", import.meta.url));

// url path -> file relative to src/, for the handful of language files the
// browser needs (they import each other by relative path, which resolves
// correctly once served from matching URL paths)
const STATIC_FILES = {
  "/client.js": "renderer/client.js",
  "/scene3d.js": "renderer/scene3d.js",
  "/easing.js": "renderer/easing.js",
  "/tween.js": "renderer/tween.js",
  "/evaluator.js": "evaluator.js",
  "/globals.js": "globals.js",
  "/suggest.js": "suggest.js",
  "/assetPath.js": "assetPath.js",
  // The public registration surface a runtime extension's own script (see
  // extensionRoutes/writeExtensionFiles, below) imports from - see
  // extensionRegistry.js's own header and docs/runtime-extensions.md.
  "/extensionRegistry.js": "extensionRegistry.js",
};

// name -> absolute disk path, for whichever runtime extensions the current
// plan's own imported packages declared (modules.js/plan.js's passthrough -
// see docs/runtime-extensions.md). A plain object, not baked into
// STATIC_FILES, because it changes with the plan (a live-reloaded edit can
// add/remove an import) - html.js's extensionUrl(name) is the one place
// that decides the URL each of these is served at, shared by both server.js
// (matching a request) and writeStaticSite (copying the same file to the
// same relative path on disk).
function extensionRoutes(plan) {
  const routes = {};
  for (const ext of plan.extensions ?? []) routes[extensionUrl(ext.name)] = ext.jsFile;
  return routes;
}

// `liveReload: true` (only `axis run` passes this - see cli.js) adds an SSE
// route the browser connects to on load, and returns a server whose
// `.updatePlan(newPlan, newBaseDir)` / `.notifyReload()` let the caller hot-
// swap what's served and tell already-open tabs to refresh, without
// restarting the process or losing the port.
// Every file a scene's own asset-serving actually needs to resolve on disk -
// `model.src` files (`assets`) and `material.map` texture files (`textures`,
// kept as a separate plan field so threeVendor.js's GLTFLoader gating stays
// accurate - see plan.js's own note on why). One real file list either way,
// as far as resolveAssetFiles/serveThreeRequest are concerned.
function sceneAssetSrcs(plan) {
  return [...(plan.assets ?? []), ...(plan.textures ?? [])];
}

export function startServer(plan, { port = 0, baseDir, liveReload = false } = {}) {
  let html = renderHtml(plan, { liveReload });
  let assetFiles = resolveAssetFiles(sceneAssetSrcs(plan), baseDir);
  let neededJsmFiles = neededJsmFilesFor(plan);
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

      // A runtime extension's own JS - unlike STATIC_FILES (always inside
      // src/), this reads from wherever the consuming project's own
      // axis_modules/<name>/ actually put it (an absolute path already -
      // see modules.js's own resolution). See docs/runtime-extensions.md.
      if (extensionFiles[req.url]) {
        const js = await readFile(extensionFiles[req.url], "utf8");
        res.writeHead(200, { "Content-Type": "text/javascript" });
        res.end(js);
        return;
      }

      if (await serveThreeRequest(req, res, { neededJsmFiles, assetFiles })) return;

      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("not found");
    } catch (err) {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end(`server error: ${err.message}`);
    }
  });

  if (liveReload) {
    server.updatePlan = (newPlan, newBaseDir = baseDir) => {
      html = renderHtml(newPlan, { liveReload: true });
      assetFiles = resolveAssetFiles(sceneAssetSrcs(newPlan), newBaseDir);
      neededJsmFiles = neededJsmFilesFor(newPlan);
      extensionFiles = extensionRoutes(newPlan);
    };
    server.notifyReload = () => reloadHub.notify();
  }

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "localhost", () => resolve(server));
  });
}

// Writes the exact same set of files `startServer` would serve to disk, so
// a scene can be hosted as plain static files instead of needing `axis run`.
export async function writeStaticSite(plan, outDir, { baseDir } = {}) {
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, "index.html"), renderHtml(plan));

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

  const assetFiles = resolveAssetFiles(sceneAssetSrcs(plan), baseDir);
  await writeThreeVendorFiles(outDir, { neededJsmFiles: neededJsmFilesFor(plan), assetFiles });

  return outDir;
}
