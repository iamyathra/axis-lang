// axis-wireframe's actual runtime capability - the one thing this whole
// package exists to prove: a genuinely new, live-settable 3D scalar
// property (`wireframe`), registered from OUTSIDE AXIS's own source, via
// the public registerScalarProperty API (src/renderer/extensionRegistry.js
// - see docs/runtime-extensions.md for the full contract). This file is
// authored strictly after AXIS's "core freeze" commit for this milestone;
// `git diff -- src/` across every commit built on top of it stays empty.
//
// Deliberately real, not fake: `wireframe` is a genuine three.js
// Material property AXIS's own built-in SCALAR_PROPERTIES table has never
// covered (only `color`/`groundColor`/`background`/`intensity`/
// `progress`/`castShadow`/`receiveShadow`/`fov`/`near`/`far`) - there was
// no way to express "render this shape as a wireframe" from `.ax` source
// at all before this package existed, built-in or otherwise.
//
// `obj3d` is the raw three.js Object3D/Mesh this property was invoked on -
// the one, deliberately narrow thing this API hands an extension (not the
// whole scene, renderer, or interpreter). A mesh's `.material` can be a
// single Material or an array of them (multi-material geometry) - three.js
// public API, not an AXIS internal - so this package writes its own tiny
// helper rather than reusing scene3d.js's private `collectMaterials`
// (which it has no way to import anyway - see docs/runtime-extensions.md's
// "private API firewall" section).
import { registerScalarProperty } from "/extensionRegistry.js";

function materialsOf(obj3d) {
  if (!obj3d.material) return [];
  return Array.isArray(obj3d.material) ? obj3d.material : [obj3d.material];
}

registerScalarProperty("wireframe", {
  valueType: "boolean",
  // Tweening a boolean between two states isn't meaningful - same
  // reasoning AXIS's own built-in castShadow/receiveShadow entries
  // already follow (see scene3d.js's SCALAR_PROPERTIES).
  animatable: false,
  get(obj3d) {
    const mats = materialsOf(obj3d);
    return mats.length > 0 ? mats[0].wireframe : undefined;
  },
  set(obj3d, value) {
    for (const mat of materialsOf(obj3d)) mat.wireframe = value;
  },
});
