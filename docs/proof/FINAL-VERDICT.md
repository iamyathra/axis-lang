# AXIS Real-World Validation Report

## Executive Verdict

# KEEP AS NICHE PROJECT

Justified below with the actual evidence gathered this session - not a
hedge, and not the default outcome of avoiding a harder call. See
"Reading the evidence honestly," below, for why the other three verdicts
don't fit what was actually found.

## What AXIS Actually Is

A real, working small language and runtime - lexer, parser, interpreter,
render plan, browser runtime - for self-contained interactive DOM+3D web
pages, with a genuinely useful, demonstrated capability: one shared
reactive `state`/`let` pool that both a page's DOM and an embedded 3D
scene read and write, without any cross-domain plumbing. 929 unit tests
and 53 browser tests pass; a real npm-install distribution bug (found and
fixed this session) no longer blocks a real user from trying it; the CLI
(`create`/`run`/`build`/`check`/`fmt`/`inspect`/`lsp`) all work as
documented.

## What AXIS Is NOT

Not a general-purpose game engine, not a Godot/Unity competitor, not
(yet) a project with any external validation at all. Not something with
a mature ecosystem, editor support beyond its own hand-rolled `axis lsp`,
or a body of prior art a stranger can search for. Not proven to be easier
for an unfamiliar developer - see "Biggest remaining risk," below.

## Baseline

Full detail: [`BASELINE.md`](BASELINE.md). Verified directly, not assumed
from prior claims: 53 local commits were unpushed at the start of this
session (now pushed); a real distribution bug would have broken `axis
build`/`axis run` for every actual npm-installed user (found and fixed);
the npm tarball was shipping 15.3MB of vendored `node_modules` from
examples (fixed, now 448KB); `axis-lang`/`axis-react` have never been
published to the npm registry.

## Benchmark Results

Full detail: [`BENCHMARK.md`](BENCHMARK.md).

| Task | AXIS | React/Three.js | Winner |
|------|------|----------------|--------|
| 1. Interactive 3D Hero | 0 repair cycles | 2 repair cycles (peer-dependency conflicts) | Wash |
| 2. Product Configurator | 0 repair cycles, 1 real architectural rough edge found | 0 repair cycles | Slight AXIS edge |
| 3. Interactive Data (Solar System) | 2 real bugs found+fixed, 1 found+documented | 0 repair cycles | React, decisively |
| 4. Cinematic Portfolio | 0 repair cycles | 0 repair cycles | AXIS, clearly |
| 5. Zero-Gravity Playground | 0 repair cycles | 0 repair cycles | Wash |

## AI Generation

Full detail: [`AI-GENERATION.md`](AI-GENERATION.md). Not a cold-start
test (this session had deep prior AXIS knowledge). 4 of 5 tasks were
`axis check`-valid and browser-correct on the first attempt; the fifth
(Task 3) was `axis check`-valid while being completely broken at
runtime - the single most important caveat on every "0 repair cycles"
result in this report.

## AI Repair

Full detail: [`AI-REPAIR.md`](AI-REPAIR.md). `axis check` did not catch
Task 3's bugs at all, and one of the two (a stored property binding that
silently never re-evaluates) produces no error signal ever, by design
(`scene3d.js` swallows the evaluation exception). Fixing it required
reading `interpreter.js`'s source directly - not something an ordinary
AXIS user should have to do, and not comparable to React/Vite's loud,
specific, self-diagnosable failures in this same suite.

## AI Regeneration

Full detail: [`AI-REGENERATION.md`](AI-REGENERATION.md). **The mission's
own specified experiment was not run.** What exists instead (a one-line
tuning change in Task 5, and the bug-driven edits in Task 3) does not
substitute for it. This is a real gap in this report, not a rounding
error.

## Human Developer Experience

Full detail: [`HUMAN-DX.md`](HUMAN-DX.md). This session's own reasoned
assessment only - no independent human read or modified any of this
code. The sharpest asymmetry found: AXIS's debugging floor (Task 3)
requires interpreter-source knowledge no ordinary user should need;
React's worst case in this suite (a peer-dependency error) is routine and
self-diagnosable by any working React developer.

## External Developer Testing

Full detail: [`EXTERNAL-TESTING.md`](EXTERNAL-TESTING.md). **Zero
external developers tested AXIS this session.** This is the single
largest evidence gap in this entire report, acknowledged plainly rather
than papered over. The mission's own kill condition 1 ("five real
developers attempt and none succeed") is untested, not false.

## Showcase Results

**Not built this session.** The mission's own Section 25 asks for 3-5
polished showcase projects; given the scope already covered (baseline
audit, a real distribution-bug fix, and the full 5-task benchmark suite,
which itself produced 5 working, verified AXIS+React implementation
pairs), building separate showcases was deprioritized in favor of
finishing the benchmark suite and this report. The benchmark
implementations under `benchmarks/*/axis/` are real, working, verified
programs, but they were built as a controlled comparison, not as
polished, standalone showcase pieces - treat them as adjacent evidence,
not a substitute for this section.

## Extensibility

From this session's own reading of `docs/runtime-extensions.md` and the
element-type-extension work committed at the start of this session (not
re-verified from scratch here):

| Capability | Extensible? | External proof? |
|---|---|---|
| DOM elements | Yes | Yes - `examples/element-extension-demo`'s `axis-badge` package, proven in a real browser test |
| 3D object types (new light/geometry) | No | No - still a hardcoded dispatch table in `interpreter.js`/`scene3d.js` |
| 3D scalar properties (a new live-settable property on an existing object) | Yes | Yes - `axis-wireframe`/`axis-line-width` packages |
| Events | No | No - a fixed set (click/hover/unhover/tick/keydown/keyup/mousemove/mousedown/mouseup/change/submit/load/error/complete) |
| Behaviors/systems | Yes, indirectly | Yes - `examples/game-foundation`'s ECS pattern is built entirely from existing primitives (records, self-bound methods, `on tick`), no compiler changes needed |
| Runtime APIs | Yes, narrowly | Yes - a package's `buildExtension`/`runtimeExtension` scripts, but sandboxed (no filesystem/process access by design) |

## Competitive Analysis

Full detail: [`COMPETITORS.md`](COMPETITORS.md). AXIS holds one real,
demonstrated advantage (cross-domain reactive state, especially
scroll-linked data) against React+R3F specifically, and is behind on
nearly everything else against every competitor considered (ecosystem,
tooling maturity, hiring pool, 3D capability ceiling, and - for
Godot specifically - by a wide, not currently closable margin on physics/
editor/asset-pipeline maturity, though AXIS was never competing for that
job in the first place).

## Strongest Evidence FOR AXIS

1. **`scrollProgress` (Task 4).** A one-line, zero-dependency built-in
   that replaces ~10 lines of hand-rolled scroll-listener plumbing in
   React, for a real, non-contrived requirement (a scroll-driven progress
   indicator also affecting a 3D property).
2. **The declarative `animate` primitive (Task 2).** Handles a triggered
   property transition with zero extra dependencies; React's equivalent
   needed a hand-rolled per-frame lerp, or would realistically need a
   third dependency in production.
3. **Real bugs get found and fixed, not just complained about.** Two
   genuine, previously-undiscovered interpreter bugs were found, root-caused,
   fixed, and covered by new regression tests within this same session
   - evidence the codebase is maintainable and its own test discipline
   works as intended.

## Strongest Evidence AGAINST AXIS

1. **Task 3's bug class, and how invisible it was.** A completely
   idiomatic, documentation-consistent pattern silently failed at
   runtime with zero static-analysis warning. This is not a rare edge
   case - it's the natural way to write "click a loop-generated item to
   select it," a genuinely common UI pattern.
2. **Zero external validation, at all, of any kind.** Every favorable
   comparison in this report was produced and judged by the same
   long-running session that also builds and maintains AXIS. See
   `benchmarks/README.md`'s "Familiarity bias" section - this isn't a
   minor caveat, it's a structural limit on how much any of this report
   can be trusted as a general claim.
3. **Distribution was broken until this session fixed it.** `axis
   build`/`axis run` would have failed for every real npm-installed user
   before today. A project with a broken installation path for its
   entire prior existence has, by construction, never actually been
   tried by an outsider - which is consistent with "zero external users"
   being a fact about distribution, not necessarily about interest.

## Biggest Remaining Risk

That AXIS's apparent strengths are artifacts of this session's own deep
familiarity, and its real weakness (Task 3's bug class) is exactly the
kind of thing that would surface immediately and repeatedly for a genuine
newcomer, with no debugging path available to them short of "read the
interpreter source" - which is not a realistic expectation for a
language's actual target users. Until a real outsider tries AXIS, this
risk is unresolved, not merely theoretical.

## What Would Make You Wrong

- A real external developer (not this session) successfully builds
  something non-trivial with AXIS, unassisted, within a reasonable time,
  and says they'd use it again - would meaningfully strengthen the case
  for AXIS beyond what this report can currently support.
- A real external developer hits Task 3's bug class (or one like it)
  independently and cannot resolve it even with `docs/ai/
  COMMON_MISTAKES.md` entry 21 in front of them - would meaningfully
  weaken it further, past what's already accounted for here.
- A controlled AI-regeneration experiment (Section 13, not run this
  session) showing React+R3F handles a real feature addition with fewer
  regressions than AXIS - would undercut this report's claim that AXIS's
  bugs are narrow rather than systemic.

## Scorecard

Scored 0-100 from this session's own evidence only; not letting the
number override the qualitative read, per the mission's own instruction.

| Category | Score | Why |
|---|---|---|
| Technical foundation | 70 | 929+53 real tests pass; a real, load-bearing bug class was found in the core interpreter this session, now partially fixed |
| Language design | 65 | The shared-state model is genuinely elegant for its target case; the scene/page object-namespace boundary and the loop-variable-capture gap are real, non-cosmetic rough edges |
| Developer experience | 55 | Fast for the idiomatic path; the debugging floor when something silently fails is currently much worse than mainstream tooling's |
| AI generation quality | 70 | Strong when the generator already knows AXIS (this session); untested cold |
| AI repair quality | 40 | `axis check` missed a real, common bug class entirely; the mission's own Section 21 concern is confirmed, not resolved |
| AI regeneration quality | 0 (untested) | The mission's own experiment was not run |
| DOM+3D usefulness | 75 | The one consistently demonstrated real advantage in this report |
| Uniqueness | 60 | The shared-vocabulary thesis is real and not something React+R3F has a direct answer for; the addressable case is narrow |
| Competitive advantage | 40 | Real but narrow (see Competitive Analysis); behind on nearly everything else |
| Extensibility | 55 | Real, proven for DOM elements and scalar properties; a hardcoded dispatch table for new 3D object types remains |
| Distribution | 60 | Broken before this session, fixed now, still never actually published |
| Ecosystem potential | 20 | Zero external users, zero published packages, zero community signal of any kind |
| External user validation | 0 | None collected |
| Real-world usefulness | 45 | Demonstrated for a narrow, real case; nothing broader validated |
| Solo-developer feasibility | 60 | The codebase is well-tested and its own bugs are fixable within a session, as demonstrated |
| Opportunity cost | not scored | See below |

**Overall (excluding opportunity cost): ~50/100** - consistent with "an
interesting, partially-proven niche project," not a clear build-it-out
signal and not a clear kill signal either.

## Kill Conditions

Per the mission's own rule: needs **two** of three true to trigger a stop
recommendation.

1. **"Five real developers attempt and none succeed."** Untested -
   cannot be marked true. Not false either; simply unknown.
2. **"Six months pass without meaningful public usage."** Not
   applicable within a single session - time has not passed.
3. **"A controlled benchmark shows frontier AI can reliably produce
   equivalent experiences with standard tooling, no meaningful
   disadvantage."** Partially true, partially false: 3 of 5 tasks were a
   wash, 1 clearly favored React, 1 clearly favored AXIS - "no meaningful
   disadvantage" is roughly right for the median task, but Task 4's
   result is a real, meaningful AXIS advantage this condition's own
   framing doesn't have room for. Call this **not satisfied** as stated.

**Zero of three kill conditions are satisfied.** STOP AXIS is not
supported by this session's evidence.

## Recommended Next 90 Days

1. **Get one real external developer to actually try it** - the single
   highest-value, lowest-cost thing not yet done. Hand them
   `benchmarks/task-01-hero/requirements.md` (or any task) and the README
   Install section, watch, don't rescue, record honestly.
2. **Publish `axis-lang`/`axis-react` to npm** - prepared, verified, and
   held only for the explicit go-ahead this session was scoped to
   require.
3. **Extend `axis check` (or at minimum `docs/ai/COMMON_MISTAKES.md`)
   to cover Task 3's bug class more broadly** - the highest-leverage
   remaining technical risk, since it's a common pattern, not a rare one.
4. **Run the actual AI-regeneration experiment** (Section 13) this
   report couldn't - it's the cleanest remaining piece of missing
   evidence that doesn't require external people.
5. **Do not** expand scope toward a general-purpose language, a game
   engine, or new syntax in the meantime - nothing found this session
   argues for that, and the mission's own framing (Section 1: is this
   worth building at all, for this one job) hasn't been fully answered
   yet.

## Final Verdict

# KEEP AS NICHE PROJECT
