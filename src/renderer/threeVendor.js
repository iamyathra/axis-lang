// Shared "serve/copy three.js + its addons + model assets" logic - used by
// both server.js (a whole-scene file) and domServer.js (a page that embeds
// one or more scenes via `viewport`), so there's exactly one place that
// knows where three.js's build/examples live on disk and how a `model`'s
// `src` resolves to an actual file. See
// docs/architecture/page-scene-fusion.md.

import { readFile, writeFile, mkdir, cp } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { assetUrl } from "../assetPath.js";

// A hardcoded "../../node_modules/three/..." path (relative to this file's
// own location inside axis-lang's package directory) breaks for any real
// npm install: npm hoists a shared dependency like `three` up to the
// installing project's own top-level node_modules instead of nesting it
// under node_modules/axis-lang/node_modules/three, so that path simply
// doesn't exist there (found via a real `npm pack` + install + `axis
// build` run, not guessed). require.resolve runs the real Node package
// resolution algorithm from this file's location - the same lookup that
// finds `three` correctly regardless of where npm actually placed it -
// then this walks up from the resolved entry file to the directory whose
// own package.json is actually named "three", since three's "exports"
// field only exposes a few specific subpaths (not "./build/*" or
// "./package.json" generally), so the package root itself has to be
// found by walking up, not resolved as an import specifier.
function resolvePackageRoot(name) {
  const require = createRequire(import.meta.url);
  let dir = path.dirname(require.resolve(name));
  for (;;) {
    const pkgJsonPath = path.join(dir, "package.json");
    if (existsSync(pkgJsonPath) && JSON.parse(readFileSync(pkgJsonPath, "utf8")).name === name) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error(`couldn't locate the '${name}' package root on disk`);
    dir = parent;
  }
}

const THREE_ROOT = resolvePackageRoot("three");
export const THREE_BUILD_DIR = path.join(THREE_ROOT, "build") + path.sep;
export const THREE_JSM_DIR = path.join(THREE_ROOT, "examples", "jsm") + path.sep;

// Every three.js "addon" AXIS wires up, keyed by the URL it's served at.
// Each is only ever *requested* by scene3d.js when the scene actually needs
// it (a `model` for GLTFLoader, `camera { controls: "orbit" }` for
// OrbitControls) - the caller computes exactly which subset of these a
// given plan needs (`neededJsmFiles`, below) so nothing is served or copied
// that nothing asked for.
export const JSM_FILES = {
  // GLTFLoader.js and its two sibling files are imported by relative path
  // from within GLTFLoader.js itself, so the URL structure has to mirror
  // three's own examples/jsm/ layout exactly - all three travel together.
  "/vendor/jsm/loaders/GLTFLoader.js": "loaders/GLTFLoader.js",
  "/vendor/jsm/utils/BufferGeometryUtils.js": "utils/BufferGeometryUtils.js",
  "/vendor/jsm/utils/SkeletonUtils.js": "utils/SkeletonUtils.js",
  "/vendor/jsm/controls/OrbitControls.js": "controls/OrbitControls.js",
};

// The three GLTFLoader-related URLs, as a convenience for callers deciding
// what a scene needs - see collectNeededJsmFiles below.
export const GLTF_JSM_URLS = [
  "/vendor/jsm/loaders/GLTFLoader.js",
  "/vendor/jsm/utils/BufferGeometryUtils.js",
  "/vendor/jsm/utils/SkeletonUtils.js",
];
export const ORBIT_CONTROLS_URL = "/vendor/jsm/controls/OrbitControls.js";

export const ASSET_CONTENT_TYPES = { ".glb": "model/gltf-binary", ".gltf": "model/gltf+json" };

// `assetSrcs` is a flat list of raw relative `src` strings (renderer/plan.js
// dedupes and collects these per scene) - interpreter.js already rejected
// anything shaped like a path-traversal attempt (assetSrcError), but
// resolving against the filesystem is exactly the kind of thing worth a
// second, independent check rather than trusting a single layer -
// path.relative here catches anything that still somehow escaped `baseDir`.
export function resolveAssetFiles(assetSrcs, baseDir) {
  const files = new Map(); // url path -> absolute file path
  if (!baseDir) return files;
  for (const src of assetSrcs) {
    const abs = path.resolve(baseDir, src);
    const rel = path.relative(baseDir, abs);
    if (rel.startsWith("..") || path.isAbsolute(rel)) continue;
    files.set(assetUrl(src), abs);
  }
  return files;
}

// A single scene plan (the shape renderer/plan.js's buildScenePlan
// produces) -> the set of JSM_FILES URLs it needs. Shared by server.js (one
// top-level scene) and domServer.js (unioned across every viewport's own
// embedded scene).
export function neededJsmFilesFor(scenePlan) {
  const urls = new Set();
  if (scenePlan?.assets?.length > 0) for (const url of GLTF_JSM_URLS) urls.add(url);
  if (scenePlan?.camera?.controls === "orbit") urls.add(ORBIT_CONTROLS_URL);
  return urls;
}

// Handles a request for /vendor/jsm/... (an addon, gated on
// `neededJsmFiles`), a resolved model asset file, or generic /vendor/...
// (three.js's own core, never gated - every 3D viewport needs it). Returns
// true if it responded (the caller should stop), false if the URL isn't one
// of these (the caller should keep trying its own routes, then 404).
export async function serveThreeRequest(req, res, { neededJsmFiles, assetFiles }) {
  if (req.url.startsWith("/vendor/jsm/")) {
    if (neededJsmFiles.has(req.url) && JSM_FILES[req.url]) {
      const js = await readFile(path.join(THREE_JSM_DIR, JSM_FILES[req.url]), "utf8");
      res.writeHead(200, { "Content-Type": "text/javascript" });
      res.end(js);
    } else {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("not found");
    }
    return true;
  }

  if (assetFiles.has(req.url)) {
    const filePath = assetFiles.get(req.url);
    try {
      const bytes = await readFile(filePath);
      res.writeHead(200, { "Content-Type": ASSET_CONTENT_TYPES[path.extname(filePath)] ?? "application/octet-stream" });
      res.end(bytes);
    } catch {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end(`asset not found: ${filePath}`);
    }
    return true;
  }

  if (req.url.startsWith("/vendor/")) {
    const requested = req.url.slice("/vendor/".length);
    const filePath = path.join(THREE_BUILD_DIR, requested);
    if (!filePath.startsWith(THREE_BUILD_DIR)) {
      res.writeHead(400, { "Content-Type": "text/plain" });
      res.end("bad request");
      return true;
    }
    const js = await readFile(filePath, "utf8");
    res.writeHead(200, { "Content-Type": "text/javascript" });
    res.end(js);
    return true;
  }

  return false;
}

// Writes the exact same set of files serveThreeRequest would serve, to
// disk, so a scene (or a page with viewports) can be hosted as plain static
// files instead of needing `axis run`. three.js's own core is always
// copied - every 3D viewport needs it - the addons and asset files are
// conditional on `neededJsmFiles`/`assetFiles`, same as the serving side.
export async function writeThreeVendorFiles(outDir, { neededJsmFiles, assetFiles }) {
  await mkdir(path.join(outDir, "vendor"), { recursive: true });
  await cp(THREE_BUILD_DIR, path.join(outDir, "vendor"), { recursive: true });

  for (const url of neededJsmFiles) {
    const relPath = JSM_FILES[url];
    if (!relPath) continue;
    const contents = await readFile(path.join(THREE_JSM_DIR, relPath), "utf8");
    const dest = path.join(outDir, url.slice(1));
    await mkdir(path.dirname(dest), { recursive: true });
    await writeFile(dest, contents);
  }
  for (const [urlPath, absPath] of assetFiles) {
    const dest = path.join(outDir, urlPath.slice(1));
    await mkdir(path.dirname(dest), { recursive: true });
    await cp(absPath, dest);
  }
}
