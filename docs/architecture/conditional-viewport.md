# Conditional viewport rendering: the AXIS-language trigger for a lifecycle that already existed

Status: **implemented.** [viewport-lifecycle.md](viewport-lifecycle.md) built
`mountViewport`/`unmountViewport` as correct, tested internal primitives and
said plainly that nothing called them - AXIS had no way for a `viewport` to
disappear on its own. This milestone closes that one gap, with the smallest
feature that closes it: `visible: expr` on a `viewport`, wired straight to
the primitives that already exist.

## The gap this closes

`unmountViewport(name)` could dispose a mounted viewport completely -
stop rendering, free GPU resources, remove the canvas, drop the scroll
link - and had since the previous milestone. But nothing in AXIS source
could ever call it. A `viewport` was mounted once, at page load, and lived
for the life of the page. This milestone adds exactly one thing: a boolean
property that decides whether a `viewport`'s own 3D runtime exists at all,
reactive the same way every other bound page-element property already is.

```ax
state showScene = true

page main {
    viewport demo {
        scene: "Earth"
        visible: showScene
    }

    button toggle {
        text: "Toggle"
        on click {
            showScene = !showScene
        }
    }
}
```

## Why `visible`, and why this shape

AXIS's own property grammar (`parser.js`'s `parsePath`/`parseProperty`)
already does everything this needed - a dotted-path property with a value
expression is exactly what `visible: showScene` is. **No parser changes at
all.** The entire language-surface addition is: `visible` accepted (and
required to be a real boolean) on `DOM_ALLOWED_PROPS.viewport`
(interpreter.js), defaulting `true`; and the existing "stash a non-literal
property expression as a live binding" mechanism
(`PageBuilder.applyProperty`'s `bindings` stash) picks it up for free,
exactly the way `content`, `color`, `background`, and everything else
`state`-bindable already work. This is the same mechanism, not a new one -
see docs/language.md's State section.

`visible` is deliberately scoped to `viewport` only - not a
`UNIVERSAL_DOM_PROP` every element gets. Writing `visible: true` on a
`container`/`text`/anything else is the same "doesn't have that property"
error an unrecognized property always gets. This is a 3D-runtime lifecycle
switch, not a general conditional-rendering feature - see "What this
deliberately does NOT do," below.

## The model: one reactive boolean, one owner of what it does

domClient.js gains a single new piece of state, `viewportVisibility` (a
`Map<viewport name, boolean>`) and one function, `setViewportVisible(node,
visible)`, that's the *only* place `visible`'s effect actually happens:

1. No-op if `visible` isn't an actual change from what `viewportVisibility`
   already has recorded for this viewport - the exact rule the mission
   specified (`true -> true`/`false -> false` do nothing) implemented as a
   single equality check, not a bigger state machine.
2. Toggles the viewport's own DOM container's `display` (`""` or `"none"`) -
   page-DOM bookkeeping this file already owns everywhere else (see
   `applyElementProperty`).
3. Calls `mountViewport(node)` or `unmountViewport(node.name)` - the exact
   same two functions [viewport-lifecycle.md](viewport-lifecycle.md) built,
   completely unmodified in what they guarantee. This function orchestrates
   them; it does not duplicate anything either one does.

`setViewportVisible` has exactly two callers, both already-existing control
points, not new ones:

- **`reRender()`'s own bindings loop** - a `visible: someState` binding that
  changed is routed here instead of `applyElementProperty`'s generic DOM-
  property dispatch (which wouldn't know to mount/unmount anything). This is
  the declarative path: an `on click` handler flips `showScene`, the
  existing `reRenderAll()` re-check (already called after every handler,
  see [reactive-state.md](reactive-state.md)) finds the changed binding, and
  the runtime follows.
- **The initial per-node mount loop**, at the bottom of domClient.js, which
  already existed to call `mountViewport` once per viewport at page load -
  it now checks `viewportVisibility` (seeded from the plan's own build-time
  value) first, so a viewport that starts `visible: false` is never mounted
  at all.

No new reactive-state mechanism was built. `visible` rides the exact
dependency-free "re-evaluate every binding, compare against the last value,
act on what changed" loop every other `state`-bound property already uses -
see docs/architecture/reactive-state.md.

## Avoiding a double-mount at page load

`reRender()`'s very first call happens at module load, before the per-node
mount loop has run - and its own `lastBoundValues` cache starts empty, so
*every* binding looks like "changed" on that first pass, including a
reactive `visible` expression. Without a seed already in place, that first
pass would call `setViewportVisible` and try to mount the same viewport the
per-node loop is about to mount for real, a moment later.

The fix is ordering, not new logic: `viewportVisibility` is seeded from
`node.visible` (the plan's own build-time value - what the server actually
rendered) *before* `reRender()`'s first call. That first pass then finds
`visible`'s freshly-evaluated value already equal to what's seeded, so
`setViewportVisible` no-ops (correctly - nothing actually changed), and the
per-node loop performs the one real initial mount. A viewport with no
reactive `visible` binding at all (the common case - a literal `true`/
`false`, or no `visible` property) never touches this path either way; the
per-node loop is its only mounter.

## Avoiding a double-mount from rapid toggling

Hiding and showing a viewport fast enough - before its (async)
`createSceneRuntime()` call even resolves - is a real race this milestone
introduces that the previous one couldn't: previously a viewport was
*mounted* exactly once, ever; now `mountViewport` can be asked to mount the
same name again while an earlier call for it is still in flight.

`mountViewport` gained two guards, both checked before it starts a new
`createSceneRuntime()` call:

1. **Already live?** (`viewportRuntimesByName.has(node.name)`) - a no-op.
   Can't happen through `setViewportVisible`'s own equality check under
   normal sequencing, but costs nothing to guard directly.
2. **Already mounting?** (`pendingMount`, a new `Set` alongside the existing
   `pendingUnmount`) - also a no-op, rather than starting a second
   concurrent `createSceneRuntime()` for the same name. Before returning,
   though, it clears any `pendingUnmount` entry for this name - a fresh
   mount request supersedes whatever unmount was queued while this same
   in-flight mount was still pending.

That second point is what makes rapid toggling converge on the *last*
requested state instead of racing: `pendingUnmount`'s existing contract
(from viewport-lifecycle.md) is "dispose the instant this in-flight mount
resolves, instead of ever registering it as live." A `true -> false -> true`
flip while still mounting queues an unmount, then immediately cancels it -
so when the one real `createSceneRuntime()` call eventually resolves, it
finds nothing queued and registers normally. A `false -> true -> false`
flip, mirrored, queues nothing and then queues an unmount - so the runtime
gets disposed the moment it appears. Either way, exactly one
`createSceneRuntime()` call is ever in flight per viewport at a time, and
the outcome always matches whatever `visible` was most recently set to,
regardless of how many times it flipped in between. `unmountViewport`
itself needed no changes at all - its existing `pendingUnmount` contract
already covered its half of this.

## Waking the runtime

A mount that happens well after page load (i.e. from an `on` handler, not
the initial mount) has no guarantee the page's own render-on-demand loop
(`wake()`/`tick()`, see [render-on-demand.md](render-on-demand.md)) is still
running - an otherwise-idle page will have already let it settle back to
sleep. A freshly-created runtime's `dirty` flag starts `true` (its first
frame is still owed), so `mountViewport`'s own resolution now calls
`wake()` once it registers the runtime live, guaranteeing that first frame
actually gets scheduled instead of silently waiting for something unrelated
to wake the loop.

## DOM behavior

The container `<div>` a `viewport` renders into is still page-owned,
server-rendered markup, unchanged from viewport-lifecycle.md's ownership
model - `visible` doesn't touch that. What's new: this container's own
`display` now tracks `visible` too, toggled by `setViewportVisible`
alongside the mount/unmount call, so hiding a viewport doesn't just remove
its canvas (leaving an empty box at its usual size, per
viewport-lifecycle.md's disposal guarantee) but collapses out of the page's
own layout entirely - the more complete "this thing is gone" a *conditional*
feature should give, versus viewport-lifecycle.md's original disposal
primitive, which only ever needed to guarantee the runtime was correctly
torn down, not that the page reflowed around its absence.

An initially-hidden viewport (`visible: false`, whether a literal or a
reactive expression whose build-time value is `false`) has `display: none`
baked into its server-rendered style directly (domPlan.js) - no flash of an
empty 400px box before domClient.js hydrates and no wasted layout either.

## Initial mount

`visible: false` at page load means no `createSceneRuntime()` call at
all - not a mount-then-immediately-dispose. The per-node mount loop checks
`viewportVisibility` (seeded from the plan's own build-time value) before
ever calling `mountViewport`, so a hidden-at-load viewport never allocates a
`WebGLRenderer`, never fetches `GLTFLoader`/`OrbitControls` even if its
scene would otherwise need them, and never does any of the node-building
work `createSceneRuntime` does before its first `return`.

## What this deliberately does NOT do

- **Not a general conditional-rendering feature.** `visible` exists on
  `viewport` only. There's no way to conditionally mount/unmount a
  `container`, `text`, or any other element - see docs/language.md's Known
  Limitations.
- **No virtual DOM, no diffing, no reconciliation.** A `viewport`'s presence
  is a single boolean with two possible real effects (mount, unmount) - not
  a tree comparison of any kind.
- **No list rendering.** A `for` loop can still only generate objects once,
  at build time (or component-instantiation time) - this doesn't add a
  reactive `for`.
- **No routing, no page transitions.** Named by the original mission as
  things this lifecycle is *for*, still not things this builds.
- **No new reactive-state mechanism.** `visible` is read through the exact
  same dependency-free bindings re-check every other bound property already
  uses - see docs/architecture/reactive-state.md. No dependency tracking was
  added for this or anything else.
- **No change to `mountViewport`/`unmountViewport`'s own disposal
  guarantees.** Every guarantee viewport-lifecycle.md documented (render
  scheduling stops, GPU resources freed, canvas removed, scroll link
  dropped, disposed runtimes can't resurrect from a stale async callback)
  is unchanged - this milestone only adds a new, race-safe way to *call*
  them.

## Verification

`examples/conditional-viewport.ax` mounts two viewports side by side:
A (always `visible`, its own continuously-repeating `animate`) and B
(`visible: showB`, its own continuously-repeating `animate`, a scroll-linked
`timeline`, and a `scrollProgress` write) - a button toggles `showB`.
Browser-verified in dev (`axis run`) and a static production build
(`axis build` + `python3 -m http.server`), measuring purely external DOM
signals (canvas count inside B's own container, that container's computed
`display`, and a page text binding reading `showB`'s presence via a helper
function) rather than any internal debug hook - none were added or needed:

- Initial load: both viewports mounted (one canvas each), zero console
  errors.
- Click to hide B: B's canvas count drops to 0, its container's `display`
  becomes `"none"`, A is untouched (still 1 canvas, still animating - a
  before/after zoom screenshot shows its cube at a different rotation a
  couple of seconds apart, i.e. still actively ticking).
- Click to show B again: a fresh canvas appears, `display` returns to its
  normal (unset) value, zero console errors.
- Five rapid clicks in immediate succession (no waiting between them,
  deliberately faster than `createSceneRuntime()` can resolve): the guard
  logic in `mountViewport` (see "Avoiding a double-mount from rapid
  toggling," above) converges correctly on the final requested state (an
  odd number of toggles from "mounted" ends "unmounted") - B's canvas count
  is exactly 0, not more than one canvas, not a stuck intermediate state.
  Zero console errors.
- Hiding and immediately re-showing B while scrolled partway through its
  own scroll-linked timeline: no errors, B's canvas count and `display`
  both correctly reflect the final state, and the freshly-remounted runtime
  picks up the current scroll position on its own (via the same
  `addScrollLink` call `mountViewport` has always made on a successful
  mount).
- The same full sequence, repeated against a static production build served
  over plain HTTP (`axis build` + `python3 -m http.server`), with identical
  results.

`examples/render-on-demand.ax`, `examples/viewport-lifecycle.ax` (including
re-verifying `on box.click` interaction still fires), `examples/
scroll-progress.ax` (scroll-driven progress text still updates correctly),
and `examples/unified-story.ax` were each re-verified in the browser
afterward and are unaffected by this milestone. The full existing example
set (every `.ax` file in `examples/`) was also re-built with `axis build`
to confirm nothing regressed at the build-pipeline level.
