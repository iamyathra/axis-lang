# External developer testing

**Not collected. Zero external developers attempted AXIS during this
session.** This is the single largest evidence gap in the entire
validation mission, and it is reported here plainly rather than
approximated, simulated, or quietly dropped.

## Why this session could not produce this evidence

This is a single AI agent session with no mechanism to recruit, observe,
or collect feedback from real, unfamiliar human developers. The mission's
own instructions (Section 17-19) are explicit about what's required: five
real people, given only documentation and a task, observed without
rescue, with their confusion/questions/success or failure recorded
honestly. None of that is something an agent session can manufacture on
its own, and this session did not attempt to fake it - see
`docs/proof/BASELINE.md`'s original scoping note, agreed with the user
before any benchmark work began.

## What was considered and rejected as a substitute

A fresh, context-free AI subagent attempting one of the benchmark tasks
cold was considered as a weak proxy (this was explicitly offered as an
option before the benchmark suite began, and the user chose to skip it in
favor of preparing real materials instead - see this session's own
scoping decisions). It was not used: an AI agent's failure mode when
confused (guessing plausibly, rationalizing, rarely just giving up) is
different enough from a human's that treating it as equivalent evidence
would be misleading, not merely weak.

## What exists, ready to hand to a real person

- [`README.md`](../../README.md)'s Install section (added this session,
  verified against a real `npm install -g` of the packed tarball).
- [`docs/ai/QUICKSTART.md`](../ai/QUICKSTART.md).
- Any of `benchmarks/task-01-hero/requirements.md` through
  `benchmarks/task-05-toy/requirements.md` as a ready-made, scoped task
  with clear, checkable success criteria.

The mission's own minimum bar (Section 19, "one real outsider success")
requires exactly this kit plus one real person - both are five minutes
away from being tested, but neither the person nor the resulting evidence
exists yet.

## What this means for the final verdict

The final verdict in `docs/proof/FINAL-VERDICT.md` is written with this
gap treated as load-bearing, not incidental: any claim in this mission
that depends on "AXIS is easy for an unfamiliar developer" rests entirely
on this session's own reasoning (see `docs/proof/HUMAN-DX.md`'s explicit
caveats), never on an actual outsider's experience. Kill condition 1 in
the mission's own text ("five real developers attempt a realistic AXIS
task and none successfully complete it") cannot be evaluated as true or
false from this session - it remains simply untested.
