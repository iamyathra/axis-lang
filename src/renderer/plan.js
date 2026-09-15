// Turns a scene graph (from the interpreter) into a "render plan" - a plain
// data description of what to draw, how to animate it, and what interaction
// handlers exist, with everything converted to units a renderer can use
// directly (radians instead of degrees).
//
// This file knows nothing about three.js, WebGL, or the browser. That's
// deliberate: it's the seam between the language (lexer/parser/interpreter)
// and whatever actually draws pixels, so it can be unit tested on its own
// and swapped to a different renderer later without touching the language.
// Function/handler bodies pass through untouched (they're plain AST data);
// the browser runtime evaluates them with the same evaluator.js the
// interpreter uses.

const AXIS_INDEX = { x: 0, y: 1, z: 2 };
// "target" (the camera's own look-at point - see interpreter.js's camera
// defaults) is a plain point, exactly like "position" - no rotation-style
// unit conversion needed, so it's just a fourth member of this same group,
// not a special case in buildChange, below.
const ANIMATABLE_GROUPS = new Set(["position", "rotation", "scale", "target"]);
const LIGHT_TYPES = new Set(["ambientLight", "directionalLight", "pointLight", "spotLight", "hemisphereLight"]);
const MATERIAL_FIELDS = new Set(["color", "metalness", "roughness", "opacity", "emissive", "emissiveIntensity"]);
const COLOR_FIELDS = new Set(["color", "emissive"]);
// A material field's own true starting value when a scene never set it
// explicitly - three.js's own MeshStandardMaterial defaults, so animating
// `material.metalness` on a shape that never set one still eases smoothly
// from what it's actually rendering (0, non-metallic), not `undefined`.
const MATERIAL_DEFAULTS = { metalness: 0, roughness: 1, opacity: 1, emissiveIntensity: 1, emissive: "#000000" };
// A shape/model's interpreter-graph object only ever gets a `.material`
// field at all once at least one `material.*` property was actually set
// (see interpreter.js's applyProperty) - so "no `.material` object" does
// NOT mean "this object type can't have one" (that would wrongly treat a
// shape/model with zero material.* properties the same as a `group`, which
// genuinely has no material). This is the actual type-capability check.
const MATERIAL_CAPABLE_TYPES = new Set(["cube", "sphere", "plane", "cylinder", "model"]);

function toRadians(degrees) {
  return (degrees * Math.PI) / 180;
}

function defaultCamera() {
  return { position: [0, 2, 5], controls: null, fov: 60, near: 0.1, far: 100, target: [0, 0, 0], bindings: {} };
}

function defaultEnvironment() {
  return { background: "#111111", fogColor: null, fogNear: 10, fogFar: 50, bindings: {} };
}

function buildNode(obj) {
  if (obj.type === "group") {
    return {
      name: obj.name,
      type: "group",
      parent: obj.parent,
      position: obj.position,
      rotation: obj.rotation.map(toRadians),
      scale: obj.scale,
      bindings: obj.bindings ?? {},
    };
  }
  if (LIGHT_TYPES.has(obj.type)) {
    // A light is a real LiveObject now too (scene3d.js) - `color`/
    // `intensity` are `on`-handler-mutable and `state`-bindable exactly
    // like a shape's, so its `bindings` carry through the same way a
    // shape's/group's/model's do.
    const node = { name: obj.name, type: obj.type, parent: obj.parent, color: obj.color, intensity: obj.intensity, bindings: obj.bindings ?? {} };
    if (obj.direction) node.direction = obj.direction;
    if (obj.position) node.position = obj.position;
    if (obj.target) node.target = obj.target;
    if (obj.groundColor !== undefined) node.groundColor = obj.groundColor;
    if (obj.angle !== undefined) node.angle = toRadians(obj.angle);
    if (obj.penumbra !== undefined) node.penumbra = obj.penumbra;
    if (obj.shadows !== undefined) node.shadows = obj.shadows;
    return node;
  }
  if (obj.type === "model") {
    return {
      name: obj.name,
      type: "model",
      parent: obj.parent,
      position: obj.position,
      rotation: obj.rotation.map(toRadians),
      scale: obj.scale,
      src: obj.src,
      clip: obj.clip ?? null,
      material: obj.material ?? {},
      castShadow: obj.castShadow,
      receiveShadow: obj.receiveShadow,
      bindings: obj.bindings ?? {},
    };
  }
  // Every spatial node type (shapes, `group`, `model`) carries `bindings`
  // through now - scene3d.js wraps all three in a LiveObject, so all three
  // are real `on`-handler-mutable, `state`-bindable scene citizens, not just
  // shapes. Lights aren't - they're not an addressable value in the
  // language yet either way.
  return {
    name: obj.name,
    type: obj.type,
    parent: obj.parent,
    position: obj.position,
    rotation: obj.rotation.map(toRadians),
    scale: obj.scale,
    color: obj.color,
    material: obj.material ?? {},
    castShadow: obj.castShadow,
    receiveShadow: obj.receiveShadow,
    bindings: obj.bindings ?? {},
  };
}

function isColorPath(path) {
  return (
    (path.length === 1 && (path[0] === "color" || path[0] === "groundColor" || path[0] === "background")) ||
    (path.length === 2 && path[0] === "material" && COLOR_FIELDS.has(path[1]))
  );
}

// Reads the current/starting value for an animatable path off the raw
// interpreter graph object a change targets - shared by a plain top-level
// `animate` and a `timeline` step, since "from" is computed the same way
// for both. `undefined` means this object doesn't support this path (a
// `pointLight` has no `material`, a `group` has no `intensity`, ...) - the
// caller warns and skips it, the same lenient behavior an out-of-range
// position/rotation/scale path has always had.
function currentValueFor(targetObj, path) {
  if (path.length === 1 && path[0] === "color") {
    return targetObj.material?.color ?? targetObj.color ?? undefined;
  }
  if (path.length === 1 && path[0] === "groundColor") {
    return targetObj.groundColor;
  }
  if (path.length === 1 && path[0] === "background") {
    return targetObj.background;
  }
  if (path.length === 1 && path[0] === "intensity") {
    return targetObj.intensity;
  }
  if (path.length === 1 && (path[0] === "fov" || path[0] === "near" || path[0] === "far")) {
    return targetObj[path[0]];
  }
  // A model's animation-clip progress (see docs/architecture/
  // skeletal-animation.md) - only meaningful on a `model`, and always 0 as
  // its build-time "from": nothing can have played a frame of a clip before
  // the scene has even mounted, so a top-level `animate model { progress ->
  // 1 }` always eases up from the very start of whichever clip ends up
  // selected, exactly like an untouched `intensity`/`opacity` would.
  if (path.length === 1 && path[0] === "progress") {
    return targetObj.type === "model" ? 0 : undefined;
  }
  if (path.length === 2 && path[0] === "material" && MATERIAL_FIELDS.has(path[1])) {
    if (!MATERIAL_CAPABLE_TYPES.has(targetObj.type)) return undefined;
    const field = path[1];
    if (targetObj.material?.[field] !== undefined) return targetObj.material[field];
    if (field === "color") return targetObj.color ?? "#ffffff";
    return MATERIAL_DEFAULTS[field];
  }
  if (path.length === 2 && ANIMATABLE_GROUPS.has(path[0]) && path[1] in AXIS_INDEX && targetObj[path[0]]) {
    return targetObj[path[0]][AXIS_INDEX[path[1]]];
  }
  return undefined;
}

// One animated property change, converted from the interpreter's
// `{path, toValue, unit}` (a dotted string plus the raw evaluated target
// value) into `{path, from, to, color}` - what a renderer actually needs to
// interpolate. Shared by a plain `animate` and a `timeline` step (see
// buildTimeline, below) - both `animate box { position.y -> 2 }` at the top
// of a scene and the exact same block as a timeline step produce this the
// same way.
//
// Rotation is the one path that needs a unit conversion: AXIS always
// stores/authors a rotation in degrees (see interpreter.js), so `from` -
// read straight off the interpreter graph - is unconditionally converted;
// `to` only converts unless the animate target itself was written with an
// explicit `rad` suffix. Not applying that same conversion to `from` was a
// real, live bug (an object with a non-zero initial rotation would animate
// to a wildly wrong angle) - safe to fix here since it was unexercised by
// every existing example (see this slice's regression test).
// Exported for domPlan.js: a page-level `timeline` step can cross-reference
// a `viewport`'s own embedded-scene object (`animate ("stage.centerpiece")
// { ... }` - see interpreter.js's PageBuilder.buildTimelineStep), and
// resolving *that* step's `from`/`to`/color the same way a scene's own
// steps are is exactly this function - one place that knows how to turn an
// interpreter-level change into a renderer-ready one, reused across both
// files rather than reimplemented.
export function buildChange(change, targetObj, targetLabel, warnings) {
  const path = change.path.split(".");
  const raw = targetObj ? currentValueFor(targetObj, path) : undefined;
  if (raw === undefined) {
    warnings.push(`animate ${targetLabel}: can't animate '${change.path}' yet, skipping it`);
    return null;
  }
  if (isColorPath(path)) {
    return { path, from: raw, to: change.toValue, color: true };
  }
  if (path[0] === "rotation") {
    return { path, from: toRadians(raw), to: change.unit === "rad" ? change.toValue : toRadians(change.toValue), color: false };
  }
  return { path, from: raw, to: change.toValue, color: false };
}

function buildAnimation(anim, objectsByName, warnings) {
  const targetObj = objectsByName.get(anim.target);
  const changes = anim.changes.map((c) => buildChange(c, targetObj, anim.target, warnings)).filter(Boolean);
  if (changes.length === 0) return null;
  return { target: anim.target, duration: anim.duration, delay: anim.delay, repeat: anim.repeat, easing: anim.easing, changes };
}

// A `timeline`'s steps are already fully scheduled (absolute `at`, in ms)
// by interpreter.js - this only does the same path/unit resolution
// buildAnimation does per step, grouped back under the timeline's own name.
function buildTimeline(timeline, objectsByName, warnings) {
  const steps = timeline.steps
    .map((step) => {
      const targetObj = objectsByName.get(step.target);
      const changes = step.changes.map((c) => buildChange(c, targetObj, `${timeline.name}/${step.target}`, warnings)).filter(Boolean);
      if (changes.length === 0) return null;
      return { target: step.target, at: step.at, duration: step.duration, easing: step.easing, changes };
    })
    .filter(Boolean);
  return { name: timeline.name, duration: timeline.duration, steps, loop: timeline.loop ?? false };
}

// Converts one already-built scene graph (interpreter.js's SceneBuilder
// output) into the plain-data plan a 3D runtime needs. Split out from
// buildRenderPlan so a page's `viewport` can embed a scene's plan
// (domPlan.js) using exactly the same node/animation conversion a
// standalone scene file uses - one place that knows how a scene graph
// becomes drawable data, whether it ends up as the whole page or nested
// inside one. `warnings` is passed in (and mutated) rather than returned,
// so an embedded scene's warnings land in the *page's* warnings list.
export function buildScenePlan(scene, warnings = []) {
  const camera = scene.camera
    ? {
        position: scene.camera.position,
        controls: scene.camera.controls ?? null,
        fov: scene.camera.fov ?? 60,
        near: scene.camera.near ?? 0.1,
        far: scene.camera.far ?? 100,
        target: scene.camera.target ?? [0, 0, 0],
        // Without this, a `camera { fov: someState }` binding never
        // reaches the browser at all - it exists on the raw interpreter
        // object (interpreter.js's applyProperty already stashes it) but
        // this object, not that one, is what actually gets serialized to
        // the client. See scene3d.js's reRender() for the other half.
        bindings: scene.camera.bindings ?? {},
      }
    : defaultCamera();
  const environment = scene.environment
    ? {
        background: scene.environment.background ?? "#111111",
        fogColor: scene.environment.fogColor ?? null,
        fogNear: scene.environment.fogNear ?? 10,
        fogFar: scene.environment.fogFar ?? 50,
        bindings: scene.environment.bindings ?? {},
      }
    : defaultEnvironment();
  const objectsByName = new Map(scene.objects.map((obj) => [obj.name, obj]));
  // Neither the camera nor the environment is a spatial node (`nodes`,
  // below, only ever carries shapes/groups/models/lights - see buildNode) -
  // both are registered here only so `animate camera { position.z -> 4 }` /
  // `animate environment { background -> ... }` / a timeline step can
  // resolve them as targets the same way any other named object does.
  if (scene.camera) objectsByName.set("camera", scene.camera);
  if (scene.environment) objectsByName.set("environment", scene.environment);
  const nodes = scene.objects.map(buildNode);
  const animations = scene.animations.map((anim) => buildAnimation(anim, objectsByName, warnings)).filter(Boolean);
  const timelines = (scene.timelines ?? []).map((t) => buildTimeline(t, objectsByName, warnings));
  // Every distinct file a `model` references, in first-seen order - the
  // Node-only layer (cli.js/server.js) resolves these against the actual
  // project directory and serves/copies them; this file never touches disk.
  const assets = [...new Set(nodes.filter((n) => n.type === "model").map((n) => n.src))];
  // Every distinct `material.map` texture file any node references (a
  // shape or a model) - kept separate from `assets`, not merged into it,
  // because threeVendor.js's neededJsmFilesFor gates fetching the GLTFLoader
  // addon on "does this scene have any assets at all" - a scene with only a
  // texture and no model must not trigger that fetch.
  const textures = [...new Set(nodes.filter((n) => n.material?.map).map((n) => n.material.map))];

  return { camera, environment, nodes, animations, timelines, variables: scene.variables, handlers: scene.handlers, assets, textures };
}

export function buildRenderPlan(sceneGraph) {
  const warnings = [];
  const scene = sceneGraph.scenes[0];
  const functions = sceneGraph.functions ?? [];
  const sharedVariables = sceneGraph.sharedVariables ?? {};
  // Every imported package's own runtime extension (see modules.js/
  // interpret()'s own passthrough, and docs/runtime-extensions.md) -
  // html.js turns each into a <script type="module"> tag, server.js serves
  // the actual file. Pure passthrough here too; this file still knows
  // nothing about what a runtime extension actually does.
  const extensions = sceneGraph.extensions ?? [];

  if (!scene) {
    return { camera: defaultCamera(), environment: defaultEnvironment(), nodes: [], animations: [], timelines: [], functions, variables: {}, sharedVariables, handlers: [], assets: [], textures: [], extensions, warnings };
  }

  if (sceneGraph.scenes.length > 1) {
    warnings.push(
      `this file has ${sceneGraph.scenes.length} scenes; only rendering the first one ('${scene.name}') - picking which scene to run isn't built yet`
    );
  }

  const scenePlan = buildScenePlan(scene, warnings);
  return { ...scenePlan, functions, sharedVariables, extensions, warnings };
}
