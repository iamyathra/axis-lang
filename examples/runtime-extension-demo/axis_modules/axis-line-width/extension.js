// axis-line-width: a second, independently-authored runtime extension,
// proving the exact same public API (registerScalarProperty) generalizes
// - not a special case built once and never exercised again. Registers
// `wireframeLinewidth` (a real three.js Material property - how thick a
// wireframe's own lines render, only meaningful alongside `wireframe`,
// but this package has NO dependency on axis-wireframe at all: it works
// standalone, on any mesh, whether or not wireframe mode happens to be
// on). Deliberately the *other* half of SCALAR_PROPERTIES' own valueType
// split axis-wireframe didn't cover: `animatable: true`, `valueType:
// "number"` - so `animate box { wireframeLinewidth: 6 duration: 0.3 }`,
// triggered from an `on` handler, works exactly like a built-in numeric
// scalar property would (see scene3d.js's triggerAnimation, which this
// registration flows through unmodified).
import { registerScalarProperty } from "/extensionRegistry.js";

function materialsOf(obj3d) {
  if (!obj3d.material) return [];
  return Array.isArray(obj3d.material) ? obj3d.material : [obj3d.material];
}

registerScalarProperty("wireframeLinewidth", {
  valueType: "number",
  animatable: true,
  get(obj3d) {
    const mats = materialsOf(obj3d);
    return mats.length > 0 ? mats[0].wireframeLinewidth : undefined;
  },
  set(obj3d, value) {
    for (const mat of materialsOf(obj3d)) mat.wireframeLinewidth = value;
  },
});
