# Human developer experience

**Not a study - no human besides the one guiding this session read or
modified any of this code.** Everything below is this session's own
reasoned assessment from writing, reading, and debugging all 10
benchmark implementations, not a report of an independent human's actual
experience. See [`EXTERNAL-TESTING.md`](EXTERNAL-TESTING.md) for the gap
this leaves, and treat this document as a set of testable hypotheses, not
findings.

## Readability, six months later - the actual question this section asks

**AXIS files** (see any file under `benchmarks/*/axis/`): shorter overall
in most tasks, one file, no build configuration to understand. A returning
reader has to learn AXIS's own grammar (a real cost - it has no
presence in mainstream editors/LSPs beyond this project's own `axis lsp`,
and no large public body of Stack Overflow answers or blog posts to lean
on) but, once past that, the file reads as a flat, declarative
description of what exists and what happens on each interaction - close
to reading a spec.

**React files**: familiar to millions of developers, first-class editor
support (TypeScript could have been used but wasn't, in this suite, to
keep the comparison closer to AXIS's own untyped model - a real project
would likely add types, which is itself a DX advantage React has that
this comparison doesn't fully capture), and every implementation pattern
used here (lifting state up, `useRef` for physics values, `useEffect` for
a scroll listener) is something a working React developer has almost
certainly seen before, in this exact shape, many times.

## Debugging, six months later

This is the sharpest asymmetry the benchmark suite actually demonstrated,
not merely hypothesized: when Task 3's AXIS bug appeared, fixing it
required reading `src/interpreter.js` directly - not something a typical
AXIS *user* (as opposed to an AXIS *contributor*) would ever do, or
should have to do. A returning human hitting the same bug six months from
now, without this session's specific interpreter knowledge, would very
likely be stuck at exactly the point this session almost was: a silent
failure, a clean `axis check`, and no obvious next step short of
"suspect the language runtime itself," which is a very unusual place for
an application developer's debugging instinct to go. React's equivalent
worst case in this suite (an `npm install` peer-conflict error) is
routine, well-documented, and something most React developers have
independently solved before.

## Where AXIS's model is easier, credibly

Task 4's `scrollProgress` and the general "one `state`, read from both
DOM and 3D" pattern (present in Tasks 1-4) are the most defensible
"actually easier to maintain" claims in this suite: there's no prop
drilling, no context provider, no synchronization code to get wrong six
months later, because there's only one variable and one place it's
declared. A returning developer doesn't need to trace data flow through
component boundaries to find where a shared value lives - it's the one
`state`/`let` at the top of the file, always.

## What would strengthen this evidence

The actual thing this section is supposed to measure: hand one of these
five tasks' AXIS and React implementations (not written by the person
being asked) to a real developer unfamiliar with both, and ask which they
find easier to understand and modify. Not attempted this session -
folded into the same gap as [`EXTERNAL-TESTING.md`](EXTERNAL-TESTING.md).
