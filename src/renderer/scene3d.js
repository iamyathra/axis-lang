// Mounts one AXIS 3D scene plan (the shape renderer/plan.js's
// buildScenePlan produces - camera/nodes/animations/variables/handlers/
// assets) into a given DOM element as a three.js canvas, and wires up its
// `animate`/`on` behavior live, using the shared evaluator. This is the one
// file that actually knows three.js exists, and the one place that logic
// lives - a whole-page `scene` file (client.js) and a `viewport` embedded
// inside a `page` (domClient.js) both call this the same way, so there's
// exactly one 3D runtime, not two copies of it. See
// docs/architecture/page-scene-fusion.md.
//
// The caller owns the requestAnimationFrame loop - a page might mount
// several viewports and still wants exactly one shared loop driving all of
// them plus its own DOM animations - so createSceneRuntime never calls
// requestAnimationFrame itself. Call the returned `tick(now)` once per
// frame instead.

import * as THREE from "/vendor/three.module.js";
import { evaluate, executeBlock, executeBlockAsync, typeName, literalUnit, parseAnimateTiming, resolveAnimateTarget, AxisRuntimeError, deepEqual } from "/evaluator.js";
import { assetUrl } from "/assetPath.js";
import { stepAnimation, applyTimelineAtElapsed, tickTimeline, startTimelineState, restartTimeline, pauseTimeline, resumeTimeline, reverseTimeline } from "/tween.js";
import { registeredScalarProperties } from "/extensionRegistry.js";

// One entry per built-in shape type - "add a new shape" is one entry here,
// not a new `case` to remember. Falls back to a cube for an unrecognized
// type (interpreter.js already refuses an unknown object type at build
// time - this default only matters for a render plan built some other,
// non-`axis check`-validated way).
const SHAPE_GEOMETRIES = {
  cube: () => new THREE.BoxGeometry(1, 1, 1),
  sphere: () => new THREE.SphereGeometry(0.6, 32, 16),
  plane: () => new THREE.PlaneGeometry(5, 5),
  cylinder: () => new THREE.CylinderGeometry(0.5, 0.5, 1.2, 24),
};

function geometryFor(type) {
  return (SHAPE_GEOMETRIES[type] ?? SHAPE_GEOMETRIES.cube)();
}

// A directional light's shadow camera is an orthographic box, not a frustum
// - three.js has no way to size it automatically, so it needs *some*
// explicit bounds. These cover a normal-sized AXIS scene (a handful of units
// around the origin, matching where a scene's own objects and default
// camera actually sit) without a developer ever having to think about
// shadow-camera math - `shadows: true` is meant to be the whole API.
const SHADOW_MAP_SIZE = 1024;
const DIRECTIONAL_SHADOW_EXTENT = 12;

function configureShadowCasting(light, mapSize = SHADOW_MAP_SIZE) {
  light.castShadow = true;
  light.shadow.mapSize.set(mapSize, mapSize);
  light.shadow.bias = -0.0025;
}

// One entry per built-in light type - "add a new light type" is one entry
// here, not another `if (node.type === "...")` line to append.
const LIGHT_BUILDERS = {
  ambientLight: (node) => new THREE.AmbientLight(node.color, node.intensity),
  hemisphereLight: (node) => new THREE.HemisphereLight(node.color, node.groundColor, node.intensity),
  directionalLight: (node) => {
    const light = new THREE.DirectionalLight(node.color, node.intensity);
    light.position.set(-node.direction[0], -node.direction[1], -node.direction[2]);
    if (node.shadows) {
      configureShadowCasting(light);
      const d = DIRECTIONAL_SHADOW_EXTENT;
      Object.assign(light.shadow.camera, { left: -d, right: d, top: d, bottom: -d, near: 0.5, far: 60 });
    }
    return light;
  },
  pointLight: (node) => {
    const light = new THREE.PointLight(node.color, node.intensity);
    light.position.set(...node.position);
    return light;
  },
  spotLight: (node) => {
    const light = new THREE.SpotLight(node.color, node.intensity, 0, node.angle, node.penumbra);
    light.position.set(...node.position);
    light.target.position.set(...node.target);
    if (node.shadows) configureShadowCasting(light);
    return light;
  },
};

function makeLight(node) {
  return LIGHT_BUILDERS[node.type]?.(node) ?? null;
}

// AXIS's material properties, translated onto a real three.js material.
// Shared by materialOptionsFor (a shape's own material, built fresh) and
// applyMaterialOverrides/MaterialHandle (a loaded model's materials, which
// already exist and must be mutated in place, not replaced - see the note
// on `model` in interpreter.js). The `in mat` guards mean a material type
// that doesn't have a given field (e.g. a glTF file using
// MeshBasicMaterial, which has no `metalness`/`roughness`) is silently
// skipped for that one field instead of erroring - AXIS overlays what it
// can onto whatever the file actually gave it.
// `applyMap` (optional): the one runtime-scoped operation among these
// fields - see createSceneRuntime's own applyMap, which is what every real
// call site actually passes. Undefined only for a caller that's certain
// `field` can never be "map" (there is none today - every call site below
// threads it through) - guarded rather than required so this function's own
// shape doesn't have to assume who's calling it.
function applyMaterialField(mat, field, value, applyMap) {
  switch (field) {
    case "color":
      if (mat.color) mat.color.set(value);
      break;
    case "emissive":
      if (mat.emissive) mat.emissive.set(value);
      break;
    case "opacity":
      if ("opacity" in mat) {
        mat.opacity = value;
        mat.transparent = value < 1;
      }
      break;
    case "map":
      if ("map" in mat && applyMap) applyMap(mat, value);
      break;
    default:
      if (field in mat) mat[field] = value;
  }
}

// Every real three.js Material belonging to an Object3D subtree - a shape's
// single Mesh, or every mesh/submesh inside a loaded `model`. THREE's own
// `.traverse` visits the root itself too, so this works unchanged whether
// `root` is a Mesh or a Group.
function collectMaterials(root) {
  const materials = [];
  root.traverse((child) => {
    if (!child.isMesh || !child.material) return;
    if (Array.isArray(child.material)) materials.push(...child.material);
    else materials.push(child.material);
  });
  return materials;
}

function applyMaterialOverrides(root, materialProps, applyMap) {
  if (!materialProps) return;
  const materials = collectMaterials(root);
  for (const [field, value] of Object.entries(materialProps)) {
    for (const mat of materials) applyMaterialField(mat, field, value, applyMap);
  }
}

// `box.material.metalness = 0.1` (an `on` handler) or `material.roughness:
// someState` (a reactive binding, applied through this same setter by
// reRender below) - one live handle per LiveObject, re-collecting the
// underlying material(s) on every write rather than caching them, since a
// `model`'s materials don't exist until its glTF finishes loading.
class MaterialHandle {
  constructor(root, applyMap) {
    this._root = root;
    this._applyMap = applyMap;
  }
  _materials() {
    return collectMaterials(this._root);
  }
  _get(field) {
    const mat = this._materials()[0];
    if (!mat) return null;
    if (field === "color" || field === "emissive") return mat[field] ? `#${mat[field].getHexString()}` : null;
    if (field === "map") return mat.map?.userData?.axisSrc ?? null;
    return field in mat ? mat[field] : null;
  }
  _set(field, value) {
    for (const mat of this._materials()) applyMaterialField(mat, field, value, this._applyMap);
  }
  get color() { return this._get("color"); }
  set color(v) { this._set("color", v); }
  get metalness() { return this._get("metalness"); }
  set metalness(v) { this._set("metalness", v); }
  get roughness() { return this._get("roughness"); }
  set roughness(v) { this._set("roughness", v); }
  get opacity() { return this._get("opacity"); }
  set opacity(v) { this._set("opacity", v); }
  get emissive() { return this._get("emissive"); }
  set emissive(v) { this._set("emissive", v); }
  get emissiveIntensity() { return this._get("emissiveIntensity"); }
  set emissiveIntensity(v) { this._set("emissiveIntensity", v); }
  get map() { return this._get("map"); }
  set map(v) { this._set("map", v); }
}

// A shape's own starting MeshStandardMaterial - `node.material` (the
// `material.*` properties actually set in the .ax source) laid on top of
// `node.color` (the plain `color` property every shape's had since v1),
// same overlay idea applyMaterialOverrides uses for a loaded model's
// materials, just building a fresh material instead of mutating an existing
// one.
// `m.map` is deliberately NOT read here - a texture loads asynchronously
// (see createSceneRuntime's own applyMap), so it can't be part of a
// material's synchronous constructor options the way every other field
// here can; the node-building loop kicks off its load right after creating
// the mesh instead, the exact same "placeholder now, filled in once the
// fetch resolves" shape `model` loading already has.
function materialOptionsFor(node) {
  const opts = { color: node.color };
  const m = node.material ?? {};
  if (m.color !== undefined) opts.color = m.color;
  if (m.metalness !== undefined) opts.metalness = m.metalness;
  if (m.roughness !== undefined) opts.roughness = m.roughness;
  if (m.opacity !== undefined) {
    opts.opacity = m.opacity;
    opts.transparent = m.opacity < 1;
  }
  if (m.emissive !== undefined) opts.emissive = new THREE.Color(m.emissive);
  if (m.emissiveIntensity !== undefined) opts.emissiveIntensity = m.emissiveIntensity;
  return opts;
}

class DegreesEuler {
  constructor(euler) {
    this._euler = euler;
  }
  get x() { return (this._euler.x * 180) / Math.PI; }
  set x(deg) { this._euler.x = (deg * Math.PI) / 180; }
  get y() { return (this._euler.y * 180) / Math.PI; }
  set y(deg) { this._euler.y = (deg * Math.PI) / 180; }
  get z() { return (this._euler.z * 180) / Math.PI; }
  set z(deg) { this._euler.z = (deg * Math.PI) / 180; }
}

// One entry per single-token scalar property (a light's `color`/
// `intensity`, a camera's `fov`/`near`/`far`, a hemisphereLight's
// `groundColor`, `environment`'s own `background`) - "add a new built-in
// scalar property" means one entry here, not four separate edits (this
// registry didn't exist until this consolidation - the four were
// LiveObject's own getter/setter below, applyChange's per-frame dispatch,
// currentLiveValue's mirror of it for an animation's own starting value,
// and triggerAnimation's "is this a legal animate path" check). All four
// consumers now read this table instead of duplicating the lookup logic;
// see each one's own comment for exactly how.
//
// `get` returns `undefined` when the property doesn't apply to this
// particular object (a shape has no `intensity`, most things have no
// `fov`) - every caller already treats "doesn't apply" as a harmless
// no-op, the same guarded-access idea a plain `"intensity" in obj3d`
// check already was.
//
// `animatable: false` (`groundColor`/`background`) marks a real,
// pre-existing asymmetry this consolidation intentionally preserves, not
// removes: those two are reachable via an `on`-handler direct assignment
// or a reactive `state` binding, but never through `animate`/`timeline` -
// true before this registry existed, and still true now.
//
// Deliberately scoped to *scalar* (single-path-token) properties only -
// `position`/`rotation`/`scale`/`target` (a camera's own look-at point)
// have a fundamentally different shape (a two-token `position.x` path
// for `animate`, plus a whole-vector `position = (x, y, z)` assignment
// for `on` handlers) and are a separate piece of this same consolidation
// still worth doing, not done here - see
// docs/architecture/2026-09-language-platform-audit.md's registry
// addendum for exactly what's left.
//
// This registry is JavaScript, living entirely inside this one browser-
// only file - it is *not* something an AXIS package (pure `.ax` source,
// no way to run JS) can add an entry to. See the same addendum for why
// that's a real, load-bearing limit on what "extensible" can mean here,
// not an oversight.
const SCALAR_PROPERTIES = {
  color: {
    animatable: true,
    valueType: "color",
    // A light's own `color` lives directly on it; a shape's or model's
    // lives on its material(s) - checking both means the same lookup
    // works for either without the caller needing to know which. (The
    // pre-registry `currentLiveValue` only ever checked the material
    // side, silently missing a light's own `color` - this consolidation
    // corrects that rather than preserving the inconsistency; see
    // tests/lights-animate-color.test.js.)
    get(obj3d) {
      const c = obj3d.color ?? collectMaterials(obj3d)[0]?.color;
      return c ? `#${c.getHexString()}` : undefined;
    },
    set(obj3d, value) {
      if (obj3d.color) obj3d.color.set(value);
      else for (const mat of collectMaterials(obj3d)) applyMaterialField(mat, "color", value);
    },
  },
  // hemisphereLight-only.
  groundColor: {
    animatable: false,
    valueType: "color",
    get(obj3d) {
      return obj3d.groundColor ? `#${obj3d.groundColor.getHexString()}` : undefined;
    },
    set(obj3d, value) {
      if (obj3d.groundColor) obj3d.groundColor.set(value);
    },
  },
  // `environment`-only (a THREE.Scene's own background color).
  background: {
    animatable: false,
    valueType: "color",
    get(obj3d) {
      return obj3d.background ? `#${obj3d.background.getHexString()}` : undefined;
    },
    set(obj3d, value) {
      if (obj3d.background) obj3d.background.set(value);
    },
  },
  // Light-only.
  intensity: {
    animatable: true,
    valueType: "number",
    get(obj3d) {
      return "intensity" in obj3d ? obj3d.intensity : undefined;
    },
    set(obj3d, value) {
      if ("intensity" in obj3d) obj3d.intensity = value;
    },
  },
  // A model's own animation-clip progress - see the `progress` accessor
  // defined on its holder Group in the node-building loop, elsewhere in
  // this file, for where the real work happens.
  progress: {
    animatable: true,
    valueType: "number",
    get(obj3d) {
      return "progress" in obj3d ? obj3d.progress : undefined;
    },
    set(obj3d, value) {
      if ("progress" in obj3d) obj3d.progress = value;
    },
  },
  // Concrete proof this registry does what it claims (see
  // docs/architecture/2026-09-language-platform-audit.md's registry
  // addendum): `castShadow`/`receiveShadow` were a real, documented,
  // pre-existing gap - set once at mount time (see the node-building
  // loop, elsewhere in this file) but with no live setter at all, so an
  // `on`-handler couldn't toggle either and no `state` binding could
  // drive them. Adding these two entries is the *entire* change needed
  // to close that gap - LiveObject's own getter/setter (generated from
  // this table, just below the class) and BINDABLE_KEYS (derived from
  // `Object.keys(SCALAR_PROPERTIES)`, further down) both pick them up
  // automatically, with no separate edit to either. `animatable: false`
  // because tweening a boolean between two states isn't a meaningful
  // `animate` target - `on box.click { box.castShadow = false }` (or a
  // `state`-bound `castShadow: someBooleanState`) is what this is for.
  castShadow: {
    animatable: false,
    valueType: "boolean",
    get(obj3d) {
      return "castShadow" in obj3d ? obj3d.castShadow : undefined;
    },
    set(obj3d, value) {
      if ("castShadow" in obj3d) obj3d.castShadow = value;
    },
  },
  receiveShadow: {
    animatable: false,
    valueType: "boolean",
    get(obj3d) {
      return "receiveShadow" in obj3d ? obj3d.receiveShadow : undefined;
    },
    set(obj3d, value) {
      if ("receiveShadow" in obj3d) obj3d.receiveShadow = value;
    },
  },
};
// Camera-only scalars, same registry shape - three.js needs
// `updateProjectionMatrix()` called after any of these change, or the new
// value is stored but never actually reflected in what's rendered.
for (const key of ["fov", "near", "far"]) {
  SCALAR_PROPERTIES[key] = {
    animatable: true,
    valueType: "number",
    get(obj3d) {
      return key in obj3d ? obj3d[key] : undefined;
    },
    set(obj3d, value) {
      if (key in obj3d) {
        obj3d[key] = value;
        obj3d.updateProjectionMatrix();
      }
    },
  };
}

// Wraps a real three.js Object3D so `box.color = red` and `box.position.x =
// 5` in an `on` handler mutate the actual object, not a disconnected copy.
// Works for any spatial node - a shape's Mesh, a `group`'s Group, or a
// `model`'s holder Group - so all three are equally live-bindable and
// `state`-reactive scene citizens; `color` is simply a no-op read/write for
// whichever of those don't carry a single material (a group or a model have
// no color of their own - whatever the file's/children's own materials say
// wins).
class LiveObject {
  constructor(mesh, applyMap) {
    this.mesh = mesh;
    this._rotation = new DegreesEuler(mesh.rotation);
    this._material = new MaterialHandle(mesh, applyMap);
  }
  get position() { return this.mesh.position; }
  set position(v) { this.mesh.position.set(v.x, v.y, v.z); }
  get scale() { return this.mesh.scale; }
  set scale(v) { this.mesh.scale.set(v.x, v.y, v.z); }
  get rotation() { return this._rotation; }
  set rotation(v) { this.mesh.rotation.set((v.x * Math.PI) / 180, (v.y * Math.PI) / 180, (v.z * Math.PI) / 180); }
  // color/intensity/groundColor/fov/near/far all delegate to
  // SCALAR_PROPERTIES (above) - the exact same lookup applyChange/
  // currentLiveValue/triggerAnimation now share, so there's one place
  // that knows how each of these actually reads/writes, not four.
  // `?? null` at each getter preserves this class's own long-standing
  // "missing means null" contract (the registry's own `get` returns
  // `undefined` for "doesn't apply," matching the other three callers'
  // convention instead).
  // `box.material.metalness = 0.1` (an `on` handler) or a `material.*`
  // reactive binding (reRender, below) - one MaterialHandle per LiveObject,
  // covering every mesh under this node (one, for a shape; every submesh a
  // loaded `model` has, once it's loaded) so a multi-mesh Blender export
  // gets one coherent write instead of needing one per submesh.
  get material() { return this._material; }
  // A camera's own `.target` (below) is a plain Vector3; a light's native
  // `.target` (SpotLight) is a whole Object3D whose own `.position` is what
  // actually needs reading/writing - same shape distinction applyChange's
  // own two-token dispatch already makes, above.
  get target() {
    const t = this.mesh.target;
    return t ? (t.isObject3D ? t.position : t) : null;
  }
  set target(v) {
    const t = this.mesh.target;
    if (!t) return;
    (t.isObject3D ? t.position : t).set(v.x, v.y, v.z);
  }
}

// Merges the built-in table above with whatever a runtime extension
// registered (extensionRegistry.js - see docs/runtime-extensions.md) into
// ONE lookup every caller below (LiveObject's own accessors, applyChange,
// currentLiveValue, triggerAnimation) shares - the same "one authoritative
// registry" principle SCALAR_PROPERTIES itself already follows, extended
// to cover an externally-registered entry exactly the same way as a
// built-in one, not a second, parallel dispatch path. Computed once,
// lazily, and cached - registerScalarProperty is only ever called from an
// extension's own top-level script code (a one-time, page-load-time
// event, never mid-session - see registerScalarProperty's own "already
// registered" guard), so nothing after the first call needs to see a
// change; recomputing this on every applyChange (a per-frame call, for an
// active `animate`) would be wasted work for state that's already settled
// by the time any scene actually mounts.
let mergedScalarProperties = null;
function allScalarProperties() {
  mergedScalarProperties ??= new Map([...Object.entries(SCALAR_PROPERTIES), ...registeredScalarProperties()]);
  return mergedScalarProperties;
}

// Every merged-table entry gets a matching `on`-handler-facing getter/
// setter on LiveObject, generated from the table instead of hand-written -
// so registering a new scalar property (one call to registerScalarProperty,
// or one built-in SCALAR_PROPERTIES entry) is genuinely enough on its own
// to make it live-bindable *and* directly `on`-handler-settable, with no
// second, separate edit needed here. `?? null` preserves this class's own
// long-standing "missing means null" contract (the registry's own `get`
// returns `undefined` for "doesn't apply," matching applyChange/
// currentLiveValue/triggerAnimation's own convention instead).
//
// Deferred (called from createSceneRuntime, not run at this module's own
// top level like the built-in-only version of this loop used to be) and
// guarded to run at most once: an extension's own registerScalarProperty
// call needs to have already happened by the time this reads the merged
// table, which is only guaranteed once every earlier <script type="module">
// on the page (html.js places every extension's own script tag before
// /client.js's) has finished running - true by the time createSceneRuntime
// is first called (the async top-level statement inside client.js, itself
// the LAST sibling module script - see docs/runtime-extensions.md), but
// NOT true at this file's own top-level evaluation time, which can happen
// earlier. Guarded (not just idempotent) because Object.defineProperty on
// an already-defined, non-configurable property throws - and
// createSceneRuntime can genuinely run more than once on one page (a page
// embedding several `viewport`s, each mounting its own scene runtime -
// see docs/architecture/page-scene-fusion.md).
let scalarPropertyAccessorsInstalled = false;
function ensureScalarPropertyAccessorsInstalled() {
  if (scalarPropertyAccessorsInstalled) return;
  scalarPropertyAccessorsInstalled = true;
  for (const [key, prop] of allScalarProperties()) {
    Object.defineProperty(LiveObject.prototype, key, {
      get() {
        return prop.get(this.mesh) ?? null;
      },
      set(v) {
        prop.set(this.mesh, v);
      },
    });
  }
}

// The `on`-handler-facing wrapper for `environment` - deliberately NOT a
// LiveObject (which assumes a single spatial node with a meaningful
// position/rotation/scale/material of its own): `environment` stands for
// the whole `scene`, and `scene.position`/`.rotation`/`.scale` do exist
// (THREE.Scene is an Object3D) but moving/rotating/scaling an entire scene
// via `environment.position = ...` isn't a real AXIS concept - LiveObject
// would silently allow it anyway, since it never checks whether `mesh` is
// the kind of thing those actually mean something for. This only exposes
// what `environment` is actually for.
class EnvironmentHandle {
  constructor(scene) {
    this._scene = scene;
  }
  get background() { return this._scene.background ? `#${this._scene.background.getHexString()}` : null; }
  set background(v) { this._scene.background?.set(v); }
}

// The clean abstraction between the browser's Pointer Lock API and AXIS
// script (game-foundation phase, item 9 of the post-milestone directive:
// "the game should not directly manipulate browser APIs if AXIS can
// provide a clean abstraction"). Deliberately polled, not event-based -
// `pointerLock.isLocked` read from an `on tick` handler (which already
// runs every frame) tells a scene everything `pointerlockchange`/
// `pointerlockerror` would, one frame later at most, with zero new `on`
// event vocabulary or parser/interpreter changes needed (per item 12:
// "use the lowest-level mechanism necessary"). `request()` needs a real
// user gesture (a click) to succeed, same as the browser API itself - AXIS
// doesn't add a permission model on top, it just gives the call a name;
// a rejected/failed request simply leaves `isLocked` false, which a
// scene already has to handle regardless (the user can always press
// Escape to unlock, which is entirely the browser's own doing - nothing
// here needs to detect that specially). `dx`/`dy` from `on mousemove`
// keep meaning the same thing, locked or not (see docs/language.md's
// Mouse input section) - lock only stops the OS cursor from hitting the
// screen edge and clamping further movement, it doesn't change the event
// shape at all.
class PointerLockHandle {
  constructor(domElement) {
    this._el = domElement;
  }
  get isLocked() {
    return document.pointerLockElement === this._el;
  }
  request = (args, line) => {
    this._el.requestPointerLock?.();
    return null;
  };
  exit = (args, line) => {
    if (this.isLocked) document.exitPointerLock?.();
    return null;
  };
}

// A general, camera-centered raycast query - the FPS Flagship Proof
// milestone's own one genuine runtime-level primitive (docs/fps-proof.md
// has the full justification), the same category of addition pointerLock
// was: something no `.ax` package could build on top of existing
// primitives, since it needs three.js's own Raycaster and a live camera
// transform. Deliberately NOT FPS-specific - "what's under the crosshair"
// is exactly as useful for object selection in a first-person viewer, an
// aiming reticle in any genre, or a line-of-sight check in a simulation,
// as it is for a shooter's own "what did I hit." AXIS's existing click/
// hover raycasting (below, in createSceneRuntime) is mouse-position-
// driven and only considers objects with an `on click`/`hover` handler
// declared - deliberately different from this: `raycast.fromCamera()`
// always casts from the viewport's own center (the one meaningful
// "aim point" once the pointer is locked, when the OS cursor's own
// position is no longer meaningful) and considers every named object in
// the scene, handler or not - a `.ax` script decides what a hit *means*,
// this primitive only answers "what's there."
class RaycastHandle {
  constructor(camera, object3Ds, renderer) {
    this._camera = camera;
    this._object3Ds = object3Ds;
    this._renderer = renderer;
    this._raycaster = new THREE.Raycaster();
  }
  // Returns `null` (no hit within `maxDistance`, default Infinity - a
  // real range limit is exactly what a weapon's own data should express,
  // not something this primitive hardcodes) or a record `{name,
  // distance}` for the nearest hit - `name` is the object's own AXIS
  // name (`mesh.userData.axisName`, the same tag the click/hover
  // raycaster already relies on), so a `.ax` handler can match it
  // against whatever it cares about with ordinary string comparison, no
  // new value type needed.
  fromCamera = (args, line) => {
    const maxDistance = args.length > 0 ? args[0] : Infinity;
    if (typeof maxDistance !== "number") {
      throw new AxisRuntimeError(`'raycast.fromCamera' expects a number (or no argument), got a ${typeName(maxDistance)}`, line);
    }
    // Matches the click/hover raycaster's own "don't trust a possibly-
    // stale transform between frames" note just below, in
    // createSceneRuntime - this can be called from any `on` handler, not
    // just once per tick.
    this._camera.updateMatrixWorld(true);
    this._raycaster.setFromCamera({ x: 0, y: 0 }, this._camera); // viewport center - the crosshair
    this._raycaster.far = Number.isFinite(maxDistance) ? maxDistance : Infinity;
    const hits = this._raycaster.intersectObjects([...this._object3Ds.values()], true);
    if (hits.length === 0) return null;
    const hit = hits[0];
    const name = hit.object.userData.axisName ?? null;
    if (name === null) return null; // hit something with no AXIS name (shouldn't happen for a named node, but not this primitive's job to assume)
    return { __axisType: "record", name, distance: hit.distance };
  };
}

// "target" (the camera's own look-at point, a plain THREE.Vector3 own
// property - see the camera-construction note below) joins this group for
// the exact same reason plan.js's copy of this Set does: it's just a
// fourth Vector3-shaped thing an object can carry, no special-casing needed
// in applyChange's generic two-token dispatch below.
const ANIMATABLE_GROUPS = new Set(["position", "rotation", "scale", "target"]);
const AXES = new Set(["x", "y", "z"]);

// ---- generalized animated-change application ---------------------------
// Shared by the top-level `animate`/triggered-`animate` scheduler and
// `timeline` playback (below) - both ultimately just walk this same small
// path vocabulary (a transform axis, a material field, a light's own
// color/intensity) against a real three.js object, one frame at a time.

const _scratchColor = new THREE.Color();

// Attaches precomputed THREE.Color instances to a color change once, when
// it's scheduled - not reallocated every frame.
function prepareChanges(changes) {
  return changes.map((c) => (c.color ? { ...c, fromColor: new THREE.Color(c.from), toColor: new THREE.Color(c.to) } : c));
}

function valueAt(change, t) {
  if (change.color) {
    _scratchColor.copy(change.fromColor).lerp(change.toColor, t);
    return `#${_scratchColor.getHexString()}`;
  }
  return change.from + (change.to - change.from) * t;
}

function applyChange(obj3d, change, t) {
  const value = valueAt(change, t);
  const path = change.path;
  if (path.length === 1 && allScalarProperties().has(path[0])) {
    // Not gated by `animatable` - matches this dispatch's own long-
    // standing behavior of applying whatever a `change` object names,
    // regardless of whether `triggerAnimation`'s validation would have
    // let a *new* `animate` statement schedule one for `groundColor`/
    // `background` in the first place (see SCALAR_PROPERTIES' own note).
    allScalarProperties().get(path[0]).set(obj3d, value);
  } else if (path.length === 2 && path[0] === "material") {
    for (const mat of collectMaterials(obj3d)) applyMaterialField(mat, path[1], value);
  } else if (path.length === 2 && ANIMATABLE_GROUPS.has(path[0]) && AXES.has(path[1])) {
    const group = obj3d[path[0]];
    if (!group) return;
    // "target" is the one member of ANIMATABLE_GROUPS that isn't a uniform
    // shape across every object type: a camera's own `.target` (below) is a
    // plain THREE.Vector3, exactly like position/rotation/scale, but a
    // light's native `.target` (SpotLight) is a whole Object3D whose own
    // `.position` is what actually needs the write.
    if (group.isObject3D) group.position[path[1]] = value;
    else group[path[1]] = value;
  }
}

// `container`: the DOM element to mount the canvas into (document.body for
// a whole-page scene, a viewport's own div when embedded).
// `scriptEnv`: an environment already seeded with the file's top-level `fn`
// declarations - this scene's own env is a child of it, the same as a
// page's own env is a *sibling* child of that very same scriptEnv (see
// domClient.js) - so a `let`/`fn` declared at the top of the file is
// visible to both without either domain needing to know the other exists,
// while each domain's own objects/state stay in their own scope.
// `fitToContainer`: false sizes the renderer to the window (a whole-page
// scene, matching the old client.js exactly); true sizes and keeps it in
// sync with the container's own box via ResizeObserver (an embedded
// viewport, so it behaves like any other responsive page element).
// `onStateChange`: called after this scene's own `on` handler runs, in
// addition to this scene re-rendering its own bindings - lets the caller
// (domClient.js) also re-render the page and every *other* mounted
// viewport when this scene's handler mutated a top-level `state` they
// share. See docs/architecture/reactive-state.md.
// One place for both callers (client.js's own standalone-scene page, and
// domClient.js mounting this into a `viewport`) to agree on the same
// reduced-motion snapshot, read once per mounted runtime rather than
// duplicated in each caller.
const REDUCED_MOTION = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export async function createSceneRuntime(scenePlan, { container, scriptEnv, fitToContainer, onStateChange, onInvalidate }) {
  // Safe to do now (not at this module's own top level) - see
  // ensureScalarPropertyAccessorsInstalled's own comment for exactly why
  // the timing here matters.
  ensureScalarPropertyAccessorsInstalled();

  const GLTFLoader = scenePlan.nodes.some((n) => n.type === "model")
    ? (await import("/vendor/jsm/loaders/GLTFLoader.js")).GLTFLoader
    : null;
  const gltfLoader = GLTFLoader ? new GLTFLoader() : null;

  const scene = new THREE.Scene();
  // `environment { background: ... fogColor: ... }` - always present in the
  // plan (plan.js's own defaultEnvironment/buildScenePlan fallback), so
  // this line means exactly the same thing a scene with no `environment`
  // block always rendered as, unchanged. Fog is opt-in by presence, same
  // idea `shadows: true` already follows - a scene that never sets
  // `fogColor` gets no THREE.Fog at all, not one with a meaningless color.
  scene.background = new THREE.Color(scenePlan.environment.background);
  if (scenePlan.environment.fogColor) {
    scene.fog = new THREE.Fog(scenePlan.environment.fogColor, scenePlan.environment.fogNear, scenePlan.environment.fogFar);
  }

  function currentSize() {
    return fitToContainer
      ? { width: container.clientWidth || 1, height: container.clientHeight || 1 }
      : { width: window.innerWidth, height: window.innerHeight };
  }

  const initialSize = currentSize();
  const camera = new THREE.PerspectiveCamera(scenePlan.camera.fov, initialSize.width / initialSize.height, scenePlan.camera.near, scenePlan.camera.far);
  camera.position.set(...scenePlan.camera.position);
  // A plain Vector3 own property, not a three.js built-in (THREE.Camera has
  // no native `.target`) - the camera's own look-at point, animatable/
  // state-bindable/`on`-handler-mutable exactly like position (see
  // ANIMATABLE_GROUPS/applyChange and LiveObject's own target accessor,
  // above). Re-applied via camera.lookAt() every frame something changed
  // (see tick(), below) - three.js has no way to keep a camera aimed at a
  // *moving* point automatically, unlike position/rotation/scale, which the
  // renderer just reads directly every frame.
  camera.target = new THREE.Vector3(...scenePlan.camera.target);
  camera.lookAt(camera.target);

  // a soft fill light so shapes read as 3D even before a scene adds its own
  // lights - real lights the scene declares are added on top of this. Only
  // added when the scene doesn't declare its own `hemisphereLight` (now a
  // real, authorable object type - interpreter.js) - a scene that wants
  // this exact fill just declares one with the same defaults instead of
  // getting a second, redundant hemisphere light it can't see or control.
  if (!scenePlan.nodes.some((n) => n.type === "hemisphereLight")) {
    scene.add(new THREE.HemisphereLight("#ffffff", "#222233", 0.6));
  }

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  // Capped at 2, not the raw devicePixelRatio - a 3x/4x phone display would
  // otherwise ask for 9x/16x the fragment-shading work for a sharpness gain
  // nobody can see past 2x; this is the same cap every major 3D web
  // framework settles on for exactly that reason. Without this at all, every
  // AXIS 3D canvas was rendering at 1x (CSS-pixel) resolution - visibly
  // blurrier than the DOM content around it on any Retina/HiDPI display.
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(initialSize.width, initialSize.height);
  renderer.domElement.style.display = "block";
  if (fitToContainer) {
    // three.js's own setSize already wrote a matching px style below - for
    // an embedded viewport the canvas should track the container's actual
    // CSS box (which can change for reasons that aren't a `resize` event,
    // like the page's own layout shifting), not a fixed pixel size.
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
  }
  container.appendChild(renderer.domElement);

  // Every DOM event listener this runtime itself attaches directly to
  // `renderer.domElement` (the pointer/raycasting listeners, below) is
  // registered with this one signal - dispose() aborts it once, instead of
  // needing to remember each listener/handler pair individually.
  const listenerController = new AbortController();

  // ---- render-on-demand ------------------------------------------------
  // `renderer.render()` (in tick(), below) only actually runs when
  // something in this scene visually changed since the last one - a page
  // with several mounted scenes shouldn't pay a continuous GPU cost for
  // the ones that are just sitting there. `dirty` is the single source of
  // truth for "does this scene need a fresh frame"; `invalidate()` is the
  // one place anything that changes this scene's visual state sets it -
  // every mutation path below (an `on`-handler's reRender, a model
  // finishing its async load, `seekTimeline`/`setState`/
  // `applyChangeToTarget`, resize, orbit-control input) calls it, rather
  // than each one separately deciding whether to reach for
  // `renderer.render()` itself.
  //
  // `onInvalidate` (optional) is how the *caller* (client.js/domClient.js,
  // which own the actual requestAnimationFrame scheduling - see the note
  // at the top of this file) finds out "please schedule another tick" even
  // while this scene's own runtime has otherwise gone idle and stopped
  // being ticked at all - invalidate() is what wakes that back up.
  let dirty = true; // the initial mount always needs a first render

  // ---- lifecycle ---------------------------------------------------------
  // A runtime has exactly two states: mounted (the default) or disposed.
  // `disposed` is the one flag every mutation entry point below checks
  // first - once true, nothing in this closure can schedule a frame, touch
  // the renderer, or resurrect itself, no matter what still calls in (a
  // stale scroll callback, a page-level timeline step targeting this scene,
  // a model's fetch finishing well after the fact). See dispose(), at the
  // bottom of this function, for what actually gets torn down.
  let disposed = false;

  function invalidate() {
    if (disposed) return;
    dirty = true;
    if (onInvalidate) onInvalidate();
  }

  // `material.map` - a texture, loaded lazily (only a scene that actually
  // uses one pays for THREE.TextureLoader/the fetch), cached per runtime by
  // resolved URL so several materials sharing the same file (or a live
  // `state` update reusing a src already loaded once) don't refetch/reparse
  // it. Scoped to this one closure (not a module-level/cross-runtime cache)
  // so it's never a resource that outlives this particular mount - see
  // applyMap's own disposed-guard, below, for the other half of that.
  const textureLoader = new THREE.TextureLoader();
  const textureCache = new Map(); // resolved URL -> Promise<THREE.Texture>

  function loadTexture(src) {
    const url = assetUrl(src);
    let pending = textureCache.get(url);
    if (!pending) {
      pending = new Promise((resolve, reject) => textureLoader.load(url, resolve, undefined, reject));
      textureCache.set(url, pending);
    }
    return pending;
  }

  // The one place `material.map` actually gets applied - the initial
  // material build, a model's own overlay, an `on`-handler write, and a
  // `state` binding update (reRender) all funnel through this (via
  // applyMaterialField's own "map" case, below), same as every other
  // material field already funnels through applyMaterialField itself.
  // Async by nature (unlike every other material field, which is a plain
  // synchronous write) - a texture doesn't exist yet the instant this is
  // called, so the mesh/model renders with no texture (its plain `color`
  // still shows) until this resolves and calls invalidate() to actually
  // paint it in.
  function applyMap(mat, src) {
    if (!src) {
      mat.map = null;
      mat.needsUpdate = true;
      invalidate();
      return;
    }
    loadTexture(src)
      .then((texture) => {
        // This scene may have been unmounted while the fetch was still in
        // flight (three.js's own loader has no cancellation - same
        // "resurrection guard" loadModel's own success/error callbacks
        // already need, just for a texture instead of a whole model). The
        // generic scene-teardown walk in dispose() can't have freed this
        // texture - it didn't exist yet at dispose time - so it has to be
        // disposed here instead, or it's a real, if small, per-mount GPU
        // leak (see docs/architecture's "repeated mount/unmount shouldn't
        // accumulate resources" requirement).
        if (disposed) {
          texture.dispose();
          return;
        }
        texture.userData.axisSrc = src; // lets MaterialHandle's own `map` getter round-trip a plain read, same as `color` already does
        mat.map = texture;
        mat.needsUpdate = true;
        invalidate();
      })
      .catch((err) => console.error(`[axis] couldn't load texture '${src}': ${err.message ?? err}`));
  }

  // `camera { controls: "orbit" }` - drag to orbit, scroll/pinch to zoom,
  // around the camera's own `target` (defaults to (0, 0, 0), the same point
  // camera.lookAt already used above), so turning this on never changes the
  // initial framing, only what a visitor can then do with it. Fetched only
  // when actually requested (see threeVendor.js) - a scene with a fixed
  // camera pays nothing for it. `tick` (below) calls `.update()` every
  // frame while active - required for damping, and three.js's own
  // `update()` return value (true only when the camera's transform actually
  // changed that call) is what tells `tick` both whether to render this
  // frame and whether to keep asking for more of them (see tick, below) - a
  // settled camera stops needing ticks on its own, no separate "is the user
  // still dragging" tracking needed. `start` (dispatched on the very first
  // pointer/wheel input of a new gesture, before `update()` would otherwise
  // ever see it) is only needed to *wake* an already-idle runtime - once
  // ticking, `update()`'s own return value keeps it going for as long as it
  // needs to.
  let orbitControls = null;
  if (scenePlan.camera.controls === "orbit") {
    const { OrbitControls } = await import("/vendor/jsm/controls/OrbitControls.js");
    orbitControls = new OrbitControls(camera, renderer.domElement);
    orbitControls.target.copy(camera.target); // its own separate Vector3 - OrbitControls doesn't read camera.target itself
    orbitControls.enableDamping = true;
    orbitControls.addEventListener("start", invalidate);
  }

  function handleResize() {
    if (disposed) return;
    const { width, height } = currentSize();
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, !fitToContainer);
    invalidate();
  }

  let resizeObserver = null;
  if (fitToContainer && typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(container);
  } else {
    window.addEventListener("resize", handleResize);
  }

  const object3Ds = new Map(); // name -> THREE.Object3D
  // Registered under the fixed name "camera" - see interpreter.js's note on
  // the same - so `animate camera { position.z -> 4 }` / a `timeline` step
  // can target the actual THREE.PerspectiveCamera, and an `on` handler can
  // mutate it directly (`camera.position = ...`), the same as any other
  // named object.
  object3Ds.set("camera", camera);
  // Registered under the fixed name "environment" too - not a spatial
  // object, but `scene` itself is where `background` (a real THREE.Color)
  // actually lives, so it's the right thing for `animate environment {
  // background -> ... }`'s generic single-token dispatch (applyChange's own
  // `background` case, below) to mutate directly - same idea as `camera`,
  // just standing in for the scene's own atmosphere instead of its
  // viewpoint.
  object3Ds.set("environment", scene);
  const meshesByName = new Map(); // name -> THREE.Mesh (interactive shapes only)

  // Built from `scenePlan.handlers` alone (static input data, nothing here
  // depends on the node-building loop below) so it's ready before a `model`
  // - which loads asynchronously - might need to consult it. name ->
  // { click?, hover?, unhover? }.
  const handlersByTarget = new Map();
  // Global handlers (target: null, see interpreter.js's interpretOnDecl) -
  // kept as plain lists, one per event, not folded into handlersByTarget's
  // one-body-per-event-per-target shape, since multiple independent
  // handlers for the same global event (multiple "systems" on 'tick', say)
  // are the expected case, not a collision to resolve.
  const tickHandlers = [];
  const keydownHandlers = [];
  const keyupHandlers = [];
  const mousemoveHandlers = [];
  const mousedownHandlers = [];
  const mouseupHandlers = [];
  const GLOBAL_HANDLER_LISTS = {
    tick: tickHandlers,
    keydown: keydownHandlers,
    keyup: keyupHandlers,
    mousemove: mousemoveHandlers,
    mousedown: mousedownHandlers,
    mouseup: mouseupHandlers,
  };
  for (const handler of scenePlan.handlers) {
    if (handler.target === null) {
      GLOBAL_HANDLER_LISTS[handler.event].push(handler.body);
      continue;
    }
    const forTarget = handlersByTarget.get(handler.target) ?? {};
    forTarget[handler.event] = handler.body;
    handlersByTarget.set(handler.target, forTarget);
  }

  // Every three.js mesh raycasting should consider - a shape gets tagged
  // (and added) as soon as it's built below; a `model`'s own meshes only
  // exist once its (async) load finishes, and only get tagged/added at all
  // if that model actually has an `on` handler - see loadModel. Every mesh
  // pushed here carries `userData.axisName` so a raycast hit maps straight
  // back to the AXIS object name that owns it, model submesh or not.
  const interactiveMeshes = [];

  // Every `model` node's animation-clip state, keyed by AXIS name - see
  // docs/architecture/skeletal-animation.md. One entry per model, created
  // synchronously (below, alongside its holder Group) so `play`/`stop`/a
  // `progress` write all have somewhere to record what's *wanted* even
  // before the glTF (and the clips it carries) actually finishes loading;
  // `clips`/`mixer` stay null until then. `mixer`/`action` are three.js's
  // own AnimationMixer/AnimationAction - the only place either exists in
  // this runtime, advanced from the same tick() every other animation here
  // already runs through (see the note there) - not a second animation
  // loop.
  //
  //   mixer:       THREE.AnimationMixer | null - null until this model has
  //                loaded AND actually needs one (a model with zero clips
  //                never gets one at all).
  //   clips:       Map<name, AnimationClip> | null - null means "still
  //                loading"; an empty Map (once loaded) means "loaded, but
  //                this file has no animation clips at all."
  //   action:      THREE.AnimationAction | null - the currently selected
  //                clip's action, once one has been chosen.
  //   desiredClip: string | null - the clip name that should be active,
  //                from `clip:` (seeded below) or the most recent `play`.
  //   playing:     should the mixer auto-advance this action every tick
  //                (native, looping playback) - false while scrubbed via
  //                `progress` or after `stop`.
  //   progress:    number | null - an explicit scrub value in [0, 1] from
  //                the most recent `progress` write; null once native
  //                playback (`play`) has taken over again.
  //   lastTime:    number | null - this model's own last tick() timestamp,
  //                used to compute *this* mixer's own per-frame delta time
  //                independent of any other model's - see tick(). Reset to
  //                null whenever playback (re)starts, so resuming after an
  //                idle scene never advances by a big stale gap.
  const modelClips = new Map(); // name -> ModelClipState

  // The one place any of the four ways a model's clip state can change
  // (`clip:`'s own load-time default, `play`, `stop`, a `progress` write)
  // actually reconciles that *want* against reality - creating/replacing
  // the mixer's AnimationAction as needed and leaving it in the right
  // paused/playing/scrubbed state. Every caller below invalidates the scene
  // itself (this function doesn't, so a caller reconciling several models in
  // one pass isn't forced into redundant invalidate() calls - same reasoning
  // as applyChange, above).
  //
  // A no-op (not an error) if this model hasn't loaded yet (`clips ===
  // null`, see above) - whatever's wanted is already recorded on `state`,
  // and gets reconciled for real the moment loadModel's own callback calls
  // this again. A clip name that doesn't exist in the file (typo, or a
  // model with no animations at all) is a clear, deterministic
  // console.error naming what's actually available, not a crash or a silent
  // forever-hang - matches loadModel's own error-reporting style just below.
  function reconcileClip(name) {
    const state = modelClips.get(name);
    if (!state || state.clips === null) return;
    // `progress` was written (live or queued pre-load) before any clip was
    // ever explicitly chosen - default to the file's first clip, the common
    // single-clip-model case, rather than silently doing nothing.
    if (!state.desiredClip && state.progress !== null && state.clips.size > 0) {
      state.desiredClip = state.clips.keys().next().value;
    }
    if (!state.desiredClip) return;

    const clip = state.clips.get(state.desiredClip);
    if (!clip) {
      console.error(
        `[axis] model '${name}' has no animation clip named '${state.desiredClip}' - it has: ${[...state.clips.keys()].join(", ") || "(none)"}`
      );
      state.desiredClip = null;
      state.playing = false;
      return;
    }

    if (!state.mixer) state.mixer = new THREE.AnimationMixer(object3Ds.get(name));
    if (!state.action || state.action.getClip() !== clip) {
      if (state.action) state.action.stop();
      state.action = state.mixer.clipAction(clip);
    }

    if (state.progress !== null) {
      state.action.play();
      state.action.paused = true;
      state.action.time = Math.max(0, Math.min(1, state.progress)) * clip.duration;
    } else if (state.playing) {
      state.action.reset().play();
      state.action.paused = false;
      state.lastTime = null; // a fresh playback session - see the note on `lastTime`, above
    } else {
      state.action.play();
      state.action.paused = true;
    }
    state.mixer.update(0); // apply the now-current time/pose immediately, without waiting for the next tick()
  }

  // A `model` loads asynchronously, so it gets a plain Group as a stand-in
  // immediately (carrying the real position/rotation/scale, so parenting,
  // sibling layout, and any `animate` targeting its transform all work
  // right away) - the loaded file's own scene graph is added as that
  // group's child once the fetch actually finishes. If this model has an
  // `on` handler, every mesh inside the loaded file becomes a raycast
  // target under the model's own AXIS name - clicking any part of a
  // multi-mesh Blender export fires the same `on model.click`.
  function loadModel(node, holder) {
    gltfLoader.load(
      assetUrl(node.src),
      (gltf) => {
        // The fetch can easily still be in flight when this viewport gets
        // unmounted - three.js's loader has no way to cancel it, and isn't
        // asked to (see dispose()'s own note) - but the load finishing must
        // not resurrect a dead runtime: no adding to a disposed scene, no
        // invalidate() (which would itself be a no-op, but returning here
        // also skips the pointless traversal/material work entirely).
        if (disposed) return;
        holder.add(gltf.scene);
        // `material.*` properties overlay the file's own materials rather
        // than replacing them (see interpreter.js's note on `model`) -
        // applied once here, at load time, for the model's initial
        // material; a later `state` update re-applies through
        // MaterialHandle instead (see reRender, below), which re-traverses
        // the (now loaded) holder itself rather than needing this gltf.scene
        // reference again.
        applyMaterialOverrides(gltf.scene, node.material, applyMap);
        gltf.scene.traverse((child) => {
          if (!child.isMesh) return;
          child.castShadow = node.castShadow ?? true;
          child.receiveShadow = node.receiveShadow ?? true;
          if (handlersByTarget.has(node.name)) {
            child.userData.axisName = node.name;
            interactiveMeshes.push(child);
          }
        });
        // Animation clips (see the note on `modelClips`/reconcileClip,
        // above) - an empty Map is a real, meaningful result (this file
        // genuinely has none), not "still unknown," which is exactly why
        // `state.clips` starts `null` rather than `[]`: reconcileClip uses
        // that distinction to tell "not loaded yet" (queue and wait) apart
        // from "loaded, but nothing by that name" (a clear error, now).
        // Reconciles whatever was already wanted - `clip:`'s own default
        // (seeded onto `state.desiredClip` below, alongside the rest of
        // this model's holder), or a `play`/`stop`/`progress` write that
        // happened to run before this fetch resolved.
        const clipState = modelClips.get(node.name);
        clipState.clips = new Map(gltf.animations.map((c) => [c.name, c]));
        reconcileClip(node.name);
        // 'on model.load' (see interpreter.js's ASSET_LIFECYCLE_EVENTS) -
        // the declarative escape hatch for "loading -> loaded -> reveal":
        // a handler here typically just writes a shared `state` boolean,
        // which a page's own reactive `if` (docs/architecture/
        // reactive-structure.md) already knows how to turn into a
        // conditional reveal, with no new mechanism beyond this event.
        // Fired before invalidate() so the handler's own state write is
        // folded into the same render-on-demand wake this load already
        // triggers, not a second one.
        runHandler(node.name, "load");
        // The load finished asynchronously, well outside any tick() call -
        // if this scene had already gone idle (nothing else animating),
        // nothing would ever ask for another frame and the model would
        // never actually appear on screen without this.
        invalidate();
      },
      undefined,
      (err) => {
        console.error(`[axis] couldn't load model '${node.name}' from '${node.src}': ${err.message ?? err}`);
        if (disposed) return; // same resurrection guard as the success path, above
        runHandler(node.name, "error");
        invalidate();
      }
    );
  }

  for (const node of scenePlan.nodes) {
    let obj3d;
    if (node.type === "group") {
      obj3d = new THREE.Group();
      obj3d.position.set(...node.position);
      obj3d.rotation.set(...node.rotation);
      obj3d.scale.set(...node.scale);
    } else if (node.type === "model") {
      const holder = new THREE.Group();
      holder.position.set(...node.position);
      holder.rotation.set(...node.rotation);
      holder.scale.set(...node.scale);
      // `clip: "Walk"` (if given) is this model's initial "want" -
      // `playing: !!node.clip` is what makes declaring it alone enough to
      // auto-play once loaded, the same "declared at the top level plays
      // automatically" convention `animate`/`timeline` already follow. See
      // the note on `modelClips`, above, for every field's meaning.
      modelClips.set(node.name, { mixer: null, clips: null, action: null, desiredClip: node.clip ?? null, playing: !!node.clip, progress: null, lastTime: null });
      // `progress` (see applyChange/currentLiveValue's own `progress`
      // branches, below) reads/writes this model's *normalized* clip time
      // (0-1) as a plain property directly on the holder - the exact same
      // shape `intensity` already is on a light, so the whole existing
      // `animate`/`timeline`/scroll-linked-`seekTimeline` machinery (which
      // only ever knows how to read/write a named property on an Object3D)
      // can drive it with zero changes of its own. Defined synchronously,
      // before the model has even started loading, so a `progress` write
      // that races the fetch has somewhere safe to land (see
      // reconcileClip's own note on queuing) instead of throwing.
      Object.defineProperty(holder, "progress", {
        get() {
          const state = modelClips.get(node.name);
          if (state?.action) return state.action.time / state.action.getClip().duration;
          return state?.progress ?? 0;
        },
        set(value) {
          const state = modelClips.get(node.name);
          if (!state) return;
          state.progress = Math.max(0, Math.min(1, value));
          state.playing = false; // scrubbing always pauses native playback - the same explicit "this exact frame" intent `stop` has
          reconcileClip(node.name);
        },
      });
      loadModel(node, holder);
      obj3d = holder;
    } else if (node.type.endsWith("Light")) {
      obj3d = makeLight(node);
    } else {
      const mesh = new THREE.Mesh(geometryFor(node.type), new THREE.MeshStandardMaterial(materialOptionsFor(node)));
      mesh.position.set(...node.position);
      mesh.rotation.set(...node.rotation);
      mesh.scale.set(...node.scale);
      mesh.userData.axisName = node.name;
      mesh.castShadow = node.castShadow ?? true;
      mesh.receiveShadow = node.receiveShadow ?? true;
      if (handlersByTarget.has(node.name)) interactiveMeshes.push(mesh);
      meshesByName.set(node.name, mesh);
      if (node.material?.map) applyMap(mesh.material, node.material.map);
      obj3d = mesh;
    }
    object3Ds.set(node.name, obj3d);
  }

  // build every three.js Object3D first (unparented), then attach by name
  // so declaration order in the .ax file never has to match nesting order
  for (const node of scenePlan.nodes) {
    const obj3d = object3Ds.get(node.name);
    const parent = node.parent ? object3Ds.get(node.parent) : scene;
    (parent ?? scene).add(obj3d);
    // A spotLight's `target` is a separate Object3D three.js doesn't add to
    // the scene on its own - without this, moving the target away from its
    // (0,0,0) default would never actually take effect (an unparented
    // Object3D's world matrix isn't kept current by the render loop).
    if (node.type === "spotLight") scene.add(obj3d.target);
  }

  // Shadow-map rendering costs a real render pass, so it's only turned on
  // when a scene actually asks for it (`directionalLight`/`spotLight`
  // `{ shadows: true }`) - the same "pay nothing unless you use it"
  // philosophy OrbitControls/GLTFLoader already follow. VSMShadowMap is this
  // three.js version's soft-shadow filter (PCFSoftShadowMap is deprecated,
  // silently downgraded to hard-edged PCFShadowMap as of r180) - the right
  // default for the deliberately small "shadows: true, that's the whole
  // API" surface this exposes, not a knob AXIS asks a developer to turn.
  if (scenePlan.nodes.some((n) => n.shadows)) {
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.VSMShadowMap;
  }

  // ---- animation ----------------------------------------------------

  // A load-time `animate` that loops forever (`repeat: infinite`) is
  // exactly the kind of perpetual motion `prefers-reduced-motion` asks
  // pages to avoid - a spinning/orbiting object declared to just play on
  // load, same reasoning as domClient.js's identical treatment for the DOM
  // side. Lands directly on each change's own end value (t=1) instead of
  // never animating at all, so the scene still ends up in a coherent pose.
  // A finite-repeat or one-shot animate is left alone - see the note on
  // domClient.js's own version of this for why.
  const runningAnimations = scenePlan.animations.map((anim) => {
    const changes = prepareChanges(anim.changes);
    if (REDUCED_MOTION && anim.repeat === "infinite") {
      const obj3d = object3Ds.get(anim.target);
      if (obj3d) for (const change of changes) applyChange(obj3d, change, 1);
      return { ...anim, changes, startTime: null, finished: true };
    }
    return { ...anim, changes, startTime: null, finished: false };
  });

  // `timeline`s are fully scheduled at build time (see interpreter.js's
  // interpretTimelineDecl) - every step already carries an absolute `at`
  // (ms from the timeline's own start), so playback here is just "how far
  // into the whole timeline are we, and which steps does that fall inside."
  // Keyed by name so `play NAME` (below) - or a scroll-linked viewport, see
  // seekTimeline - can find one.
  //
  // `driver` is the one thing that decides *where* "how far in" comes from:
  // "playback" (the default - a wall-clock `startTime`, ticked every frame
  // below) or "scroll" (an external caller supplies elapsed directly via
  // seekTimeline, and the normal per-frame ticking leaves it alone - see the
  // note on `tick`, below, and docs/language.md's Timelines section on why
  // a scroll-linked timeline and `play` don't both get to drive the same
  // clock).
  const runningTimelines = new Map(
    scenePlan.timelines.map((t) => [t.name, startTimelineState(t.duration, t.steps.map((s) => ({ ...s, changes: prepareChanges(s.changes) })), t.loop)])
  );

  // The per-step timing math (rawT/easing) is shared with domClient.js via
  // tween.js - resolving the target and actually mutating it is the one
  // thing genuinely specific to a three.js scene.
  function applySceneTimelineStep(step, t) {
    const obj3d = object3Ds.get(step.target);
    if (!obj3d) return;
    for (const change of step.changes) applyChange(obj3d, change, t);
  }

  // The scroll half of a `timeline` - see the `viewport { scrollTimeline:
  // ... }` property (interpreter.js) and domClient.js's own per-frame scroll
  // -progress measurement, which is the only caller of this. `progress` is
  // always in [0, 1] (already clamped by the caller); this just maps it
  // linearly onto the timeline's own duration and evaluates it exactly
  // there - no "catching up," no accumulated state, no `startTime` at all.
  // The first call permanently switches this timeline off wall-clock
  // playback (see `driver`, above) - a `timeline` a `viewport` claims for
  // scroll never goes back to auto-playing on its own. Idempotent -
  // calling this twice with the same `elapsed` always produces the same
  // visual state (applyTimelineAtElapsed, tween.js), which is what makes
  // scroll scrubbing (scroll position -> exact timeline state, reversible,
  // no drift) possible in the first place.
  function seekTimeline(name, progress) {
    if (disposed) return;
    const rt = runningTimelines.get(name);
    if (!rt) return;
    rt.driver = "scroll";
    rt.finished = false;
    applyTimelineAtElapsed(rt, Math.max(0, Math.min(1, progress)) * rt.duration, applySceneTimelineStep);
    invalidate();
  }

  // Called once per scheduled frame by the caller (client.js's own loop,
  // or domClient.js's shared page loop, for an embedded viewport) - never
  // self-scheduling (see the file-level note at the top). Returns whether
  // this scene still needs another tick: an unfinished playback-driven
  // `animate`/`timeline`, or orbit controls still actively moving (dragging,
  // or damping not yet settled). The caller uses that to decide whether to
  // keep asking for frames at all, or let this scene go idle - see
  // `invalidate`, above, for how it wakes back up once idle.
  //
  // Only actually renders `if (dirty)` - advancing an animation always sets
  // `dirty` as part of applying its change, so an active animation still
  // renders every frame exactly as before; a scene with nothing running and
  // nothing newly invalidated does the cheap bookkeeping below and returns
  // without ever calling `renderer.render()`.
  function tick(now) {
    if (disposed) return false;
    let needsMore = false;

    // Opts this scene out of render-on-demand's "stop when idle" the moment
    // any 'on tick' handler exists - a per-frame system, by definition,
    // needs to keep running even when nothing else changed (its own body
    // is exactly what might change something render-on-demand's own
    // invalidate() tracking has no way to see coming). This is the one
    // deliberate, documented tradeoff of having a tick hook at all - see
    // docs/language.md's "Per-frame updates" section.
    if (tickHandlers.length > 0) {
      needsMore = true;
      runTickHandlers(now);
    }

    for (const anim of runningAnimations) {
      const stillGoing = stepAnimation(
        anim,
        now,
        (target) => object3Ds.has(target),
        (target, change, t) => {
          applyChange(object3Ds.get(target), change, t);
          dirty = true;
        }
      );
      if (stillGoing) needsMore = true;
    }

    for (const [name, rt] of runningTimelines) {
      if (rt.driver !== "playback" || rt.finished) continue;
      needsMore = true;
      tickTimeline(rt, now, applySceneTimelineStep, () => runHandler(name, "complete"));
      dirty = true;
    }

    // Native clip playback (`play`/`clip:`'s own auto-play, see
    // reconcileClip) - the one part of this milestone that genuinely needs
    // a per-frame delta *time*, not an elapsed-since-start like every other
    // animation here (a looping clip has no fixed "start," it just keeps
    // going) - three.js's own AnimationMixer.update(deltaSeconds) is what
    // actually advances it, called from this same tick(), not a second RAF
    // loop. Each model tracks its own `lastTime` (see the note on
    // `modelClips`, above) rather than sharing one scene-wide clock, so an
    // otherwise-idle scene waking up after a long gap never advances a
    // freshly-(re)started clip by that stale gap. A paused/stopped clip's
    // `state.playing` is false, so it costs nothing here and asks for no
    // further frames - see docs/architecture/skeletal-animation.md.
    for (const state of modelClips.values()) {
      if (!state.playing || !state.mixer) continue;
      needsMore = true;
      const delta = state.lastTime === null ? 0 : (now - state.lastTime) / 1000;
      state.lastTime = now;
      state.mixer.update(delta);
      dirty = true;
    }

    if (orbitControls) {
      // Returns true only when the camera's transform actually changed
      // this call (see the note on `orbitControls`, above) - both whether
      // to render this frame and whether to keep asking for more of them
      // fall out of that one return value, no separate interaction-state
      // tracking needed.
      if (orbitControls.update()) {
        dirty = true;
        needsMore = true;
      }
    } else if (dirty) {
      // Keeps the camera aimed at its own `target` (default (0,0,0), same
      // as before this was authorable) true even while the camera's own
      // position - or target - is being animated/timelined/state-bound -
      // without this, a camera move would keep facing whatever direction it
      // faced at load time instead of continuing to frame the scene, which
      // reads as a mistake, not a cinematic pan. Only worth redoing when a
      // render is about to happen anyway.
      camera.lookAt(camera.target);
    }

    if (dirty) {
      renderer.render(scene, camera);
      dirty = false;
    }

    return needsMore;
  }

  // The other half of `animate` - not the auto-play-on-load plan above, but
  // an `animate target { ... }` statement inside an `on` handler, run live
  // via the evaluator's `hooks.onCustomStatement` escape hatch. Same
  // grammar, but "from" is read off the object's actual current state
  // instead of a value baked in at build time, since it may already have
  // moved by the time this fires. Shares the same small path vocabulary
  // (transform axes, `material.*`, `color`, `intensity`) buildChange
  // (renderer/plan.js) resolves at build time for a top-level `animate` -
  // just read live here instead of off the interpreter graph.
  function currentLiveValue(obj3d, path) {
    if (path.length === 1 && allScalarProperties().has(path[0])) {
      const value = allScalarProperties().get(path[0]).get(obj3d);
      // "color" alone keeps its own long-standing fallback (a sensible
      // starting color to animate *from* when the object doesn't have one
      // of its own yet) - every other scalar keeps returning `undefined`
      // when it doesn't apply, same as before this consolidation.
      if (value === undefined && path[0] === "color") return "#ffffff";
      return value;
    }
    if (path.length === 2 && path[0] === "material") {
      const mat = collectMaterials(obj3d)[0];
      if (!mat) return undefined;
      const field = path[1];
      if (field === "color" || field === "emissive") return mat[field] ? `#${mat[field].getHexString()}` : "#000000";
      return field in mat ? mat[field] : undefined;
    }
    if (path.length === 2 && ANIMATABLE_GROUPS.has(path[0]) && AXES.has(path[1])) {
      return obj3d[path[0]][path[1]];
    }
    return undefined;
  }

  function triggerAnimation(decl, env) {
    const targetName = resolveAnimateTarget(decl, env);
    const obj3d = object3Ds.get(targetName);
    if (!obj3d) {
      throw new AxisRuntimeError(`can't animate '${targetName}' - no object with that name in the scene`, decl.line);
    }

    const timing = parseAnimateTiming(decl, env);
    const changes = [];

    for (const entry of timing.rest) {
      const key = entry.path.join(".");
      const path = entry.path;
      const isAnimatableScalar = path.length === 1 && allScalarProperties().get(path[0])?.animatable;
      const isColorPath =
        (isAnimatableScalar && allScalarProperties().get(path[0]).valueType === "color") ||
        (path.length === 2 && path[0] === "material" && (path[1] === "color" || path[1] === "emissive"));
      const isKnownPath =
        isAnimatableScalar ||
        isColorPath ||
        (path.length === 2 && path[0] === "material") ||
        (path.length === 2 && ANIMATABLE_GROUPS.has(path[0]) && AXES.has(path[1]));
      if (!isKnownPath) {
        throw new AxisRuntimeError(`can't animate '${key}' - try position.x/y/z, rotation.x/y/z, scale.x/y/z, material.*, color, intensity, or progress`, decl.line);
      }

      const toValue = evaluate(entry.to, env);
      if (isColorPath) {
        if (typeof toValue !== "string") throw new AxisRuntimeError(`animated value for '${key}' must be a color, got a ${typeName(toValue)}`, decl.line);
      } else if (typeof toValue !== "number") {
        throw new AxisRuntimeError(`animated value for '${key}' must be a number, got a ${typeName(toValue)}`, decl.line);
      }

      const from = currentLiveValue(obj3d, path);
      if (from === undefined) {
        throw new AxisRuntimeError(`can't animate '${key}' on '${targetName}' - it doesn't have that property`, decl.line);
      }

      if (isColorPath) {
        changes.push({ path, from, to: toValue, color: true });
      } else if (path[0] === "rotation") {
        changes.push({ path, from, to: literalUnit(entry.to) === "rad" ? toValue : (toValue * Math.PI) / 180, color: false });
      } else {
        changes.push({ path, from, to: toValue, color: false });
      }
    }

    if (changes.length === 0) return;
    runningAnimations.push({ target: targetName, ...timing, changes: prepareChanges(changes), startTime: null, finished: false });
    invalidate(); // pushed from an `on` handler, outside tick() - wake an idle runtime so the first frame of this animation actually happens
  }

  // `play NAME` - restarts an already-declared `timeline` from its own
  // beginning (its steps' `at` stays relative to *this* new start, not the
  // original one). `pause`/`resume`/`reverse` (below) share this same
  // lookup-and-scroll-guard shape - see requireTimeline.
  //
  // A scroll-linked timeline (see seekTimeline, above) can't be `play`ed,
  // `pause`d, `resume`d, or `reverse`d - that's not an arbitrary
  // restriction, it's the one invariant a scroll-driven timeline promises:
  // the same scroll position always produces the same timeline state. Any
  // of these "restarted"/"froze"/"flipped" it would be invisible on the
  // very next scroll-driven frame anyway (nothing about the scroll
  // position changed), so refusing it with a clear reason beats a silent
  // no-op.
  // `line` is optional - present for the build-time-authored `stmt` path
  // below (a real source location to attribute the error to), absent for
  // the by-name external API (playTimelineByName & co.) a page-level
  // handler reaches this scene's own timelines through (see
  // pageRuntime.js's cross-viewport timeline control) - that error still
  // gets a line number, just the *page's* own, attached by the caller.
  function requireTimelineByName(name, verb, line) {
    const rt = runningTimelines.get(name);
    if (!rt) {
      throw new AxisRuntimeError(`can't ${verb} '${name}' - no timeline with that name in this scene`, line);
    }
    if (rt.driver === "scroll") {
      throw new AxisRuntimeError(`can't ${verb} '${name}' - it's driven by scroll (a viewport's 'scrollTimeline'), not manual playback`, line);
    }
    return rt;
  }

  function requireTimeline(stmt, env, verb) {
    return requireTimelineByName(resolveAnimateTarget(stmt, env), verb, stmt.line);
  }

  function playTimeline(stmt, env) {
    restartTimeline(requireTimeline(stmt, env, "play"));
    invalidate(); // called from an `on` handler, outside tick() - wake an idle runtime
  }

  function pauseTimelineStmt(stmt, env) {
    pauseTimeline(requireTimeline(stmt, env, "pause"), performance.now());
  }

  function resumeTimelineStmt(stmt, env) {
    resumeTimeline(requireTimeline(stmt, env, "resume"), performance.now());
    invalidate();
  }

  function reverseTimelineStmt(stmt, env) {
    reverseTimeline(requireTimeline(stmt, env, "reverse"), performance.now());
    invalidate();
  }

  // The external, by-name half of timeline playback control - what makes
  // `play "stage.intro"` work from a *page*-level `on` handler (see
  // pageRuntime.js), reaching into this specific viewport's own embedded
  // scene by its already-resolved timeline name, not a stmt/env pair this
  // scene never had. Same underlying tween.js state machine, same
  // invalidate()-wakes-the-shared-loop wiring - just addressed differently.
  function playTimelineByName(name) {
    restartTimeline(requireTimelineByName(name, "play"));
    invalidate();
  }
  function pauseTimelineByName(name) {
    pauseTimeline(requireTimelineByName(name, "pause"), performance.now());
  }
  function resumeTimelineByName(name) {
    resumeTimeline(requireTimelineByName(name, "resume"), performance.now());
    invalidate();
  }
  function reverseTimelineByName(name) {
    reverseTimeline(requireTimelineByName(name, "reverse"), performance.now());
    invalidate();
  }

  // Shared target-resolution/validation for `play CLIP on TARGET` and `stop
  // TARGET` - `verb` only shapes the error message. Distinguishes "no such
  // object" from "a real object, but not a model" (a `cube`/`group`/light
  // has no animation clips to play) the same way `triggerAnimation`'s own
  // "no object with that name" error does for a plain `animate`.
  function requireModelClipState(targetName, verb, line) {
    if (!object3Ds.has(targetName)) {
      throw new AxisRuntimeError(`can't ${verb} '${targetName}' - no object with that name in the scene`, line);
    }
    const state = modelClips.get(targetName);
    if (!state) {
      throw new AxisRuntimeError(`can't ${verb} '${targetName}' - it's not a model (only a 'model' has animation clips to play)`, line);
    }
    return state;
  }

  // `play CLIP on TARGET` - selects (or switches to, if a different clip was
  // already active) CLIP on TARGET and starts it playing, looping, from its
  // own beginning - three.js's own AnimationAction default (`LoopRepeat`),
  // the natural fit for the common case (a walk cycle, an idle sway) and
  // consistent with `play`'s own "restarts from the beginning" contract for
  // a timeline. A model plays at most one clip at a time - the smallest
  // useful capability, not a blending system (see docs/architecture/
  // skeletal-animation.md for why). If TARGET hasn't finished loading yet,
  // this is recorded and reconciled the moment it does (reconcileClip's own
  // note) rather than being an error or a lost request.
  function playClip(stmt, env) {
    const clipName = resolveAnimateTarget({ target: stmt.clip, targetIsExpr: stmt.clipIsExpr, line: stmt.line }, env);
    const targetName = resolveAnimateTarget(stmt, env);
    const state = requireModelClipState(targetName, "play a clip on", stmt.line);
    state.desiredClip = clipName;
    state.playing = true;
    state.progress = null; // a fresh `play` always restarts from 0, not wherever a previous `progress` scrub left off
    reconcileClip(targetName);
    invalidate(); // called from an `on` handler, outside tick() - wake an idle runtime
  }

  // `stop TARGET` - freezes whichever clip is currently active on TARGET at
  // its current pose (does not reset to frame 0 - see docs/architecture/
  // skeletal-animation.md for why "stop" means "freeze," not "rewind").
  // Composes with `progress`: stop mid-`play`, then scrub it by hand, works
  // exactly as it reads. A no-op, not an error, if nothing is currently
  // playing on TARGET (idempotent, the same leniency `unmountViewport` and
  // `dispose()` already have for "already in the state you asked for").
  function stopClip(stmt, env) {
    const targetName = resolveAnimateTarget(stmt, env);
    const state = requireModelClipState(targetName, "stop", stmt.line);
    state.playing = false;
    if (state.action) state.action.paused = true;
    invalidate(); // called from an `on` handler, outside tick() - wake an idle runtime so the frozen frame actually renders
  }

  // ---- interaction ----------------------------------------------------
  // `on box.click { ... }` bodies are plain AXIS AST, evaluated live with
  // the same evaluator.js the CLI uses. Each named shape gets wrapped in a
  // LiveObject so `box.color = red` actually mutates the real mesh.

  const sceneEnv = scriptEnv.child();
  for (const [name, { value, constant, initializer }] of Object.entries(scenePlan.variables)) {
    // vectors already round-trip through JSON as plain {__axisType, x, y, z}
    // objects, which is exactly what evaluator.js expects - no rehydration
    // needed. A scene-level `let` stays mutable here too, so a handler can
    // hold state across clicks (a counter, a toggle); a `const` doesn't.
    //
    // `initializer` - only present when `value` contains a function (a
    // "data with behavior" record - see interpreter.js's captureVariables
    // and evaluator.js's containsFunction) - means `value` itself is NOT
    // safe to use as-is: its own JSON round trip through this scene's plan
    // reduced every function field's `.closure` (a real Environment class
    // instance server-side) to a plain, prototype-less object, so reading
    // that field at all - not even calling it - throws
    // ("value.closure.child is not a function") the first time any `on`
    // handler does. Re-evaluating the ORIGINAL initializer expression here
    // instead - against this real, live `sceneEnv` (already carrying every
    // earlier sibling `let`/`const` and every top-level `fn`, in
    // declaration order) - produces a fresh value whose functions have a
    // real, working closure, exactly as if this scene had just built
    // itself in the browser. A real bug this fixed, not a defensive
    // measure: ANY scene-level `let`/`state` holding a self-bound record
    // (Phase E's "data with behavior" pattern) threw exactly this error
    // the moment any handler read one of its methods - see
    // docs/architecture/2026-09-language-platform-audit.md's game-
    // foundation addendum for the full account (pageRuntime.js has the
    // identical fix, for the identical reason, on the DOM side).
    sceneEnv.define(name, initializer ? evaluate(initializer, sceneEnv) : value, constant);
  }
  // Every named node - shape, `group`, `model`, light, or the camera -
  // becomes a LiveObject: its own position/rotation/scale (and, for a
  // light, color/intensity; for a shape/model, material.*) is a real
  // `on`-handler-mutable value. A `model`'s obj3d is its holder Group,
  // which exists synchronously even while the actual glTF is still
  // loading, so this is safe to do immediately for every node type.
  const liveObjectNames = new Set();
  for (const node of scenePlan.nodes) {
    const obj3d = object3Ds.get(node.name);
    if (!obj3d) continue;
    sceneEnv.define(node.name, new LiveObject(obj3d, applyMap));
    liveObjectNames.add(node.name);
  }
  sceneEnv.define("camera", new LiveObject(camera, applyMap));
  liveObjectNames.add("camera");
  const environmentHandle = new EnvironmentHandle(scene);
  sceneEnv.define("environment", environmentHandle);
  const pointerLockHandle = new PointerLockHandle(renderer.domElement);
  sceneEnv.define("pointerLock", pointerLockHandle);
  sceneEnv.define("raycast", new RaycastHandle(camera, object3Ds, renderer));

  // ---- reactive re-render ---------------------------------------------
  // The DOM sibling of this is domClient.js's reRender() - same idea, over
  // three.js objects instead of DOM elements: every non-literal property
  // expression on a shape/group/model/light/camera/environment was shipped
  // through as a `bindings` entry (see interpreter.js's
  // SceneBuilder.applyProperty), so after anything runs that could have
  // changed a `state` this scene reads - its own handler, or (via
  // onStateChange) a page's or another viewport's - re-evaluate them and
  // patch whichever object actually has one. `camera`/`environment` aren't
  // part of `scenePlan.nodes` (see renderer/plan.js) - applyBindings is
  // called for them separately, just below, against their own `.bindings`.
  const MATERIAL_PREFIX = "material.";
  // Every scalar/vector/color field a `LiveObject`/`EnvironmentHandle`
  // actually exposes a real setter for - see those classes, above. Not
  // every SCENE_ALLOWED_PROPS key is in here (`direction`/`angle`/
  // `penumbra`/`shadows` still have no live setter - `castShadow`/
  // `receiveShadow` used to be in that same "no live setter" list too,
  // until they were added to SCALAR_PROPERTIES as the registry's own
  // proof-of-concept external-shaped registration - see that entry's own
  // comment).
  // Every scalar in SCALAR_PROPERTIES, plus the vector-group keys that
  // registry doesn't cover yet (see its own note on why they're a
  // separate piece of this consolidation) - adding a new scalar to that
  // registry makes it bindable automatically, no second edit here.
  const BINDABLE_KEYS = new Set([...Object.keys(SCALAR_PROPERTIES), "position", "rotation", "scale", "target"]);

  // name -> key -> the last value this binding's own expression actually
  // computed. Without this, a bound property whose expression's value
  // hasn't changed since last time (most commonly: it references
  // something that can never change, like a named color constant, or
  // nothing about its dependencies moved this cycle) would still get
  // unconditionally re-applied on every single reRender() - silently
  // stomping right back over an `on`-handler's own direct assignment to
  // that same property (`box.color = green`, explicitly documented as a
  // real, supported pattern - see docs/language.md) the instant that
  // handler's own reRender() ran. Found auditing pre-pivot examples
  // (examples/interaction.ax's click-to-toggle-color never actually
  // worked, for exactly this reason) - see
  // docs/architecture/2026-09-language-platform-audit.md's addendum.
  // pageRuntime.js's own reRender already has this exact guard
  // (`lastBoundValues`, keyed the same way) - this brings scene3d.js in
  // line with it, using `deepEqual` instead of `===` since a scene's own
  // bindable properties (position/rotation/scale/target) are vectors,
  // not primitives - evaluate() builds a fresh vector object every call
  // even when its components are unchanged, so reference equality alone
  // would never skip a write.
  const lastBoundValues = new Map();

  function applyBindings(bindings, live, name) {
    if (!bindings || !live) return;
    for (const [key, expr] of Object.entries(bindings)) {
      const isMaterialField = key.startsWith(MATERIAL_PREFIX);
      if (!isMaterialField && !BINDABLE_KEYS.has(key)) continue;
      try {
        const value = evaluate(expr, sceneEnv);
        const cacheKey = `${name}.${key}`;
        if (deepEqual(lastBoundValues.get(cacheKey), value)) continue;
        lastBoundValues.set(cacheKey, value);
        if (isMaterialField) live.material[key.slice(MATERIAL_PREFIX.length)] = value;
        else live[key] = value;
      } catch {
        // a bad expression (e.g. referencing something out of scope)
        // shouldn't crash the whole re-render pass
      }
    }
  }

  function reRender() {
    if (disposed) return;
    for (const node of scenePlan.nodes) {
      applyBindings(node.bindings, liveObjectNames.has(node.name) ? sceneEnv.get(node.name) : null, node.name);
    }
    applyBindings(scenePlan.camera.bindings, sceneEnv.get("camera"), "camera");
    applyBindings(scenePlan.environment.bindings, environmentHandle, "environment");
    invalidate();
  }
  reRender();

  const handlerHooks = {
    onCustomStatement: (stmt, stmtEnv) => {
      if (stmt.kind === "AnimateDecl") return triggerAnimation(stmt, stmtEnv);
      if (stmt.kind === "PlayStmt") return playTimeline(stmt, stmtEnv);
      if (stmt.kind === "PlayClipStmt") return playClip(stmt, stmtEnv);
      if (stmt.kind === "StopClipStmt") return stopClip(stmt, stmtEnv);
      if (stmt.kind === "PauseStmt") return pauseTimelineStmt(stmt, stmtEnv);
      if (stmt.kind === "ResumeStmt") return resumeTimelineStmt(stmt, stmtEnv);
      if (stmt.kind === "ReverseStmt") return reverseTimelineStmt(stmt, stmtEnv);
      throw new AxisRuntimeError(`'${stmt.kind}' can't be used inside an 'on' handler`, stmt.line);
    },
  };

  async function runHandler(targetName, event) {
    const body = handlersByTarget.get(targetName)?.[event];
    if (!body) return;
    try {
      await executeBlockAsync(body, sceneEnv.child(), handlerHooks);
    } catch (e) {
      if (e instanceof AxisRuntimeError) console.error(`[axis] error in 'on ${targetName}.${event}': ${e.message}`);
      else console.error(e);
    } finally {
      reRender();
      if (onStateChange) onStateChange();
    }
  }

  // Runs every handler for one global event ('tick'/'keydown'/'keyup'),
  // each with whatever extra bindings that event gives its body ('dt' for
  // 'tick', 'key' for the keyboard ones - see the two callers below).
  // Fire-and-forget from every caller (never awaited), same as a
  // raycast-triggered click handler already is elsewhere in this file - a
  // handler with an `await` inside just runs across more than one frame's
  // worth of wall-clock time, it doesn't block rendering.
  async function runGlobalHandlers(handlers, eventName, extraBindings) {
    if (handlers.length === 0) return;
    for (const body of handlers) {
      const handlerEnv = sceneEnv.child();
      for (const [name, value] of Object.entries(extraBindings)) handlerEnv.define(name, value, true);
      try {
        await executeBlockAsync(body, handlerEnv, handlerHooks);
      } catch (e) {
        if (e instanceof AxisRuntimeError) console.error(`[axis] error in 'on ${eventName}': ${e.message}`);
        else console.error(e);
      }
    }
    reRender();
    if (onStateChange) onStateChange();
  }

  // Called from tick(now) below with the same RAF timestamp every other
  // per-frame thing in this file already uses. `dt` (seconds, not AXIS's
  // usual milliseconds - the near-universal convention for a per-frame
  // delta in game/physics code, where velocity*dt formulas assume seconds)
  // is `0` on the very first tick a handler runs (no previous frame to
  // measure from), never negative, never a huge value from a scene that
  // was asleep - render-on-demand doesn't get a chance to sleep this scene
  // at all once any tick handler exists (see tick(), below), so
  // lastTickTime only ever advances by one real frame at a time.
  let lastTickTime = null;
  function runTickHandlers(now) {
    if (tickHandlers.length === 0) return;
    const dt = lastTickTime === null ? 0 : Math.max(0, (now - lastTickTime) / 1000);
    lastTickTime = now;
    runGlobalHandlers(tickHandlers, "tick", { dt });
  }

  // 'key' is the browser's own KeyboardEvent.key verbatim ("a", "ArrowUp",
  // " ", ...) - a raw primitive, not a normalized/cased/"is held" version
  // of it (that's exactly the kind of convenience a package can build on
  // top, composing these two events with a record the way
  // examples/physics-demo/ already proved for physics - see
  // docs/architecture/2026-09-language-platform-audit.md). Fires on every
  // native repeat while a key is held, same as the browser's own keydown
  // does - a package wanting "just pressed" edge detection reads that
  // itself from consecutive events, AXIS doesn't filter it away here.
  // Listeners are only attached at all if this scene actually declares a
  // handler for that event (the same "pay nothing unless you use it"
  // philosophy shadows/OrbitControls/GLTFLoader already follow) - see
  // dispose(), below, for their cleanup.
  function handleKeydown(event) {
    runGlobalHandlers(keydownHandlers, "keydown", { key: event.key });
  }
  function handleKeyup(event) {
    runGlobalHandlers(keyupHandlers, "keyup", { key: event.key });
  }
  if (keydownHandlers.length > 0) window.addEventListener("keydown", handleKeydown);
  if (keyupHandlers.length > 0) window.addEventListener("keyup", handleKeyup);

  // 'dx'/'dy' (mousemove) are MouseEvent.movementX/movementY - pixels moved
  // since the previous event, not an absolute position (a "where is the
  // cursor" query is a different, still-unbuilt primitive - this one is
  // specifically what a mouse-look camera needs, and works identically
  // whether or not the pointer is locked to the canvas). 'button' (mouse-
  // down/up) is MouseEvent.button verbatim (0/1/2 - left/middle/right).
  // Same "raw primitive, pay nothing unless declared" rules as the
  // keyboard events above - no pointer-lock request, no drag-gesture/
  // double-click convenience; see docs/language.md's Keyboard input
  // section for the same philosophy applied to `on keydown`.
  function handleMousemove(event) {
    runGlobalHandlers(mousemoveHandlers, "mousemove", { dx: event.movementX, dy: event.movementY });
  }
  function handleMousedown(event) {
    runGlobalHandlers(mousedownHandlers, "mousedown", { button: event.button });
  }
  function handleMouseup(event) {
    runGlobalHandlers(mouseupHandlers, "mouseup", { button: event.button });
  }
  if (mousemoveHandlers.length > 0) window.addEventListener("mousemove", handleMousemove);
  if (mousedownHandlers.length > 0) window.addEventListener("mousedown", handleMousedown);
  if (mouseupHandlers.length > 0) window.addEventListener("mouseup", handleMouseup);

  // A model's own meshes don't exist yet at this point (still loading) even
  // when it will end up interactive - `interactiveMeshes` gets those pushed
  // in later, asynchronously, by loadModel above. Attaching the raycast
  // listeners is decided now, synchronously, from the plan itself (which
  // node types have a handler), not from whether interactiveMeshes happens
  // to be non-empty yet - a model-only interactive scene would otherwise
  // never get its listeners wired up at all.
  const hasInteractiveTarget = scenePlan.nodes.some(
    (n) => (meshesByName.has(n.name) || n.type === "model") && handlersByTarget.has(n.name)
  );

  if (hasInteractiveTarget) {
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let hovered = null;

    function findName(mesh) {
      return mesh.userData.axisName ?? null;
    }

    function pick(event) {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      // the caller's shared tick loop keeps the camera's matrix current for
      // drawing, but a click can happen between frames - update it
      // explicitly so raycasting never reads a one-frame-stale transform
      camera.updateMatrixWorld(true);
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(interactiveMeshes, false);
      return hits.length > 0 ? hits[0].object : null;
    }

    renderer.domElement.addEventListener(
      "click",
      (event) => {
        const hit = pick(event);
        if (hit) runHandler(findName(hit), "click");
      },
      { signal: listenerController.signal }
    );

    renderer.domElement.addEventListener(
      "pointermove",
      (event) => {
        const hit = pick(event);
        if (hit !== hovered) {
          if (hovered) runHandler(findName(hovered), "unhover");
          if (hit) runHandler(findName(hit), "hover");
          hovered = hit;
        }
      },
      { signal: listenerController.signal }
    );
  }

  // The narrow hook that lets a *page*-level `timeline` step choreograph
  // one of this scene's own objects (`animate ("stage.centerpiece") {
  // ... }` - see interpreter.js's PageBuilder.buildTimelineStep and
  // domClient.js's own timeline engine, which is the only caller): apply
  // one already-interpolated change, computed exactly the way any other
  // change here is (applyChange, above) - this scene doesn't know or care
  // that the timeline driving it lives in a different domain.
  function applyChangeToTarget(targetName, change, t) {
    if (disposed) return;
    const obj3d = object3Ds.get(targetName);
    if (!obj3d) return;
    applyChange(obj3d, change, t);
    invalidate(); // called from domClient.js's own timeline tick, outside this scene's - wake/keep this scene rendering too
  }

  // The data half of `scrollProgress` on a `viewport` (see domClient.js's
  // own setPageProgressState, the page-scoped sibling of this): writes a
  // value into this scene's own `state` through the *same* Environment.set
  // + reRender machinery an `on` handler's assignment already uses -
  // scroll progress becomes an ordinary reactive value, not a bespoke
  // scroll-to-3D pipeline. Throws (same as Environment.set) if `name` isn't
  // a variable this scene actually has - the caller's job to report that
  // usefully, not spam it every scrolling frame.
  function setState(name, value) {
    if (disposed) return;
    sceneEnv.set(name, value);
    reRender();
    if (onStateChange) onStateChange();
  }

  // Any texture-valued property on a material - three.js has no single
  // "dispose everything this material owns" call, so this looks at what the
  // material actually has rather than hardcoding a fixed list of map names
  // (map/normalMap/roughnessMap/... - a loaded glTF file can carry any
  // combination). Safe to call on every material this scene's own graph
  // has, shape or loaded model alike.
  function disposeMaterial(mat) {
    for (const value of Object.values(mat)) {
      if (value?.isTexture) value.dispose();
    }
    mat.dispose();
  }

  // Frees the GPU-side resources this scene's own graph holds - geometries,
  // materials, and their textures. `renderer.dispose()` (below) frees the
  // renderer's own internal caches/programs; it does NOT walk the scene and
  // free what the scene's *objects* own, so without this a disposed
  // viewport still leaks every geometry/material/texture it ever created
  // (a real leak `dispose()` claimed to fix before this existed - fixed
  // now, not just documented as deferred). Only this scene's own graph is
  // traversed - nothing shared with another viewport, the page, or a
  // future asset cache is touched.
  function disposeSceneResources() {
    scene.traverse((obj) => {
      obj.geometry?.dispose();
      const mat = obj.material;
      if (!mat) return;
      if (Array.isArray(mat)) mat.forEach(disposeMaterial);
      else disposeMaterial(mat);
    });
  }

  // Stops and frees everything this runtime owns, and flips the one flag
  // every mutation entry point above checks - see `disposed`'s own note.
  // Idempotent: a second (or third) call sees `disposed` already true and
  // returns immediately, so a caller never needs to track whether it
  // already disposed a given runtime.
  function dispose() {
    if (disposed) return;
    disposed = true;
    // Releases the OS pointer lock if this scene's own canvas currently
    // holds it - otherwise disposing a locked scene (a viewport's
    // `visible: false`, say) would leave the user's cursor invisibly
    // locked to a canvas that no longer exists.
    pointerLockHandle.exit();
    if (resizeObserver) resizeObserver.disconnect();
    else window.removeEventListener("resize", handleResize);
    if (orbitControls) {
      orbitControls.removeEventListener("start", invalidate);
      orbitControls.dispose();
    }
    if (keydownHandlers.length > 0) window.removeEventListener("keydown", handleKeydown);
    if (keyupHandlers.length > 0) window.removeEventListener("keyup", handleKeyup);
    if (mousemoveHandlers.length > 0) window.removeEventListener("mousemove", handleMousemove);
    if (mousedownHandlers.length > 0) window.removeEventListener("mousedown", handleMousedown);
    if (mouseupHandlers.length > 0) window.removeEventListener("mouseup", handleMouseup);
    listenerController.abort();
    disposeSceneResources();
    renderer.dispose();
    renderer.domElement.remove();
    object3Ds.clear();
    meshesByName.clear();
    interactiveMeshes.length = 0;
    runningAnimations.length = 0;
    runningTimelines.clear();
    // AnimationMixer has no `dispose()` of its own (no GPU/native resource,
    // just references to its own actions/root) - `stopAllAction()` drops its
    // internal per-action bookkeeping, and tick()'s own `disposed` guard
    // (already checked at the top of this function) already guarantees no
    // mixer here ever advances again regardless; this loop just drops this
    // runtime's own last references to them, same as every other collection
    // cleared above.
    for (const state of modelClips.values()) state.mixer?.stopAllAction();
    modelClips.clear();
    textureCache.clear();
  }

  return {
    tick,
    reRender,
    object3Ds,
    seekTimeline,
    applyChangeToTarget,
    setState,
    dispose,
    playTimelineByName,
    pauseTimelineByName,
    resumeTimelineByName,
    reverseTimelineByName,
  };
}
