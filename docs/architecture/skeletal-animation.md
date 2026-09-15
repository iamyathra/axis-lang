# Skeletal/clip animation: a loaded model's own clips, driven by the timeline engine that already exists

Status: **implemented.** A `model`'s glTF/GLB file can carry animation
clips - skeletal (bone-deformed) or plain node-transform, glTF doesn't
distinguish the two at the API level and neither does this milestone - that
were previously parsed by `GLTFLoader` and immediately discarded (see
`examples/model.ax`'s v3.1-era note: "Not supported yet: skeletal animation,
animation clips baked into the file"). This milestone keeps them, and gives
AXIS the smallest language surface that makes them usable: `clip: "Walk"` on
a `model` (selects a clip, auto-plays it once loaded - the same "declared at
the top level plays automatically" convention `animate`/`timeline` already
have), `play CLIP on TARGET`/`stop TARGET` (runtime selection/playback
control from an `on` handler), and `progress` joining the existing scalar
animate-path vocabulary (`intensity`, `color`, ...) so a clip's normalized
time is just another `animate`/`timeline`/scroll-linked-`scrollTimeline`
target - not a second animation system bolted on next to the first one.

## Where this milestone starts: the existing asset/render pipeline

Before writing any of this, the existing architecture was mapped (not
assumed) across four questions:

1. **How does a `model` asset load, and where does the loaded object become
   available?** `scene3d.js`'s `loadModel(node, holder)` calls three.js's
   `GLTFLoader.load()`, and on success does `holder.add(gltf.scene)` -
   `holder` is a plain `THREE.Group` created *synchronously*, before the
   fetch even starts, standing in for the model at its declared
   position/rotation/scale (so parenting, sibling layout, and `animate`
   targeting its transform all work immediately, load or no load). The
   loaded content only exists as `holder`'s child once `gltf.onLoad` fires,
   well after the node-building loop that created `holder` has finished.
2. **Did animation clips already survive loading?** No. `gltf.animations`
   (three.js's `GLTFLoader` result always carries this - an array of
   `THREE.AnimationClip`, whether the file's animations target a
   `SkinnedMesh`'s bones or a plain node's transform) was never read at all;
   the callback used `gltf.scene` and nothing else from the result object.
3. **What's the existing render-scheduling architecture?** Render-on-demand
   (see [render-on-demand.md](render-on-demand.md)): one shared `tick(now)`
   per mounted scene, called once per animation frame by the caller
   (`client.js`/`domClient.js`, whichever owns the actual
   `requestAnimationFrame` loop), returning whether it still needs more
   frames. A `dirty` flag decides whether `tick()` actually calls
   `renderer.render()`; `invalidate()` is the one function anything that
   changes this scene's visual state *outside* `tick()` itself calls.
   `runningAnimations` (plain `animate`) and `runningTimelines` (`timeline`)
   are the two existing "things `tick()` advances every frame," both
   elapsed-since-start based.
4. **Where could a mixer/action live without a second render loop?** Inside
   `createSceneRuntime`'s own closure, alongside `runningAnimations`/
   `runningTimelines` - advanced from the exact same `tick()` call, sharing
   the exact same `dirty`/`needsMore`/`invalidate()` protocol. There was no
   architectural reason to reach for a second loop, and several reasons not
   to (documented in render-on-demand.md's "what this deliberately does not
   do": no second scroll-measurement system, no dependency tracking bolted
   on beside the existing one - the same logic applies to a second animation
   loop).

## The language surface, and why it's shaped this way

**`clip: "Walk"` on a `model`** - a plain string property, validated like
any other (`SCENE_ALLOWED_PROPS.model`, `interpreter.js`), *not* reactive
(excluded from `bindings`, same treatment as `src`/`controls` - a model's
initial clip selection isn't something a running scene hot-swaps via
`state`, the same way its source file isn't; `play` is the live-swap path,
see below). Declaring it alone is enough to see it play, looping, the
instant the model finishes loading - deliberately mirroring `animate`'s and
`timeline`'s own "declared at the top level plays automatically" contract,
not a new convention.

**`play CLIP on TARGET`** and **`stop TARGET`** - new statements, usable
inside an `on` handler (or an `if`/`while`/`for` nested in one), the exact
same scope `play NAME` (timeline restart) already has. `play`'s existing
grammar already had exactly the right shape for a two-target extension:
`parsePlayStmt` now parses one `parseTarget()` (bare name or parenthesized
computed expression - the same convention `animate`/`on`/`play` all already
use) and, only if the keyword `on` immediately follows, parses a *second*
`parseTarget()` and returns a `PlayClipStmt` instead of the original
`PlayStmt`. This needed no backtracking and breaks nothing: `play NAME`
(no `on`) parses exactly as before, byte-for-byte the same AST it always
produced, and `on` can never legally follow a bare `play NAME` statement
today (a new statement starts there instead), so seeing it is an
unambiguous signal. `stop TARGET` is a single new statement, parsed the same
way `play`'s original target always was.

Why two new statements instead of overloading `play NAME` to mean "either a
timeline or a clip, guess from context"? A `timeline` name is a compile-time
scene declaration (`this.timelines`, checked at build time); a clip name is
a string baked into an external `.glb`/`.gltf` file, unknowable until the
browser actually loads it. Collapsing them into one ambiguous grammar would
mean one keyword sometimes validates at build time and sometimes can't -
worse for error messages, not simpler for the language. `play CLIP on
TARGET`'s explicit second target also reads the way the feature actually
works: "play this clip *on* this model," not "play this clip" (which clip,
on what?) - a `timeline` never needed a target because a `timeline` only
ever has one thing it could mean.

Both are pure runtime primitives (`scene3d.js`'s `playClip`/`stopClip`,
dispatched through the exact `handlerHooks.onCustomStatement` escape hatch
`AnimateDecl`/`PlayStmt` already use) - `interpreter.js` never inspects a
handler body's statements at build time at all (see `interpretOnDecl` -
`body` is stored as raw AST and shipped to the browser untouched), so there
was no build-time validation to add or skip for these, the same as `play
NAME`'s own "no timeline with that name" check has always been a *runtime*
error (`scene3d.js`'s `playTimeline`), not a build-time one, despite
`timeline` names being statically knowable - build-time-checkable was never
actually the bar `play` set; component-instance renaming
(`renameIdentifiers`) was, and both new statements got a case for that (see
"Components," below).

**`progress`** joins the single-token animate-path vocabulary (alongside
`intensity`, `color`) in three places that already shared it:
`applyChange`/`currentLiveValue` (scene3d.js, the actual per-frame/live-read
dispatch) and `currentValueFor` (renderer/plan.js, the build-time "from"
resolver for a top-level auto-play `animate`). Nothing about `animate`,
`timeline`, `at`/`previous`/`label`/stagger, or scroll-linking needed to
learn a new concept - a normalized clip time behaves exactly like any other
number-valued object property already does, so the entire existing engine
(easing, `duration`/`delay`/`repeat`, `at`-scheduling inside a `timeline`,
and - see below - `scrollTimeline`/`seekTimeline`) applies to it for free.

## Mixer/action state: where it lives, and its exact shape

One `modelClips: Map<name, state>` per `createSceneRuntime` closure,
entries created *synchronously* in the same node-building loop that creates
each model's `holder` Group - before the glTF fetch even starts, so `play`/
`stop`/a `progress` write racing the load always has somewhere safe to
record what's wanted (see "Missing/invalid/pre-load clips," below) instead
of needing a separate "not ready yet" error path.

```js
{
  mixer: THREE.AnimationMixer | null,   // null until loaded AND actually needed (zero-clip models never allocate one)
  clips: Map<name, AnimationClip> | null, // null = "still loading"; an empty Map = "loaded, has none" - the distinction reconcileClip needs
  action: THREE.AnimationAction | null, // the currently selected clip's action, once chosen
  desiredClip: string | null,           // the clip name that should be active
  playing: boolean,                     // should the mixer auto-advance this action every tick() - false while scrubbed or stopped
  progress: number | null,              // last explicit 'progress' write (0-1); null once native playback has taken over again
  lastTime: number | null,              // this model's own last tick() timestamp - see "Per-model delta time," below
}
```

**`reconcileClip(name)`** is the one function where all four ways this state
can change (`clip:`'s load-time default, `play`, `stop`, a `progress` write)
actually take effect - it's a no-op until `clips` is non-null (loaded), then
creates/replaces the `AnimationAction` as needed (`mixer.clipAction(clip)` -
three.js itself memoizes this per mixer+clip+root, so calling it again for
the same clip is cheap and returns the same action) and leaves it in the
right paused/playing/scrubbed state. Every *caller* invalidates the scene
itself; `reconcileClip` doesn't, so a caller that's also doing other work in
the same pass isn't forced into a redundant `invalidate()` (the same
division of responsibility `applyChange` already has).

**`progress` itself** is a real accessor property (`Object.defineProperty`)
defined directly on each model's `holder` Group, at construction time - the
exact same shape a light's `intensity` already is on its own THREE object.
This is what lets `applyChange`'s existing single-token dispatch
(`if ("progress" in obj3d) obj3d.progress = value`) reach it with zero new
branching logic beyond the one-line addition each of `applyChange`/
`currentLiveValue` got. The setter clamps to `[0, 1]`, pauses native
playback (`playing = false` - an explicit "show me this exact frame," the
same intent `stop` has), and calls `reconcileClip`; the getter returns the
live action's `time / clip.duration` once one exists, or the last written
`progress` before that.

## Per-model delta time, inside the one existing loop

Every other thing `tick()` already advances (`animate`, a playback-driven
`timeline`) is elapsed-since-its-own-start - clean, but wrong for a
*looping* clip, which has no fixed start to measure from. Three.js's own
`AnimationMixer.update(deltaSeconds)` is what actually advances one, so
`tick()` gained one small loop, alongside the existing `animate`/`timeline`
ones:

```js
for (const state of modelClips.values()) {
  if (!state.playing || !state.mixer) continue;
  needsMore = true;
  const delta = state.lastTime === null ? 0 : (now - state.lastTime) / 1000;
  state.lastTime = now;
  state.mixer.update(delta);
  dirty = true;
}
```

Each model tracks its *own* `lastTime` rather than one scene-wide clock -
`lastTime` resets to `null` whenever playback (re)starts (`reconcileClip`'s
`playing` branch), so a scene that had gone fully idle (nothing animating,
`tick()` not being called at all - the normal render-on-demand state) and
then wakes up for a fresh `play` never advances that first frame by however
long the scene had been idle. A model that's `stop`ped or being scrubbed by
`progress` contributes nothing here at all - not `needsMore`, not a `dirty`
write - so a paused clip costs nothing beyond the one `if` check, and
render-on-demand's existing guarantee ("everything renders zero frames
until something calls `invalidate()`/`wake()` again," see
render-on-demand.md) extends to clips unchanged.

## Multiple models: verified independent

Each model gets its own `THREE.AnimationMixer`, bound to its own `holder`
(three.js mixers are independent objects by construction - nothing shared
between two of them) and its own `modelClips` entry. Verified directly (not
just by code inspection) in the browser: `examples/skeletal-animation.ax`'s
two characters run genuinely different clips ("Wave" looping natively,
"Salute" scroll-scrubbed) simultaneously with zero cross-talk - stopping one
via a click leaves the other's `action.time` advancing exactly as before,
confirmed by reading each model's own `AnimationAction.time` directly
(not just visually) across repeated samples.

## Lifecycle

- **`dispose()`**: `AnimationMixer` has no `dispose()` of its own (no GPU or
  native resource - just references to its actions/root); `stopAllAction()`
  plus dropping this runtime's own `modelClips` map (mirroring every other
  collection `dispose()` already clears) is sufficient. `tick()`'s existing
  `disposed` guard (checked before anything else, see
  [viewport-lifecycle.md](viewport-lifecycle.md)) already guarantees no
  mixer here advances again regardless, the same way it already stops
  `animate`/`timeline`.
- **A model's async load finishing after the runtime it belongs to was
  disposed**: covered by `loadModel`'s pre-existing `if (disposed) return;`
  guard, unchanged - `reconcileClip` for a load that resolves post-dispose
  simply never runs, exactly like the material-overlay/mesh-traversal work
  right next to it never did.
- **`visible`/conditional viewport, mount/unmount/remount**: untouched by
  this milestone - `modelClips` lives entirely inside `createSceneRuntime`'s
  own closure, recreated fresh on every mount, so a remounted viewport gets
  entirely new mixers with no possible leakage from a previous mount. Zero
  console errors, correct canvas add/remove, and independently-verified
  clip state (fresh auto-play pose after remount) confirmed in the browser
  across single toggles and five rapid toggles in immediate succession (the
  same race `conditional-viewport.md`'s own `pendingMount`/`pendingUnmount`
  guards resolve - unmodified by this milestone, and still correct with
  clip state along for the ride).
- **Sticky scroll-linked viewport**: `examples/skeletal-animation.ax`'s
  `salute` character's `progress` is driven by a page-level `scrollTimeline`
  through a sticky-pinned `viewport`, the exact composition
  [sticky-scroll-timeline.md](sticky-scroll-timeline.md) already documented
  for any other scene property - no changes needed there at all.

## Missing/invalid/pre-load clips

- **A model with no animation clips at all**: `clips` becomes an empty
  `Map` once loaded (not `null` - loading genuinely finished, there's just
  nothing in it). `reconcileClip` finds no `desiredClip` match, logs one
  clear `console.error` naming what the file actually has (`"(none)"` in
  this case), and leaves `playing`/`desiredClip` cleared rather than
  retrying forever.
- **A nonexistent clip name** (typo, or a real name that isn't in this
  particular file): the same `reconcileClip` path - `console.error` listing
  the file's real clip names, deterministic, no crash. Matches
  `loadModel`'s own existing error-reporting style
  (`console.error` on a failed fetch) rather than throwing, since this can
  fire from an async load-completion callback with no live `on`-handler
  call stack to catch an `AxisRuntimeError` usefully.
- **A model that fails to load entirely**: `clips` stays `null` forever
  (the pre-existing `(err) => console.error(...)` branch never sets it) -
  `reconcileClip` for that model is permanently a no-op, exactly like every
  other model-dependent operation already silently doesn't happen for a
  failed load.
- **A clip requested (`play`/`stop`/a `progress` write) before the model's
  load completes**: recorded on `modelClips`' entry (created synchronously,
  well before any load can possibly finish) and reconciled for real the
  moment `loadModel`'s own callback calls `reconcileClip` after populating
  `clips` - the same "apply once loaded" pattern `node.material` overlays
  already used for exactly this reason, not a new one.
- **`play`/`stop` targeting an object that doesn't exist, or exists but
  isn't a `model`**: a clear runtime `AxisRuntimeError` ("no object with
  that name in the scene" / "it's not a model - only a 'model' has
  animation clips to play"), the same voice `triggerAnimation`'s own "can't
  animate 'X'" and `playTimeline`'s "no timeline with that name" already
  use, caught and logged by the same `runHandler` try/catch every `on`
  handler already runs inside.

## Components

`renameIdentifiers` (interpreter.js) - the pass that rewrites a component
instance's bare local names to their namespaced (`instanceName.`) form
inside its own handler bodies - gained cases for `PlayClipStmt` (both
`clip` and `target`, following the exact bareword-lookup-or-recurse-if-
computed rule `AnimateDecl`'s own `target` already has) and `StopClipStmt`
(`target` only). Verified directly: two instances of the same component,
each declaring `model body { ... }` and `on body.click { play Walk on body
stop body }`, produce two handlers whose `PlayClipStmt`/`StopClipStmt`
correctly target `a.body`/`b.body` respectively, not a shared bare `body`.

## What this deliberately does NOT do

- **No inverse kinematics, bone manipulation, or procedural animation.**
  AXIS reads and plays clips a file already carries; it doesn't let a scene
  reach into individual bones.
- **No animation blending.** One clip active per model at a time -
  switching (`play` with a different name) is a hard cut
  (`action.stop()`/fresh `clipAction()`), not a crossfade. This is the
  stated "smallest useful capability," not an oversight - three.js's own
  `crossFadeTo` exists and was deliberately not reached for.
- **No state machines.** `playing`/`progress`/`desiredClip` is a flat
  record reconciled by one function, not a transition graph - the same
  "two states cover every real distinction" reasoning
  [viewport-lifecycle.md](viewport-lifecycle.md) used for `disposed`.
- **No physics.**
- **No generic asset pipeline changes.** Everything here is additive to the
  existing `model`/`GLTFLoader`/asset-serving path - `renderer/plan.js`'s
  asset collection, `renderer/server.js`'s serving, and `assetSrcError`'s
  path validation are all completely unchanged.
- **No morph targets, Draco/KTX2 compression.** Still genuinely not
  supported - unrelated to clips, not touched here.
- **`clip:` is not itself reactive/`state`-bindable.** Its initial value is
  read once, like `src`; live selection is `play`'s job. A future milestone
  could reconsider this if a real use case needs it - not added speculatively.

## Verification

`examples/skeletal-animation.ax` (browser-verified, both `axis run` and a
static `axis build` + `python3 -m http.server` production build) mounts one
`scene` (embedded via a `viewport`) with two independently animated
characters, sharing `examples/assets/character.glb` - a small, genuinely
skinned (two real bones, real per-vertex skin weights - not a whole-object
transform) hand-built fixture with two named clips ("Wave", "Salute"), the
same "hand-built but spec-compliant" approach `examples/assets/pyramid.glb`
already used for static geometry (built with three.js's own
`SkinnedMesh`/`Skeleton`/`Bone`/`AnimationClip`/`GLTFExporter` APIs, not by
hand-authoring glTF JSON).

Measured directly (each model's real `AnimationMixer`/`AnimationAction`
state, not just visual appearance) across repeated samples:

- **`clip:` auto-play on load**: both characters begin looping their
  respective clips (`action.paused === false`, `action.time` advancing)
  the instant each one's glTF finishes loading, with zero explicit trigger.
- **`play`/`stop` (native playback)**: clicking the "wave" character
  toggles `stop` (freezes - `playing: false`, `action.paused: true`,
  `action.time` provably unchanged across a further 2-second wait) and
  `play Wave on wave` (resumes - `playing: true`, restarted from `time: 0`,
  advancing again).
- **`progress` (scroll-scrubbed)**: scrolling the page's sticky-pinned
  section drives `salute`'s clip progress bidirectionally and
  deterministically - `progress`/`action.time` tracked scroll position
  exactly (e.g. `scrollY: 500` -> `progress: 0.3625`, `scrollY: 1500` ->
  `progress: 0.663`, then scrolling back up to `scrollY: 700` ->
  `progress: 0.423`, confirming reversibility, not just forward playback).
- **Composability**: clicking `salute` mid-scroll-scrub switches it to
  native playback (`playing: true`, `progress: null`, restarted from `time:
  0`); scrolling again afterward re-claims it for scrubbing
  (`playing: false`, `progress` matching the new scroll position again) -
  confirmed working in both directions, repeatedly.
- **Two independent models, no cross-talk**: stopping `wave` never affected
  `salute`'s own advancing `action.time`, and vice versa, throughout.
- **Render-on-demand**: `renderer.info.render.frame`/scene `dirty` state
  confirmed idle (no new frames) while both clips were stopped/settled, and
  actively incrementing only while at least one was playing or being
  scrubbed - matching render-on-demand.md's existing "everything renders
  zero frames until something calls invalidate()" guarantee, now including
  clip playback.
- **Lifecycle**: `visible`-driven mount/unmount/remount (via a page button
  wired to the exact `viewport visible: expr` primitive
  conditional-viewport.md built) - clean unmount (canvas removed, zero
  console errors), clean remount (fresh auto-play state, independent of
  whatever the previous mount's clips were doing), and five rapid toggles
  in immediate succession converging correctly with zero errors, mirroring
  conditional-viewport.md's own verification of the same race.
- **Production build parity**: the full scroll-scrub/click/lifecycle
  sequence re-verified against a static `axis build` output served over
  plain HTTP, with identical results and zero console errors.
