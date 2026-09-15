# Page + Scene fusion (v1)

Status: **implemented, partial by design.** This is the first real step away
from "AXIS has two unrelated renderers" toward "AXIS has one composition
model with a DOM layer and a 3D layer." It is deliberately not the whole
roadmap - see "Deliberately postponed" at the end.

## The problem this replaces

Before this milestone, `scene` and `page` were fully separate pipelines that
never touched: two interpreters producing two graph shapes, two render-plan
builders, two HTML shells, two dev servers, and two browser runtimes
(`client.js` for three.js, `domClient.js` for the DOM) that duplicated the
same animation-tweening and `on`-handler-dispatch logic twice, once per
domain. `cli.js` refused to even build a file that declared both a `scene`
and a `page`. A "3D landing page" was structurally impossible in one file.

## The model: DOM is the tree, 3D is a bounded region inside it

AXIS does not get a third, generic "unified scene graph" that DOM and 3D
both get flattened into - that would mean reimplementing either the DOM's
layout engine or three.js's renderer on top of an abstraction neither
actually needs. Instead:

- **The DOM tree is authoritative for layout and composition.** A page is
  still a tree of `container`/`text`/`button`/... elements, laid out by the
  real browser layout engine, same as before.
- **3D is a bounded region inside that tree**, introduced by a new leaf
  element type: `viewport`. A `viewport` occupies a normal CSS box (it has
  `width`/`height`/`position`/etc. like any other element) and, inside that
  box, owns a complete, independent three.js scene.
- **A `viewport` references a `scene` by name** (`viewport earth { scene:
  "Earth" }`), rather than a page's body containing 3D object declarations
  directly. The 3D domain keeps its own grammar (`cube`, `camera`,
  `animate position.x`, ...) exactly as it already existed - a page doesn't
  need to learn 3D vocabulary, and a scene doesn't need to learn DOM
  vocabulary. Fusion happens at the *boundary* (`viewport`), not by merging
  the two grammars into one.

This was a deliberate rejection of "just put a `<canvas>` in a `<div>`":
the canvas-in-a-div version would still leave two disconnected runtimes
that happen to share a page. What actually changes below - shared
environment, shared interaction dispatch, shared asset pipeline, shared
animation driver - is what makes it fusion instead of juxtaposition.

## Ownership

| Concern | Owner |
|---|---|
| Page layout, box size/position of a `viewport` | DOM / CSS |
| Everything *inside* a mounted `viewport`'s canvas (camera, meshes, lights) | three.js, via `scene3d.js` |
| Canvas pixel size | `scene3d.js`, kept in sync with the `viewport`'s DOM box via `ResizeObserver` |
| Top-level `fn`/`let` values | shared: one `globalEnv` at interpret time, one `scriptEnv` at runtime, both DOM and 3D build children of it |
| A scene's own objects/state (`sceneEnv`) | scoped to that one mounted scene instance, not visible to the page's own handlers or to other viewports |
| A page's own elements/state (`pageEnv`) | scoped to the page, not visible inside an embedded scene |

Scene-local and page-local environments are siblings, not one merged
namespace. A page-level `on viewport.click` fires on the *box* (ordinary
DOM event bubbling - clicking a mesh inside also bubbles up to the
container). A scene-level `on someMesh.click` fires on that specific 3D
object via raycasting, exactly as it does for a whole-page scene file.
**What's still one namespace:** anything declared at the very top of the
`.ax` file (`let`, `fn`) - both domains are children of the same env, so a
`let earthColor = "#4a90e2"` at the top of the file is legitimately visible
to both a page's handlers and an embedded scene's properties, today,
without any new plumbing (this already worked before fusion, since both
builders always built off one shared `globalEnv` - fusion just makes it
*useful*, because now both domains can coexist in the same file).

## Build pipeline

1. `interpreter.js` parses the whole file once (unchanged parser/lexer -
   `viewport { scene: "..." }` is just an ordinary object declaration with a
   string property, no grammar changes needed). It collects every top-level
   `SceneDecl`'s AST into a `Map<name, ast>` *before* building anything, so a
   `viewport` can reference a scene declared later in the file.
2. When `PageBuilder` reaches a `viewport` object declaration, it resolves
   `scene` against that map and builds the referenced scene right there,
   with a fresh `SceneBuilder` chained off the same `globalEnv` every
   top-level scene uses. **A scene means exactly the same thing whether you
   run it standalone or embed it in a page** - same builder, same rules,
   same error messages. The built scene graph is attached to the
   `viewport`'s own DOM node as `sceneGraph`.
3. `domPlan.js` (the DOM sibling of `plan.js`) walks the page's node list as
   before; for a `viewport` node it now also calls `plan.js`'s
   `buildScenePlan` (extracted from `buildRenderPlan` so both the
   standalone-scene path and the embedded-in-a-page path share the exact
   same node/animation-conversion code) on that attached `sceneGraph`, and
   nests the result as `node.scene`. One DOM plan, with 3D sub-plans nested
   at every `viewport`.
4. `cli.js` no longer treats "a file has both a scene and a page" as an
   error. It always prefers the page pipeline when any `page` exists (a
   `scene` only renders standalone when the file has *no* page at all - the
   same "which one am I building" rule as always, just resolved once at the
   top instead of rejecting the combination outright). A scene that's
   declared but never referenced by any `viewport` in the rendered page now
   produces a warning, not a silent no-op: *"scene 'X' is declared but no
   'viewport' embeds it - it won't render."*

## Runtime: one shared 3D engine, two call sites

All the actual three.js code - building meshes/lights/groups from a plan,
loading a `model`'s glTF, tweening `animate`, raycasting for `on
click`/`hover` - used to live entirely inside `client.js` (the whole-page
scene renderer). It has moved to `renderer/scene3d.js` as
`createSceneRuntime(scenePlan, { container, scriptEnv, fitToContainer })`,
which mounts a scene into any DOM element and hands back a `tick(now)`
function. Neither call site owns a `requestAnimationFrame` loop itself:

- **`client.js`** (a whole-page `scene` file, unchanged in what it produces
  for the user) is now a ~15-line bootstrap: create the top-level env, mount
  one scene into `document.body` with `fitToContainer: false` (sized to the
  window, exactly as before), drive one `requestAnimationFrame` loop calling
  its `tick`.
- **`domClient.js`** mounts one `createSceneRuntime` per `viewport` node,
  into that viewport's own hydrated DOM element, with `fitToContainer:
  true` (sized and kept in sync with the element's own box via
  `ResizeObserver` - a real, responsive improvement over the old
  whole-window-only 3D renderer, not just a side effect of extraction). It
  then folds every mounted viewport's `tick` into the *same*
  `requestAnimationFrame` loop that already drives the page's own CSS
  animations. A page with a DOM fade and two embedded rotating models runs
  on exactly one animation driver, not three.

This is the concrete "Animation is a shared system" claim: not a shared
*API surface* (the `animate`/`on` grammar already was shared, before this
milestone), but a shared *scheduler*.

## Assets

Serving three.js's core module, the `GLTFLoader` addon, and a `model`'s
actual `.glb`/`.gltf` bytes used to be `server.js`-only logic. It's
extracted to `renderer/threeVendor.js` (`resolveAssetFiles`,
`serveThreeRequest`, `writeThreeVendorFiles`), used by both `server.js`
(a whole-scene file) and `domServer.js` (a page, gated on whether any of
its viewports actually reference a `model` - a page with only primitive
shapes in its viewports still never pays for the GLTFLoader addon, same
"don't ship what you don't use" rule the scene-only path already had).

## Hydration / SSR

A page still server-renders real HTML for everything DOM (unchanged - a
`viewport` server-renders as an empty, correctly-sized `<div>`, same as any
other element). There is no server-side rendering of 3D content - a
`viewport`'s box exists and is correctly sized on first paint (so layout
doesn't jump once JS runs), but the canvas itself, like the whole-page
scene renderer before it, only exists once `domClient.js` runs. This is a
pre-existing, honest limitation (three.js has no meaningful SSR story), not
something this milestone was scoped to fix.

## Coordinate systems

Two coordinate spaces exist and do not know about each other: CSS pixels
for DOM layout, and each viewport's own independent 3D scene-local space
(right-handed, degrees in the language, radians in three.js, matching the
existing scene renderer exactly). There is currently no projection between
them - an HTML label that tracks a 3D object's screen position, or a 3D
object that reacts to DOM scroll position, is out of scope for v1. That's
the "scroll-driven camera choreography" and "2D/3D overlay" work the
project roadmap lists separately; it needs this fusion boundary to exist
first, which is what this milestone builds.

## Cleanup / disposal

**Known, deliberate gap, not an oversight.** AXIS has no dynamic
mount/unmount of DOM subtrees yet (no conditional rendering, no lists that
change length at runtime) - every `viewport` that exists is mounted once,
at page load, and stays mounted for the page's lifetime. Because nothing in
the language can ever *remove* a `viewport`, `scene3d.js` does not implement
a `dispose()` path: writing one now would be untested, unreachable code
(explicitly against this project's own rules). When AXIS gets conditional
or list rendering, disposal (releasing the renderer, geometries, materials,
and the `ResizeObserver`) has to be designed together with that feature,
not bolted on speculatively now.

## What this milestone deliberately does NOT do

- ~~No shared/reactive state between a page and an embedded scene beyond
  top-level `let`/`fn`~~ - **built in the next milestone**, see
  [reactive-state.md](reactive-state.md): a top-level `state` is now a
  genuinely shared, two-way-mutable cell, not just a value baked in once. A
  scene's own *objects* still aren't exposed into the page's handler
  namespace or vice versa (each domain keeps its own `on` handlers/object
  names) - only `state`/`let` crosses the boundary, and only explicitly.
- **No DOM/3D coordinate projection** (see above).
- **No multiple cameras / camera choreography tied to scroll.** A viewport
  still has exactly one camera, same as a standalone scene.
- **No component-level fusion.** A `component` can't yet declare a
  `viewport` inside it that gets its own instance per use (untested path,
  not attempted here).
