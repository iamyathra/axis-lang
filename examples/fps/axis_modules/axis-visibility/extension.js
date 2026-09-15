// axis-visibility: a third, independently-authored runtime extension
// (see docs/runtime-extensions.md), reusing the exact same
// registerScalarProperty API examples/runtime-extension-demo/'s
// axis-wireframe/axis-line-width already proved - this package has no
// relation to either. Registers `visible` (boolean, non-animatable),
// backed directly by three.js's own native `Object3D.visible` - a real
// capability AXIS's built-in SCALAR_PROPERTIES table has never covered
// (there is no way to hide/show a 3D object from `.ax` source otherwise).
//
// Built for the FPS Flagship Proof milestone's own real need: since a
// `scene`'s own `if`/`for` only ever build once, at load (see
// docs/language.md's Reactive structure section - 3D scene objects are
// NOT reactive the way DOM elements are), there is no way to dynamically
// spawn or remove a 3D object at runtime. `visible` is what makes
// object-pooling - pre-declare a fixed set of objects, toggle them on
// and off - a real, working pattern for "destroying" a target, entirely
// through ordinary `.ax` composition. Unlike axis-wireframe/
// axis-line-width (which needed a small `materialsOf(obj3d)` helper for
// three.js's own single-or-array `.material` shape), `visible` is a
// direct property on every Object3D - the simplest possible extension.
import { registerScalarProperty } from "/extensionRegistry.js";

registerScalarProperty("visible", {
  valueType: "boolean",
  animatable: false,
  get(obj3d) {
    return obj3d.visible;
  },
  set(obj3d, value) {
    obj3d.visible = value;
  },
});
