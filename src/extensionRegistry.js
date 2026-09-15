// The one, explicit, public registration surface a runtime extension's own
// JavaScript can call into - see docs/runtime-extensions.md for the full
// contract. Served at the fixed URL /extensionRegistry.js (server.js's
// STATIC_FILES) so both a runtime extension's own script (imported via a
// <script type="module"> tag html.js emits, one per extension a resolved
// package declared - see modules.js/plan.js) and scene3d.js import the
// SAME module instance - the browser's module cache is what makes this a
// real shared registry, not a coincidence. Deliberately not a global
// (`window.AXIS_EXTENSIONS` or similar): an ordinary ES module import gives
// explicit, static ownership instead of a magic ambient value - see
// docs/runtime-extensions.md's "No magic globals" note for why that
// distinction matters here.
//
// Scalar 3D properties are the one runtime capability category this
// milestone proves extensible (see docs/runtime-extensions.md's "Level 2"
// section for exactly why this category, and which categories are still
// core-only) - registerEvent/registerHandle/registerSystem do not exist.
// Reuses scene3d.js's own SCALAR_PROPERTIES *shape* exactly (an entry with
// `get(obj3d)`/`set(obj3d, value)`/`animatable`/`valueType`), per this
// project's own "one authoritative registry, not a second architecture"
// principle - a registered extension property is looked up through
// exactly the same LiveObject accessor / applyChange / currentLiveValue /
// triggerAnimation code scene3d.js's built-in properties already share,
// not a parallel dispatch path.

const scalarProperties = new Map();

// name: the property's name as `.ax` source will use it (`box.wireframe =
// true` inside an `on` handler, or `animate box { wireframe: ... }`
// triggered from one - see docs/runtime-extensions.md for the current,
// honest limit on where this can appear: NOT yet in an object's own
// literal declaration or a top-level unconditional `animate`, both of
// which are validated build-time, in Node, against a fixed allowlist this
// registry has no way to reach - only the two purely client-side paths
// above go through this registry at all).
//
// definition.get(obj3d): reads the property's current value off a real
// three.js Object3D/Mesh, or returns `undefined` if it doesn't apply to
// that particular object (the same convention every built-in
// SCALAR_PROPERTIES entry follows).
// definition.set(obj3d, value): writes it.
// definition.animatable (default false): whether `animate`/a timeline can
// tween this property over time, vs. only ever being set outright.
// definition.valueType: "number" (default), "boolean", or "color" - governs
// how triggerAnimation validates an `animate` target's value and how
// applyChange interpolates it frame to frame.
export function registerScalarProperty(name, definition) {
  if (typeof name !== "string" || name.length === 0) {
    throw new Error("registerScalarProperty: 'name' must be a non-empty string");
  }
  if (typeof definition?.get !== "function" || typeof definition?.set !== "function") {
    throw new Error(`registerScalarProperty('${name}'): definition needs 'get(obj3d)' and 'set(obj3d, value)' functions`);
  }
  if (scalarProperties.has(name)) {
    throw new Error(`registerScalarProperty('${name}'): already registered - two extensions (or the same one, twice) tried to claim this name`);
  }
  const valueType = definition.valueType ?? "number";
  if (valueType !== "number" && valueType !== "boolean" && valueType !== "color") {
    throw new Error(`registerScalarProperty('${name}'): valueType must be "number", "boolean", or "color", got ${JSON.stringify(valueType)}`);
  }
  scalarProperties.set(name, {
    animatable: Boolean(definition.animatable),
    valueType,
    get: definition.get,
    set: definition.set,
  });
}

// scene3d.js's own read side - never called from an extension itself.
export function registeredScalarProperties() {
  return scalarProperties;
}

// A second, independent registration surface reusing this same module (one
// authoritative registry file, not a second architecture) for a different
// capability: a genuinely new DOM/page element type - the dimension the
// scalar-property registry above explicitly does NOT cover (see this
// file's own header). Two distinct entry points call this:
//
// 1. A package's `axis.json` `buildExtension` file (modules.js) - executed
//    once per package, synchronously, in Node, with `registerElementType`
//    handed to it directly (see modules.js's own note on why this can't be
//    an ordinary ESM `import` the way `runtimeExtension` is) - this is
//    what makes `interpreter.js`/`domHtml.js` accept and server-render the
//    new type at all, build time.
// 2. That same package's `runtimeExtension` file, imported by the browser
//    exactly like an extension's scalar-property registration already is
//    - this is what makes `pageRuntime.js` mount/hydrate it live.
//
// Deliberately narrow, like the scalar-property registry: a registered
// element type is always a generic leaf (a single tag, optionally holding
// a text `content`, plus whatever of AXIS's own universal style properties
// - background/padding/etc. - already apply to everything) - see
// docs/runtime-extensions.md for the exact, honest boundary (no container
// types, no custom attributes beyond `allowedProps`, no special rendering
// logic the way a built-in `link`'s `href` or `input`'s `value` has).
const elementTypes = new Map();

// name: the element type's name as `.ax` source will use it
// (`badge greeting { content: "Hi" }`).
// definition.tag: the real HTML tag to render/mount (e.g. "span") - a
// non-empty string, required.
// definition.allowedProps (default []): extra property names (beyond
// AXIS's universal style properties) this type accepts - `content` is the
// only one with special meaning (rendered as the tag's text content).
// definition.defaults (default {}): property values an unconfigured
// instance starts with, same convention DOM_LEAF_TYPES' own entries use.
export function registerElementType(name, definition) {
  if (typeof name !== "string" || name.length === 0) {
    throw new Error("registerElementType: 'name' must be a non-empty string");
  }
  if (typeof definition?.tag !== "string" || definition.tag.length === 0) {
    throw new Error(`registerElementType('${name}'): definition needs a non-empty 'tag' string`);
  }
  if (elementTypes.has(name)) {
    throw new Error(`registerElementType('${name}'): already registered - two extensions (or the same one, twice) tried to claim this name`);
  }
  elementTypes.set(name, {
    tag: definition.tag,
    allowedProps: new Set(definition.allowedProps ?? []),
    defaults: { ...(definition.defaults ?? {}) },
  });
}

// interpreter.js's/domHtml.js's/pageRuntime.js's own read side - never
// called from an extension itself.
export function registeredElementTypes() {
  return elementTypes;
}
