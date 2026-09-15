// Turns a page graph (from the interpreter) into a "DOM render plan" - a
// plain data description of the elements to build, styled with CSS-ready
// values, plus interaction handlers. This is the DOM sibling of plan.js:
// it knows nothing about actual HTML markup or the browser, which keeps it
// unit-testable and keeps the language layer decoupled from how a page
// actually gets drawn.

import { buildStyle, cssForProperty } from "./domStyle.js";
import { PATH_TO_PROPERTY, COLOR_PROPERTIES } from "./domAnimate.js";
import { registeredElementTypes } from "../extensionRegistry.js";

// A page element has no "current color" the way it has no "current
// position" (see the note on positionX/positionY, below) - these are the
// same kind of sensible, always-picked literal default buildDomChange
// already uses for opacity (1)/scale (1)/rotation (0), just for the one
// path shape (a color string) those don't cover. Black text on a white
// background is the plainest possible starting point when the element
// itself didn't declare its own `color`/`background`.
const COLOR_DEFAULTS = { color: "#000000", background: "#ffffff" };
import { buildScenePlan, buildChange as buildSceneChange } from "./plan.js";

// One `responsive` breakpoint tier's properties -> real CSS declarations -
// the exact same `cssForProperty` a node's own base style already goes
// through (domStyle.js), just applied to an override set instead. `css`
// (the raw escape hatch) is pulled out into `__raw` the same way
// buildStyle already does for a node's base style, so domHtml.js's
// existing styleAttr-shaped handling (rest first, `__raw` appended after)
// works unchanged for a tier's own text too.
function buildResponsiveStyle(elementType, props) {
  const style = {};
  for (const [key, value] of Object.entries(props)) {
    if (key === "css") style.__raw = value;
    else Object.assign(style, cssForProperty(elementType, key, value));
  }
  return style;
}

// Exported for domClient.js: a reactive `if`/`for`'s client-side rebuild
// (see interpreter.js's PageBuilder.registerReactiveBlocks) produces raw
// interpreter-graph objects the exact same shape build time always has -
// turning one into a plan node (with a real, CSS-ready `.style`) is exactly
// this function, reused rather than reimplemented.
export function buildNode(obj) {
  const node = { name: obj.name, type: obj.type, parent: obj.parent, style: buildStyle(obj), bindings: obj.bindings ?? {} };
  if (obj.type === "text" || obj.type === "paragraph") node.content = obj.content ?? "";
  if (obj.type === "heading") {
    node.content = obj.content ?? "";
    node.level = obj.level ?? 1;
  }
  if (obj.type === "button" || obj.type === "link") node.label = obj.label ?? "";
  if (obj.type === "link") node.href = obj.href ?? "#";
  if (obj.type === "image") {
    node.src = obj.src ?? "";
    node.alt = obj.alt ?? "";
  }
  if (obj.type === "input") {
    node.kind = obj.kind ?? "text";
    node.value = obj.value ?? "";
    node.placeholder = obj.placeholder ?? "";
  }
  // Not one of the built-in types above - a registerElementType extension
  // (interpreter.js already rejected anything that's neither, at build
  // time). Always the same generic leaf shape: `content`, if the type's
  // own `allowedProps` actually includes it, same convention `text`/
  // `paragraph` above use for their own always-a-string default.
  if (!["text", "paragraph", "heading", "button", "link", "image", "input", "viewport"].includes(obj.type)) {
    const registered = registeredElementTypes().get(obj.type);
    if (registered?.allowedProps.has("content")) node.content = obj.content ?? "";
  }
  if (obj.type === "viewport") {
    // `node.visible` is the one field domClient.js's own conditional-mount
    // logic reads to decide whether this viewport gets a runtime at all on
    // initial load (see docs/architecture/conditional-viewport.md) - baked
    // into the *style* here too (not just carried as data) so a viewport
    // that starts hidden doesn't paint an empty 400px box on first SSR
    // paint, the same "no wasted renderer, no wasted layout" guarantee the
    // INITIAL MOUNT case asks for. Always present (default `true`) - a
    // `viewport`'s own mount/unmount lifecycle needs to know this either way.
    node.visible = obj.visible !== false;
    if (!node.visible) node.style.display = "none";
  } else if (obj.visible !== undefined) {
    // Any other element type: a plain, cheap `display: none` toggle - no
    // lifecycle to manage, so (unlike `viewport`, above) this field is only
    // present at all when the author actually set `visible`, keeping the
    // plan lean for the common case of not using it.
    node.visible = obj.visible;
    if (!node.visible) node.style.display = "none";
  }
  return node;
}

// One page-element property change, resolved from the interpreter's
// `{path, toValue, unit}` - shared by a plain page `animate` and a page-
// level `timeline` step targeting this same element (see buildTimelineStep,
// below), the DOM sibling of plan.js's buildChange.
function buildDomChange(change, node, targetLabel, warnings) {
  const property = PATH_TO_PROPERTY[change.path];
  if (!property) {
    warnings.push(`animate ${targetLabel}: can't animate '${change.path}' yet, skipping it`);
    return null;
  }

  let from;
  let to = change.toValue;
  if (COLOR_PROPERTIES.has(property)) {
    // `node` here is the raw interpreter-graph object, not yet run through
    // buildStyle/cssForProperty - its own declared `color`/`background` (a
    // DOM_STRING_KEY, already a plain CSS-ready string, same as node.opacity
    // is already used directly just below) is the "current" color to
    // animate away from.
    from = node[property] ?? COLOR_DEFAULTS[property];
    return { property, from, to, color: true };
  }
  if (property === "opacity") {
    from = node.opacity ?? 1;
  } else if (property === "scale") {
    from = 1;
  } else if (property === "rotation") {
    from = 0;
    // CSS rotate() wants degrees; AXIS's animate values are degrees by
    // default too, so only convert if the literal was explicitly radians
    // (the exact inverse of how plan.js converts scene rotations).
    if (change.unit === "rad") to = (change.toValue * 180) / Math.PI;
  } else {
    // positionX/positionY are an offset from the element's normal,
    // in-flow layout position, not an absolute coordinate - a page
    // element doesn't have a stored "position" the way a 3D object does.
    from = 0;
  }

  return { property, from, to };
}

function buildAnimation(anim, nodesByName, warnings) {
  const node = nodesByName.get(anim.target);
  const changes = anim.changes.map((c) => buildDomChange(c, node, anim.target, warnings)).filter(Boolean);
  if (changes.length === 0) return null;
  return { target: anim.target, duration: anim.duration, delay: anim.delay, repeat: anim.repeat, easing: anim.easing, changes };
}

// A raw interpreter scene graph (a `viewport`'s own `obj.sceneGraph`) ->
// name -> object, "camera" included - the exact lookup plan.js's own
// buildScenePlan builds internally, needed again here so a page-level
// timeline step that cross-references a viewport's embedded object
// (`animate ("stage.centerpiece") { ... }`) can resolve its `from`/`to`
// the same way that scene's own steps would.
function sceneObjectsByName(sceneGraph) {
  const map = new Map(sceneGraph.objects.map((obj) => [obj.name, obj]));
  if (sceneGraph.camera) map.set("camera", sceneGraph.camera);
  return map;
}

// One `timeline` step - either a page element (kind "dom", resolved via
// buildDomChange, same as a plain page `animate`) or a cross-reference into
// a viewport's own embedded scene (kind "scene", resolved via plan.js's own
// buildChange against that scene's raw object graph - genuinely the exact
// same resolution a scene-level timeline step gets, just reached from a
// page-level one). `sceneGraphsByViewport` is built once by buildDomPlan
// and passed through rather than looked up per step.
function buildTimelineStep(step, nodesByName, sceneGraphsByViewport, warnings) {
  if (step.kind === "scene") {
    const sceneGraph = sceneGraphsByViewport.get(step.viewportName);
    const targetObj = sceneGraph ? sceneObjectsByName(sceneGraph).get(step.sceneTargetName) : undefined;
    const changes = step.changes.map((c) => buildSceneChange(c, targetObj, step.target, warnings)).filter(Boolean);
    if (changes.length === 0) return null;
    return { kind: "scene", target: step.sceneTargetName, viewportName: step.viewportName, at: step.at, duration: step.duration, easing: step.easing, changes };
  }
  const node = nodesByName.get(step.target);
  const changes = step.changes.map((c) => buildDomChange(c, node, step.target, warnings)).filter(Boolean);
  if (changes.length === 0) return null;
  return { kind: "dom", target: step.target, at: step.at, duration: step.duration, easing: step.easing, changes };
}

function buildTimeline(timeline, nodesByName, sceneGraphsByViewport, warnings) {
  const steps = timeline.steps.map((s) => buildTimelineStep(s, nodesByName, sceneGraphsByViewport, warnings)).filter(Boolean);
  return { name: timeline.name, duration: timeline.duration, steps, loop: timeline.loop ?? false };
}

// One page's own plan - everything buildDomPlan (a file with no `route`
// declarations, the pre-routing behavior, unchanged) always did, factored
// out so buildDomRouterPlan (below) can build one of these per *routed*
// page instead of just the first page in the file. `embeddedSceneNames`,
// an output parameter (a Set the caller owns and passes in), accumulates
// across every page a caller builds this way, so "a scene nothing embeds"
// can be warned about file-wide, once, rather than independently per page
// (a scene only one of several routed pages embeds isn't unused).
function buildSinglePagePlan(page, interpretResult, warnings, embeddedSceneNames) {
  const components = interpretResult.components ?? [];

  const nodesByName = new Map(page.nodes.map((n) => [n.name, n]));
  const animations = (page.animations ?? []).map((anim) => buildAnimation(anim, nodesByName, warnings)).filter(Boolean);

  // name -> that viewport's raw embedded scene graph - built once, up
  // front, so buildTimeline (below) doesn't rebuild it per cross-scene step.
  const sceneGraphsByViewport = new Map(
    page.nodes.filter((obj) => obj.type === "viewport" && obj.sceneGraph).map((obj) => [obj.name, obj.sceneGraph])
  );
  const timelines = (page.timelines ?? []).map((t) => buildTimeline(t, nodesByName, sceneGraphsByViewport, warnings));

  // A `viewport` node carries the scene graph interpreter.js already built
  // for it (obj.sceneGraph) - convert it with the exact same buildScenePlan
  // a standalone scene file uses (see plan.js), nested under `.scene`, so
  // domClient.js gets a complete, self-contained 3D plan to hand to
  // scene3d.js. See docs/architecture/page-scene-fusion.md.
  //
  // `scrollTimeline`/`scrollProgress` carry through for *any* node type
  // now, not just `viewport` - which timeline/state they drive (this
  // page's own, or the embedded scene's) is entirely a domClient.js
  // runtime decision (does this node have a `.scene`, i.e. is it a
  // viewport, or not) - see docs/language.md's Timelines section.
  // One entry per node that actually has a `responsive` property, in
  // declaration order - domHtml.js turns this into the page's one
  // `<style>` block of real `@media` rules. See
  // docs/architecture/responsive-layout.md.
  const responsiveRules = [];
  const nodes = page.nodes.map((obj) => {
    const node = buildNode(obj);
    if (obj.type === "viewport" && obj.sceneGraph) {
      embeddedSceneNames.add(obj.scene);
      node.sceneName = obj.scene;
      node.scene = buildScenePlan(obj.sceneGraph, warnings);
    }
    if (obj.scrollTimeline) node.scrollTimeline = obj.scrollTimeline;
    if (obj.scrollProgress) node.scrollProgress = obj.scrollProgress;
    if (obj.scrollRoot) node.scrollRoot = obj.scrollRoot;
    if (obj.responsive) {
      for (const [tier, props] of Object.entries(obj.responsive)) {
        responsiveRules.push({ name: node.name, tier, style: buildResponsiveStyle(obj.type, props) });
      }
    }
    return node;
  });

  return {
    title: page.title,
    nodes,
    animations,
    timelines,
    variables: page.variables,
    handlers: page.handlers,
    reactiveBlocks: page.reactiveBlocks ?? [],
    components: (page.reactiveBlocks ?? []).length > 0 ? components : [],
    responsiveRules,
  };
}

export function buildDomPlan(interpretResult) {
  const warnings = [];
  const pages = interpretResult.pages ?? [];
  const functions = interpretResult.functions ?? [];
  const sharedVariables = interpretResult.sharedVariables ?? {};
  // Same passthrough as plan.js's buildRenderPlan - see
  // docs/runtime-extensions.md. A page's own embedded `viewport`s share
  // scene3d.js with a whole-scene file, so a runtime extension a page (or
  // a scene it embeds) imports needs to reach the browser exactly the
  // same way.
  const extensions = interpretResult.extensions ?? [];
  const page = pages[0];

  if (!page) {
    return { title: "", nodes: [], animations: [], timelines: [], functions, sharedVariables, extensions, variables: {}, handlers: [], reactiveBlocks: [], components: [], responsiveRules: [], warnings };
  }

  if (pages.length > 1) {
    warnings.push(
      `this file has ${pages.length} pages; only rendering the first one ('${page.title}') - picking which page to run isn't built yet (declare 'route's to render all of them - see docs/architecture/routing.md)`
    );
  }

  const embeddedSceneNames = new Set();
  const pagePlan = buildSinglePagePlan(page, interpretResult, warnings, embeddedSceneNames);
  warnUnusedScenes(interpretResult, embeddedSceneNames, warnings, [page.title]);

  return { ...pagePlan, functions, sharedVariables, extensions, warnings };
}

// Shared by buildDomPlan (one page) and buildDomRouterPlan (every routed
// page) - a scene the file declares but that no viewport on *any* rendered
// page actually embeds isn't an error (it might be meant for a page this
// build didn't reach, or a future one), but it's clearly not doing
// anything, so say so once, file-wide.
function warnUnusedScenes(interpretResult, embeddedSceneNames, warnings, pageTitles) {
  for (const scene of interpretResult.scenes ?? []) {
    if (!embeddedSceneNames.has(scene.name)) {
      warnings.push(
        `scene '${scene.name}' is declared but no 'viewport' embeds it in ${pageTitles.length > 1 ? "any routed page" : `page '${pageTitles[0]}'`} - it won't render`
      );
    }
  }
}

// One plan per *routed* page (a `route "/x" PageName` decl exists for it),
// plus the route/redirect table itself - the multi-page sibling of
// buildDomPlan, reusing buildSinglePagePlan for each page rather than a
// second "graph -> plan" implementation. A page nothing routes to isn't
// built at all (dead weight the shipped plan shouldn't pay for) - same
// "only build what's reachable" reasoning buildDomPlan already has for a
// scene no viewport embeds, one level up.
export function buildDomRouterPlan(interpretResult) {
  const warnings = [];
  const routes = interpretResult.routes ?? [];
  const redirects = interpretResult.redirects ?? [];
  const functions = interpretResult.functions ?? [];
  const sharedVariables = interpretResult.sharedVariables ?? {};
  const extensions = interpretResult.extensions ?? [];
  const pagesByTitle = new Map((interpretResult.pages ?? []).map((p) => [p.title, p]));

  const embeddedSceneNames = new Set();
  const pages = {};
  for (const route of routes) {
    if (pages[route.pageName]) continue; // more than one route can point at the same page - build it once
    const page = pagesByTitle.get(route.pageName);
    pages[route.pageName] = buildSinglePagePlan(page, interpretResult, warnings, embeddedSceneNames);
  }
  warnUnusedScenes(interpretResult, embeddedSceneNames, warnings, Object.keys(pages));

  return { routes, redirects, pages, functions, sharedVariables, extensions, warnings };
}

// A router plan's own `pages[name]` is deliberately *not* self-contained
// (see buildDomRouterPlan) - `functions`/`sharedVariables` are the same
// for every page in one program, so they're hoisted to the router plan's
// own top level instead of duplicated per page. `createPageRuntime`
// (pageRuntime.js) expects a complete, single-page plan though (it reads
// `.functions`/`.sharedVariables` straight off whatever it's given, with
// no idea a router plan exists) - this is the one place that gap gets
// closed, reused by both domServer.js (server-rendering the page a
// request's URL matched) and domRouter.js (the browser mounting a page
// client-side on navigation).
export function resolvedPagePlan(routerPlan, pageName) {
  return { ...routerPlan.pages[pageName], functions: routerPlan.functions, sharedVariables: routerPlan.sharedVariables, extensions: routerPlan.extensions };
}
