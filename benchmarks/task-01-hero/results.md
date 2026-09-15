# Task 1 - Interactive 3D Hero - results

Both implementations verified against every numbered requirement in
`requirements.md`, in a real browser, via a throwaway Playwright harness
modeled on `tests/browser/harness.js` (not the interactive Chrome-extension
automation - see "A methodology note" at the bottom for why). Read
`benchmarks/README.md`'s "Familiarity bias" section before treating any of
this as evidence about AI-assisted developers in general, not just this
specific comparison.

## Requirement-by-requirement

| # | Requirement | AXIS | React + R3F |
|---|---|---|---|
| 1 | Title | met | met |
| 2 | Description | met | met |
| 3 | CTA button | met | met |
| 4 | Idle rotation | met (confirmed via `on tick` + `print`, since a plain-color sphere doesn't show rotation visually) | met |
| 5 | Camera parallax | met (confirmed via `print(offsetX, offsetY)` inside `on tick`, and a canvas-screenshot pixel diff across mouse positions) | met (screenshot pixel diff across mouse positions) |
| 6 | Hover -> color change | met (`#4a90e2` -> `#facc15`, confirmed visually) | met (same colors, confirmed visually) |
| 7 | Click -> counter | met | met |
| 8 | DOM shows live 3D-driven counter | met - one top-level `state clicks = 0`, mutated from the scene's `on gem.click`, read directly in the page's `text` binding | met - `clicks` state lifted to `<App>`, passed to the 3D layer as an `onGemClick` callback prop |
| 9 | CTA click changes its own label | met | met |

Both implementations meet all 9 requirements. No requirement exposed a
functional gap in either stack for this task.

## Generation time / repair cycles

**AXIS**: one file, one `axis check --json` pass - **0 repair cycles**,
valid on the first attempt. The only iteration was a tuning change (mouse
sensitivity for the parallax accumulator, `0.003` -> `0.0006`), not a
correctness fix - `offsetX`/`offsetY` were already computing the right
thing, they just saturated at the clamp bound too fast to look smooth.

**React + R3F**: **2 real repair cycles before any code ran**:
1. `npm install` failed outright - `@react-three/fiber@9.7.0`'s peer range
   is `react: >=19 <19.3`, but the version this session would have
   defaulted to (matching this repo's own `examples/embed-react`, which
   pins `react: ^19.3.0`) is 19.3.0 - just outside that range. Caught by
   checking the npm registry before installing, not by hitting the failure
   blind - a real AI-generation pitfall either way (a plausible-looking
   version pin that's actually incompatible with a fast-moving 3D library's
   peer range).
2. Pinning `react`/`react-dom` to `^19.2.0` alone wasn't enough -
   `@react-three/fiber`'s large *optional* peer surface (`expo`,
   `react-native`, and friends, for its React Native target) still produced
   an `ERESOLVE` conflict on plain `npm install`. Fixed with an
   `"overrides"` block pinning `react`/`react-dom` exactly, which is the
   correct fix (not `--legacy-peer-deps`, which would silently accept a
   broken resolution instead of a correct one).

Neither repair was a logic bug - both were dependency-resolution friction
specific to react-three-fiber's current peer-dependency shape. This is
the single most concrete, non-familiarity-biased data point in this task:
regardless of who's generating the code, AXIS's implementation needed zero
JS-ecosystem dependency negotiation because it has exactly one dependency
(three, already vendored via `axis-lang` itself), while the R3F stack's
dependency graph produced a real, blocking failure before either
implementation's actual logic was even exercised.

## Code size / files / dependencies

| | AXIS | React + R3F |
|---|---|---|
| Files | 1 (`main.ax`) | 5 (`index.html`, `package.json`, `vite.config.js`, `src/main.jsx`, `src/App.jsx`) |
| Lines (excluding config/manifest) | 106 | 109 (`App.jsx` + `main.jsx`) |
| Direct dependencies | 1 (`three`, already present - nothing new to install for this task) | 4 runtime (`react`, `react-dom`, `three`, `@react-three/fiber`) + 2 dev (`vite`, `@vitejs/plugin-react`) |
| `node_modules` size | 0 extra (uses the repo's own install) | 82MB / 35 packages |
| Build output | `axis build` -> static `dist/` (not measured separately for this task; see `docs/proof/BASELINE.md` for the general build-quality finding) | `vite build` -> 1.1MB JS bundle (304KB gzipped), one chunk - large enough that Vite's own build output warns about it |

Line count is a wash - not a meaningful signal either way. File count and
dependency footprint are not: AXIS's version of this task has no
`package.json`/build config/module-entry boilerplate to write or get
wrong, because there's nothing to install beyond what `axis-lang` itself
already vendors.

## How requirement 8 (cross-domain shared state) was actually plumbed

This is the requirement most directly testing AXIS's own stated thesis
(a shared vocabulary for DOM+3D state), so it's worth describing precisely
rather than just marking it "met" for both:

- **AXIS**: a single `state clicks = 0` declared outside both the `scene`
  and `page` blocks. The scene's `on gem.click` handler mutates it exactly
  like a local variable (`clicks = clicks + 1`); the page's `text` element
  reads it exactly like a local variable (`"Interactions: " + clicks`).
  No import, no prop, no callback - the *only* thing marking it as
  cross-domain is that it's declared at the top level instead of inside
  either block.
- **React + R3F**: ordinary React state lifted to the common ancestor
  (`clicks` in `<App>`), passed down to the 3D layer as a callback prop
  (`onGemClick`) and to the DOM layer as a plain value. This is the
  idiomatic, correct way to do it in React - not awkward - but it is a
  *general* mechanism (props/lifting state up) applied to this specific
  case, not a mechanism that exists *because* DOM and 3D share a
  vocabulary. AXIS's version is a special case of "one variable, two
  readers" enabled by DOM and 3D sharing one environment; React's version
  is the same general pattern React uses for any two sibling components
  regardless of what they render with.

Neither is more lines of code than the other here. The difference is
conceptual: AXIS needed no new concept to cross the DOM/3D boundary
(`state` already means the same thing everywhere in the file); React
needed the ordinary "lift state up" pattern, which is general-purpose and
well-understood, but is a pattern applied to this problem rather than a
feature of the 3D library itself - `@react-three/fiber`'s `<Canvas>` has
no built-in notion of "the page around me."

## Rubric scores (0-5, see `benchmarks/README.md`)

| Category | AXIS | React + R3F | Note |
|---|---|---|---|
| Functionality | 5 | 5 | All 9 requirements met by both |
| Interaction quality | 4 | 4 | Identical interaction model; R3F's built-in NDC `state.pointer` made the parallax math slightly more direct to write than AXIS's delta-accumulation, but the end result is equivalent |
| Visual quality | 3 | 3 | Deliberately plain for both (a flat-shaded sphere, no textures/post-processing) - this task doesn't stress visual polish |
| Responsiveness | 4 | 4 | Both render at native canvas framerate; no jank observed in either during testing |
| Animation quality | 4 | 4 | Same rotation speed/easing target (`360deg`/12s vs. `2*PI/12` rad/s), same parallax smoothing intent |

No category shows a lopsided winner for this task - Task 1 alone does not
support a strong verdict either way. The dependency-resolution friction
found on the React side (see above) is the most concrete asymmetry, but
it's a JS-ecosystem/library-versioning issue, not a fundamental limitation
of React or Three.js as such.

## A methodology note

The first verification pass used the interactive Chrome-extension browser
automation tool, and initially seemed to show camera parallax and idle
rotation *not* working on the AXIS side. That was a false negative: the
automation tool's controlled tab had `document.visibilityState ===
"hidden"` (confirmed directly), which makes Chrome fully throttle
`requestAnimationFrame` - so nothing driven by `on tick` could have run,
regardless of correctness. Switching to a throwaway script built on the
same real-server-plus-headless-Chromium pattern `tests/browser/harness.js`
already uses for this exact class of problem (see that file's own header)
resolved it immediately.
Recorded here because it's a real lesson for verifying *any* tick-driven
AXIS behavior going forward, not specific to this task.
