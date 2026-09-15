# AXIS real-world benchmark suite — summary

Full detail, requirements, and evidence for each task live in
[`benchmarks/`](../../benchmarks/) - this document is the cross-task
summary. Read [`benchmarks/README.md`](../../benchmarks/README.md)'s
"Familiarity bias" section before treating any AXIS-favorable result here
as evidence about AI-assisted developers in general, rather than about
this specific session's deep, pre-existing AXIS knowledge applied against
ordinary React+Three.js familiarity.

All five tasks were built from scratch this session - the mission's own
"baseline" claim that Task 1 already existed as a completed benchmark was
checked directly and found false (no `benchmarks/` directory existed
anywhere in the repository before this work); see
[`BASELINE.md`](BASELINE.md).

## Results table

| Task | AXIS repair cycles | React+R3F repair cycles | Winner | Why |
|---|---|---|---|---|
| 1. Interactive 3D Hero | 0 (1 tuning pass) | 2 (React/R3F peer-dependency conflicts) | Wash | Both fully functional; React's repairs were dependency-resolution friction, not logic bugs |
| 2. Product Configurator | 0 | 0 | Slight AXIS edge | AXIS's declarative `animate` handles the accessory transition natively; React hand-rolled a per-frame lerp. AXIS also has a real architectural rough edge here (a page handler can't directly animate a scene's own object) |
| 3. Interactive Data (Solar System) | 0 build-time, but 2 real runtime bugs found+fixed, 1 found+documented | 0 | **React**, decisively, for this task | Building the idiomatic AXIS version (matching AXIS's own `examples/planets.ax` style) triggered a previously-undiscovered class of bug in `interpreter.js`; the React version needed no debugging at all |
| 4. Cinematic Portfolio | 0 | 0 | **AXIS**, clearly, for this task | `scrollProgress` is a one-line, zero-dependency built-in; React's equivalent needed ~10 lines of hand-rolled scroll-listener plumbing |
| 5. Zero-Gravity Playground (toy) | 0 (1 tuning pass) | 0 | Wash | Verified behaviorally identical under the same input sequence on both stacks |

## What this table does and doesn't support

**Does support:** AXIS is not broadly broken or impractical for this
class of task - 4 of 5 tasks needed zero correctness repairs on the AXIS
side, and the one real defect class found was root-caused and fixed
within the session, with regression tests. AXIS has at least one genuine,
demonstrable advantage (scroll-linked reactive data, Task 4) that isn't
just syntax sugar - it removes a real category of hand-written plumbing
React has no built-in answer for.

**Does not support:** a general claim that AXIS is more reliable than
React+Three.js for an arbitrary AI-assisted developer. Every repair cycle
on the AXIS side in this suite was performed with source-level access to
`interpreter.js` and deep prior knowledge of its architecture
(`captureLoopVariables`, `loopVarStack`, the scene/page object-namespace
boundary) - an ordinary user hitting Task 3's bugs would have seen a
silent, undiagnosable failure (`axis check` reports nothing wrong) and
most plausibly concluded the feature simply doesn't work. See
[`AI-REPAIR.md`](AI-REPAIR.md) for why this matters more than the raw
repair-cycle count suggests.

## Real product fixes this benchmark work produced

Two real bugs were found and fixed in `src/interpreter.js` as a direct
result of building Task 3 (see that task's
[`results.md`](../../benchmarks/task-03-data/results.md) for the full
account), with new regression tests
(`tests/browser/loop-property-binding-capture.test.js`) verified to fail
against the pre-fix code and pass against the fix. A third, narrower gap
was documented rather than fixed (`docs/ai/COMMON_MISTAKES.md` entry 21).
These are the most concrete, non-familiarity-biased evidence in the
entire validation mission: real, previously-unknown defects, found only
by attempting a real, natural, documented AXIS idiom under load.
