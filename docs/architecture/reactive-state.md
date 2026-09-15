# Reactive state (v1): one shared cell, not two copies

Status: **implemented, intentionally narrow.** This is the follow-up to
[page-scene-fusion.md](page-scene-fusion.md), which explicitly postponed
"two-way state sharing beyond top-level `let`/`fn`." This milestone builds
that sharing - for `state`, in both directions - without touching anything
else fusion already got right.

## The problem this replaces

Before this milestone, "a page and a scene share a top-level `let`" was true
only at *build time*: `interpret()` evaluated it once, baked the resulting
value into whatever object property read it, and that was the end of the
relationship. At runtime, in the browser, a page's `pageEnv` and an embedded
viewport's `sceneEnv` each independently received their own **copy** of
whatever they'd captured - two separate `Environment.define()` calls, two
separate memory cells, initialized to the same starting value and then
completely unrelated. A page button that did `count += 1` had no way to
affect a 3D object's color, and clicking a 3D object had no way to update a
page's text, because there was no shared variable at runtime, only a shared
*initial* value at build time.

## The model: one cell, many readers

AXIS does not get a new state-management API, a store, or an event bus. It
gets a well-known fact about lexical scoping applied on purpose: `evaluator.js`'s
`Environment.set(name, value)` walks up the parent chain and mutates the
environment where `name` is **defined**, not the environment `.set()` was
called from. So if a name is defined exactly once, on an environment every
other environment is a descendant of, every one of those descendants reads
and writes the *same* cell.

That's the entire mechanism:

1. **`state` (and `let`) can now be declared at the top level of a file**,
   not just inside a `page` or `scene` body. `interpret()` evaluates these
   once into `globalEnv` (exactly like it always did for top-level `let`)
   and also collects them into a new `sharedVariables` map -
   `{ name: { value, constant, reactive } }` - carried on both
   `buildRenderPlan`'s and `buildDomPlan`'s output.
2. **The browser runtime defines `sharedVariables` exactly once**, on
   `scriptEnv` - the one environment `client.js`, `domClient.js`, and every
   `scene3d.js` scene instance already built their own env as a *child* of
   (this ancestor relationship already existed, for `fn`; sharing `state`
   through it needed no new plumbing). A page's `pageEnv` and every mounted
   viewport's `sceneEnv` are siblings under that same `scriptEnv` - so an
   assignment in any one of them lands on the shared cell, and any other
   domain's next binding re-evaluation sees it.
3. **Any non-literal property expression becomes a binding - now inside a
   `scene` too, not just a `page`.** `SceneBuilder.applyProperty` gained the
   same "stash the raw expression if it isn't a bare literal" step
   `PageBuilder.applyProperty` already had. A shape's `color`, `position`,
   `rotation`, or `scale` that reads a variable is now live, exactly like a
   page element's `content` or `opacity` already was.
4. **One dispatcher, widened, not duplicated.** `domClient.js`'s `reRender()`
   (patches DOM bindings) gained a sibling, `reRenderAll()`, which also
   calls every mounted viewport's own `reRender()` (a new function in
   `scene3d.js`, the 3D-side mirror of the DOM one - patches a shape's
   live-bindable properties via its existing `LiveObject` setters). Both a
   page handler and a scene's own handler (via a new `onStateChange`
   callback passed into `createSceneRuntime`) now trigger the *same*
   app-wide re-check, in either direction, after they run.

No dependency tracking was added - this is the same "full but cheap
re-check" model `state` already used inside a page, just applied across
domain boundaries instead of within one. That's a deliberate choice, not a
missed opportunity: AXIS already had exactly this trade-off, documented and
accepted, for pages; extending it consistently is more honest than quietly
introducing a second, more sophisticated reactivity model for the
cross-domain case while leaving the single-domain case as-is.

## What's live-bindable, and what isn't

Only a shape's (`cube`/`sphere`/`plane`/`cylinder`) `position`, `rotation`,
`scale`, and `color` are live-bindable from the 3D side. That's not an
arbitrary cut: it's exactly the set of properties an `on` handler could
already mutate imperatively (`box.color = red`), via the same `LiveObject`
wrapper. A light or a group isn't an addressable, mutable value in the
language at all yet (an `on` handler can't reach one today either) - making
their properties reactive would be new ground unrelated to this milestone,
not an extension of an existing capability. A `model`'s `src` is explicitly
excluded even though it's a shape-adjacent property: hot-swapping a loaded
glTF file is a materially different feature (asynchronous re-fetch,
re-parenting a whole loaded subtree) that this milestone doesn't touch.

## What this deliberately does NOT do

- **No derived/computed values.** There's no `derived`/`computed` keyword -
  a property expression can already combine several `state` values inline
  (`content: "Count: " + count`), which covers the common case. A *named*,
  reused derived value is future work, not attempted here.
- **No dependency tracking.** Every binding, in every mounted domain, is
  re-checked after every handler anywhere. This is fine at the scale AXIS
  runs at today; it stops being fine well before AXIS would need to worry
  about it, and the honest fix (real dependency tracking) is a bigger,
  separate project.
- **No reactive animation parameters.** An `animate` block's `duration`/
  target values are still evaluated once (at load, or at trigger time) -
  they don't re-run if the `state` they read changes mid-animation.
- **No state persisted across a `viewport`'s mount cycle** - moot today
  (AXIS still can't unmount one), but worth naming: a mounted viewport reads
  the *current* value of shared state at construction, not a frozen
  snapshot, so this was correct by construction, not by an added feature.
- **A rapid interaction during a viewport's (async) mount window can be
  missed** - `createSceneRuntime` is asynchronous (it may need to fetch the
  GLTFLoader addon), so a click on a not-yet-mounted viewport's canvas, or
  on a page control in the same instant, can land before that viewport is
  wired up. Once mounted (typically well under a second, sooner with no
  `model` to load), everything is live. Not fixed here; noting it honestly
  rather than letting a screenshot imply otherwise.

## Verification

`examples/configurator.ax` proves both directions in one file: page buttons
write a shared `state productColor`/`productScale` a 3D cube's `color`/
`scale` read, and clicking that same cube writes a shared `state clicks` a
page `text` reads. Browser-verified (`axis run`) and static-build-verified
(`axis build` + a plain `python3 -m http.server`, not just the dev server)
in both directions.
