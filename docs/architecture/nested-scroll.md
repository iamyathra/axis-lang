# Nested scroll containers: `scrollRoot`

Status: **implemented.** The one piece of the "tall wrapper, pinned inner
element" scrollytelling pattern the project's own roadmap had listed first
([sticky-scroll-timeline.md](sticky-scroll-timeline.md) built the pinning
half; this closes the other half) - `scrollTimeline`/`scrollProgress`
could only ever measure against the document's own scroll position, never
a scrollable container (`overflow-y: auto`) nested inside the page.

```ax
container panel {
    css: "overflow-y: auto"
    height: 320

    container track {
        height: 1600
        scrollTimeline: "reveal"
        scrollRoot: "panel"
        scrollProgress: "progress"
    }
}
```

## The design: one new property, the same formula

`scrollRoot: "name"` names an ancestor element to measure against instead
of the document - unset means exactly today's behavior, fully backward
compatible. No new timeline/progress mechanism: `scrollProgressFor(el,
root)` (domClient.js) generalizes its existing formula by replacing the
document's own "viewport" (`window.innerHeight`, and `el`'s
`getBoundingClientRect().top` measured from coordinate 0) with the root
element's own `getBoundingClientRect()` - `rootRect.height` stands in for
`window.innerHeight`, and `rect.top - rootRect.top` stands in for `rect.top`
alone, since `getBoundingClientRect()` is always viewport-relative
regardless of which element it's called on. Passing no `root` collapses
back to exactly the original formula (`rootRect = {top: 0, height:
window.innerHeight}`), which is why this needed no new test coverage for
the document case - it's the same code path, not a fork of it.

`interpreter.js` validates `scrollRoot` at build time: it has to name a
real *ancestor* of the element declaring it (walking `.parent` links,
already-registered objects only, so an element can't name itself or a
not-yet-declared sibling), the same "did you mean" treatment every other
target name gets. This works for any element type, `viewport` included -
`scrollRoot` is a `UNIVERSAL_DOM_PROP`, independent of whether
`scrollTimeline`/`scrollProgress` are actually set at all.

## Waking the loop: a `scroll` event never bubbles

The existing scroll-driven design deliberately has no `scroll` listener
doing the actual measurement (see [render-on-demand.md](render-on-demand.md) -
progress is sampled once per frame in the shared render loop, a listener's
only job is waking a stopped loop back up). That listener was on `window`
alone, which works for the document case because a `scroll` event
*targeting* `document`/`window` is the only kind that bubbles there. A
`scroll` event on a nested `overflow: auto` container does not bubble at
all - `window`'s own listener would simply never fire for it. Fixed by
attaching one additional passive `scroll` listener directly to each
distinct element any node names via `scrollRoot` (deduplicated - several
scroll-linked elements can share one root without doubling up listeners),
doing the exact same "note the time, wake the loop" job the `window`
listener already does. Nothing else about the render loop needed to
change - once woken, `tick()`'s own per-frame sampling already reads
whichever `root` each `scrollLinkedTargets` entry carries.

## What this deliberately does NOT do

- **No new scroll-measurement concept.** `scrollTimeline`/`scrollProgress`
  mean exactly what they already meant; `scrollRoot` only changes *what
  "the viewport" means* for that one measurement.
- **No automatic `overflow` styling.** Making a container actually
  scrollable is the author's own `css: "overflow-y: auto"` (or a
  `responsive` override) - AXIS doesn't infer "this has `scrollRoot`
  pointed at it, so it must scroll."
- **No multi-axis (horizontal) scroll support** - the formula, like the
  document-based one before it, is vertical-only.

## Verification

`tests/nested-scroll.test.js` covers the build-time contract (accepted
when it genuinely names an ancestor - immediate parent or further up -
rejected with a clear, suggestion-bearing error for a sibling, a
non-ancestor, self, or a typo'd name; carries through `domPlan.js`
unchanged when omitted). The actual scroll-driven math has no Node-testable
equivalent (no real layout engine under `node --test`) - verified instead
through the same from-scratch DOM shim `reactive-structure.md` used,
extended with fake (but internally consistent) `getBoundingClientRect()`
geometry for a scrollable panel and its content, run against a real `axis
run` server's actual `domClient.js`: scrolling the *panel* element
directly (not `window`) via its own dispatched `scroll` event correctly
advances both a `scrollTimeline`-driven opacity animation and a
`scrollProgress`-driven text readout, in exact numeric agreement with the
formula computed by hand (e.g. `scrollTop: 400` -> `progress: 0.375`,
matched exactly by the opacity value applied that frame), and scrolling
back up returns to the original value with no drift - confirming both the
math and the new per-root `scroll` listener (removing the listener, in an
earlier failed run, reproduced exactly the bug this was meant to fix: no
update at all until an unrelated `window` scroll happened to fire).
