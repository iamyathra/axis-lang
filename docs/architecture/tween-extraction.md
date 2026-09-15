# Shared tween scheduling: one implementation, not two

Status: **implemented**, pure refactor - no behavior change anywhere.

`domClient.js` (a DOM element) and `scene3d.js` (a three.js object) each
had their own hand-written copy of the cycle/repeat/delay/easing stepping
math for `animate` and the per-step timing math for `timeline` playback -
conceptually one timeline architecture (both agree on what
`duration`/`delay`/`repeat`/`easing`/`at` mean, both get that from the same
`evaluator.js#parseAnimateTiming`), but two actual implementations of the
runtime stepping code that could silently drift (a fix applied to one and
forgotten in the other). Extracted into `src/renderer/tween.js`:

- `stepAnimation(anim, now, hasTarget, applyOneChange)` - advances one
  `animate` by a frame; returns whether it still needed a frame at all.
- `applyTimelineAtElapsed(rt, elapsed, applyStep)` - a timeline's already-
  scheduled steps, evaluated at a given elapsed time (shared by wall-clock
  playback and scroll-driven seeking alike).
- `tickTimeline(rt, now, applyStep)` - the per-frame wrapper around the
  above for wall-clock (`driver: "playback"`) timelines.

Everything genuinely specific to one caller - how a change actually gets
applied (`applyDomChange` vs. a three.js mutation), what "does this target
still exist" means, scene3d.js's own render-on-demand `dirty` flag - stays
entirely with that caller, passed in as plain callbacks. `tween.js` itself
knows nothing about the DOM or three.js.

## Verification

No new tests - this changes no observable behavior, only where the code
lives, so the existing animation/timeline test suites (already covering
the plan-building side extensively) are the right coverage. Re-verified
the actual runtime behavior is unchanged using the same DOM-shim harness
built for reactive-structure.md/nested-scroll.md/accessibility-and-
security.md: re-ran the reactive-list, nested-scroll, and reduced-motion
scenarios against the refactored code and confirmed byte-for-byte
identical output to the pre-refactor runs (the same opacity/progress
values, the same DOM structure at every step).
