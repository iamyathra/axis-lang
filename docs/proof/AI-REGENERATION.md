# AI regeneration quality

**This experiment was not run as the mission specifies it.** Section 13
of the mission asks for a specific, controlled test: take one working
implementation, request a single meaningful feature addition, and measure
lines/files changed, regressions introduced, and repair cycles needed -
for both stacks, under matching conditions. That dedicated test was not
performed this session, given the scope of work already completed
(baseline audit, the distribution-bug fix, and the full 5-task benchmark
suite). This document says what's honestly known instead of fabricating
the missing experiment.

## The closest available evidence, and why it doesn't substitute

Two things happened this session that resemble regeneration without
being the controlled test the mission wants:

1. **Task 5's damping retune** (`benchmarks/task-05-toy/results.md`): an
   existing, already-working AXIS file had one constant changed
   (`DAMPING = 0.98` -> `0.997`) to fix a feel/design problem, not a
   correctness one. One line changed, one file, no regressions, verified
   immediately. This is real, but it's a trivial single-constant edit,
   nowhere near the mission's "add a clickable control that changes the
   3D object's material and updates the DOM status" scale of change, and
   it only happened on the AXIS side - there's no matched React trial to
   compare it against.
2. **Task 3's bug-driven edits** (`benchmarks/task-03-data/results.md`):
   fixing the two real interpreter bugs required editing the AXIS
   benchmark file (switching `p.name` to `planets[i].name` in two
   places) after the fact. This is a real "existing code, meaningful
   change, measure the blast radius" data point, but it was driven by
   working around a bug this session itself found, not by a feature
   request a stakeholder might plausibly make - a fundamentally
   different kind of change than the mission's own example.

Neither is a substitute for the actual experiment: a single, meaningful,
feature-shaped change requested against an already-complete
implementation in both stacks, under matching conditions, measuring the
same things for both.

## What would strengthen this evidence

Pick one benchmark task (Task 2, the Product Configurator, is the most
natural candidate - it already has both a DOM control and a 3D object to
connect) and run the actual experiment: request the exact same
feature addition against both the AXIS and React implementations, with
no other context, and measure lines/files changed and regressions
introduced by re-running each task's own verification script afterward.
Not attempted this session.
