# Task 3 - Interactive Data / Information Experience - results

This task took far longer than Tasks 1-2 and found three real, previously
undiscovered AXIS bugs - two fixed in `src/`, one worked around and
documented. Read this one in full; it's the most consequential result in
the suite so far, in both directions.

## Requirement-by-requirement

| # | Requirement | AXIS | React + R3F |
|---|---|---|---|
| 1 | Title + description | met | met |
| 2 | Data-driven 3D scene (array -> loop) | met | met |
| 3 | DOM sidebar list | met | met |
| 4 | 3D click -> DOM detail panel | met (after fixes - see below) | met, first try |
| 5 | DOM click -> 3D highlight (same mechanism) | met (after fixes - see below) | met, first try |
| 6 | Default "nothing selected" state | met | met |
| 7 | Only one highlighted at a time | met | met |

Both implementations meet all 7 requirements in the end. The React
column's "first try" is not a stylistic flourish - it's the headline
finding of this task.

## What actually happened, in order

1. Wrote the natural, idiomatic AXIS version: a top-level `for` loop
   generating both the 3D planets and (in the page) their sidebar
   buttons, using `let p = planets[i]` for readability - exactly the
   style `examples/planets.ax` and `examples/configurator.ax` already
   use. `axis check` reported zero diagnostics.
2. It didn't work. Clicking a planet's name in the DOM sidebar list did
   nothing at all - no error, no state change, nothing.
3. Root cause #1 (real bug, fixed): `on (p.name + "Btn").click { selected
   = p.name }`, declared inside a `for` loop, throws `undefined variable
   'p'` **the moment the handler actually runs** - not at build time.
   `axis check`/`axis build` see nothing wrong. The loop's own iteration
   variable (`i`) is correctly snapshotted into a handler body meant to
   run later (`interpreter.js`'s `captureLoopVariables`); a `let` derived
   from it (`p`) is not. This is a genuine, previously undiscovered gap -
   not fixed in `src/` (the capture mechanism would need to track every
   loop-body `let`, a larger change than this task's scope justified) -
   worked around by referencing `planets[i]` directly instead of `p`
   inside every handler body, and documented as
   [`docs/ai/COMMON_MISTAKES.md`](../../docs/ai/COMMON_MISTAKES.md)'s new
   entry 21, reproduced and verified there against the real interpreter.
4. After that fix, clicking still didn't visibly highlight the selected
   planet **in the 3D scene** (the DOM detail panel updated correctly,
   proving the click/state mutation itself now worked).
5. Root cause #2 (real bug, fixed in `src/interpreter.js`): a scene
   object's reactive property binding (`color: selected == planets[i].name
   ? white : planets[i].color`, itself already avoiding the `let`-alias
   trap above) was **never captured at all** - `SceneBuilder.applyProperty`/
   `PageBuilder.applyProperty` stashed a property's raw expression AST for
   later re-evaluation without ever running it through
   `captureLoopVariables`, the way an `on`/`animate` handler body already
   does. Every loop iteration's stored binding was the exact same
   `i`-referencing expression - correct only by the accident of whichever
   iteration happened to run last. Fixed by applying the same capture step
   already used for handler bodies to every non-literal property binding,
   at both call sites.
6. Root cause #3 (real bug, fixed in `src/interpreter.js`): even after
   fix #2, the color still didn't update. `captureLoopVariables`'s own AST
   walker had cases for `Vector`/`Binary`/`Member`/etc. but **no case for
   `Ternary`** - `cond ? a : b` fell through to the default "return
   unchanged" branch, so the exact loop-variable reference the walker was
   supposed to substitute was left completely untouched inside every
   ternary. A `position` binding (`Vector` + `Binary`) was captured
   correctly the whole time; `color` (a bare `Ternary`) never was - the
   asymmetry that made this take real digging to isolate, since fixing #2
   alone looked like it should have worked and didn't.
7. All three findings reproduced with minimal, isolated `.ax` files before
   touching any fix (a single-cube-pair scene, no page, no orbit
   animation) - each one verified to fail against the code before the fix
   and pass after, using a real Playwright-driven browser, not a
   same-process unit test (see "A second methodology note," below, for
   why the interactive Chrome-extension tool wasn't used for this either).

## Fixes shipped

- `src/interpreter.js`: `SceneBuilder.applyProperty`/
  `PageBuilder.applyProperty` now run a loop-generated property's stored
  binding through `captureLoopVariables`, exactly like an `on`/`animate`
  body already does.
- `src/interpreter.js`: `captureLoopVariables` gained a `Ternary` case
  (recursing into `condition`/`then`/`else`), matching every other
  compound-expression case it already had.
- `tests/browser/loop-property-binding-capture.test.js` (new, 2 tests):
  a loop-generated 3D object's ternary color binding, verified across
  *multiple, distinct* selections (not just one) and from *both*
  directions (a scene-originated click and a page-originated one) -
  confirmed to fail against the pre-fix code and pass against the fix.
- `docs/ai/COMMON_MISTAKES.md` entry 21: the one gap left unfixed (a
  loop-body `let` alias inside a handler body or binding), with both a
  reproduced ❌ and a verified ✓ workaround.
- Full suite re-run clean after both fixes: 929/929 unit, 53/53 browser
  (one unrelated timing flake in `tick.test.js` on the first
  `test:browser` run - passed on immediate re-run and in isolation,
  matching this project's own documented "load-induced flake" pattern,
  not caused by this change).

## Why this didn't happen in React

`PLANETS.map((planet) => <Planet key={planet.name} planet={planet} ... />)`
- every item's own click handler is a real, ordinary JavaScript closure
  over that specific `planet` object, created fresh by the array method
  itself. There is no separate "capture this for later" step to have a
  gap in, because nothing is ever detached from its originating scope in
  the first place - the closure *is* the running code, not a
  build-time-then-replayed-later AST. This is a structural property of
  how React (and JS generally) handles per-item callbacks, not a
  React-specific feature - but it's the direct, mechanical reason the
  React implementation needed zero debugging for something that took the
  bulk of this task's time on the AXIS side.

This is also the most direct evidence in the suite so far for a real,
non-cosmetic AXIS weakness: a `for` loop generating live, still-referenced
declarations (objects notably, but originally the handlers wired to them)
requires the interpreter to explicitly re-derive per-iteration context
that a closure-based model gets for free. Two of the three gaps found here
are exactly that class of bug, and the third (the docs-only one) is a
narrower instance of the same root cause.

## Dependencies / files / size

| | AXIS | React + R3F |
|---|---|---|
| Files | 1 (`main.ax`) | 5 |
| Lines (excl. config/manifest) | 181 total, 145 excluding comments (36 lines of comments specifically document the 3 findings above - not typical AXIS verbosity) | 89 |
| New direct dependencies for this task | 0 | 0 (reuses Task 1's react/react-dom/three/@react-three/fiber) |
| `node_modules` size | 0 extra | 82MB / 35 packages |
| `npm install` repair cycles | n/a | 0 - Task 1's fix carried over unchanged |
| `axis check` repair cycles | 0 (valid on every attempt - the bugs found are runtime-only; see "What would make you wrong" in the eventual final verdict for why this matters) | n/a |

## Rubric scores (0-5)

| Category | AXIS | React + R3F | Note |
|---|---|---|---|
| Functionality | 5 | 5 | Both meet all 7 requirements, in the end |
| Interaction quality | 4 | 5 | Identical interaction model; React needed no debugging to get there |
| Visual quality | 3 | 3 | Deliberately plain, same as Tasks 1-2 |
| Responsiveness | 4 | 4 | No jank in either once working |
| Animation quality | 4 | 4 | Same orbit-speed-per-planet approach on both sides |

## A second methodology note

Same lesson as Task 1's, reinforced harder here: every one of the three
bugs above was isolated using a throwaway script built on
`tests/browser/harness.js`'s exact pattern (a real server + real headless
Chromium), never the interactive Chrome-extension automation. Beyond
Task 1's `document.visibilityState` issue, this task's debugging also
depended on reading `console.error` output precisely (`[axis] error in
'on EarthBtn.click': undefined variable 'p'`) - exactly the kind of
signal that needs a real browser transport to see at all.

## Familiarity-bias note specific to this task

Finding and fixing these three bugs required deep, specific knowledge of
`interpreter.js`'s internals (`captureLoopVariables`, `loopVarStack`,
`applyProperty`) that an arbitrary AI-assisted AXIS user - even one
reading the documentation closely - could not plausibly have had. Rated
on its own, "AXIS eventually got this working" is not evidence that AXIS
is easy to debug; it's evidence that *this session*, with source-level
access and the willingness to bisect and instrument the interpreter
directly, could get it working. A real, unfamiliar user hitting bug #1
alone (a silent runtime failure with zero diagnostic help) would most
likely have concluded the feature simply doesn't work and moved on - see
`benchmarks/README.md`'s "Familiarity bias" section again; this task is
the sharpest illustration of it in the suite.
