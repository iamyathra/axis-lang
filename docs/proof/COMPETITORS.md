# AXIS vs. the alternatives

A brutally honest comparison, grounded in what this session directly
observed (the [`benchmarks/`](../../benchmarks/) suite) plus well-known,
uncontroversial facts about each competitor - not new benchmarking against
every name below. Where a claim isn't backed by this session's own
evidence, it's flagged as general knowledge rather than presented as a
finding.

## React + Three.js (vanilla, no R3F)

**What it does better:** Absolute maximum control over the render loop,
scene graph, and performance tuning - nothing between you and three.js's
own API. Enormous ecosystem, hiring pool, and prior art. No language to
learn beyond JS/TS and three.js itself.

**What AXIS does better:** Everything this session's benchmark suite
measured about `@react-three/fiber` specifically (see below) applies more
strongly here, since vanilla Three.js has none of R3F's declarative
scene-graph convenience either - manual `scene.add()`/disposal/render-loop
bookkeeping for every object, by hand.

**Who should use vanilla Three.js instead:** Anyone who needs
performance-critical control R3F's abstraction would get in the way of,
or who is integrating 3D into a large existing non-React codebase.

**Why AXIS exists anyway:** For the specific case this suite tested (a
small, self-contained interactive DOM+3D experience), hand-rolled
Three.js is strictly more code and more manual bookkeeping than either
AXIS or R3F, for no benefit unless that control is actually needed.

## React + react-three-fiber (this session's actual comparison target)

**What it does better, per this session's own evidence:** Dependency
resolution is a real, if solvable, friction point (Task 1's two repair
cycles) but once solved, ordinary React patterns (closures over `.map()`
items, `useRef` for per-frame values) are simply correct by construction
- Task 3's entire class of AXIS bug (a loop-generated object's binding
not surviving past the loop) cannot occur in this model, because there's
no separate "capture for later" step to have a gap in. Vastly larger
ecosystem: TypeScript, `@react-three/drei`'s huge helper library, and
every general React tool (state management, testing, dev tools) works
unmodified.

**What AXIS does better, per this session's own evidence:** Zero
dependencies to install or resolve versions for (three.js is already
vendored). One line for scroll-linked reactive state
(`scrollProgress`) versus ~10 hand-rolled lines in React (Task 4). A
built-in declarative `animate` for property transitions versus a manual
per-frame lerp or a third dependency (Task 2). No JS build step at all
for the CLI workflow (`axis run`) versus Vite/bundler configuration.

**Who should use R3F instead:** Any team already invested in React, that
needs the surrounding React ecosystem (routing, data fetching, testing
libraries, TypeScript, a large hiring pool), or that needs 3D
capabilities beyond AXIS's current scope (no morph targets, no
Draco/KTX2 compression, no animation-clip blending, no post-processing
pipeline - see `README.md`'s own Status section for the current honest
limitations list).

**Why AXIS exists anyway:** The one clean, repeated finding across this
whole suite - a real, if narrow, advantage for the specific "DOM state
and 3D state need to share one small pool of reactive data" shape of
problem, with meaningfully less code and zero new dependencies.

## Vanilla Three.js vs. AXIS's 3D scene layer, directly

AXIS's scene layer is, underneath, a thin declarative layer over the same
Three.js this session's React comparisons also used - the choice isn't
"three.js's power vs. AXIS's simplicity," it's "hand-write the
scene-graph/lifecycle code yourself vs. let AXIS generate it from a
declarative description." For the small, self-contained scenes this
suite tested, that trade was consistently in AXIS's favor on code volume;
it says nothing about scenes far larger or more custom than anything
tested here.

## Svelte / Astro

Not evaluated this session - neither appeared naturally in any of the
five benchmark tasks, and forcing a comparison without real evidence
would violate this document's own "don't manufacture results" standard.
General knowledge: Svelte's own compiler-driven reactivity model is the
closest *conceptual* relative to AXIS's "one shared `state`, read
anywhere" approach among mainstream frameworks, but Svelte has no 3D
story of its own (it composes with Three.js the same manual way plain
React does) - the comparison that would actually matter (Svelte + Threlte,
its R3F equivalent) was not run.

## Godot (for the interactive/game-adjacent side)

**What it does better:** A real, mature, general-purpose game engine -
physics, animation blending, a visual editor, asset pipelines, and a
scripting language (GDScript) built for exactly this domain, with a huge
head start in tooling maturity AXIS cannot currently match (AXIS
explicitly has no physics engine, no visual editor, and a much smaller
set of 3D capabilities - see `README.md`'s Status section).

**What AXIS does better:** AXIS is not a game engine and the mission's
own scope explicitly excludes competing with one (`docs/VISION.md`
Section 39's "not building an FPS/racing/platformer engine" framing). For
AXIS's actual target (a small interactive DOM+3D *web* experience, not a
standalone game), Godot's own web export exists but is a substantially
heavier, more general tool for a narrower job than AXIS's `axis run`/
`axis build` workflow.

**Who should use Godot instead:** Anyone building an actual game, or
anything needing physics, complex animation blending, or a visual level
editor.

**Why AXIS exists anyway:** AXIS was never competing for this job in the
first place - see `docs/architecture/2026-09-language-platform-audit.md`'s
own framing of the FPS/game-foundation work as a capability proof, not a
pivot toward game-engine competition.

## The honest summary

For the one class of problem this session's benchmark suite actually
tested (a small, self-contained interactive DOM+3D web page), AXIS holds
a real, narrow, demonstrated advantage in code volume and dependency
count for cross-domain reactive state specifically, and a real,
demonstrated cost in debuggability when something goes wrong in a way
`axis check` doesn't catch. For nearly everything else - ecosystem size,
hiring pool, tooling maturity, TypeScript, editor support, 3D capability
ceiling - the established alternatives are ahead, in some cases (Godot's
physics/editor, React's ecosystem) by a wide and not-currently-closable
margin. AXIS's case has to rest entirely on that narrow advantage being
valuable enough to the right, small audience - not on competing broadly.
