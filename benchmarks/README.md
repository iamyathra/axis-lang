# AXIS benchmark suite

Five tasks comparing "AI generates an interactive DOM+3D web experience in
AXIS" against "AI generates the same experience in TypeScript + React +
Three.js (react-three-fiber)". Part of the real-world validation mission
tracked in `docs/proof/`.

Each task directory:

```text
task-NN-name/
  requirements.md   requirements defined BEFORE implementation, identical for both stacks
  axis/             the AXIS implementation
  react/            the React + react-three-fiber implementation
  results.md        measurements + rubric scores for both, honestly reported
```

## Rubric (0-5 per category, applied identically to both stacks)

```text
0 = broken            3 = good
1 = poor              4 = excellent
2 = acceptable        5 = exceptional
```

Categories: Functionality, Interaction quality, Visual quality,
Responsiveness, Animation quality (3D quality folded into these where a
task has 3D content).

## Familiarity bias - read before trusting any AXIS-favorable result

Both implementations in every task were written by the same AI assistant
that also helps build and maintain AXIS itself, in the same session, with
full knowledge of AXIS's internals, its docs, and its diagnostic codes
memorized rather than looked up cold. That AI has
comparatively ordinary (not expert, not novice) familiarity with React
Three Fiber - real but shallower than its AXIS knowledge.

This means: **any result where AXIS produces fewer repair cycles or a
faster generation time is not strong evidence that AXIS is intrinsically
easier for an arbitrary AI-assisted developer.** It is only strong
evidence for a narrower, still-useful claim: *given deep familiarity with
AXIS specifically, generating in AXIS was faster/more reliable than
generating in React+R3F with ordinary familiarity.* The two are not the
same claim, and the final verdict must not conflate them.

What IS reasonably load-bearing regardless of familiarity:
- Whether a real bug or diagnostic gap was found in AXIS along the way
  (a familiarity advantage doesn't manufacture a false compile error).
- Concrete, countable facts: line counts, file counts, dependency counts,
  which stack needed a second file to plumb cross-domain state.
- Whether the DOM+3D shared-state requirement (the one AXIS's own thesis
  is actually about) required genuinely different amounts of glue code -
  this is the single most direct test of AXIS's stated value proposition
  and the number this suite should be read for most carefully.

No external, AXIS-unfamiliar tester was available this session (see
`docs/proof/BASELINE.md`) - that remains the missing piece for a claim
stronger than the above.
