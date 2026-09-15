# AI generation quality

Evidence from generating all 10 implementations (5 tasks x 2 stacks) in
the benchmark suite - see [`BENCHMARK.md`](BENCHMARK.md) for the results
table and [`benchmarks/`](../../benchmarks/) for full detail. This
document is specifically about *generation from documentation*, not
repair (see [`AI-REPAIR.md`](AI-REPAIR.md)) or iterating on an existing
implementation (see [`AI-REGENERATION.md`](AI-REGENERATION.md)).

## Was this a cold-start test?

**No, and this matters.** This session already had deep AXIS knowledge
(the same knowledge used to build and audit AXIS itself) going in - every
`.ax` file in the benchmark suite was written by referencing
`docs/language.md` and real files under `examples/` for exact syntax,
not purely from memory, but with full awareness of what to look for and
where. This is explicitly **not** the "cold-start AI, docs only" test the
mission describes (Section 11) - that would require a fresh agent with no
prior AXIS exposure, which this session cannot simulate on itself. Treat
every finding below as "AXIS generation quality when the generator
already knows the language deeply," not as evidence about a
genuinely-cold AI.

## What was actually observed

- **4 of 5 tasks**: the AXIS file was `axis check`-valid on the very
  first attempt, and worked correctly in a real browser on the first
  real-browser verification pass. No syntax errors, no semantic errors,
  no silent runtime failures.
- **1 of 5 tasks (Task 3)**: `axis check` reported zero diagnostics on a
  version that was silently, completely broken at runtime (a click
  handler that threw `undefined variable` the moment it actually ran).
  This is the single most important data point in this document: **a
  clean `axis check` was not sufficient evidence the generated code
  actually worked**, for a pattern that looked exactly as idiomatic as
  every other AXIS example in the repository.
- Every syntax choice was checked against `docs/language.md` or a real
  file under `examples/` before being used, per `docs/ai/QUICKSTART.md`'s
  own instruction ("Never invent AXIS syntax") - this discipline caught
  several near-misses before they became errors (e.g., confirming
  `icosahedron` isn't a real primitive before using it in Task 1;
  confirming `scale.x`/`scale.y`/`scale.z` are valid `animate` targets
  before using them in Task 2).
- One real ecosystem-knowledge gap was caught proactively, not by
  failure: before generating Task 1's React implementation, checking the
  npm registry directly revealed `@react-three/fiber`'s latest stable
  release requires `react: >=19 <19.3` - a version constraint this
  session would otherwise have violated by defaulting to
  `examples/embed-react`'s own `react: ^19.3.0` pin. Caught before
  attempting installation, not after a failure.

## What this suggests about AXIS's AI-facing documentation

`docs/ai/QUICKSTART.md`, `docs/language.md`, and real files under
`examples/` were sufficient to generate 4 of 5 tasks correctly with zero
repair cycles, when actually consulted rather than guessed from. That's
a real, positive data point for the `docs/ai/` corpus's basic
sufficiency. It is not evidence the corpus is complete: Task 3's bug
class (a loop-body `let` alias, or a loop-generated object's reactive
binding, not surviving past the loop) was not documented anywhere before
this session found it, and nothing in `docs/ai/COMMON_MISTAKES.md` would
have warned a generator away from it - entry 21 exists now specifically
because this benchmark work found the gap the hard way.

## What would strengthen this evidence

A genuinely cold-start trial: a fresh agent (or a real external
developer, see [`EXTERNAL-TESTING.md`](EXTERNAL-TESTING.md)) given only
`docs/ai/QUICKSTART.md` and asked to build one of these five tasks with
no other context. That trial was not run this session.
