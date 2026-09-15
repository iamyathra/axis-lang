# Viewport lifecycle: mount, unmount, and a dead runtime that stays dead

Status: **implemented as an internal primitive; not yet reachable from AXIS
source.** [render-on-demand.md](render-on-demand.md) added `dispose()` to
`createSceneRuntime`'s returned API and noted honestly that nothing called
it. This milestone makes `dispose()` actually correct and idempotent, gives
every mounted viewport an explicit owner in `domClient.js`
(`mountViewport`/`unmountViewport`), and closes every resurrection path a
disposed runtime previously had - without inventing a way for AXIS itself to
trigger an unmount yet, because none exists (see "What this deliberately
does NOT do," below).

## The problem this replaces

Three real bugs, all stemming from the same root cause - nothing ever
removed a mounted viewport's runtime from anything:

1. `domClient.js`'s `viewportRuntimes`/`viewportRuntimesByName` were
   populated once, at mount, and never had an entry removed. There was no
   way to make a runtime stop being ticked, stop being re-rendered on a
   `state` change, or stop being reachable by a page-level timeline step.
2. `scrollLinkedTargets` (the passive-scroll-driven sampling list) had the
   same problem - a viewport's own scroll-link entry, once added, lived
   forever.
3. `scene3d.js`'s `dispose()` (added last milestone) only handled the
   resize observer/listener, `OrbitControls`, and the renderer's own
   internal caches. It didn't remove the canvas from the DOM, didn't free
   the scene's own geometries/materials/textures, didn't remove the
   pointer/raycasting listeners it had attached, and - the sharpest gap -
   had no way to stop `invalidate()`/`tick()`/`reRender()`/`setState()`/
   `applyChangeToTarget()`/`seekTimeline()`, or a `model`'s in-flight async
   load, from continuing to do real work (including scheduling more frames)
   on a runtime that had supposedly already been "disposed."

That last point is the one the mission named directly: `viewport mounts →
model starts loading → viewport unmounts → runtime disposed → model
finishes loading` - before this milestone, that completion callback would
still call `invalidate()`, which would still call `onInvalidate` (`wake()`),
which would still find the (still-registered) runtime in `viewportRuntimes`
and tick it. A "disposed" scene could come back to life.

## The model: one `disposed` flag, checked at every entry point

`createSceneRuntime` gained a single `disposed` boolean, private to its
closure. Every function that could touch the renderer, mutate scene state,
or ask for another frame checks it first and does nothing if it's set:
`invalidate`, `tick`, `reRender`, `setState`, `applyChangeToTarget`,
`seekTimeline`, `handleResize`, and the `loadModel` success callback. This
is deliberately not a bigger state machine (`mounting`/`active`/
`unmounting`/`disposed`, ...) - the mission asked for "an unambiguous state,
for example: mounted, disposed, or a similarly minimal model," and two
states cover every real distinction this runtime's own behavior needs to
make.

`dispose()` itself is now idempotent: it checks `disposed` first and returns
immediately on a second (or third, or hundredth) call - flipping the flag is
the very first thing it does on its real run, before any cleanup, so a
listener callback that fires mid-dispose (unlikely, but not provably
impossible) still sees the flag already set.

## Exact disposal guarantees

Calling a runtime's `dispose()` (idempotently):

1. Stops render scheduling - `tick()` returns `false` unconditionally once
   `disposed`, so it never renders and never asks for another frame again.
2. Disconnects its `ResizeObserver`, or removes its `window` `resize`
   listener (whichever it actually has - `fitToContainer` decides this once,
   at mount).
3. Removes its pointer/raycasting listeners (`click`, `pointermove`) via a
   single `AbortController` created at mount and aborted here - one call
   removes both, regardless of whether this scene had any interactive
   objects at all.
4. Disposes `OrbitControls` (if present) and removes the `'start'` listener
   this runtime itself added to it.
5. Frees this scene's own GPU resources - every geometry, material, and any
   texture a material holds, found by traversing this scene's own graph
   (`disposeSceneResources`). `renderer.dispose()` alone does not do this;
   it only frees the renderer's internal caches/programs, not what the
   scene's objects themselves own.
6. Disposes the `WebGLRenderer` and removes its canvas
   (`renderer.domElement`) from the DOM - a disposed viewport's box is now
   visibly empty, not a stale last frame.
7. Drops its own internal strong references (`object3Ds`, `meshesByName`,
   `interactiveMeshes`, `runningAnimations`, `runningTimelines`) - once
   nothing outside the runtime still references it either (see
   `unmountViewport`, below), the whole closure is eligible for garbage
   collection. This is not a claim that GC has been *proven* to run - only
   that the runtime itself no longer holds anything that would prevent it.

## Async asset safety

`loadModel`'s glTF success callback checks `disposed` before doing anything
- no `holder.add(gltf.scene)`, no material overlay, no mesh traversal, no
`invalidate()`. The fetch itself isn't cancelled (three.js's `GLTFLoader`
has no cancellation hook, and the mission didn't ask for one - "do not
necessarily cancel network requests unless the existing architecture makes
that appropriate," and it doesn't here). The guarantee is narrower and
sufficient: whenever the fetch does finish, a disposed runtime cannot become
active again because of it.

## Event/listener cleanup

- Pointer/raycasting listeners: one `AbortController` per runtime, created
  at mount, aborted once in `dispose()` - see guarantee 3, above.
- `OrbitControls`' own internal DOM listeners: removed by
  `orbitControls.dispose()` itself (three.js's own contract); this
  runtime's own `'start'` listener on top of that is explicitly removed
  too.
- Resize: `ResizeObserver.disconnect()` / `removeEventListener("resize", ...)`
  - both already idempotent on a repeat call, independent of this
  milestone's own `disposed` guard.
- Scroll: see "How multiple viewports behave," below - this is
  `domClient.js`'s responsibility (a scroll link is page-owned bookkeeping,
  not something `scene3d.js`'s own `dispose()` knows about), not
  `scene3d.js`'s.

## Animation cleanup

A running `animate` (including `repeat: infinite`), a playback-driven
`timeline`, and a scroll-driven one are all just state `tick()`/
`seekTimeline()` advance - once `tick()` is a disposed no-op and
`seekTimeline()` is a disposed no-op, nothing advances any of them again,
regardless of how many were running or what triggered them. No animation
callback holds a reference to the runtime independent of the runtime's own
closure, so there's nothing extra to unhook here beyond the guards already
listed.

## How multiple viewports behave (ownership in `domClient.js`)

`domClient.js` gained the actual lifecycle control point:
`mountViewport(node)` and its exact inverse, `unmountViewport(name)`. These
are the only two places anything reaches into `viewportRuntimes`/
`viewportRuntimesByName`/`viewportScrollUnsubscribes` - the previous
one-shot mounting loop now just calls `mountViewport` once per `viewport`
plan node, unchanged in behavior.

`unmountViewport(name)`:

1. Looks the runtime up by name. Not found and never requested before? A
   no-op (nothing to do). Not found because it's still mid-mount (
   `createSceneRuntime` is async - it may still be fetching `GLTFLoader`/
   `OrbitControls`)? Recorded in a `pendingUnmount` set - `mountViewport`'s
   own `.then` checks this the instant the runtime actually appears, and
   disposes it immediately instead of ever registering it as live. This
   closes the exact async race the mission called out at the *mount* level,
   the same way `scene3d.js`'s own `disposed` guard closes it at the
   *model-load* level.
2. Calls `runtime.dispose()` (all of the guarantees above).
3. Removes it from `viewportRuntimes` and `viewportRuntimesByName` - the
   page's own `tick()` loop and `reRenderAll()` both iterate
   `viewportRuntimes` directly, so a removed viewport is skipped from the
   very next frame on, not just inert if reached.
4. Removes its own scroll-link entry from `scrollLinkedTargets`, if it had
   one (`addScrollLink` now returns its own removal closure for exactly
   this) - a disposed viewport's scroll callback stops being sampled at
   all, not just silently no-op via `scene3d.js`'s own guard. Two-layer
   defense: `unmountViewport`'s bookkeeping is the "nothing stale lingers"
   layer, `scene3d.js`'s `disposed` guards are the hard safety net that
   stays correct even if a caller ever forgot this step.

Disposing one viewport touches only its own entries in these three
collections - a sibling viewport's own runtime, scroll link, and render
scheduling are untouched, which is exactly what render-on-demand's own
per-scene `dirty` scoping already guaranteed for *active* viewports; this
milestone extends the same guarantee to *disposal*.

## Resource ownership

- `scene3d.js` owns, and disposes: its own `THREE.Scene`'s geometries/
  materials/textures, its own renderer and canvas, its own resize/pointer/
  orbit-control listeners.
- `scene3d.js` does **not** own, and never touches: `scriptEnv` (the page's
  shared top-level `state`/`let`/`fn` scope - `sceneEnv` is a *child* of it,
  dropped along with the rest of this runtime's closure, but the shared
  parent itself is untouched), the page's own DOM elements outside the
  canvas it created (the `viewport`'s own container `<div>` is page-owned,
  server-rendered markup - `dispose()` removes the canvas *from* it, not the
  container itself), and nothing about any other mounted viewport.
- `domClient.js` owns, and cleans up on unmount: the entry in its own
  `viewportRuntimes`/`viewportRuntimesByName`/`viewportScrollUnsubscribes`
  bookkeeping. It does not own anything inside the runtime itself - it
  never reaches past `runtime.dispose()`.

## What this deliberately does NOT do

- **No AXIS-language trigger.** `unmountViewport` exists as a correct,
  tested internal primitive with no current caller - AXIS still has no
  conditional rendering, no dynamic DOM add/remove, and no way for a
  `viewport`'s own container element to disappear on its own. This is the
  same honest disclosure `dispose()` itself shipped with last milestone
  ("nothing calls it yet"), extended one layer up: now the *primitive that
  would call it* also exists, correctly, with nothing yet wired to call
  *that*.
- **No MutationObserver, no automatic DOM-removal detection.** Considered
  and rejected - AXIS already controls every point a `viewport` is created
  (`mountViewport`, the one loop that walks `plan.nodes`), so that's the
  right control point for its removal too, once something exists to call
  it. Watching the DOM for changes AXIS itself never makes would be
  speculative infrastructure for a feature that doesn't exist yet.
- **No conditional rendering, no routing, no page transitions.** All named
  by the mission as things this lifecycle is *for*, not things this
  milestone builds.
- **No proof of garbage collection.** `dispose()` drops every strong
  reference this runtime's own closure held; once `unmountViewport` also
  drops the last *external* reference, the whole thing is eligible for GC.
  Whether/when the browser's collector actually reclaims it is outside what
  this milestone measures or claims.
- **No shared asset cache, no texture deduplication.** `disposeSceneResources`
  only walks and disposes this scene's own graph - if AXIS ever loads the
  same `.glb` into two viewports, each still gets and disposes its own
  independent copy, exactly as before. A shared cache is real future work,
  explicitly out of scope here.

## Verification

`examples/viewport-lifecycle.ax` mounts three viewports (A/B/C): A and C are
completely static; B alone carries a continuously-repeating `animate`, a
`timeline` driven by the viewport's own `scrollTimeline`, a `scrollProgress`
write into its own scene-local `state`, and an `on box.click` handler.
Browser-verified in both dev (`axis run`) and a static production build
(`axis build` + `python3 -m http.server`) via a temporary debug hook
(`window.__axisDebugUnmountViewport`, plus render-count/collection-size
counters, all removed before finishing) calling `unmountViewport("B")`
directly - AXIS itself has no way to trigger this yet. Measured, in both:
clicking B's cube first (`bClicks: 0 → 1`) proved interaction worked before
disposal; after `unmountViewport("B")`, its canvas was gone from the DOM
(`querySelectorAll('canvas').length` 1 → 0 inside B's container), its render
count froze permanently (through further scrolling and a repeat click
attempt at its old location), `viewportRuntimes.length` dropped 3 → 2, and
its own scroll-link entry dropped out of `scrollLinkedTargets` (1 → 0) -
while A and C's own render counts, unaffected the entire time, kept
incrementing normally. Calling `unmountViewport("B")` twice more, and once
on a name that was never a real viewport, threw nothing and changed
nothing. Zero console errors throughout. `examples/render-on-demand.ax`,
`examples/scroll-progress.ax`, and `examples/unified-story.ax` were each
re-verified in the browser afterward and are unaffected by this milestone.
