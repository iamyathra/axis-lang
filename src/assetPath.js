// Pure, filesystem-free helpers for a `model`'s `src` path - shared by
// interpreter.js (to reject a bad path with a line number, right where the
// author wrote it), renderer/server.js (to serve the file and copy it on
// `axis build`), and renderer/client.js (to fetch it from the browser).
// None of this touches disk - that's server.js's job, deliberately kept
// separate so this stays trivially shared across every one of those.

// A safe relative asset path: non-empty, not absolute, no '..' segment (an
// asset always has to live inside the project directory - unlike `import`,
// which only ever resolves against a trusted .ax file another .ax file
// wrote, a `model`'s src can end up served straight to a browser, so this
// is a real security boundary, not paranoia for its own sake), and ending
// in '.glb' or '.gltf' - the only two container formats AXIS loads.
// Returns a human-readable reason it's invalid, or null if it's fine.
const MODEL_EXTENSIONS = [".glb", ".gltf"];
const TEXTURE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp", ".gif"];

// `extensions` defaults to model files (every existing caller before
// `material.map`) - a texture (interpreter.js's own `material.map`
// validation) passes TEXTURE_EXTENSIONS instead. The path-safety checks
// (relative, no absolute path, no '..') apply identically to either kind of
// asset - only "which file extensions are actually legal" differs.
export function assetSrcError(src, extensions = MODEL_EXTENSIONS) {
  if (typeof src !== "string" || src.trim() === "") return "needs a file path string";
  if (src.startsWith("/") || /^[A-Za-z]:[\\/]/.test(src)) return "must be a relative path, not an absolute one";
  if (src.split(/[\\/]/).includes("..")) return "can't contain '..' - an asset has to live inside the project directory";
  if (!extensions.some((ext) => src.endsWith(ext))) {
    const list = extensions.map((ext) => `'${ext}'`).join(" or ");
    return `must point at a ${list} file`;
  }
  return null;
}

export { TEXTURE_EXTENSIONS };

// Turns an author-written relative src ("./earth.glb", "models/earth.glb")
// into the stable URL path both the dev server and the browser client key
// off of, and the same relative path `axis build` copies it to under
// dist/assets/ - strips a leading "./" and normalizes backslashes, but
// otherwise preserves structure so nested asset folders stay legible.
export function assetUrl(src) {
  return `/assets/${src.replace(/\\/g, "/").replace(/^\.\//, "")}`;
}
