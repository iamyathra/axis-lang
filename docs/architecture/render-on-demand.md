# Render-on-demand: a scene stops costing anything once it's still

Status: **implemented.** Every scene AXIS could mount - a whole-page `scene`
(client.js) or a `viewport` embedded in a `page` (domClient.js), both driven
by the one shared three.js runtime in scene3d.js - used to call
`renderer.render(scene, camera)` unconditionally, every animation frame,
forever, from the moment it mounted until the tab was closed. A page with
three static, unanimated viewports was rendering all three, 60 times a
second, indefinitely, for no visual reason at all. This milestone replaces
that with an invalidate()-driven loop: a scene renders when something
actually changed, and goes quiet the instant nothing is left to show.

## The old loop

`client.js` and `domClient.js` each had a `function tick(now) { requestAnimationFrame(tick); ...; renderer.render(scene, camera); }` - self-rescheduling,
unconditional, with no exit. `scene3d.js`'s `tick(now)` (the shared per-scene
step both callers drove) never returned anything, and never decided whether
a frame was necessary; it just did the work and trusted the caller to call it
again next frame, forever.

## The new model: one `dirty` flag per scene, plus a shared `needsMore`

`scene3d.js`'s `createSceneRuntime` now owns a private `dirty` flag and an
`invalidate()` closure that sets it (and calls the caller's `onInvalidate`,
so an idle *caller* loop knows to wake up). `tick(now)` still runs the same
animation/timeline/orbit-control-update work it always did, but now:

- only calls `renderer.render(...)` when `dirty` is true, then clears it;
- returns a `needsMore` boolean - true while an animation or a driver-`"playback"`
  timeline is still running, or while `OrbitControls.update()` reports the
  camera is still moving.

`client.js` and `domClient.js` no longer self-reschedule unconditionally.
Each keeps one `scheduled` flag and a `wake()` function: `wake()` requests
exactly one animation frame (if one isn't already pending), that frame calls
`tick(now)`, and only calls `wake()` again if `tick` returned `needsMore`
(domClient.js's own `tick` folds in every mounted viewport's `runtime.tick(now)`,
so the page's own loop keeps running as long as *anything* it's driving
still needs frames). No `needsMore` anywhere in the chain, and the
`requestAnimationFrame` chain simply stops - not "stops doing work," stops
*existing*.

Nothing outside scene3d.js/client.js/domClient.js knows any of this exists.
The AXIS language has no new syntax, no new plan field, and no way to
observe `dirty`/`invalidate`/`wake` at all - this is a runtime scheduling
detail underneath the existing `animate`/`timeline`/`scrollTimeline`/
`scrollProgress` semantics, not a replacement for any of them.

## What still calls `invalidate()`, and why

Anything that changes what a frame would show, but happens *outside* the
normal `tick()` call (so there's no already-running loop to naturally pick
it up), calls `invalidate()` explicitly:

- **Initial mount** - `dirty` starts `true`, so the first frame always renders.
- **A `model`'s glTF finishing its async load** - resolves well after the
  `tick()` that triggered the fetch returned.
- **`reRender()`** (state-driven 3D property changes, both a scene's own
  handler and a page's `state` write reaching an embedded viewport via
  `onStateChange`) - already the single re-check dispatcher from
  [reactive-state.md](reactive-state.md); it now also flips the dirty bit.
- **`triggerAnimation`** (an `on` handler starting a plain `animate`) and
  **`playTimeline`/`playPageTimeline`** (an `on` handler restarting a
  `timeline`) - pushed from a click/hover handler, not from inside `tick()`.
- **`applyChangeToTarget`** - a page-level timeline step reaching into a
  viewport's own object (the cross-domain targeting from
  [page-scene-fusion.md](page-scene-fusion.md)'s timeline follow-up).
- **`seekTimeline`** - a scroll-driven (`driver: "scroll"`) timeline's own
  seek, called from the page's scroll-linked sampling.
- **`OrbitControls`'s own `'start'` event** - fires at the beginning of a
  drag/wheel/touch gesture, purely so an idle runtime wakes for the *first*
  frame of a gesture; every subsequent frame is decided by
  `OrbitControls.update()`'s own return value instead (see below).
- **`handleResize()`** - a container or window resize.
- **A passive `window` `scroll` listener** (`domClient.js`, only wired up
  when the page actually has a `scrollTimeline`/`scrollProgress` - see
  `HAS_SCROLL_LINKS`) - wakes the loop and starts a `SCROLL_SETTLE_MS`
  (200ms) window during which `tick()` keeps re-sampling scroll progress.
  This is **only a wake signal** - it does not measure or apply scroll
  progress itself. The actual per-frame measurement
  (`scrollProgressFor(element)`) and the calls into `seekTimeline`/`setState`
  still happen entirely inside `tick()`, exactly as before this milestone -
  see [the scroll-progress-as-data work](../language.md) for why a second
  scroll-measurement system was explicitly ruled out.

## What still needs continuous rendering, and why

- **A running `animate` or a `driver: "playback"` timeline** - every frame
  it's active is a real interpolation step; `tick()` keeps returning
  `needsMore: true` until the last cycle finishes, then stops for good (not
  "stops doing work while still being asked for frames" - the frame requests
  themselves stop).
- **`OrbitControls` while actually moving** - damping means a drag or wheel
  gesture keeps producing new camera positions for a few frames after the
  input itself stops; `orbitControls.update()`'s own boolean return is the
  single source of truth for "is the camera still settling," reused directly
  as both the dirty signal and the `needsMore` signal.
- **An active scroll gesture** (`HAS_SCROLL_LINKS` pages only, during their
  settle window) - scroll position can change every frame while the user is
  actively scrolling, and there's no scroll-specific "did it change" event
  cheaper than just sampling it.

Everything else - a static scene, a finished animation, a settled camera, a
page after scrolling has stopped - renders zero frames until something calls
`invalidate()`/`wake()` again.

## Scope: per scene, not global

Each mounted scene (whole-page or one `viewport`) owns its **own** `dirty`
flag and its **own** `needsMore` contribution. A page's outer loop calls
`runtime.tick(now)` on *every* mounted viewport whenever it's awake for *any*
reason (one viewport animating, a scroll gesture, a DOM-only `animate`) - but
each viewport's `tick()` independently decides whether it actually renders.
An idle viewport's cost during that shared wake is a cheap early-return, not
a GPU frame - so one animating viewport never forces a sibling idle one to
render.

## `dispose()`

`createSceneRuntime`'s returned API gained a `dispose()` (disconnects the
resize observer/listener, disposes `OrbitControls`, disposes the renderer).
Nothing calls it yet - AXIS has no `viewport` unmount/teardown story at all,
a pre-existing gap this milestone doesn't attempt to close. It's added now,
alongside the rest of this runtime's lifecycle work, so the primitive exists
before the language grows a reason to call it.

## What this deliberately does NOT do

- **No public AXIS-language API.** No new keyword, property, or handler
  exposes scheduling. `invalidate`/`wake`/`dirty`/`needsMore` are runtime
  internals only.
- **No dependency tracking, no per-property dirty regions.** A dirty scene
  re-renders the *whole* frame, same as always - only the decision of
  *whether* to render at all is new.
- **No second scroll-measurement system.** Confirmed above; worth repeating
  because it was the single easiest thing to get wrong here.
- **No viewport unmount/teardown feature.** `dispose()` exists as a
  primitive; nothing in the language can trigger it yet.

## Verification

`examples/render-on-demand.ax` mounts three scenes side by side: a fully
static one, one with a single finite `animate`, and one driven by a page
`scrollTimeline`, alongside plain DOM content. Browser-verified (`axis run`)
and static-build-verified (`axis build` + `python3 -m http.server`) with a
temporary per-scene render-call counter (removed before landing): the static
scene rendered exactly once at mount and never again, however long either
sibling scene stayed active; the finite-animation scene rendered a handful
of frames and then stopped identically to the static one; the scroll-driven
scene rendered only in response to actual scroll input, in both dev and the
static production build.
