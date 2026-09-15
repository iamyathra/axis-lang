# Sticky scroll-linked viewports: a pattern, not a feature

Status: **implemented with zero changes to `src/`.** The "tall wrapper,
pinned inner element" scrollytelling pattern - [docs/language.md](../language.md)'s
Timelines section named it explicitly as "not yet supported... isn't
supported cleanly yet" - turns out to already be a correct composition of
three independently-shipped primitives:
[`scrollTimeline`/`scrollProgress`](../language.md#scroll) measuring
progress from whichever element they're declared on, [DOM + 3D in one
timeline](../language.md#dom--3d-in-one-timeline)'s cross-scene page-timeline
steps, and `position` already being an arbitrary CSS string. This milestone
is mostly verification, an example, tests, and this document - not new
runtime code.

## The problem this replaces

`scrollProgressFor(el)` (domClient.js) computes progress from `el`'s own
`getBoundingClientRect()` - `0` when its top edge would enter the bottom of
the window, `1` when its bottom edge would leave the top. This works
perfectly for an ordinary, normally-flowing element: its rect changes
continuously and monotonically as the page scrolls past it.

A `position: sticky` element's own rect does **not** do that while it's
pinned - by design, that's what "sticky" means. If `scrollTimeline`/
`scrollProgress` were declared on the *same* element that's sticky-
positioned, progress would climb briefly, then freeze at whatever value it
had the instant the element stuck, for the entire pin duration, then resume
- exactly the "not supported cleanly" gap the docs disclosed.

## The fix: measure the wrapper, pin the child

`scrollTimeline`/`scrollProgress` already only ever look at the element
they're declared on (see `mountViewport`'s `addScrollLink(container, ...)`
for a viewport, and the bottom per-node loop's `addScrollLink(element, ...)`
for any other element - both in domClient.js, both unchanged by this
milestone). Nothing forces that element to be the *same* one that's visually
sticky. So: declare `scrollTimeline`/`scrollProgress` on a plain, tall,
**normally-flowing** wrapper `container`; nest the `viewport` you want
visually pinned as its child, with its own `position: "sticky"` and `top`:

```ax
scene reveal {
    camera { position: (0, 2, 8) }
    model hero { src: "./hero.glb" }
}

page Home {
    container pin {
        direction: "column"
        height: 3000
        scrollTimeline: "arc"

        viewport stage {
            scene: "reveal"
            position: "sticky"
            top: 0
            height: 500
        }
    }

    timeline arc {
        animate ("stage.hero") { rotation.y -> 360deg duration: 2000 }
    }
}
```

`pin`'s own rect keeps moving continuously through the entire scroll-through
- its `height: 3000` sets how long that takes, exactly the way `height` on
any scroll-linked element already does. `stage`'s own rect, meanwhile, stays
pinned at `top: 0` for as much of that range as `pin`'s own height allows -
real browser CSS, computed by the browser's own layout engine, that
`scrollProgressFor` never looks at, measures, or needs to know exists.

`arc`'s own steps reach `stage`'s embedded scene through the *existing*
cross-scene page-timeline mechanism (`animate ("stage.hero") { ... }` -
[docs/language.md](../language.md#dom--3d-in-one-timeline)), unchanged: `pin`
is a plain page element with a `scrollTimeline`, exactly like
`examples/unified-story.ax`'s own `hero` wrapper already was, just now with
a sticky-positioned child instead of a plainly-flowing one.

## Why this needed no new language surface

Everything the pattern above uses already existed, independently, before
this milestone:

- **`position` is an unvalidated string** (interpreter.js's
  `DOM_STRING_KEYS`) - `"sticky"` was never rejected; it was simply never
  *paired* with a wrapper measuring something else.
- **`scrollTimeline`/`scrollProgress` already work on any element**, not
  just `viewport` - see docs/language.md's Scroll section ("On a `viewport`
  ... On any other element - a `container`, a `heading`, anything...") and
  `tests/scroll-progress-state.test.js`'s own
  `"'scrollProgress' is accepted on any page element, not just viewport"`.
- **A page-level `timeline` step can already cross-reference a `viewport`'s
  embedded scene** - `examples/unified-story.ax` already demonstrated this,
  with an ordinary (non-sticky) wrapper.

Composing "wrapper carries the scroll measurement" with "child is visually
pinned" doesn't cross any of these mechanisms with each other in a new way
- it's the same two independent facts (an element's *measured* scroll
progress, and an element's *own* CSS position) simply being facts about two
different elements instead of accidentally being forced onto one. AXIS
never tried to implement pinning, and doesn't need to stop trying - it never
started.

## Coordinate spaces, and why they don't get coupled

Four distinct things are in play, and this pattern keeps them from ever
touching each other's math:

1. **Document scroll position** (`window.scrollY`) - the single source
   `scrollProgressFor` reads from, indirectly, via `getBoundingClientRect()`
   (which is itself computed relative to the current scroll position).
2. **The wrapper's own bounding box** - a plain in-flow element; its `top`/
   `height` change continuously and predictably as the user scrolls, exactly
   like any other scroll-linked element already did before this milestone.
   This is the *only* rect `scrollProgressFor` ever reads for this pattern.
3. **The sticky child's own bounding box** - governed entirely by CSS
   `position: sticky`'s own algorithm (browser-native, not AXIS code). Its
   `top` reads `0` (or whatever offset) while pinned, and something else
   while not - AXIS's scroll-progress math never reads this rect at all,
   for the sticky child specifically.
4. **Timeline progress** (`0..1`, then mapped onto a timeline's own
   `0..duration`) - a pure function of (2), same formula, same code path,
   same as every other scroll-linked element.

The reason these can't become "accidentally coupled" (the mission's own
phrasing) is structural, not defensive: `addScrollLink` takes exactly one
DOM element and measures exactly that element's own rect. There is no
implicit "find the sticky descendant" step, no shared cache keyed by
anything other than the element identity itself, and no code path in
domClient.js that reads a *different* element's rect than the one
`scrollTimeline`/`scrollProgress` were declared on. Two independent pinned
sections on the same page (see `examples/sticky-scroll.ax`'s `pinA`/`pinB`)
share nothing - not a rect, not a progress number, not a timeline - beyond
both existing in the same `scrollLinkedTargets` array, exactly the
independence `examples/scroll-story.ax` already established for two
ordinary (non-sticky) scroll-linked viewports.

## What "let CSS own sticky behavior" means concretely

AXIS's own code does not know, check, or care whether any element on the
page has `position: sticky`. `mountViewport`'s `fitToContainer` sizing reads
`container.clientWidth`/`clientHeight` (its **content box**, which `position`
never affects) through the same `ResizeObserver` every viewport already
uses, sticky or not - a pinned viewport's canvas resizes exactly the way a
normally-positioned one's does, because nothing in that code path
distinguishes them. Conditional viewport rendering's own `visible` (see
[conditional-viewport.md](conditional-viewport.md)) composes the same way -
`setViewportVisible` toggles `display`, mounts/unmounts the runtime, and
neither of those touches or reads `position` either.

## What this deliberately does NOT do

- **No new property, no new keyword.** `position: "sticky"` uses grammar
  and validation that already existed. This milestone's entire `src/` diff
  is zero lines.
- **No sticky-aware progress formula.** `scrollProgressFor` is unchanged -
  it still only ever reads *the element it's called with*. The pattern
  works by choosing *which* element that is (the wrapper), not by teaching
  the formula about sticky children.
- **No automatic "find the sticky child and pin it for the author" sugar.**
  The wrapper and the sticky child are both ordinary, independently-declared
  elements - AXIS doesn't infer a relationship between them from anything
  but ordinary DOM nesting, the same way it never inferred anything about
  ordinary (non-sticky) parent/child element pairs either.
- **No scrollable-container support.** Only the document's own scroll
  position drives anything here, same limitation `scrollTimeline` already
  had before this milestone (see docs/language.md's Scroll section).
- **No pin-duration validation.** AXIS doesn't check that a wrapper's
  `height` actually exceeds its sticky child's own height (the condition
  that gives a sticky element any pin duration at all) - that's ordinary CSS
  authoring knowledge, the same way AXIS doesn't validate that a `duration`
  is "reasonable" or that a `timeline`'s steps don't overlap oddly.

## Verification

`examples/sticky-scroll.ax` mounts three viewports: two independent pinned
sections (`stageA`/`stageB`, each its own tall wrapper, its own
`scrollTimeline`, cross-referencing its own scene's objects) plus one
perfectly ordinary, non-sticky, non-scroll-linked viewport (`plain`) as the
regression control. `stageA` is also `visible`-toggleable (conditional
viewport rendering, from the previous milestone), and its wrapper's
`scrollProgress` feeds a shared `state` a page-level text reads live.

Browser-verified (`axis run`) and against a static production build
(`axis build` + `python3 -m http.server`), via external, purely observable
signals - no debug hooks added or needed:

- **Continuous, non-stuck progress while pinned**: sampled at multiple
  real scroll depths (via genuine wheel-scroll input, not programmatic
  `scrollTo` - see the note on verification method, below) while reading
  `stageA`'s own `getBoundingClientRect().top` at each point. Progress
  climbed smoothly and monotonically (18% -> 23% -> 39% -> 58%, scrolling
  down) while `top` stayed pinned at exactly `0` for the entire pinned
  range, and moved away from `0` correctly at the transition edges (before
  pinning starts, and after the wrapper's own bottom is reached) -
  confirming the wrapper's rect (not the sticky child's) is genuinely what's
  driving progress.
- **The 3D timeline actually advances while pinned**: `stageA`'s cube
  visibly grew (the `scale.x/y/z -> 1.3` step) and rotated while its own
  `top` stayed at `0` throughout.
- **Independence**: `stageB` (a completely separate wrapper/scrollTimeline/
  scene) reached its own pinned state and advanced its own timeline (a
  sphere's material going metallic) with no relationship to `stageA`'s own
  progress or pin state.
- **The ordinary-viewport regression check**: `plain` (no `position`, no
  `scrollTimeline`) kept animating (a continuously-repeating rotation)
  identically before, during, and after all of the above - two screenshots
  taken ~500ms apart show it at different rotation angles throughout.
- **Conditional visible + sticky compose correctly**: toggling `stageA`'s
  `visible` while scrolled partway through its own pin range correctly
  removed its canvas and collapsed its container (`display: none`); toggling
  back re-mounted a fresh runtime that immediately re-pinned at `top: 0`.
  Five rapid toggles in immediate succession converged on the correct final
  state with zero duplicate mounts and zero console errors (the same
  race-safety `mountViewport`'s `pendingMount`/`pendingUnmount` guards -
  [conditional-viewport.md](conditional-viewport.md) - already provided,
  completely unmodified by this milestone).
- **Static production build**: the identical scroll-depth/pin/progress
  checks, repeated against `axis build`'s output served over plain HTTP,
  with identical results.
- **Zero console errors** throughout every scenario above, in both dev and
  the static build.

### A note on verification method (real scroll vs. programmatic `scrollTo`)

This automation environment's tab is not the OS-focused/visible tab between
tool calls (`document.visibilityState` reads `"hidden"` even as the sole
open tab) - Chrome throttles `requestAnimationFrame` and `ResizeObserver`
callbacks in that state, confirmed directly with a bare, AXIS-independent
`ResizeObserver` that never fired despite a real, verified box-size change.
Programmatic `window.scrollTo()` calls were similarly unreliable at
triggering AXIS's passive `scroll` listener under this same throttling -
confirmed as a pre-existing, sticky-unrelated characteristic by reproducing
the identical staleness on `examples/scroll-progress.ax` (already-shipped,
untouched by this milestone). Genuine simulated wheel-scroll input (this
harness's `computer` tool) was not affected by this throttling and produced
the continuous, correct progress readings this document reports. **Resize**
specifically could not be live-verified end-to-end for this reason: the
container's own `clientWidth`/`clientHeight` were confirmed to update
correctly and immediately under a CSS size change regardless of `position:
sticky` (proving the DOM box model itself isn't affected), but the
`ResizeObserver` callback that would resize the canvas to match could not be
observed firing in this session, for the plain (non-sticky) viewport
identically to the sticky ones - a disclosed environment limitation, not a
finding about AXIS's own code (which received zero changes to its resize
handling in this milestone).

`examples/scroll-story.ax`, `examples/unified-story.ax`, and
`examples/scroll-progress.ax` were each re-verified in the browser after
this milestone (real scroll gestures, checking for console errors and
correct rendering) and are unaffected - expected, since this milestone
changed no source file they depend on.
