# AI repair quality

Comparing `axis check`/browser-console errors against `npm install`/
`vite build`/browser-console errors, across the same 10 implementations
in [`benchmarks/`](../../benchmarks/). This is about how well each
stack's own error surface helps an AI (or anyone) find and fix a problem
- not about whether problems occurred at all (see
[`AI-GENERATION.md`](AI-GENERATION.md) and
[`BENCHMARK.md`](BENCHMARK.md)).

## The central finding: `axis check`'s silence on Task 3

This is the most important, concrete result in this document. Task 3's
real bugs (see
[`benchmarks/task-03-data/results.md`](../../benchmarks/task-03-data/results.md))
were **not caught by `axis check` at all** - `valid: true`, zero
diagnostics, on code that was completely non-functional at runtime. The
only signal anything was wrong was:

1. Manually observing that a click did nothing (no error, no visual
   change - the failure is silent by default).
2. Digging into the browser console specifically, where
   `[axis] error in 'on EarthBtn.click': undefined variable 'p'` was
   logged - but only because this session already knew to look there;
   nothing in the DOM or the terminal running `axis run` surfaces this.
3. For the *second* bug (the missing `Ternary` case), there was no error
   at all, anywhere, ever - `scene3d.js`'s `applyBindings` catches and
   silently discards any evaluation error from a stored binding, so a
   binding that never updates produces no signal whatsoever short of an
   observer watching the actual rendered value change (or not).

This directly confirms the mission's own suspicion (Section 21): **AXIS's
static analysis does not catch undefined-variable errors inside event
handler bodies**, and this session found a live, real instance of exactly
that gap, not a hypothetical one. Worse than a caught error: some of this
bug's symptoms (bug #2, the property-binding case) produce **no error
signal even at runtime** - the failure is a value that silently never
changes, which is strictly harder to notice than a thrown exception.

## Compare: React + TypeScript/Vite's error surface

Every failure hit on the React side in this suite was loud, specific,
and immediately actionable:

- `npm install` failures (Task 1) named the exact conflicting peer
  ranges and the packages responsible - enough to diagnose and fix
  without guessing.
- `vite build`'s chunk-size warning was informative, not blocking.
- No React-side runtime failure occurred anywhere in the suite that
  required silent-failure debugging - every problem surfaced either at
  install time or (in earlier, unrelated debugging of the AXIS
  distribution bug, see `docs/proof/BASELINE.md`) as a thrown,
  stack-traced error.

This is a real, structural asymmetry, not a coincidence of which bugs
happened to appear in which stack: a thrown JS exception in React/Vite's
world is visible by construction (uncaught errors are loud by default in
a browser and in Node); an AXIS handler/binding error is caught and
discarded by design in `scene3d.js`/`pageRuntime.js` specifically so one
broken handler doesn't crash an entire running scene - a reasonable
runtime-robustness tradeoff that has the side effect of making a class of
authoring bug much harder to notice.

## What repair actually required, when `axis check` didn't help

Fixing Task 3's bugs required: writing minimal, isolated reproduction
files; instrumenting `interpreter.js` with temporary debug logging;
reading `captureLoopVariables`'s AST-walker switch statement directly to
find a missing case; and cross-referencing three different code paths
(`interpretOnDecl`, `SceneBuilder.applyProperty`/`PageBuilder
.applyProperty`, `scene3d.js`'s `reRender()`) to understand why a fix to
one didn't fully resolve the symptom. This is source-level interpreter
debugging, not "read the diagnostic and fix what it says" - a fundamentally
different, much higher-effort activity than repairing a `tsc`/ESLint
error, and not something an ordinary AXIS user (human or AI) could
realistically have done without exactly this kind of access.

## What would strengthen this evidence

A real, scoped improvement to `axis check` that catches "a handler body
references an identifier that won't survive past the point the handler
is stored" (Section 21's own ask) - not attempted this session, given the
scope of work already completed and the size such a change would
realistically need to be done safely (see
[`benchmarks/task-03-data/results.md`](../../benchmarks/task-03-data/results.md)'s
note on why the deeper capture-mechanism fix wasn't attempted either).
