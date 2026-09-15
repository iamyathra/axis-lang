// Walks the AST and builds a graph for each top-level declarative construct
// AXIS has: `scene` (a 3D scene) and `page` (a web page). Both share the same
// AST shape (object decls, animate, on, plus plain let/if/while/for) because
// parser.js's block grammar doesn't know or care which domain it's building
// for - the split only happens here, in the interpreter.
//
// Object/animate/property values are full expressions, evaluated with the
// shared evaluator (evaluator.js) against an environment seeded with AXIS's
// globals (globals.js) plus any `let`/`const`/`fn` the program defines.
// Bodies can mix declarative constructs (objects, animate, on) with plain
// statements (let/if/while/for) - the evaluator handles the plain statements
// generically and calls back into `dispatchSceneStatement` for the
// domain-specific ones via its `hooks.onCustomStatement` escape hatch, which
// is the seam that keeps evaluator.js free of any scene/page knowledge.
//
// `DeclarativeBuilder` holds what scenes and pages have in common (a named
// object registry, animate/on handling, variable capture for the browser
// runtime). `SceneBuilder` and `PageBuilder` each supply what's different:
// which object types exist, what properties they accept, and (for scenes
// only, so far) what `animate` means.

import { evaluate, executeBlock, isVector, isRecord, recordFields, typeName, literalUnit, containsFunction, ReturnSignal, AxisRuntimeError } from "./evaluator.js";
import { createGlobalEnv, EASING_NAMES as EASING_NAME_LIST } from "./globals.js";
import { suggest } from "./suggest.js";
import { assetSrcError, TEXTURE_EXTENSIONS } from "./assetPath.js";
import { isSafeUrl } from "./urlSafety.js";
import { registeredElementTypes } from "./extensionRegistry.js";

export { AxisRuntimeError };

// `PageBuilder` (below) is exported too, for domClient.js: this file is
// already environment-agnostic (no Node-specific code - see the module doc
// comment above), and reactive `if`/`for` (see
// PageBuilder.registerReactiveBlocks) needs to re-run *exactly* the same
// object-declaration/validation logic in the browser that built the page
// the first time, not a second, parallel implementation of it.

// ---- scene (3D) domain ----------------------------------------------------

const SHAPE_TYPES = new Set(["cube", "sphere", "plane", "cylinder"]);

// One entry per light type - each carries its own build-time defaults (on
// top of the `color: "white", intensity: 1` every light starts with, see
// interpretObjectDecl's light branch below - a later default here still
// wins, same as it always has, e.g. hemisphereLight's own `intensity: 0.6`)
// so a new light type is one entry here, not a separate `if (type ===
// "...")` line added to a growing chain.
const LIGHT_TYPES = {
  ambientLight: {},
  directionalLight: { defaults: { direction: [0, -1, 0], shadows: false } },
  pointLight: { defaults: { position: [0, 0, 0] } },
  spotLight: { defaults: { position: [0, 0, 0], target: [0, 0, 0], angle: 45, penumbra: 0.2, shadows: false } },
  // Matches the fixed fallback fill light every scene used to get for free
  // (scene3d.js) - declaring your own gets you the same starting look,
  // just now tunable/animatable/state-bindable instead of fixed.
  hemisphereLight: { defaults: { groundColor: "#222233", intensity: 0.6 } },
};
// The Set-shaped copy of globals.js's own EASING_NAMES list - imported, not
// re-typed, so the two can't drift (see the note on that export).
const EASING_NAMES = new Set(EASING_NAME_LIST);
// A camera's `controls` opts into a real, interactive camera - drag to
// orbit, scroll/pinch to zoom - instead of a fixed viewpoint. One value for
// now (three.js's own OrbitControls, fetched only when a scene actually
// uses this - see threeVendor.js/scene3d.js): a single well-understood
// camera behavior beats a menu of half-implemented ones.
export const CAMERA_CONTROLS = new Set(["orbit"]);

// AXIS's material vocabulary - deliberately small (the PBR properties a
// developer actually reaches for, not every THREE.MeshStandardMaterial
// field): a color, how metallic/rough the surface reads, opacity, a
// self-lit glow, and a texture (`map` - a file path, validated the same way
// `model.src` already is, see applyProperty's `material.` branch below).
// Written as a dotted property, `material.metalness: 0.8`, which is already
// ordinary AXIS grammar (parser.js's parsePath already reads any `a.b:
// value` path) - no new syntax needed. See applyProperty's `material.`
// branch below and scene3d.js's MaterialHandle, which is what makes every
// one of these a real `on`-handler-mutable, `state`-bindable value, the
// same as `position`/`color` already are - `map` included (a live texture
// swap is a real three.js operation, `mat.map = newTexture`, not a special
// case), it just isn't an `animate`/`timeline` target the way the numeric/
// color fields are (see validateSceneAnimateChange's own `material.map`
// rejection - a texture doesn't interpolate).
export const MATERIAL_FIELDS = new Set(["color", "metalness", "roughness", "opacity", "emissive", "emissiveIntensity", "map"]);
const MATERIAL_PROP_KEYS = [...MATERIAL_FIELDS].map((f) => `material.${f}`);
const SHADOW_PROP_KEYS = ["castShadow", "receiveShadow"];

const SCENE_ALLOWED_PROPS = {
  camera: new Set(["position", "controls", "fov", "near", "far", "target"]),
  group: new Set(["position", "rotation", "scale"]),
  cube: new Set(["position", "rotation", "scale", "color", ...MATERIAL_PROP_KEYS, ...SHADOW_PROP_KEYS]),
  sphere: new Set(["position", "rotation", "scale", "color", ...MATERIAL_PROP_KEYS, ...SHADOW_PROP_KEYS]),
  plane: new Set(["position", "rotation", "scale", "color", ...MATERIAL_PROP_KEYS, ...SHADOW_PROP_KEYS]),
  cylinder: new Set(["position", "rotation", "scale", "color", ...MATERIAL_PROP_KEYS, ...SHADOW_PROP_KEYS]),
  model: new Set(["position", "rotation", "scale", "src", "clip", ...MATERIAL_PROP_KEYS, ...SHADOW_PROP_KEYS]),
  ambientLight: new Set(["color", "intensity"]),
  directionalLight: new Set(["color", "intensity", "direction", "shadows"]),
  pointLight: new Set(["color", "intensity", "position"]),
  spotLight: new Set(["color", "intensity", "position", "target", "angle", "penumbra", "shadows"]),
  // `color` is the sky color (matching every other light's "primary color"
  // slot), `groundColor` the one property unique to this light type - see
  // scene3d.js's THREE.HemisphereLight(color, groundColor, intensity). No
  // `position`/`direction`/`shadows` - a hemisphere light is an ambient,
  // directionless sky/ground gradient by definition, the same reason
  // `ambientLight` doesn't have them either.
  hemisphereLight: new Set(["color", "groundColor", "intensity"]),
  // `background` is the scene's own backdrop color (what used to be a
  // fixed "#111111" everywhere, now authorable/`state`-bindable/
  // `animate`-targetable, same as `camera`). `fogColor`/`fogNear`/`fogFar`
  // are a real, simple linear fog - opt-in the same way `shadows` is (fog
  // only exists in the scene at all once `fogColor` is set) - but, unlike
  // `background`, build-time only for now: not yet `state`-reactive or
  // `animate`-targetable (see interpretObjectDecl's `environment` branch
  // and scene3d.js's own note on this).
  environment: new Set(["background", "fogColor", "fogNear", "fogFar"]),
};

// ---- page (web) domain ------------------------------------------------

// A container-like element nests other declarations (the way `group` does
// for scenes) and renders as the given real HTML tag - `container` stays a
// plain `<div>`, the others pick a semantic tag so pages don't turn into
// div soup (see docs/language.md's accessibility notes).
const DOM_CONTAINER_TAGS = { container: "div", form: "form", list: "ul", item: "li" };

const CONTAINER_LAYOUT_PROPS = new Set(["direction", "align", "justify", "gap"]);

// One entry per leaf element type - "leaf" meaning it can't nest other
// declarations, the way `image` or `viewport` can't (a `viewport`'s 3D
// content comes from the `scene` it references, not from DOM children -
// see docs/architecture/page-scene-fusion.md). Each entry carries its own
// allowed properties (beyond the universal ones - see UNIVERSAL_DOM_PROPS)
// and any build-time defaults interpretObjectDecl needs before the
// properties loop runs, so a new leaf type is one entry here, not a
// DOM_ALLOWED_PROPS entry plus a separate scattered `if (type === "...")`
// default. `defaults` isn't a validity list of its own - a default key
// still needs to appear in `allowedProps` (or UNIVERSAL_DOM_PROPS) for an
// author to be able to override it explicitly.
const DOM_LEAF_TYPES = {
  text: { allowedProps: new Set(["content", "color", "size", "weight", "align"]) },
  heading: { allowedProps: new Set(["content", "level", "color", "size", "weight", "align"]), defaults: { level: 1 } },
  paragraph: { allowedProps: new Set(["content", "color", "size", "weight", "align"]) },
  button: { allowedProps: new Set(["label", "color"]) },
  image: { allowedProps: new Set(["src", "alt"]) },
  link: { allowedProps: new Set(["label", "href", "color"]) },
  input: { allowedProps: new Set(["placeholder", "value", "kind"]), defaults: { kind: "text" } },
  viewport: {
    allowedProps: new Set(["scene"]),
    // A viewport with no explicit size would collapse to 0x0 (an empty div
    // has no intrinsic height) and its canvas would be invisible. `visible`
    // is a UNIVERSAL_DOM_PROP (see its own note there), so this default is
    // what makes an ordinary viewport with no `visible` property mean
    // exactly what it always has: mounted once, at load, never torn down.
    defaults: { width: "100%", height: 400, visible: true },
  },
};

const DOM_ALLOWED_PROPS = {
  container: CONTAINER_LAYOUT_PROPS,
  form: CONTAINER_LAYOUT_PROPS,
  list: CONTAINER_LAYOUT_PROPS,
  item: CONTAINER_LAYOUT_PROPS,
  ...Object.fromEntries(Object.entries(DOM_LEAF_TYPES).map(([type, config]) => [type, config.allowedProps])),
};

// A registered element type (extensionRegistry.js's registerElementType -
// see modules.js's own `buildExtension` note for how one gets registered
// at all) is looked up as a fallback everywhere DOM_LEAF_TYPES/
// DOM_ALLOWED_PROPS are, below - never baked into those two static tables
// themselves, since registration happens per-file, dynamically, and these
// tables are built once at module load. A plain function, not a third
// static table, because `registeredElementTypes()` can change between one
// `axis check` run and the next (a different file importing a different
// set of packages) in a way DOM_LEAF_TYPES/DOM_ALLOWED_PROPS never do.
function domLeafConfig(type) {
  return DOM_LEAF_TYPES[type] ?? registeredElementTypes().get(type);
}

function domAllowedProps(type) {
  return DOM_ALLOWED_PROPS[type] ?? registeredElementTypes().get(type)?.allowedProps;
}

// Available on every page element regardless of type - real CSS doesn't
// restrict background/padding/border/etc. to "container-shaped" elements
// either, so there's no reason AXIS should (a `text` used as a small pill
// or badge wants a background and padding just as much as a `container`
// does). `css` is the one genuine escape hatch: a raw string appended to
// the generated inline style, for anything not modeled yet - AXIS isn't a
// template framework, a developer who hits a property this language
// doesn't know about yet shouldn't be stuck.
//
// `scrollTimeline` is universal too, not just a `viewport` thing - "drive a
// timeline in this element's own scope from this element's own scroll
// position" means a *page*-level timeline for any ordinary element, and
// (kept as a `viewport`-specific case in interpretObjectDecl, since it
// needs to validate against that particular embedded scene) a *scene*-level
// one for a `viewport`. Same property name, same mental model, same
// progress formula either way - see docs/language.md's Timelines section.
// `visible` is universal too, not just a `viewport` thing - see
// applyProperty's own `visible` branch (unchanged, already generic) for the
// boolean validation and domPlan.js/domClient.js for what it actually does
// on each element type: a `viewport`'s is a real mount/unmount lifecycle
// switch (see docs/architecture/conditional-viewport.md, unchanged - a 3D
// runtime is genuinely expensive to keep around for nothing); any other
// element's is a plain, cheap `display: none` toggle - no lifecycle to
// manage, so no reason to withhold it from a `container`/`text`/etc.
// `responsive` is universal too - see applyProperty's own `responsive`
// branch and docs/architecture/responsive-layout.md for the full design.
// Two fixed, named breakpoints (not a configurable breakpoint system - one
// sensible default beats a knob nobody's asked to turn yet): `tablet`
// (<=1024px) and `mobile` (<=640px).
export const RESPONSIVE_BREAKPOINTS = new Set(["tablet", "mobile"]);
// Only properties that actually compile to real CSS (see domStyle.js's
// cssForProperty) can vary by breakpoint - `responsive` renders as a
// `<style>` block of real `@media` rules (domHtml.js), not JavaScript, so
// it can take effect before the page even hydrates. That rules out
// anything that isn't a CSS declaration at all (`content`, `href`, `src`,
// `level` - a heading's tag itself, chosen once, isn't a CSS property) and,
// deliberately, `visible` too: hiding a `viewport` isn't a plain style (it
// decides whether an entire 3D runtime exists - see conditional-viewport.md)
// and doing that responsively would need real JavaScript this milestone
// doesn't add - a real, current limitation, not silently broken.
const RESPONSIVE_STYLE_KEYS = new Set([
  "background", "padding", "radius", "width", "height", "gap",
  "border", "shadow", "opacity", "cursor",
  "position", "top", "left", "right", "bottom", "z",
  "direction", "align", "justify", "color", "size", "weight", "css",
]);

// `scrollRoot: "containerName"` - names an ancestor element to measure
// `scrollTimeline`/`scrollProgress` against instead of the document (see
// docs/architecture/nested-scroll.md). Universal, not tied to
// `scrollTimeline`/`scrollProgress` specifically, the same way `css` is
// universal even though plenty of elements never use it - validated (see
// interpretObjectDecl, below) against whatever ancestor chain this
// specific element actually has, wherever `scrollTimeline`/`scrollProgress`
// themselves get validated (at runtime, in the browser, same as those
// already are for a non-`viewport` element - a page-level timeline can be
// declared anywhere in the file).
const UNIVERSAL_DOM_PROPS = new Set([
  "background", "padding", "radius", "width", "height",
  "border", "shadow", "opacity", "cursor",
  "position", "top", "left", "right", "bottom", "z",
  "css", "scrollTimeline", "scrollProgress", "visible", "responsive", "scrollRoot",
]);

const PAGE_ANIMATABLE_PATHS = new Set(["opacity", "position.x", "position.y", "scale", "rotation", "color", "background"]);
// The PAGE_ANIMATABLE_PATHS subset whose value is a color string, not a
// number - same "one small vocabulary, one value-type rule per path" idea
// SCENE_COLOR_ANIMATE_KEYS already uses for the scene domain, just page-side.
const PAGE_COLOR_ANIMATE_KEYS = new Set(["color", "background"]);

const DOM_SIZE_KEYS = new Set(["width", "height", "padding", "gap", "radius", "size", "top", "left", "right", "bottom"]);
const DOM_STRING_KEYS = new Set([
  "background", "color", "content", "label", "href", "src", "alt", "align", "justify", "weight",
  "border", "shadow", "cursor", "position", "css", "placeholder", "kind", "scene", "scrollTimeline", "scrollProgress", "scrollRoot",
]);

// ---- shared -----------------------------------------------------------

// Events available on both domains - clicking a button and clicking a mesh
// are the same idea from the language's point of view. `change`/`submit`
// only really mean anything on a page's `input`/`form`, but there's no
// harm in the vocabulary being shared, same as `hover`/`unhover` are
// available (if meaningless) on a page element that doesn't need them.
export const EVENT_NAMES = new Set(["click", "hover", "unhover", "change", "submit", "load", "error", "complete"]);
// Unlike the rest of EVENT_NAMES (meaningless-but-harmless on a target that
// doesn't need them - see the note above), 'load'/'error' only mean
// anything for an async asset fetch, which today is only ever a `model`'s
// own .glb/.gltf - allowing them elsewhere would silently never fire,
// which is worse than a clear build-time error pointing at the one target
// type where they actually do something.
const ASSET_LIFECYCLE_EVENTS = new Set(["load", "error"]);
// 'complete' is the timeline-lifecycle mirror of ASSET_LIFECYCLE_EVENTS,
// just above - only meaningful on a `timeline` (see interpretOnDecl), fired
// once by tween.js's tickTimeline the instant a wall-clock-driven run
// reaches either end (see the note there). Not `EVENT_NAMES` itself, since
// which target types a given event is *restricted to* is decided per-event
// in interpretOnDecl, not by the shared vocabulary set.

// Property expressions that can never change (a bare literal, or a
// compound literal built entirely out of them - `(0, 0, 0)`, `[1, 2]`)
// aren't worth re-evaluating after a state update - only non-literal
// expressions get recorded as a live "binding" a page/scene can re-check.
//
// A Vector/Array node itself is NOT one of the base literal kinds, so
// before this recursed into `.items`, `position: (0, 0, 0)` was
// classified as non-literal and got stashed as a binding like any
// `state`-driven expression - which `reRender()` (scene3d.js/pageRuntime.js)
// re-evaluates and re-applies after *every* handler call, including every
// single `on tick`. The result: an object declared with a literal vector
// position, then moved from `on tick`/`on` by reading and rewriting that
// same property (`box.position = (box.position.x + v * dt, ...)`, the
// natural, obvious way to write it - see docs/language.md's Per-frame
// updates section), had its own movement silently undone immediately
// after every single tick, because the "binding" kept re-applying the
// original literal (0, 0, 0) right back. A one-shot `on click` mutation
// of the same property had the identical bug, just less visible (the
// very next handler/reRender cycle reset it, easy to miss without a test
// that specifically checks *accumulation* across multiple ticks rather
// than a single click). Found via a real-browser test while building the
// first-person controller (Phase H/I) - see
// docs/architecture/2026-09-language-platform-audit.md's addendum;
// affects every existing example that both declares a vector property as
// a literal tuple AND mutates that same property from a handler,
// including examples/tick.ax's own bounce, predating this pivot entirely.
// `-1` (no space) is already a single negative Number token (see
// lexer.js) - Unary is handled anyway for the `- 1` (spaced) case.
function isLiteralExpr(node) {
  if (node.kind === "Number" || node.kind === "String" || node.kind === "Boolean" || node.kind === "Null") return true;
  if (node.kind === "Vector" || node.kind === "Array") return node.items.every(isLiteralExpr);
  if (node.kind === "Unary") return isLiteralExpr(node.operand);
  return false;
}

// One property inside one `responsive` breakpoint tier - checked against
// exactly the same "does this element type even have this property" rule
// a plain top-level property already gets (DOM_ALLOWED_PROPS/
// UNIVERSAL_DOM_PROPS), intersected with RESPONSIVE_STYLE_KEYS (only a
// real CSS-mappable property can vary by breakpoint at all - see the note
// on that Set, above). Deliberately doesn't also re-run applyProperty's
// own per-key *value* type-checks (direction must be "row"/"column",
// opacity a number, ...) - `cssForProperty` (domStyle.js) is lenient about
// what it's handed, and a responsive override that's simply wrong reads
// the same way any other CSS mistake would, in the browser's own
// devtools - a smaller, pragmatic v1 surface, not a gap in the language's
// usual "clear error, did-you-mean" standard for its *core* properties.
function validateResponsiveKey(elementType, key, line) {
  const allowed = domAllowedProps(elementType);
  const inScope = (allowed && allowed.has(key)) || UNIVERSAL_DOM_PROPS.has(key);
  if (!inScope || !RESPONSIVE_STYLE_KEYS.has(key)) {
    throw new AxisRuntimeError(
      `'responsive' can't override '${key}' on a '${elementType}' - only a style property can vary by breakpoint${suggest(key, [...RESPONSIVE_STYLE_KEYS])}`,
      line
    );
  }
}

// `scrollRoot: "wrapper"` (PageBuilder.interpretObjectDecl) needs
// `wrapper` to actually be an ancestor of the element declaring it - walks
// `.parent` links (already-registered objects only, which is exactly why
// this runs right before `register()` adds the *current* element: an
// element can't be its own ancestor, and nothing declared later in the
// same body has been registered yet either, both correctly rejected by
// this same walk finding no match before running out of parents).
function isAncestorName(objectsByName, startParentName, targetName) {
  for (let current = startParentName; current !== null && current !== undefined; current = objectsByName.get(current)?.parent) {
    if (current === targetName) return true;
  }
  return false;
}

// The scene-domain animate-value type rule (a color path needs a color
// string, everything else needs a number) - a module-level function, not a
// SceneBuilder method, so PageBuilder's own timeline-step building can
// reuse it unchanged for a step that cross-references a viewport's
// embedded-scene object (see PageBuilder.interpretTimelineDecl) without
// needing a SceneBuilder instance around to call it on.
const SCENE_COLOR_ANIMATE_KEYS = new Set(["color", "groundColor", "background", "material.color", "material.emissive"]);
function validateSceneAnimateChange(key, value, entry) {
  if (key === "material.map") {
    throw new AxisRuntimeError(`'material.map' can't be animated - a texture doesn't interpolate; set it directly or bind it to 'state' instead`, entry.to.line);
  }
  if (key === "fogColor" || key === "fogNear" || key === "fogFar") {
    throw new AxisRuntimeError(`'${key}' can't be animated yet - fog is a static, build-time-only property for now (see docs/language.md)`, entry.to.line);
  }
  if (SCENE_COLOR_ANIMATE_KEYS.has(key)) {
    if (typeof value !== "string") {
      throw new AxisRuntimeError(`animated value for '${key}' must be a color name or a string like "#ff6600", got a ${typeName(value)}`, entry.to.line);
    }
  } else if (typeof value !== "number") {
    throw new AxisRuntimeError(`animated value for '${key}' must be a number, got a ${typeName(value)}`, entry.to.line);
  }
}

// The page-domain animate-value type rule - a page element's own small,
// CSS-mappable path vocabulary (see PAGE_ANIMATABLE_PATHS/PATH_TO_PROPERTY),
// numbers only. A module-level function for the same reason
// validateSceneAnimateChange is - PageBuilder.buildAnimateBlock reuses it
// unchanged.
function validatePageAnimateChange(key, value, entry) {
  if (!PAGE_ANIMATABLE_PATHS.has(key)) {
    throw new AxisRuntimeError(
      `can't animate '${key}' on a page element${suggest(key, [...PAGE_ANIMATABLE_PATHS])} - try opacity, position.x, position.y, scale, rotation, color, or background`,
      entry.to.line
    );
  }
  if (PAGE_COLOR_ANIMATE_KEYS.has(key)) {
    if (typeof value !== "string") {
      throw new AxisRuntimeError(`animated value for '${key}' must be a color name or a string like "#ff6600", got a ${typeName(value)}`, entry.to.line);
    }
  } else if (typeof value !== "number") {
    throw new AxisRuntimeError(`animated value for '${key}' must be a number, got a ${typeName(value)}`, entry.to.line);
  }
}

// Rewrites bare Identifier references according to `renameMap` (old bare
// name -> new, namespaced name), leaving everything else untouched.
// Used only by component expansion: a component's stored handler bodies
// and property bindings are captured as raw AST to be re-evaluated later
// (in the browser, where there's no per-instance environment - just the
// flat page env), so a reference to a param or a component-local
// state/let has to be baked in as its real, namespaced name before it's
// stored. Always returns new nodes - the same parsed component body is
// reused, unmutated, across every instantiation of that component.
function renameIdentifiers(node, renameMap) {
  if (node === null || typeof node !== "object") return node;
  if (Array.isArray(node)) return node.map((n) => renameIdentifiers(n, renameMap));

  switch (node.kind) {
    case "Identifier":
      return renameMap.has(node.value) ? { ...node, value: renameMap.get(node.value) } : node;
    case "Member":
      return { ...node, object: renameIdentifiers(node.object, renameMap) }; // .property is a fixed string, not a variable
    case "Index":
      return { ...node, object: renameIdentifiers(node.object, renameMap), index: renameIdentifiers(node.index, renameMap) };
    case "Call":
      return { ...node, callee: renameIdentifiers(node.callee, renameMap), args: renameIdentifiers(node.args, renameMap) };
    case "Unary":
      return { ...node, operand: renameIdentifiers(node.operand, renameMap) };
    case "Binary":
      return { ...node, left: renameIdentifiers(node.left, renameMap), right: renameIdentifiers(node.right, renameMap) };
    case "Vector":
    case "Array":
      return { ...node, items: renameIdentifiers(node.items, renameMap) };
    case "LetDecl":
    case "StateDecl":
      return { ...node, value: renameIdentifiers(node.value, renameMap) };
    case "Assignment":
      return { ...node, target: renameIdentifiers(node.target, renameMap), value: renameIdentifiers(node.value, renameMap) };
    case "IfStmt":
      return {
        ...node,
        condition: renameIdentifiers(node.condition, renameMap),
        then: renameIdentifiers(node.then, renameMap),
        else: node.else ? renameIdentifiers(node.else, renameMap) : null,
      };
    case "WhileStmt":
      return { ...node, condition: renameIdentifiers(node.condition, renameMap), body: renameIdentifiers(node.body, renameMap) };
    case "ForStmt":
      return { ...node, iterable: renameIdentifiers(node.iterable, renameMap), body: renameIdentifiers(node.body, renameMap) };
    case "ReturnStmt":
      return { ...node, value: node.value ? renameIdentifiers(node.value, renameMap) : null };
    case "ExprStmt":
      return { ...node, expr: renameIdentifiers(node.expr, renameMap) };
    case "AnimateDecl":
      // A bare `target` is a plain name, not an Identifier expression (same
      // as OnDecl.target), so it needs its own lookup rather than going
      // through the generic Identifier case - but the same renameMap
      // covers it, since `register()` adds every object's bare name to it
      // too, not just params/state/let. A computed `(expr)` target is a
      // real expression, though (targetIsExpr) - that one just recurses
      // normally, the same as any other AXIS expression.
      return {
        ...node,
        target: node.targetIsExpr
          ? renameIdentifiers(node.target, renameMap)
          : renameMap.has(node.target) ? renameMap.get(node.target) : node.target,
        entries: node.entries.map((entry) =>
          entry.kind === "AnimateTarget"
            ? { ...entry, to: renameIdentifiers(entry.to, renameMap) }
            : { ...entry, value: renameIdentifiers(entry.value, renameMap) }
        ),
      };
    // `play CLIP on TARGET`/`stop TARGET` - both `clip` and `target` follow
    // the exact same bare-name-or-computed-expression rule AnimateDecl's own
    // `target` does, just two fields instead of one for PlayClipStmt.
    case "PlayClipStmt":
      return {
        ...node,
        clip: node.clipIsExpr ? renameIdentifiers(node.clip, renameMap) : renameMap.has(node.clip) ? renameMap.get(node.clip) : node.clip,
        target: node.targetIsExpr ? renameIdentifiers(node.target, renameMap) : renameMap.has(node.target) ? renameMap.get(node.target) : node.target,
      };
    case "StopClipStmt":
      return {
        ...node,
        target: node.targetIsExpr ? renameIdentifiers(node.target, renameMap) : renameMap.has(node.target) ? renameMap.get(node.target) : node.target,
      };
    case "Record":
      return { ...node, fields: node.fields.map((f) => ({ ...f, value: renameIdentifiers(f.value, renameMap) })) };
    case "Await":
      return { ...node, operand: renameIdentifiers(node.operand, renameMap) };
    case "TryStmt":
      return {
        ...node,
        tryBlock: renameIdentifiers(node.tryBlock, renameMap),
        catchBlock: renameIdentifiers(node.catchBlock, renameMap),
      };
    default:
      return node; // Number/String/Boolean literals
  }
}

// A `for`-loop variable only ever lives in that one iteration's own child
// env (evaluator.js's ForStmt case) - by the time a handler declared inside
// the loop body actually *runs* (a click, well after the page finished
// building), that env is long gone. `component` params already solve the
// exact same shape of problem by resolving once, at the point of use, not
// as a live channel back to the caller (see docs/language.md's Components
// section) - this does the same thing for a loop variable: bakes its
// *current* value into the stored handler body wherever it's referenced,
// via the internal `Captured` node kind (evaluator.js). Structurally a
// close mirror of renameIdentifiers, above - same walk, different leaf
// substitution - deliberately kept separate rather than unified with it,
// since the two output genuinely different node shapes (a renamed
// Identifier vs. a value snapshot) for what are, underneath, two different
// kinds of name.
//
// `captureMap`: Map<loop variable name, its current value> - built by
// DeclarativeBuilder.interpretOnDecl from `this.loopVarStack` (below),
// which `runStatements`'s own hooks keep in sync with every currently
// *active* enclosing `for` loop, innermost last (so an inner loop's own
// variable correctly wins over an outer one sharing the same name, the
// same shadowing every other scope in AXIS already has). Only ever called
// when that stack is non-empty - a handler declared outside any loop pays
// nothing for this.
function captureLoopVariables(node, captureMap) {
  if (node === null || typeof node !== "object") return node;
  if (Array.isArray(node)) return node.map((n) => captureLoopVariables(n, captureMap));

  if (node.kind === "Identifier") {
    return captureMap.has(node.value) ? { kind: "Captured", value: captureMap.get(node.value), line: node.line } : node;
  }

  switch (node.kind) {
    case "Member":
      return { ...node, object: captureLoopVariables(node.object, captureMap) }; // .property is a fixed string, not a variable
    case "Index":
      return { ...node, object: captureLoopVariables(node.object, captureMap), index: captureLoopVariables(node.index, captureMap) };
    case "Call":
      return { ...node, callee: captureLoopVariables(node.callee, captureMap), args: captureLoopVariables(node.args, captureMap) };
    case "Unary":
      return { ...node, operand: captureLoopVariables(node.operand, captureMap) };
    case "Binary":
      return { ...node, left: captureLoopVariables(node.left, captureMap), right: captureLoopVariables(node.right, captureMap) };
    case "Ternary":
      // Missing until now - the `default` case below returned a Ternary
      // completely unrecursed-into, silently leaving any loop-variable
      // reference in its condition/then/else alone. That's a real,
      // reproduced bug (see benchmarks/task-03-data/results.md): a
      // loop-generated object's `color: selected == items[i].name ? a : b`
      // property binding stored the exact same unresolvable `i` for every
      // iteration, identical to every sibling - and, unlike an
      // out-of-scope reference elsewhere, this doesn't even throw
      // where it's later evaluated (scene3d.js's applyBindings swallows
      // the error and just never updates the property, so it looks like
      // nothing is wrong rather than failing loudly).
      return {
        ...node,
        condition: captureLoopVariables(node.condition, captureMap),
        then: captureLoopVariables(node.then, captureMap),
        else: captureLoopVariables(node.else, captureMap),
      };
    case "Vector":
    case "Array":
      return { ...node, items: captureLoopVariables(node.items, captureMap) };
    case "Record":
      return { ...node, fields: node.fields.map((f) => ({ ...f, value: captureLoopVariables(f.value, captureMap) })) };
    case "LetDecl":
    case "StateDecl":
      return { ...node, value: captureLoopVariables(node.value, captureMap) };
    case "Assignment":
      return { ...node, target: captureLoopVariables(node.target, captureMap), value: captureLoopVariables(node.value, captureMap) };
    case "IfStmt":
      return {
        ...node,
        condition: captureLoopVariables(node.condition, captureMap),
        then: captureLoopVariables(node.then, captureMap),
        else: node.else ? captureLoopVariables(node.else, captureMap) : null,
      };
    case "WhileStmt":
      return { ...node, condition: captureLoopVariables(node.condition, captureMap), body: captureLoopVariables(node.body, captureMap) };
    case "ForStmt":
      // A nested `for` inside a handler body (rare, but legal) still needs
      // its own *iterable* expression captured if it reads the outer loop
      // variable - its own body isn't recursed into further here on
      // purpose, matching renameIdentifiers' identical choice: a nested
      // loop's own variable shadows the outer one for the rest of its
      // body, which the ordinary Identifier case already resolves
      // correctly without any extra handling.
      return { ...node, iterable: captureLoopVariables(node.iterable, captureMap), body: captureLoopVariables(node.body, captureMap) };
    case "ReturnStmt":
      return { ...node, value: node.value ? captureLoopVariables(node.value, captureMap) : null };
    case "ExprStmt":
      return { ...node, expr: captureLoopVariables(node.expr, captureMap) };
    case "AnimateDecl":
      return {
        ...node,
        // A bare target name is always a real object name, never a loop
        // variable - only a *computed* one is a genuine expression that
        // might read it.
        target: node.targetIsExpr ? captureLoopVariables(node.target, captureMap) : node.target,
        entries: node.entries.map((entry) =>
          entry.kind === "AnimateTarget"
            ? { ...entry, to: captureLoopVariables(entry.to, captureMap) }
            : { ...entry, value: captureLoopVariables(entry.value, captureMap) }
        ),
      };
    case "PlayClipStmt":
      return {
        ...node,
        clip: node.clipIsExpr ? captureLoopVariables(node.clip, captureMap) : node.clip,
        target: node.targetIsExpr ? captureLoopVariables(node.target, captureMap) : node.target,
      };
    case "StopClipStmt":
      return { ...node, target: node.targetIsExpr ? captureLoopVariables(node.target, captureMap) : node.target };
    case "Await":
      return { ...node, operand: captureLoopVariables(node.operand, captureMap) };
    case "TryStmt":
      return {
        ...node,
        tryBlock: captureLoopVariables(node.tryBlock, captureMap),
        catchBlock: captureLoopVariables(node.catchBlock, captureMap),
      };
    default:
      return node; // Number/String/Boolean/Captured literals
  }
}

function expectVector3(value, what, line) {
  if (!isVector(value) || value.dim !== 3) {
    throw new AxisRuntimeError(`'${what}' needs a 3-value vector like (0, 0, 0), got a ${typeName(value)}`, line);
  }
  return [value.x, value.y, value.z];
}

// Everything a scene and a page have in common: a registry of named objects
// (for animate/on to target), interaction handlers, and the top-level
// variables a browser-side handler needs to see. Subclasses supply
// `interpretObjectDecl` and `interpretAnimateDecl`.
class DeclarativeBuilder {
  constructor(kind, name, components, globalEnv) {
    this.kind = kind; // "scene" | "page" - used in error messages
    this.name = name;
    this.components = components; // Map<name, {params, body, sourceFile}> - shared registry, same for every scene/page in the program
    this.globalEnv = globalEnv; // what a component's own env chains to - never the caller's env, so components stay encapsulated
    this.namePrefix = ""; // set while expanding a component instance, e.g. "card1." (nested components stack it further)
    this.renameMap = new Map(); // bare local name -> namespaced name, active only while expanding one component instance
    this.objects = [];
    this.objectsByName = new Map();
    this.animations = [];
    this.timelines = [];
    this.handlers = [];
    this.variables = {};
    this.reactiveNames = new Set();
    this.loopVarStack = []; // [name, value] pairs, one per currently-active enclosing 'for' loop, innermost last - see captureLoopVariables/interpretOnDecl
  }

  register(obj, line) {
    const bareName = obj.name;
    obj.name = this.namePrefix + bareName; // no-op outside a component, where namePrefix is ""
    if (this.objectsByName.has(obj.name)) {
      throw new AxisRuntimeError(`object '${obj.name}' is already defined in ${this.kind} '${this.name}'`, line);
    }
    this.objectsByName.set(obj.name, obj);
    this.objects.push(obj);
    // so a handler body stored for later (an `animate` triggered from an
    // `on` handler) can still resolve this object's bare name to its real,
    // namespaced one once renameIdentifiers runs over that stored body -
    // see expandComponent and renameIdentifiers' AnimateDecl case.
    if (this.namePrefix) this.renameMap.set(bareName, obj.name);
  }

  // Candidates for a "did you mean" suggestion on an on/animate target -
  // restricted to names sharing the current component-instance prefix (or
  // every name, outside of a component, since every string starts with
  // "") so a typo inside a component only ever suggests one of that same
  // instance's own siblings, not an unrelated name from elsewhere on the
  // page.
  localNameCandidates() {
    return [...this.objectsByName.keys()]
      .filter((k) => k.startsWith(this.namePrefix))
      .map((k) => k.slice(this.namePrefix.length));
  }

  // `on box.click` / `animate box { ... }` targets can be a bare name or a
  // computed `(expr)` (parser.js's parseTarget) - resolved here, at the
  // point the declaration itself is interpreted, so a loop-generated
  // `("box" + i)` sees that iteration's own `i` in `env` the same way a
  // loop-generated object's own computed name does.
  resolveTarget(decl, env, what) {
    if (!decl.targetIsExpr) return decl.target;
    const value = evaluate(decl.target, env);
    if (typeof value !== "string") {
      throw new AxisRuntimeError(`a computed ${what} target must evaluate to a string, got a ${typeName(value)}`, decl.line);
    }
    return value;
  }

  interpretOnDecl(decl, env) {
    // 'on tick'/'on keydown'/'on keyup'/'on mousemove'/'on mousedown'/
    // 'on mouseup' - a global handler (parser.js's isGlobalOnEvent), not
    // tied to any object - skips every bit of target resolution/validation
    // below, since there's no target. Stored with `target: null`, same
    // array (`this.handlers`) as an ordinary 'on' - the renderer
    // (scene3d.js/pageRuntime.js) is what actually gives each one its real
    // treatment (tick: run every frame; the rest: a real window listener,
    // with `key`/`dx`+`dy`/`button` bound inside the body as that event
    // calls for) rather than a click/hover-style per-object listener.
    if (decl.target === null) {
      const body = this.loopVarStack.length > 0 ? captureLoopVariables(decl.body, new Map(this.loopVarStack)) : decl.body;
      this.handlers.push({ target: null, event: decl.event, body });
      return;
    }
    const bareTarget = this.resolveTarget(decl, env, "'on'");
    const target = this.namePrefix + bareTarget;
    // A timeline is a second, separate namespace from ordinary objects (a
    // scene/page can have a shape and a timeline sharing no name collision
    // rule with each other - buildTimelineSteps never touches objectsByName)
    // - so an 'on' target is checked against both, and 'complete' (below)
    // is the one event that only ever means "this timeline finished
    // playing," never "this object did something."
    const isTimelineTarget = this.timelines.some((t) => t.name === target);
    if (!isTimelineTarget && !this.objectsByName.has(target)) {
      throw new AxisRuntimeError(
        `can't add an interaction to '${bareTarget}' - no object or timeline with that name in ${this.kind} '${this.name}'${suggest(bareTarget, [...this.localNameCandidates(), ...this.timelines.map((t) => t.name.slice(this.namePrefix.length))])}`,
        decl.line
      );
    }
    if (!EVENT_NAMES.has(decl.event)) {
      throw new AxisRuntimeError(`unknown event '${decl.event}'${suggest(decl.event, [...EVENT_NAMES])} - try click, hover, unhover, change, submit, load, error, or complete`, decl.line);
    }
    if (decl.event === "complete" && !isTimelineTarget) {
      throw new AxisRuntimeError(`'complete' only works on a timeline (it fires once playback reaches either end) - '${bareTarget}' is a ${this.objectsByName.get(target)?.type}`, decl.line);
    }
    if (isTimelineTarget && decl.event !== "complete") {
      throw new AxisRuntimeError(`'${decl.event}' isn't a timeline event - only 'complete' is, e.g. 'on ${bareTarget}.complete { ... }'`, decl.line);
    }
    if (ASSET_LIFECYCLE_EVENTS.has(decl.event) && this.objectsByName.get(target)?.type !== "model") {
      throw new AxisRuntimeError(`'${decl.event}' only works on a 'model' (it's an asset-loading event) - '${bareTarget}' is a ${this.objectsByName.get(target)?.type}`, decl.line);
    }
    // Bakes in whatever any *currently enclosing* 'for' loop's own
    // variable(s) were bound to at this exact point - see
    // captureLoopVariables, above - so `on ("row" + t.id).click { ... t.id
    // ... }` (a handler, declared inside a loop, that needs to know which
    // iteration's own data it belongs to) actually works, the same way a
    // component's own params already do. A no-op line (an empty Map) when
    // this 'on' isn't inside any loop at all - the overwhelmingly common
    // case - so it costs nothing there.
    const body = this.loopVarStack.length > 0 ? captureLoopVariables(decl.body, new Map(this.loopVarStack)) : decl.body;
    this.handlers.push({ target, event: decl.event, body });
  }

  dispatchSceneStatement(stmt, env, parentName) {
    if (stmt.kind === "ObjectDecl" && this.components.has(stmt.objectType)) this.expandComponent(stmt, env, parentName);
    else if (stmt.kind === "ObjectDecl") this.interpretObjectDecl(stmt, env, parentName);
    else if (stmt.kind === "AnimateDecl") this.interpretAnimateDecl(stmt, env);
    else if (stmt.kind === "TimelineDecl") this.interpretTimelineDecl(stmt, env);
    else if (stmt.kind === "OnDecl") this.interpretOnDecl(stmt, env);
    else if (stmt.kind === "StateDecl") this.interpretStateDecl(stmt, env);
    else throw new AxisRuntimeError(`'${stmt.kind}' can't be used inside a ${this.kind}`, stmt.line);
  }

  // Expands a component instantiation - `Card projectA { title: "..." }` -
  // as transparent macro expansion: its declarations become direct
  // children of the *call site's* own parent (no wrapper element), and
  // every name it declares gets namespaced under the instance name so two
  // instances of the same component never collide. See interpreter.js's
  // module doc comment / docs/language.md for the full model.
  expandComponent(decl, env, parentName) {
    const component = this.components.get(decl.objectType);

    let name = null;
    if (decl.nameIsExpr) {
      const evaluated = evaluate(decl.name, env);
      if (typeof evaluated !== "string") {
        throw new AxisRuntimeError(`a component instance's name must evaluate to a string, got a ${typeName(evaluated)}`, decl.line);
      }
      name = evaluated;
    } else if (decl.name) {
      name = decl.name;
    }
    if (!name) throw new AxisRuntimeError(`component '${decl.objectType}' needs an instance name, e.g. '${decl.objectType} thing { ... }'`, decl.line);

    if (decl.children.length > 0) {
      throw new AxisRuntimeError(`'${decl.objectType}' is a component - its own body decides what it contains, so it can't be given children directly`, decl.line);
    }

    const componentEnv = this.globalEnv.child();
    const providedProps = new Map(decl.properties.map((p) => [p.path.join("."), p]));
    for (const param of component.params) {
      const propEntry = providedProps.get(param);
      if (!propEntry) throw new AxisRuntimeError(`component '${decl.objectType}' is missing '${param}'`, decl.line);
      componentEnv.define(param, evaluate(propEntry.value, env), true); // a param is a value fixed at instantiation, like a function argument - not reactive
    }
    for (const [key, propEntry] of providedProps) {
      if (!component.params.includes(key)) {
        throw new AxisRuntimeError(`component '${decl.objectType}' doesn't take a '${key}' property${suggest(key, component.params)}`, propEntry.value.line);
      }
    }

    const prevPrefix = this.namePrefix;
    const prevRenameMap = this.renameMap;
    const objectsStart = this.objects.length;
    const handlersStart = this.handlers.length;

    const instancePrefix = `${prevPrefix}${name}.`;
    this.namePrefix = instancePrefix;
    this.renameMap = new Map();

    try {
      this.runStatements(component.body, componentEnv, parentName); // parentName is the CALL SITE's parent - transparent splice, no wrapper element

      // Every top-level componentEnv binding - params plus any state/let
      // the component declared directly in its own body (same "only
      // top-level bindings" rule captureVariables already uses elsewhere)
      // - needs to survive into the browser under its namespaced name,
      // and needs a rename-map entry so stored bindings/handler bodies
      // referencing the bare name resolve correctly there (there's no
      // componentEnv in the browser, only the page's flat env).
      for (const [varName, value] of componentEnv.vars) {
        if (typeof value === "function" || (value && value.__axisType === "function")) continue;
        const namespaced = instancePrefix + varName;
        this.variables[namespaced] = { value, constant: componentEnv.consts.has(varName), reactive: this.reactiveNames.has(varName) };
        this.renameMap.set(varName, namespaced);
      }

      for (let i = objectsStart; i < this.objects.length; i++) {
        const obj = this.objects[i];
        if (!obj.bindings) continue;
        for (const key of Object.keys(obj.bindings)) obj.bindings[key] = renameIdentifiers(obj.bindings[key], this.renameMap);
      }
      for (let i = handlersStart; i < this.handlers.length; i++) {
        this.handlers[i].body = renameIdentifiers(this.handlers[i].body, this.renameMap);
      }
    } catch (e) {
      if (e instanceof AxisRuntimeError && !e.filePath && component.sourceFile) e.filePath = component.sourceFile;
      throw e;
    } finally {
      this.namePrefix = prevPrefix;
      this.renameMap = prevRenameMap;
    }
  }

  // Both PageBuilder and SceneBuilder override this - this default only
  // exists as a defensive fallback for a hypothetical future domain that
  // doesn't.
  interpretStateDecl(decl) {
    throw new AxisRuntimeError(`'state' isn't supported inside a ${this.kind}`, decl.line);
  }

  // Only SceneBuilder overrides this - a `timeline` targets shapes/groups/
  // models/camera/lights, none of which a page has. A real, current
  // limitation, not a design decision - see docs/language.md's Timelines
  // section.
  interpretTimelineDecl(decl) {
    throw new AxisRuntimeError(`'timeline' isn't supported inside a ${this.kind} yet`, decl.line);
  }

  // Shared duration/delay/repeat/easing parsing for `animate` blocks - the
  // target-property validation differs per domain (Vec3 axis paths for
  // scenes, a small CSS-mappable set for pages), but the timing entries
  // mean exactly the same thing in both. Returns whether `key` was one of
  // these, so the caller knows to try something else (or give up) if not.
  applyAnimateTimingEntry(key, entry, animation, env) {
    if (key === "duration" || key === "delay") {
      const value = evaluate(entry.value, env);
      if (typeof value !== "number") throw new AxisRuntimeError(`'${key}' needs a number`, entry.value.line);
      const unit = literalUnit(entry.value);
      const ms = unit === "s" ? value * 1000 : value; // ms by default
      // Same validation as evaluator.js's parseAnimateTiming (the live-
      // trigger path) - NaN/Infinity/negative would otherwise reach the
      // tween runtime unchecked. Duplicated here, not shared, because this
      // build-time path and that live-trigger one were already two
      // separate parsers before this fix; closing the same gap in both
      // keeps it complete without a larger, unrelated refactor.
      if (!Number.isFinite(ms) || ms < 0) {
        throw new AxisRuntimeError(`'${key}' must be a finite, non-negative number, got ${value}`, entry.value.line);
      }
      animation[key] = ms;
      return true;
    }
    if (key === "repeat") {
      const value = evaluate(entry.value, env);
      if (value === Infinity) {
        animation.repeat = Infinity;
      } else if (typeof value === "number" && Number.isInteger(value) && value > 0) {
        animation.repeat = value;
      } else {
        throw new AxisRuntimeError("'repeat' must be a positive whole number or 'infinite'", entry.value.line);
      }
      return true;
    }
    if (key === "easing") {
      const value = evaluate(entry.value, env);
      if (!EASING_NAMES.has(value)) {
        throw new AxisRuntimeError(
          `unknown easing '${value}'${suggest(value, [...EASING_NAMES])} - try linear, easeInOut, easeInOutCubic, easeOutBack, or easeOutBounce`,
          entry.value.line
        );
      }
      animation.easing = value;
      return true;
    }
    return false;
  }

  // Shared core of interpreting one `animate TARGET { ... }` block's own
  // entries (everything after target resolution, which differs per domain -
  // see SceneBuilder's and PageBuilder's own buildAnimateBlock) - both a
  // top-level `animate` and one `timeline` step, in either a scene or a
  // page, walk the exact same duration/delay/repeat/easing/`at` grammar;
  // only which property *paths* and value *types* are valid differs, which
  // is what `validateChange` (caller-supplied) decides. `allowAt` and
  // `targetLabel` mean the same thing they do on SceneBuilder's
  // buildAnimateBlock (see the note there).
  buildAnimateEntries(decl, env, targetLabel, { allowAt = false, validateChange }) {
    const animation = { changes: [], duration: null, delay: 0, repeat: 1, easing: "linear", at: null };

    for (const entry of decl.entries) {
      const key = entry.path.join(".");

      if (entry.kind === "AnimateTarget") {
        const value = evaluate(entry.to, env);
        validateChange(key, value, entry);
        animation.changes.push({ path: key, toValue: value, unit: literalUnit(entry.to) });
        continue;
      }

      if (allowAt && key === "at") {
        const value = evaluate(entry.value, env);
        if (typeof value !== "number") throw new AxisRuntimeError(`'at' needs a number (a time in milliseconds) - try 'previous', a label, or plain arithmetic on either`, entry.value.line);
        if (!Number.isFinite(value)) throw new AxisRuntimeError(`'at' must be a finite number, got ${value}`, entry.value.line);
        animation.at = value;
        continue;
      }
      if (allowAt && (key === "delay" || key === "repeat")) {
        throw new AxisRuntimeError(`'${key}' isn't supported on a timeline step - use 'at' to position it on the timeline instead`, entry.value.line);
      }

      if (this.applyAnimateTimingEntry(key, entry, animation, env)) continue;

      throw new AxisRuntimeError(`unknown animate property '${key}'`, entry.value?.line ?? decl.line);
    }

    if (animation.duration === null) {
      throw new AxisRuntimeError(`animate block for '${targetLabel}' is missing 'duration'`, decl.line);
    }

    return animation;
  }

  // `timeline NAME { ... }` - a named, ordered choreography of `animate`
  // steps. Interpreted once, at build time, into a flat, fully-scheduled
  // list of steps (each with an absolute `at`, in ms from the timeline's
  // own start) - the browser runtime never sees `label`/`at`-expression/
  // `previous` at all, only the resolved numbers, the same way it never
  // sees `duration: 2s` as anything but a resolved 2000.
  //
  // `label`/`previous` are real variables in the timeline's own build-time
  // env, not a second timing language: a `label` binds the *current*
  // cursor position when it's declared (a plain number, so `at: hero + 200`
  // is just arithmetic), and `previous` is kept up to date, after every
  // step, to that step's own end - both walk the same Environment chain
  // `let`/`state` already do, so they're visible from a `for`/`if` nested
  // inside the timeline too (how stagger works - see docs/language.md).
  //
  // Domain-agnostic - a scene's and a page's own `interpretTimelineDecl`
  // both call this, differing only in `buildStep(stmt, stmtEnv)`, which
  // turns one `AnimateDecl` statement into a scheduled step (target
  // resolution/validation is entirely the caller's job; this only cares
  // about the step's own `at`/`duration` for scheduling purposes).
  buildTimelineSteps(decl, env, buildStep) {
    const steps = [];
    let cursor = 0; // "previous" - strictly the immediately-preceding step's own end
    let maxEnd = 0; // the timeline's real total length - the furthest any step reaches, not just the last one written (an explicit `at` can jump earlier or later than a plain sequential read of `previous` would)
    let loop = false; // `loop: true` - see the TimelineProperty case below
    const timelineEnv = env.child();
    timelineEnv.define("previous", cursor);

    const hooks = {
      onCustomStatement: (stmt, stmtEnv) => {
        if (stmt.kind === "LabelDecl") {
          stmtEnv.define(stmt.name, cursor, true);
          return;
        }
        if (stmt.kind === "TimelineProperty") {
          // A bare `key: value` at a timeline's own top level - `loop` is
          // the only one today (auto-restart a `play`-driven run from the
          // beginning once it reaches the end, instead of just stopping
          // there - see tween.js's own tickTimeline). Parsed generically
          // (parser.js's TimelineProperty), validated by name here, the
          // same "parse the shape, the interpreter decides what's legal"
          // split every other property in this language already follows.
          if (stmt.name !== "loop") {
            throw new AxisRuntimeError(`timeline doesn't have a '${stmt.name}' property${suggest(stmt.name, ["loop"])} - try 'loop'`, stmt.line);
          }
          const value = evaluate(stmt.value, stmtEnv);
          if (typeof value !== "boolean") {
            throw new AxisRuntimeError(`'loop' needs true or false, got a ${typeName(value)}`, stmt.line);
          }
          loop = value;
          return;
        }
        if (stmt.kind === "AnimateDecl") {
          const step = buildStep(stmt, stmtEnv);
          const at = step.at ?? cursor;
          steps.push({ ...step, at });
          cursor = at + step.duration;
          maxEnd = Math.max(maxEnd, cursor);
          stmtEnv.set("previous", cursor);
          return;
        }
        throw new AxisRuntimeError(`'${stmt.kind}' can't be used inside a timeline`, stmt.line);
      },
    };

    try {
      executeBlock(decl.body, timelineEnv, hooks);
    } catch (e) {
      if (e instanceof ReturnSignal) throw new AxisRuntimeError("'return' can only be used inside a function");
      throw e;
    }

    return { steps, duration: maxEnd, loop };
  }

  runStatements(statements, env, parentName) {
    this.registerReactiveBlocks(statements, parentName);
    const hooks = {
      onCustomStatement: (stmt, stmtEnv) => this.dispatchSceneStatement(stmt, stmtEnv, parentName),
      // Keeps `this.loopVarStack` in sync with every 'for' loop actually
      // executing right now, for interpretOnDecl/captureLoopVariables to
      // read - see the note there. Bodies run through this same
      // `runStatements` however deeply nested (a container's children, a
      // component's body, ...), so this stays correct regardless of how
      // many loops are stacked.
      onLoopVarEnter: (name, value) => this.loopVarStack.push([name, value]),
      onLoopVarExit: () => this.loopVarStack.pop(),
    };
    try {
      executeBlock(statements, env, hooks);
    } catch (e) {
      if (e instanceof ReturnSignal) throw new AxisRuntimeError("'return' can only be used inside a function");
      throw e;
    }
  }

  // Only PageBuilder overrides this (see the note there) - a scene's own
  // `if`/`for` still only ever run once, at build time, same as before.
  registerReactiveBlocks() {}

  // only the top-level bindings are exposed to interaction handlers later -
  // lets declared inside a nested group/container or loop stay local to
  // that scope, same as they would in a function. Whether each one was
  // declared `let` or `const` carries through too, so a handler can mutate
  // a top-level `let` (e.g. a click counter) but not a `const`.
  //
  // `statements` (optional - the scene/page body's own top-level AST, see
  // callers) - only used to look up a top-level LetDecl/StateDecl's own
  // initializer expression, for the same reason interpret()'s
  // `sharedVariables` does (see containsFunction's comment, evaluator.js):
  // a "data with behavior" record's function fields can't survive the
  // JSON transport to the browser, so a value that contains one also
  // needs its initializer shipped, to be re-evaluated fresh client-side.
  captureVariables(env, statements = []) {
    const initializers = new Map();
    for (const stmt of statements) {
      if (stmt.kind === "LetDecl" || stmt.kind === "StateDecl") initializers.set(stmt.name, stmt.value);
    }
    for (const [name, value] of env.vars) {
      if (typeof value === "function" || (value && value.__axisType === "function")) continue;
      this.variables[name] = { value, constant: env.consts.has(name), reactive: this.reactiveNames.has(name) };
      if (containsFunction(value) && initializers.has(name)) this.variables[name].initializer = initializers.get(name);
    }
  }
}

class SceneBuilder extends DeclarativeBuilder {
  constructor(name, components, globalEnv) {
    super("scene", name, components, globalEnv);
    this.camera = null;
    this.environment = null;
  }

  applyProperty(target, prop, env, objectType) {
    const key = prop.path.join(".");
    const allowed = SCENE_ALLOWED_PROPS[objectType];
    if (allowed && !allowed.has(key)) {
      throw new AxisRuntimeError(`'${objectType}' doesn't have a '${key}' property${suggest(key, [...allowed])}`, prop.value.line);
    }
    const value = evaluate(prop.value, env);

    if (key === "position" || key === "rotation" || key === "scale" || key === "target") {
      target[key] = expectVector3(value, key, prop.value.line);
    } else if (key === "direction") {
      target.direction = expectVector3(value, "direction", prop.value.line);
    } else if (key === "color" || key === "groundColor" || key === "background" || key === "fogColor") {
      if (typeof value !== "string") {
        throw new AxisRuntimeError(`'${key}' needs a color name or a string like "#ff6600", got a ${typeName(value)}`, prop.value.line);
      }
      target[key] = value;
    } else if (key === "src") {
      const problem = assetSrcError(value);
      if (problem) throw new AxisRuntimeError(`'src' ${problem}`, prop.value.line);
      target.src = value;
    } else if (key === "controls") {
      if (!CAMERA_CONTROLS.has(value)) {
        throw new AxisRuntimeError(`unknown camera controls '${value}'${suggest(value, [...CAMERA_CONTROLS])} - try "orbit"`, prop.value.line);
      }
      target.controls = value;
    } else if (key === "clip") {
      // Which animation clip (by name, exactly as authored in the source
      // .glb/.gltf file) this model plays as soon as it finishes loading -
      // see scene3d.js's reconcileClip for the runtime half. Only the name
      // is validated here (a string); whether a clip by that name actually
      // exists in the file can't be known until the browser loads it (see
      // docs/architecture/skeletal-animation.md).
      if (typeof value !== "string") throw new AxisRuntimeError(`'clip' needs a string (an animation clip's name), got a ${typeName(value)}`, prop.value.line);
      target.clip = value;
    } else if (key === "intensity" || key === "opacity" || key === "angle" || key === "penumbra" || key === "fov" || key === "near" || key === "far" || key === "fogNear" || key === "fogFar") {
      if (typeof value !== "number") throw new AxisRuntimeError(`'${key}' needs a number`, prop.value.line);
      target[key] = value;
    } else if (key === "shadows" || key === "castShadow" || key === "receiveShadow") {
      if (typeof value !== "boolean") throw new AxisRuntimeError(`'${key}' needs true or false`, prop.value.line);
      target[key] = value;
    } else if (key.startsWith("material.")) {
      // `material.color`/`material.metalness`/etc. - a dotted property is
      // already ordinary AXIS grammar (parser.js's parsePath), so this reads
      // just like `rotation.y` does elsewhere; validated against
      // MATERIAL_FIELDS the same way a top-level property is validated
      // against SCENE_ALLOWED_PROPS, just one level deeper. Stored as a
      // nested `target.material` object (not flattened) so scene3d.js's
      // node-building code has one place to look for a shape's/model's
      // starting material, same shape a `position`/`rotation`/`scale`
      // object already has.
      const field = prop.path[1];
      if (prop.path.length !== 2 || !MATERIAL_FIELDS.has(field)) {
        throw new AxisRuntimeError(`'material' doesn't have a '${prop.path.slice(1).join(".")}' property${suggest(field ?? "", [...MATERIAL_FIELDS])}`, prop.value.line);
      }
      if (field === "color" || field === "emissive") {
        if (typeof value !== "string") {
          throw new AxisRuntimeError(`'material.${field}' needs a color name or a string like "#ff6600", got a ${typeName(value)}`, prop.value.line);
        }
      } else if (field === "map") {
        // A texture file, validated the same way `model.src` already is
        // (assetSrcError) - not a color, not a number, the one material
        // field whose value is a path.
        if (typeof value !== "string") {
          throw new AxisRuntimeError(`'material.map' needs a string (a path to an image file), got a ${typeName(value)}`, prop.value.line);
        }
        const problem = assetSrcError(value, TEXTURE_EXTENSIONS);
        if (problem) throw new AxisRuntimeError(`'material.map' ${problem}`, prop.value.line);
      } else if (typeof value !== "number") {
        throw new AxisRuntimeError(`'material.${field}' needs a number`, prop.value.line);
      }
      target.material ??= {};
      target.material[field] = value;
    } else {
      target[key] = value;
    }

    // Stash the raw expression too (skipping bare literals, `src` - a
    // model's file can't hot-swap - `controls`, which isn't something a
    // running scene meaningfully swaps mid-flight, `clip` - its initial
    // selection can't hot-swap via reactive `state` either; use `play NAME
    // on target` from an `on` handler to switch clips live instead - and
    // `fogColor`/`fogNear`/`fogFar`, which (unlike `environment`'s own
    // `background`) are still build-time-only: whether fog exists in the
    // scene at all is decided once, at mount, from whether `fogColor` was
    // set then - a real, current limitation, not silently broken) so the
    // browser can re-evaluate it after a `state` update and patch the live
    // three.js object if the value actually changed - the scene-graph
    // sibling of PageBuilder's identical mechanism just below. See
    // renderer/scene3d.js's reRender().
    if (key !== "src" && key !== "controls" && key !== "clip" && key !== "fogColor" && key !== "fogNear" && key !== "fogFar" && !isLiteralExpr(prop.value)) {
      target.bindings ??= {};
      // Same loop-variable capture an `on`/`animate` decl's body already
      // gets (see captureLoopVariables/interpretOnDecl) - without it, a
      // loop-generated object's binding is stored as the exact same raw
      // expression for every iteration (verbatim, still referencing the
      // loop's own `i`), so scene3d.js's reRender() re-evaluates the
      // *identical* expression for every object in the loop once the loop
      // itself has finished and `i` no longer means anything - silently
      // never updating (a real, reproduced bug: see
      // benchmarks/task-03-data/results.md). A bare object-declaration
      // literal binding was never affected (`isLiteralExpr` above already
      // skips it) - only a *loop-referencing* non-literal one was.
      target.bindings[key] = this.loopVarStack.length > 0 ? captureLoopVariables(prop.value, new Map(this.loopVarStack)) : prop.value;
    }
  }

  interpretObjectDecl(decl, env, parentName) {
    const type = decl.objectType;

    let name = null;
    if (decl.nameIsExpr) {
      const evaluated = evaluate(decl.name, env);
      if (typeof evaluated !== "string") {
        throw new AxisRuntimeError(`an object's name must evaluate to a string, got a ${typeName(evaluated)}`, decl.line);
      }
      name = evaluated;
    } else if (decl.name) {
      name = decl.name;
    }

    if (type === "camera") {
      if (name !== null) throw new AxisRuntimeError("'camera' doesn't take a name", decl.line);
      if (parentName !== null) throw new AxisRuntimeError("'camera' can't be nested inside a group", decl.line);
      if (this.namePrefix) throw new AxisRuntimeError("'camera' can't be declared inside a component", decl.line);
      if (this.camera) throw new AxisRuntimeError(`scene '${this.name}' already has a camera`, decl.line);
      if (decl.children.length > 0) throw new AxisRuntimeError("'camera' can't contain other declarations", decl.line);
      // `fov` in degrees, `near`/`far` the clip planes - three.js's own
      // PerspectiveCamera defaults (see scene3d.js's camera construction,
      // unchanged from before these were authorable). `target` is the point
      // the camera looks at - was hardcoded to the origin before this
      // milestone (see scene3d.js's tick()); the default keeps every
      // existing scene's framing identical.
      const camera = { type: "camera", name: "camera", position: [0, 2, 5], fov: 60, near: 0.1, far: 100, target: [0, 0, 0] };
      for (const prop of decl.properties) this.applyProperty(camera, prop, env, "camera");
      // Registered under the fixed name "camera" too - not as a spatial
      // node (plan.js's own `scenePlan.camera` field, not `nodes`, still
      // carries the actual camera data - see buildScenePlan), just so
      // `animate camera { position.z -> 4 }` / a `timeline` step can
      // target it exactly like any other named object, and so a shape
      // that's also (confusingly) named "camera" is a clear duplicate-name
      // error instead of a silent collision, whichever one is declared
      // first.
      if (this.objectsByName.has("camera")) {
        throw new AxisRuntimeError(`object 'camera' is already defined in scene '${this.name}'`, decl.line);
      }
      this.objectsByName.set("camera", camera);
      this.camera = camera;
      return;
    }

    if (type === "environment") {
      if (name !== null) throw new AxisRuntimeError("'environment' doesn't take a name", decl.line);
      if (parentName !== null) throw new AxisRuntimeError("'environment' can't be nested inside a group", decl.line);
      if (this.namePrefix) throw new AxisRuntimeError("'environment' can't be declared inside a component", decl.line);
      if (this.environment) throw new AxisRuntimeError(`scene '${this.name}' already has an environment`, decl.line);
      if (decl.children.length > 0) throw new AxisRuntimeError("'environment' can't contain other declarations", decl.line);
      // `background` matches the fixed "#111111" every scene rendered
      // against before this was authorable (see scene3d.js). `fogColor:
      // null` means "no fog" - the same opt-in-by-presence idea `shadows`
      // already uses, just via a value instead of a boolean, since a fog
      // needs an actual color to exist at all. `fogNear`/`fogFar` only
      // matter once `fogColor` is actually set.
      const environment = { type: "environment", name: "environment", background: "#111111", fogColor: null, fogNear: 10, fogFar: 50 };
      for (const prop of decl.properties) this.applyProperty(environment, prop, env, "environment");
      // Registered under the fixed name "environment" too, same reasoning
      // as `camera` just above - `animate environment { background -> ...
      // }` / an `on`-handler write both need to resolve it as a real
      // target, and a shape confusingly named "environment" becomes a
      // clear duplicate-name error instead of a silent collision.
      if (this.objectsByName.has("environment")) {
        throw new AxisRuntimeError(`object 'environment' is already defined in scene '${this.name}'`, decl.line);
      }
      this.objectsByName.set("environment", environment);
      this.environment = environment;
      return;
    }

    if (!name) throw new AxisRuntimeError(`'${type}' needs a name, e.g. '${type} thing { ... }'`, decl.line);

    if (type in LIGHT_TYPES) {
      const light = { type, name, parent: parentName, color: "white", intensity: 1, ...LIGHT_TYPES[type].defaults };
      for (const prop of decl.properties) this.applyProperty(light, prop, env, type);
      if (decl.children.length > 0) throw new AxisRuntimeError(`'${type}' can't contain other declarations`, decl.line);
      this.register(light, decl.line);
      return;
    }

    if (type === "group") {
      const group = { type: "group", name, parent: parentName, position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] };
      for (const prop of decl.properties) this.applyProperty(group, prop, env, "group");
      this.register(group, decl.line);
      const groupEnv = env.child();
      this.runStatements(decl.children, groupEnv, group.name); // group.name, not the pre-registration local `name` - it may have been namespaced by register()
      return;
    }

    // A `model` loads its geometry and material from an external .glb/.gltf
    // file instead of getting one of the built-in primitive shapes - no
    // `color`, but `material.metalness`/`material.roughness`/etc. (see
    // applyProperty's `material.` branch, above) apply as an overlay on top
    // of whatever the file's own material(s) already define, rather than
    // replacing them - see scene3d.js's applyMaterialOverrides. Otherwise a
    // `model` is positioned/rotated/scaled like any other spatial object.
    // The actual file gets read (and its path resolved, and its bytes served
    // to the browser) entirely outside the language core - see
    // renderer/plan.js (collects which `src` paths a scene references) and
    // renderer/server.js (serves/copies them) - interpreter.js only checks
    // that the *path itself* looks sane (assetSrcError, above).
    if (type === "model") {
      if (decl.children.length > 0) throw new AxisRuntimeError("'model' can't contain other declarations", decl.line);
      const model = { type: "model", name, parent: parentName, position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], src: null, clip: null };
      for (const prop of decl.properties) this.applyProperty(model, prop, env, "model");
      if (model.src === null) {
        throw new AxisRuntimeError(`'model' needs a 'src' property pointing at a .glb or .gltf file, e.g. 'src: "./earth.glb"'`, decl.line);
      }
      this.register(model, decl.line);
      return;
    }

    if (!SHAPE_TYPES.has(type)) {
      throw new AxisRuntimeError(
        `unknown object type '${type}'${suggest(type, [...SHAPE_TYPES, "model", ...Object.keys(LIGHT_TYPES), "group", "camera", "environment", ...this.components.keys()])}`,
        decl.line
      );
    }
    if (decl.children.length > 0) {
      throw new AxisRuntimeError(`'${type}' can't contain other declarations - use 'group' if you need to nest things`, decl.line);
    }

    const obj = { type, name, parent: parentName, position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], color: "gray" };
    for (const prop of decl.properties) this.applyProperty(obj, prop, env, type);
    this.register(obj, decl.line);
  }

  // Shared core of interpreting one `animate TARGET { ... }` block - a
  // top-level (plays-on-load) `animate` and one step inside a `timeline`
  // are the exact same grammar and the exact same target/property
  // validation; they only differ in whether `at` (a step's own position on
  // its timeline's clock) is a meaningful property. `allowAt: true` also
  // rejects `delay`/`repeat` with a clear pointer to `at` instead, since
  // "when does this start" is a timeline step's job, not the step's own -
  // see interpretTimelineDecl, just below.
  buildAnimateBlock(decl, env, { allowAt = false } = {}) {
    const bareTarget = this.resolveTarget(decl, env, "'animate'");
    const target = this.namePrefix + bareTarget;
    if (!this.objectsByName.has(target)) {
      throw new AxisRuntimeError(
        `can't animate '${bareTarget}' - no object with that name in scene '${this.name}'${suggest(bareTarget, this.localNameCandidates())}`,
        decl.line
      );
    }
    const animation = this.buildAnimateEntries(decl, env, bareTarget, { allowAt, validateChange: validateSceneAnimateChange });
    animation.target = target;
    return animation;
  }

  interpretAnimateDecl(decl, env) {
    this.animations.push(this.buildAnimateBlock(decl, env));
  }

  // `timeline NAME { ... }` - a named, ordered choreography of `animate`
  // steps, targeting this scene's own objects. See DeclarativeBuilder's
  // buildTimelineSteps for the domain-agnostic walking logic (label/`at`/
  // `previous`/stagger) this shares with PageBuilder's own version - the
  // only thing scene-specific here is how one step gets built.
  interpretTimelineDecl(decl, env) {
    const name = this.namePrefix + decl.name;
    if (this.timelines.some((t) => t.name === name)) {
      throw new AxisRuntimeError(`timeline '${decl.name}' is already defined in scene '${this.name}'`, decl.line);
    }
    const { steps, duration, loop } = this.buildTimelineSteps(decl, env, (stmt, stmtEnv) => this.buildAnimateBlock(stmt, stmtEnv, { allowAt: true }));
    this.timelines.push({ name, steps, duration, loop });
  }

  // A scene-local `state` behaves exactly like a scene-local `let` for
  // evaluation purposes - the only difference is it's tracked as reactive,
  // same as PageBuilder's version just below, so a shape property that
  // reads it becomes a live binding (see applyProperty above) instead of a
  // value baked in once at build time.
  interpretStateDecl(decl, env) {
    const value = evaluate(decl.value, env);
    env.define(decl.name, value, false);
    this.reactiveNames.add(decl.name);
  }

  build(sceneDecl, globalEnv) {
    const sceneEnv = globalEnv.child();
    this.runStatements(sceneDecl.body, sceneEnv, null);
    this.captureVariables(sceneEnv, sceneDecl.body);
    return {
      name: this.name,
      camera: this.camera,
      environment: this.environment,
      objects: this.objects,
      // Includes "camera" (see interpretObjectDecl's camera branch) - a
      // page's `viewport`, embedding this scene, uses this to validate a
      // `timeline` step that cross-references one of this scene's own
      // objects (`animate ("stage.centerpiece") { ... }` - see
      // PageBuilder.buildTimelineStep) the same "does this object exist"
      // way `animate`/`on` already do within the scene itself.
      objectsByName: this.objectsByName,
      animations: this.animations,
      timelines: this.timelines,
      handlers: this.handlers,
      variables: this.variables,
    };
  }
}

export class PageBuilder extends DeclarativeBuilder {
  // `sceneDecls` - Map<name, SceneDecl AST> - is every `scene` this file
  // declares, collected up front (see interpret(), below) so a `viewport`
  // can embed one whether it's declared earlier or later in the file.
  constructor(title, components, globalEnv, sceneDecls) {
    super("page", title, components, globalEnv);
    this.sceneDecls = sceneDecls;
    this.reactiveBlocks = [];
  }

  // AXIS has reactive *values* (a bound property re-checked after a
  // handler runs) but, until now, no reactive *structure* - an `if`/`for`
  // directly inside a page/container/component body only ever ran once, at
  // build time. This is the build-time half of fixing that: every `for`
  // (always - re-running a handful of loop iterations is exactly as cheap
  // as re-checking a handful of property bindings, the same "full but
  // cheap re-check, no dependency tracking" call the rest of AXIS's
  // reactivity already makes) and every `if` whose condition isn't a bare
  // literal (mirrors `isLiteralExpr` - an `if (true)` can never change, so
  // it's not worth tracking) gets recorded, in document order, as a
  // reactive block: the *statement itself*, verbatim - not a decomposed
  // condition/body/varName - so the browser can re-run it exactly the way
  // `runStatements` already runs it here, via the very same
  // `PageBuilder` class (see domClient.js). `statements` (the whole
  // sibling list, not each stmt in isolation) is the only place this can
  // be intercepted once per body - a top-level page body, a container's
  // children, and a component's body all funnel through here.
  //
  // Deliberately does NOT recurse into `then`/`else`/the for `body` here -
  // a nested `if`/`for` *inside a container* declared in a reactive
  // block's own body is found the next time `runStatements` naturally
  // runs for real (interpretObjectDecl calling it again for that
  // container's children) - not by walking the AST speculatively.
  //
  // But it's NOT independently registered while `this.loopVarStack` is
  // non-empty - i.e., while this call is itself happening *inside* an
  // enclosing `for` loop's own iteration (the loop that pushed onto that
  // stack - see interpretOnDecl's identical use of it). Reason: a nested
  // construct declared there can freely reference the *enclosing* loop's
  // own variable (`if (faqOpen == f.id) { ... }`, inside `for f in faqs`),
  // exactly like a nested `on` handler already can (captureLoopVariables).
  // If it were ALSO registered as its own top-level reactive block, the
  // browser would try to re-run it in isolation, against `pageEnv` alone -
  // where `f` doesn't exist - and fail every single rebuild pass. It
  // doesn't need to be registered on its own anyway: the enclosing `for`
  // is always registered (every `for` is - see above), and rebuilding
  // *that* one already re-derives this nested construct's own current
  // state correctly, with `f` properly bound, as part of the very same
  // pass (domClient.js's diffing is by node name, not by which block
  // "owns" it, so this costs nothing extra to get right). A nested `if`/
  // `for` inside a plain `if` (no enclosing loop variable in scope) has no
  // such hazard and is still registered independently, same as always.
  registerReactiveBlocks(statements, parentName) {
    if (this.loopVarStack.length > 0) return;
    for (const stmt of statements) {
      if (stmt.kind === "IfStmt" && isLiteralExpr(stmt.condition)) continue;
      if (stmt.kind !== "IfStmt" && stmt.kind !== "ForStmt") continue;
      this.reactiveBlocks.push({ id: this.reactiveBlocks.length, stmt, parentName });
    }
  }

  applyProperty(target, prop, env, elementType) {
    const key = prop.path.join(".");
    const allowed = domAllowedProps(elementType);
    if (allowed && !allowed.has(key) && !UNIVERSAL_DOM_PROPS.has(key)) {
      throw new AxisRuntimeError(`'${elementType}' doesn't have a '${key}' property${suggest(key, [...allowed, ...UNIVERSAL_DOM_PROPS])}`, prop.value.line);
    }
    const value = evaluate(prop.value, env);

    if (key === "direction") {
      if (value !== "row" && value !== "column") {
        throw new AxisRuntimeError(`'direction' must be "row" or "column", got a ${typeName(value)}`, prop.value.line);
      }
      target.direction = value;
    } else if (key === "level") {
      if (!Number.isInteger(value) || value < 1 || value > 6) {
        throw new AxisRuntimeError(`'level' must be a whole number from 1 to 6, got a ${typeName(value)}`, prop.value.line);
      }
      target.level = value;
    } else if (key === "opacity" || key === "z") {
      if (typeof value !== "number") throw new AxisRuntimeError(`'${key}' needs a number`, prop.value.line);
      target[key] = value;
    } else if (key === "value") {
      if (typeof value !== "number" && typeof value !== "string") {
        throw new AxisRuntimeError(`'value' needs a string or a number, got a ${typeName(value)}`, prop.value.line);
      }
      target.value = value;
    } else if (key === "visible") {
      if (typeof value !== "boolean") throw new AxisRuntimeError(`'visible' needs true or false, got a ${typeName(value)}`, prop.value.line);
      target.visible = value;
    } else if (key === "responsive") {
      // `responsive: { mobile: { direction: "column" } }` - see
      // docs/architecture/responsive-layout.md. Evaluated once, here, like
      // every other property - deliberately NOT reactive in v1 (no
      // `state`-driven breakpoint override), since it compiles straight to
      // real `<style>`/`@media` CSS (domHtml.js) rather than a JS-patched
      // one; see validateResponsiveKey for why only a CSS-mappable
      // property is allowed inside a tier at all.
      if (!isRecord(value)) {
        throw new AxisRuntimeError(`'responsive' needs a record like { mobile: { ... } }, got a ${typeName(value)}`, prop.value.line);
      }
      const responsive = {};
      for (const tier of recordFields(value)) {
        if (!RESPONSIVE_BREAKPOINTS.has(tier)) {
          throw new AxisRuntimeError(`'responsive' doesn't have a '${tier}' breakpoint${suggest(tier, [...RESPONSIVE_BREAKPOINTS])} - try tablet or mobile`, prop.value.line);
        }
        const tierValue = value[tier];
        if (!isRecord(tierValue)) {
          throw new AxisRuntimeError(`'responsive.${tier}' needs a record of properties, got a ${typeName(tierValue)}`, prop.value.line);
        }
        const tierProps = {};
        for (const overrideKey of recordFields(tierValue)) {
          validateResponsiveKey(elementType, overrideKey, prop.value.line);
          tierProps[overrideKey] = tierValue[overrideKey];
        }
        responsive[tier] = tierProps;
      }
      target.responsive = responsive;
    } else if (DOM_SIZE_KEYS.has(key)) {
      if (typeof value !== "number" && typeof value !== "string") {
        throw new AxisRuntimeError(`'${key}' needs a number of pixels or a string like "50%", got a ${typeName(value)}`, prop.value.line);
      }
      target[key] = value;
    } else if (DOM_STRING_KEYS.has(key)) {
      if (typeof value !== "string") {
        throw new AxisRuntimeError(`'${key}' needs a string, got a ${typeName(value)}`, prop.value.line);
      }
      // `href`/`src` are the one place a literal, author-written value can
      // end up as something the browser actually navigates to - see
      // urlSafety.js. A *reactive* href/src can't be checked here (its
      // real value isn't known until a handler runs) - domClient.js's
      // applyElementProperty is where that half is sanitized live.
      if ((key === "href" || key === "src") && !isSafeUrl(value)) {
        throw new AxisRuntimeError(`'${key}' can't use a "${value.split(":")[0]}:" URL - only http(s), mailto, tel, or a relative path/anchor are allowed`, prop.value.line);
      }
      target[key] = value;
    } else {
      target[key] = value;
    }

    // Stash the raw expression too (skipping bare literals - they can
    // never change - and `responsive`, which compiles to static CSS and
    // isn't a live binding at all in v1, see above) so the browser can
    // re-evaluate it after a `state` update and patch the DOM if the value
    // actually changed. See domClient.js's reRender().
    if (key !== "responsive" && !isLiteralExpr(prop.value)) {
      target.bindings ??= {};
      // See SceneBuilder.applyProperty's identical fix, above, for why
      // this needs the same loop-variable capture an `on`/`animate` body
      // already gets - a loop-generated element's stored binding was
      // otherwise the exact same raw, `i`-referencing expression for every
      // iteration. A page's own reactive-block rebuild
      // (pageRuntime.js's rebuildReactiveBlock) separately re-runs a
      // top-level loop's whole body from source on every state change,
      // which happens to get `i` right on its own regardless of this
      // stored binding - but correctness here shouldn't depend on which of
      // two mechanisms happens to be the one consulted, and this keeps
      // both consistent rather than leaving one of them holding a
      // deceptively-plausible but wrong stored expression.
      target.bindings[key] = this.loopVarStack.length > 0 ? captureLoopVariables(prop.value, new Map(this.loopVarStack)) : prop.value;
    }
  }

  interpretObjectDecl(decl, env, parentName) {
    const type = decl.objectType;

    let name = null;
    if (decl.nameIsExpr) {
      const evaluated = evaluate(decl.name, env);
      if (typeof evaluated !== "string") {
        throw new AxisRuntimeError(`an element's name must evaluate to a string, got a ${typeName(evaluated)}`, decl.line);
      }
      name = evaluated;
    } else if (decl.name) {
      name = decl.name;
    }

    if (!name) throw new AxisRuntimeError(`'${type}' needs a name, e.g. '${type} thing { ... }'`, decl.line);

    if (type in DOM_CONTAINER_TAGS) {
      const container = { type, name, parent: parentName };
      for (const prop of decl.properties) this.applyProperty(container, prop, env, type);
      this.validateScrollRoot(container, parentName, decl.line);
      this.register(container, decl.line);
      const childEnv = env.child();
      this.runStatements(decl.children, childEnv, container.name); // container.name, not the pre-registration local `name` - it may have been namespaced by register()
      return;
    }

    const leafConfig = domLeafConfig(type);
    if (!leafConfig) {
      throw new AxisRuntimeError(
        `unknown element type '${type}'${suggest(type, [...Object.keys(DOM_CONTAINER_TAGS), ...Object.keys(DOM_LEAF_TYPES), ...registeredElementTypes().keys(), ...this.components.keys()])}`,
        decl.line
      );
    }
    if (decl.children.length > 0) {
      throw new AxisRuntimeError(`'${type}' can't contain other declarations - use 'container' if you need to nest things`, decl.line);
    }

    // The properties loop below still wins over any of these - a default
    // is only ever what an ordinary, unconfigured element gets.
    const el = { type, name, parent: parentName, ...leafConfig.defaults };
    for (const prop of decl.properties) this.applyProperty(el, prop, env, type);

    // Embed the referenced scene right here, at page-build time - see
    // docs/architecture/page-scene-fusion.md. Building with a fresh
    // SceneBuilder chained off the same globalEnv every top-level scene
    // uses means a scene means exactly the same thing whether it's run
    // standalone or embedded: same rules, same error messages, and any
    // top-level `let`/`fn` the file declares is visible to it either way.
    if (type === "viewport") {
      if (typeof el.scene !== "string" || el.scene.trim() === "") {
        throw new AxisRuntimeError(`'viewport' needs a 'scene' property naming a scene to embed, e.g. 'scene: "Earth"'`, decl.line);
      }
      const sceneDecl = this.sceneDecls.get(el.scene);
      if (!sceneDecl) {
        throw new AxisRuntimeError(
          `can't embed '${el.scene}' in a viewport - no scene with that name in this file${suggest(el.scene, [...this.sceneDecls.keys()])}`,
          decl.line
        );
      }
      el.sceneGraph = new SceneBuilder(el.scene, this.components, this.globalEnv).build(sceneDecl, this.globalEnv);

      // `scrollTimeline: "intro"` - the embedded scene's own `intro`
      // timeline (see interpretTimelineDecl) stops auto-playing on load and
      // instead tracks this viewport's own scroll position (see
      // renderer/domClient.js). Validated against the scene we just built,
      // the same "did you mean" treatment an `animate`/`on` target gets.
      if (el.scrollTimeline !== undefined) {
        const timelineNames = el.sceneGraph.timelines.map((t) => t.name);
        if (!timelineNames.includes(el.scrollTimeline)) {
          throw new AxisRuntimeError(
            `'scrollTimeline' names '${el.scrollTimeline}' - no timeline with that name in scene '${el.scene}'${suggest(el.scrollTimeline, timelineNames)}`,
            decl.line
          );
        }
      }

      // `scrollProgress: "amount"` - the data half of scroll (see
      // `scrollTimeline`, above, the animation half): this viewport's own
      // scroll progress (0-1) is written, live, into the embedded scene's
      // own `amount` variable, through the scene's ordinary reactive-state
      // machinery (renderer/scene3d.js's setState) - so a shape/material
      // property that reads `amount` re-renders on scroll the same way it
      // would after any `on` handler changed it. Validated against the
      // scene we just built, same as `scrollTimeline` just above.
      if (el.scrollProgress !== undefined) {
        const names = Object.keys(el.sceneGraph.variables);
        if (!names.includes(el.scrollProgress)) {
          throw new AxisRuntimeError(
            `'scrollProgress' names '${el.scrollProgress}' - no state/let with that name in scene '${el.scene}'${suggest(el.scrollProgress, names)}`,
            decl.line
          );
        }
      }
    }

    this.validateScrollRoot(el, parentName, decl.line);
    this.register(el, decl.line);
  }

  // Shared by both interpretObjectDecl branches above (a container and a
  // leaf element register very differently, but `scrollRoot`'s own
  // validation - does this name an actual ancestor - doesn't care which).
  // Must run *before* `register()`: `parentName` is already the caller's
  // own fully-resolved (possibly namespaced) name, but this element's own
  // hasn't been registered yet, which is exactly right - it can't be its
  // own `scrollRoot` either.
  validateScrollRoot(target, parentName, line) {
    if (target.scrollRoot === undefined) return;
    const resolved = this.namePrefix + target.scrollRoot;
    if (!isAncestorName(this.objectsByName, parentName, resolved)) {
      throw new AxisRuntimeError(
        `'scrollRoot' names '${target.scrollRoot}' - that's not an ancestor of '${target.name}'${suggest(target.scrollRoot, this.localNameCandidates())}`,
        line
      );
    }
  }

  buildAnimateBlock(decl, env, { allowAt = false } = {}) {
    const bareTarget = this.resolveTarget(decl, env, "'animate'");
    const target = this.namePrefix + bareTarget;
    if (!this.objectsByName.has(target)) {
      throw new AxisRuntimeError(
        `can't animate '${bareTarget}' - no object with that name in page '${this.name}'${suggest(bareTarget, this.localNameCandidates())}`,
        decl.line
      );
    }
    const animation = this.buildAnimateEntries(decl, env, bareTarget, { allowAt, validateChange: validatePageAnimateChange });
    animation.target = target;
    animation.kind = "dom";
    return animation;
  }

  interpretAnimateDecl(decl, env) {
    this.animations.push(this.buildAnimateBlock(decl, env));
  }

  // `timeline NAME { ... }` inside a page - the domain-agnostic walking
  // (label/`at`/`previous`/stagger) is entirely DeclarativeBuilder's
  // buildTimelineSteps; what's page-specific is how one step gets built
  // (buildTimelineStep, below), which is also where a single timeline gets
  // to choreograph DOM elements *and* a viewport's embedded 3D objects
  // together - not two separately-declared, manually-synchronized
  // timelines.
  interpretTimelineDecl(decl, env) {
    const name = this.namePrefix + decl.name;
    if (this.timelines.some((t) => t.name === name)) {
      throw new AxisRuntimeError(`timeline '${decl.name}' is already defined in page '${this.name}'`, decl.line);
    }
    const { steps, duration, loop } = this.buildTimelineSteps(decl, env, (stmt, stmtEnv) => this.buildTimelineStep(stmt, stmtEnv));
    this.timelines.push({ name, steps, duration, loop });
  }

  // One step inside a page-level `timeline`. A bare (non-dotted) target is
  // a page element - built/validated exactly like a top-level `animate`
  // already is (buildAnimateBlock), just with `at` allowed. A dotted
  // target - `animate ("stage.centerpiece") { ... }`, always written as a
  // computed (parenthesized, quoted) target since AXIS's ordinary bare-name
  // grammar has no dotted target syntax - reaches into a `viewport`
  // element's own embedded scene: `stage` must name a `viewport` declared
  // in this page, `centerpiece` an object that scene actually has
  // (checked against the SceneBuilder.build() result already sitting on
  // that viewport's own `sceneGraph` from when the viewport itself was
  // interpreted - see interpretObjectDecl's viewport branch). That step's
  // own property paths/value types follow the *scene's* rules
  // (validateSceneAnimateChange) - it's genuinely animating a 3D object,
  // just referenced from a page-level timeline.
  buildTimelineStep(decl, env) {
    const bareTarget = this.resolveTarget(decl, env, "'animate'");
    const dotIndex = bareTarget.indexOf(".");

    if (dotIndex === -1) {
      return this.buildAnimateBlock(decl, env, { allowAt: true });
    }

    if (bareTarget.indexOf(".", dotIndex + 1) !== -1) {
      throw new AxisRuntimeError(`can't animate '${bareTarget}' - a cross-scene timeline target is 'viewportName.objectName', with exactly one '.'`, decl.line);
    }

    const viewportName = bareTarget.slice(0, dotIndex);
    const objectName = bareTarget.slice(dotIndex + 1);
    const viewportTarget = this.namePrefix + viewportName;
    const viewportObj = this.objectsByName.get(viewportTarget);
    if (!viewportObj || viewportObj.type !== "viewport") {
      const viewportNames = this.localNameCandidates().filter((n) => this.objectsByName.get(this.namePrefix + n)?.type === "viewport");
      throw new AxisRuntimeError(
        `can't animate '${bareTarget}' - '${viewportName}' isn't a viewport in page '${this.name}'${suggest(viewportName, viewportNames)}`,
        decl.line
      );
    }
    if (!viewportObj.sceneGraph.objectsByName.has(objectName)) {
      throw new AxisRuntimeError(
        `can't animate '${bareTarget}' - no object named '${objectName}' in the scene viewport '${viewportName}' embeds${suggest(objectName, [...viewportObj.sceneGraph.objectsByName.keys()])}`,
        decl.line
      );
    }

    const step = this.buildAnimateEntries(decl, env, bareTarget, { allowAt: true, validateChange: validateSceneAnimateChange });
    step.kind = "scene";
    step.target = bareTarget;
    step.viewportName = viewportTarget;
    step.sceneTargetName = objectName;
    return step;
  }

  interpretStateDecl(decl, env) {
    const value = evaluate(decl.value, env);
    env.define(decl.name, value, false);
    this.reactiveNames.add(decl.name);
  }

  build(pageDecl, globalEnv) {
    const pageEnv = globalEnv.child();
    this.runStatements(pageDecl.body, pageEnv, null);
    this.captureVariables(pageEnv, pageDecl.body);
    return {
      title: this.name,
      nodes: this.objects,
      animations: this.animations,
      timelines: this.timelines,
      handlers: this.handlers,
      variables: this.variables,
      reactiveBlocks: this.reactiveBlocks,
    };
  }
}

export function interpret(program) {
  const globalEnv = createGlobalEnv();
  const functions = [];
  const components = new Map(); // name -> {params, body, sourceFile}
  const sceneDecls = new Map(); // name -> SceneDecl AST - collected up front so a page's `viewport` can embed a scene declared anywhere in the file, not just earlier
  const scenes = [];
  const pages = [];
  const sceneNames = new Set();
  const pageTitles = new Set();
  // `route`/`redirect` reference a page by name, which might be declared
  // later in the file than the route itself (same "collect names up front"
  // reasoning as sceneDecls, above, for a page's own `viewport`) - so these
  // are just collected here, and validated once every page actually exists,
  // after the second loop below has built them all.
  const routes = [];
  const redirects = [];

  for (const item of program.items) {
    if (item.kind === "FnDecl") {
      if (globalEnv.vars.has(item.name)) throw new AxisRuntimeError(`'${item.name}' is already defined`, item.line);
      globalEnv.define(item.name, { __axisType: "function", name: item.name, params: item.params, body: item.body, closure: globalEnv, isAsync: item.isAsync });
      functions.push({ name: item.name, params: item.params, body: item.body, isAsync: item.isAsync });
    } else if (item.kind === "ComponentDecl") {
      if (components.has(item.name)) throw new AxisRuntimeError(`component '${item.name}' is already defined`, item.line);
      components.set(item.name, { params: item.params, body: item.body, sourceFile: item.sourceFile });
    } else if (item.kind === "SceneDecl") {
      sceneDecls.set(item.name, item);
    } else if (item.kind === "RouteDecl") {
      routes.push({ pattern: item.pattern, pageName: item.pageName, line: item.line });
    } else if (item.kind === "RedirectDecl") {
      redirects.push({ from: item.from, to: item.to, line: item.line });
    }
  }

  // Top-level `let`/`state` - name -> {value, constant, reactive}. This is
  // the ONE explicit mechanism a scene and a page (or several viewports)
  // share a live value through: every one of them builds its own env as a
  // *child* of the same `globalEnv` these are defined on, and
  // Environment.set() (evaluator.js) mutates a name where it's actually
  // defined, not a local shadow - so as long as the browser runtime defines
  // these once, on the one shared ancestor env every domain's own env
  // chains from (see client.js/domClient.js/scene3d.js), an assignment in
  // any one domain's handler is immediately visible to every other's next
  // binding re-evaluation. See docs/architecture/reactive-state.md.
  const sharedVariables = {};

  // `params`/`query` - implicit reactive state, exactly like a `state`
  // declaration a developer wrote themselves, except the router (not page
  // source) owns writing to them. Seeded here, before any scene/page is
  // built below, with an empty record placeholder so a property expression
  // that reads `params.id` resolves at build time the same way `state
  // count = 0` always has - to *a* value, later overridden client-side once
  // the router matches an actual route (see domRouter.js's own call into
  // createPageRuntime's `inputs`, which reuses this exact seeding/update
  // mechanism, no new one). Only exists at all when this file declares at
  // least one `route` - a non-routed program's `globalEnv` is completely
  // unaffected, so `params`/`query` stay "undefined variable" errors there,
  // same as any other name nothing defined. See docs/architecture/routing.md.
  if (routes.length > 0) {
    // `params`'s dynamic segment names (":id" in "/projects/:id") ARE known
    // statically, across every route this file declares - unlike `query`
    // (any key can show up in a query string, never enumerable ahead of
    // time), so its build-time placeholder is seeded with each one, set to
    // "" - a property binding that reads `params.id` directly resolves
    // cleanly at build time (to "", later overridden with the real matched
    // value client-side) instead of "record doesn't have a '.id' field".
    // `query` has no such static shape to seed - see the new `get(record,
    // key, fallback)` stdlib function (globals.js) for the general way to
    // read a field that might not be there, which covers `query` and any
    // other not-yet-known-shape record (an API response, ...) alike.
    const dynamicParamNames = new Set();
    for (const route of routes) {
      for (const seg of route.pattern.split("/")) {
        if (seg.startsWith(":") && seg.length > 1) dynamicParamNames.add(seg.slice(1));
      }
    }
    const paramsValue = { __axisType: "record" };
    for (const name of dynamicParamNames) paramsValue[name] = "";
    globalEnv.define("params", paramsValue, false);
    sharedVariables.params = { value: paramsValue, constant: false, reactive: true };

    const queryValue = { __axisType: "record" };
    globalEnv.define("query", queryValue, false);
    sharedVariables.query = { value: queryValue, constant: false, reactive: true };
  }

  for (const item of program.items) {
    if (item.kind === "FnDecl" || item.kind === "ComponentDecl" || item.kind === "RouteDecl" || item.kind === "RedirectDecl") continue;

    if (item.kind === "LetDecl") {
      const value = evaluate(item.value, globalEnv);
      globalEnv.define(item.name, value, item.constant);
      sharedVariables[item.name] = { value, constant: item.constant, reactive: false };
      // See containsFunction's own comment (evaluator.js): a "data with
      // behavior" record can't survive the JSON transport a browser
      // runtime's `value` goes through - shipping the initializer
      // expression too lets scene3d.js/pageRuntime.js re-evaluate it
      // fresh, client-side, instead of trusting the (silently broken)
      // precomputed value.
      if (containsFunction(value)) sharedVariables[item.name].initializer = item.value;
      continue;
    }

    if (item.kind === "StateDecl") {
      const value = evaluate(item.value, globalEnv);
      globalEnv.define(item.name, value, false);
      sharedVariables[item.name] = { value, constant: false, reactive: true };
      if (containsFunction(value)) sharedVariables[item.name].initializer = item.value;
      continue;
    }

    if (item.kind === "SceneDecl") {
      if (sceneNames.has(item.name)) throw new AxisRuntimeError(`scene '${item.name}' is defined more than once`, item.line);
      sceneNames.add(item.name);
      scenes.push(new SceneBuilder(item.name, components, globalEnv).build(item, globalEnv));
      continue;
    }

    if (item.kind === "PageDecl") {
      if (pageTitles.has(item.title)) throw new AxisRuntimeError(`page '${item.title}' is defined more than once`, item.line);
      pageTitles.add(item.title);
      pages.push(new PageBuilder(item.title, components, globalEnv, sceneDecls).build(item, globalEnv));
      continue;
    }
  }

  // A `route`'s page reference is validated here, once every page actually
  // exists (not in the collection loop above, which runs before any page
  // has been built) - a name that doesn't match any declared page's own
  // title is a clear error, with a suggestion, rather than a route that
  // silently never matches. `pageTitles` already holds every page's title;
  // no distinction is made here between a page declared with a string
  // title (`page "My Site" { ... }`, which `route` can never reference -
  // there's no valid identifier token for it) and one that just isn't
  // declared at all - both fail the same lookup.
  const pageTitleList = [...pageTitles];
  for (const route of routes) {
    if (!pageTitles.has(route.pageName)) {
      throw new AxisRuntimeError(
        `route '${route.pattern}' references page '${route.pageName}', but no such page is declared${suggest(route.pageName, pageTitleList)}`,
        route.line
      );
    }
  }
  if (routes.length > 0) {
    const seen = new Set();
    for (const route of routes) {
      if (seen.has(route.pattern)) throw new AxisRuntimeError(`route '${route.pattern}' is declared more than once`, route.line);
      seen.add(route.pattern);
    }
  }

  // Exposed alongside everything else a page needs - a reactive block's
  // client-side rebuild (domClient.js) needs to be able to instantiate a
  // `component` the same way build time did, and the component registry
  // is otherwise private to this function (closed over by every
  // SceneBuilder/PageBuilder instance above, never returned on its own).
  const componentsForClient = [...components].map(([name, c]) => ({ name, params: c.params, body: c.body }));

  return {
    scenes,
    pages,
    functions,
    sharedVariables,
    components: componentsForClient,
    routes: routes.map(({ pattern, pageName }) => ({ pattern, pageName })),
    redirects: redirects.map(({ from, to }) => ({ from, to })),
    // Every imported package's own `runtimeExtension`, if it declared one -
    // pure passthrough from resolveModules (modules.js); interpret() itself
    // never reads or executes any of them (see docs/runtime-extensions.md) -
    // just carries the list forward so plan.js/html.js/server.js can serve
    // and load them. `program.extensions` is only set when interpret() was
    // reached via resolveModules (a real file with imports) - a bare
    // `interpret(parse(tokenize(source)))` call (most unit tests) has no
    // such thing, hence the fallback.
    extensions: program.extensions ?? [],
  };
}
