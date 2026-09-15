# Task 2 - 3D Product Configurator - results

Verified the same way as Task 1 - a throwaway Playwright script driving the
real server output of each stack in a real headless-Chromium page, not the
interactive Chrome-extension automation (see Task 1's `results.md`
methodology note for why that path gives false negatives on anything
`on tick`/`requestAnimationFrame`-driven).

## Requirement-by-requirement

| # | Requirement | AXIS | React + R3F |
|---|---|---|---|
| 1 | Title + description | met | met |
| 2 | 3D product | met | met |
| 3 | Orbit (drag) | met - `camera { controls: "orbit" }`, a one-line built-in | met - `@react-three/drei`'s `<OrbitControls>`, a new dependency |
| 4 | Color buttons | met | met |
| 5 | Size +/- (clamped) | met | met |
| 6 | Animated accessory toggle | met (see below - needed a real architectural workaround) | met (manual per-frame lerp in `useFrame`) |
| 7 | Live computed price | met | met |
| 8 | Click product -> DOM counter | met | met |

Both implementations meet all 8 requirements. Confirmed live in a real
browser: color swap, two size increments (Size: 1 -> 1.4, Price: $49 ->
$69), accessory on (Price: $79) and off again (Price: $69), two product
clicks (Interactions: 2), and an orbit-drag that visibly changes the
rendered frame (screenshot pixel diff) - identical sequence, identical
results, on both stacks.

## The one real design correction this task produced (AXIS side)

The first draft had the page's `on toggleAccessory.click` handler directly
call `animate accessory { scale.x -> ... }` - **this doesn't work**, and
`axis check` would have caught it as a real semantic error if it had been
run before correcting it (it wasn't; the mistake was caught by re-checking
the language rules first, so no actual failed `check` run exists to point
to - recorded here anyway because it's the same category of self-caught
mistake `axis check` exists to catch, and would have caught it if it had
reached the file): a page-level handler and a scene's own objects are
deliberately in separate namespaces (see
`docs/architecture/page-scene-fusion.md` - only `state`/`let` crosses the
scene/page boundary, not object references). The fix moves the animation
trigger *into* the scene itself, watching the shared `accessoryOn` state
from the scene's own `on tick` with edge detection against a scene-local
`let accessoryVisible`, so the triggered `animate` runs where `accessory`
is actually in scope. This is a real, if narrow, rough edge: the natural
first instinct (react to a toggle exactly where the toggle button lives)
is the one AXIS's own architecture forbids, and the workaround (poll the
shared state from `on tick`, edge-detect the change yourself) is not
obvious from the language surface alone - a newcomer would very plausibly
hit this and need `docs/architecture/page-scene-fusion.md` specifically to
understand why, not just `docs/language.md`.

**React + R3F has no equivalent restriction** - the toggle handler and the
accessory mesh can live in the same component tree with no cross-boundary
rule to trip over; state lives whereever you put it in the component tree.
This is the most concrete, non-familiarity-biased finding from this task:
AXIS's DOM/3D fusion model has a real, documented seam at exactly the
place a configurator-style toggle naturally wants to cross it.

## Animated transition, compared

- **AXIS**: a declarative `animate accessory { scale.x -> 0.4 ... duration:
  300ms }` block - the interpolation, easing, and completion are handled
  entirely by the runtime; the scene's own code only decides *when* to
  trigger it.
- **React + R3F**: no equivalent primitive in plain `@react-three/fiber`.
  Implemented as a manual per-frame lerp inside `useFrame`
  (`current + (target - current) * min(1, delta * 10)`) - correct and
  idiomatic for this ecosystem, but it's hand-written interpolation code,
  not a declarative "animate to" statement. A real project would likely
  reach for `@react-spring/three` or `framer-motion-3d` instead of
  hand-rolling this, which would mean a **third** runtime dependency for
  one property transition.

## Dependencies / files / size

| | AXIS | React + R3F |
|---|---|---|
| Files | 1 (`main.ax`) | 5 |
| Lines (excl. config/manifest) | 198 | 107 (`App.jsx` + `main.jsx`) |
| New direct dependencies for this task | 0 (orbit controls are a built-in `camera` property) | 1 new (`@react-three/drei`, for `OrbitControls`) on top of Task 1's `react`/`react-dom`/`three`/`@react-three/fiber` |
| `node_modules` size | 0 extra | 228MB / 83 packages |
| `npm install` repair cycles | n/a (nothing to install for this task) | 0 - the React version/overrides fix from Task 1 carried over unchanged, and this task's added dependency (`drei`) installed cleanly against it |
| Build output | not separately measured this task | `vite build` -> 1.12MB JS (309KB gzipped), one chunk (same bundle-size warning as Task 1) |

AXIS's line count is higher here mostly because of the page-scene-fusion
workaround above (roughly 20 lines of comment + `on tick` edge-detection
logic that wouldn't exist if the direct approach had been allowed) - worth
reading as "the cost of the seam," not general verbosity.

## Rubric scores (0-5)

| Category | AXIS | React + R3F | Note |
|---|---|---|---|
| Functionality | 5 | 5 | All 8 requirements met by both |
| Interaction quality | 4 | 4 | Same orbit/click/button interactions; equivalent feel |
| Visual quality | 3 | 3 | Deliberately plain (flat-shaded cubes), same as Task 1 |
| Responsiveness | 4 | 4 | No jank observed in either during testing |
| Animation quality | 4 | 3 | AXIS's declarative `animate` produces a real eased transition out of the box; the hand-rolled lerp on the React side is a linear-ish exponential approach, adequate but not obviously "designed," and a real project would likely add a dependency to match AXIS's easing quality |

## Reading this task's result

Task 2 is the first data point that isn't a wash: the accessory-toggle
animation is a small but genuine functionality/ergonomics edge in AXIS's
favor (a built-in declarative primitive vs. hand-rolled interpolation or
a third dependency), *and* it's the task that surfaced AXIS's own real
architectural rough edge (the scene/page object-namespace boundary). Both
findings are concrete and not just familiarity artifacts - one is about
what each stack ships out of the box, the other is about a real
documented AXIS constraint a newcomer would plausibly trip over.
