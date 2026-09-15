# Task 5 - Zero-Gravity Playground - results

Verified the same way as Tasks 1-4. No new AXIS bugs found - this task
deliberately stayed inside the same "single, non-loop-generated object"
pattern Task 4 showed working cleanly, extended with keyboard input
(the one input modality untested until now) and hand-rolled 2D
physics-like motion, both already proven idioms in AXIS's own
`examples/tick.ax` and `examples/keyboard-input/`.

## Requirement-by-requirement

| # | Requirement | AXIS | React + R3F |
|---|---|---|---|
| 1 | Title + instructions | met | met |
| 2 | Ball in a bounded 3D region | met | met |
| 3 | Keyboard control (4 arrow keys, distinct axes) | met | met |
| 4 | Wall bounce + DOM bounce counter | met | met |
| 5 | Velocity damping (settles, doesn't accelerate forever) | met | met |
| 6 | Click-to-cycle color | met | met |

Both implementations meet all 6 requirements. Verified live with the
*identical* input sequence on both stacks (4x ArrowRight, 4x ArrowUp,
then sampled every 700ms for 3.5s): the bounce count sequence was
`[2, 2, 4, 6, 6]` on **both** AXIS and React - same physics constants
(`BOUND = 2.5`, `DAMPING = 0.997`, impulse `1.5`/keypress), same observed
behavior, real confirmation the two implementations are actually
equivalent rather than just both "looking fine."

## One tuning pass, not a bug

The first damping value tried (`0.98` per tick) settled the ball after
only 1-2 bounces - technically satisfying requirement 5, but not a very
interesting toy. Caught by literally sampling the bounce count over time
and seeing it plateau too early; retuned to `0.997` (decays to roughly
the same total loss, but over many more frames) and reverified with the
same multi-checkpoint sampling. This was a design/feel adjustment,
not a correctness fix - the `0.98` version was already meeting every
literal requirement.

## Generation time / repair cycles

**AXIS**: 0 correctness repair cycles - valid on the first `axis check`,
worked on the first real-browser run (the damping retune above was a
value tweak, not a fix). Nothing from Task 3's loop-binding bug class
applied here, for the same reason as Task 4: no loop-generated object has
a reactive property in this task.

**React + R3F**: also 0 repair cycles, `npm install` clean on the first
try (Task 1's override fix carried over).

## Keyboard input, compared

- **AXIS**: `on keydown { if (key == "ArrowLeft") { vx = vx - 1.5 } ... }`
  - a global, no-target handler, `key` bound automatically to the raw
    `KeyboardEvent.key` string. Reads directly from a `state`/scalar the
    rest of the file already uses the same way everywhere else.
- **React + R3F**: a manual `window.addEventListener("keydown", ...)`
  inside a `useEffect`, mutating a `useRef` (not `useState`, deliberately
  - see below) so a rapid key sequence doesn't force a React re-render
  per keystroke.

Both are small and idiomatic for their respective ecosystems - keyboard
input isn't a meaningful differentiator on its own. The more interesting
asymmetry is *why* the React version reaches for a `ref` instead of
`state` for velocity: continuous per-frame physics values that would
otherwise cause a render every frame have to be deliberately routed
around React's own re-render model (`useRef` + direct `mesh.position`
mutation in `useFrame`, exactly react-three-fiber's own documented
pattern for this). AXIS has no such distinction to make - `state`/`let`
mutated from `on tick` was never going to trigger a React-style
component re-render in the first place, because there's no virtual-DOM
reconciliation model underneath it to protect against.

## Dependencies / files / size

| | AXIS | React + R3F |
|---|---|---|
| Files | 1 (`main.ax`) | 5 |
| Lines (excl. config/manifest) | 111 | 96 (`App.jsx` + `main.jsx`) |
| New direct dependencies for this task | 0 | 0 (same 4 as Tasks 1/4) |
| `node_modules` size | 0 extra | 82MB / 35 packages |

## Rubric scores (0-5)

| Category | AXIS | React + R3F | Note |
|---|---|---|---|
| Functionality | 5 | 5 | All 6 requirements met by both |
| Interaction quality | 4 | 4 | Identical feel, verified with an identical input sequence and matching bounce-count sequence |
| Visual quality | 3 | 3 | Deliberately plain, consistent with the rest of the suite |
| Responsiveness | 4 | 4 | No jank in either |
| Animation quality | 4 | 4 | Same hand-rolled integration/damping math on both sides |

## Reading this task's result

A second clean, bug-free task for both stacks (after Task 4), and the
most direct like-for-like verification in the suite - the same exact
input sequence produced the same exact bounce-count sequence on both
implementations. Combined with Task 4, this suggests Task 3's bugs are
specific to a real, identifiable pattern (loop-generated objects with
per-item reactive bindings) rather than evidence AXIS is broadly
unreliable - a distinction the final verdict should preserve rather than
average away.
