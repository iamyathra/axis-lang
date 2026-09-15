# Task 4 - Cinematic Portfolio / Project Experience - results

Verified the same way as Tasks 1-3 - a throwaway Playwright script against
each stack's real server output. No new AXIS bugs found this time; both
implementations worked on the first attempt.

## Requirement-by-requirement

| # | Requirement | AXIS | React + R3F |
|---|---|---|---|
| 1 | Hero (title/tagline/animated 3D visual) | met | met |
| 2 | Project metadata (role/year/tools) | met | met |
| 3 | Scroll-driven progress indicator | met | met |
| 4 | Data-driven crew cards | met | met |
| 5 | Click-to-cycle 3D color | met | met |
| 6 | Enough vertical content to exercise scrolling | met | met |

Both implementations meet all 6 requirements, verified live: scroll
progress sampled at 0/25/50/75/100% of document height on both stacks
shows a monotonically increasing bar width that plateaus once the hero
section itself has fully scrolled past (correct - progress is measured
against the hero container's own height, not the whole document, in both
implementations, by design - see below); a real click on the 3D shape
changes its rendered color (screenshot pixel diff) on both stacks; zero
console errors on either.

## Generation time / repair cycles

**AXIS**: 0 repair cycles - valid on the first `axis check`, worked on
the first real-browser run. Nothing from Task 3's bug class was hit here
because nothing in this task combines a `for` loop with a *reactive*
per-item property binding - the crew cards' `content: c.name`/`c.role`
bindings are pure functions of the loop's own literal source data, never
re-evaluated against a changed `state`, so there was no binding-capture
path to fall into. The color-cycling interaction lives entirely on a
single, non-loop-generated object, which was never affected by Task 3's
bugs even before they were fixed.

**React + R3F**: also 0 repair cycles. `npm install` succeeded immediately
using the override fix carried over from Task 1.

## The scroll-driven requirement, compared

- **AXIS**: `scrollProgress: "progress"` on the hero `container` - one
  line, on the *existing* element, writing directly into a shared
  top-level `state` that both the DOM (`width: round(progress*100) +
  "%"`) and the 3D scene (`scale: 0.9 + progress*0.6`) read as an
  ordinary reactive value, no different from reading a `state` set by a
  click handler. Zero new concepts beyond `state` itself, and it's a
  genuine part of the language's own vocabulary - the exact case AXIS's
  "shared vocabulary" thesis is built around.
- **React + R3F**: no built-in scroll-linked value primitive in plain
  React or `@react-three/fiber`. Implemented by hand: a `ref` on the hero
  div, a `window` scroll listener in `useEffect`, `useState` for the
  resulting number, passed down as an ordinary prop to both the DOM width
  style and the 3D mesh's scale. ~10 lines of manual plumbing that AXIS
  gets from one property declaration - the single clearest, most direct
  piece of evidence for AXIS's stated value proposition found in this
  suite so far. A real project would likely reach for a library
  (`react-scroll-parallax`, `framer-motion`'s scroll utilities, or
  `@react-three/drei`'s `ScrollControls`) instead of hand-rolling this,
  which would mean yet another dependency for something AXIS ships as a
  core language feature.

## Dependencies / files / size

| | AXIS | React + R3F |
|---|---|---|
| Files | 1 (`main.ax`) | 5 |
| Lines (excl. config/manifest) | 217 | 110 (`App.jsx` + `main.jsx`) |
| New direct dependencies for this task | 0 | 0 (same 4 as Task 1) |
| `node_modules` size | 0 extra | 82MB / 35 packages |
| Manual scroll-tracking code | 0 lines (`scrollProgress` is declarative) | ~10 lines (`useEffect` + scroll listener + `useState`) |

AXIS's higher line count here is mostly the DOM layout itself (more
distinct sections than Tasks 1-3: hero, progress bar, metadata row, crew
grid, footer) rather than anything related to the scroll feature - the
`scrollProgress` line itself is the shortest part of either file.

## Rubric scores (0-5)

| Category | AXIS | React + R3F | Note |
|---|---|---|---|
| Functionality | 5 | 5 | All 6 requirements met by both, first try |
| Interaction quality | 4 | 4 | Identical click-to-cycle and scroll behavior |
| Visual quality | 3 | 3 | Deliberately plain layout, consistent with Tasks 1-3's scope decision |
| Responsiveness | 4 | 4 | No jank in either during scroll or click |
| Animation quality | 4 | 4 | Same idle-rotation + scroll-scaled 3D visual on both sides |

## Reading this task's result

Task 4 is the cleanest positive data point for AXIS in the suite: no bugs
on either side, and the one genuinely new capability under test
(scroll-linked reactive data) is native to AXIS and hand-rolled in React.
It's also a useful counterweight to Task 3 - this task shows AXIS working
exactly as advertised when the code stays inside patterns the language
was actually designed and tested for (a single object's properties, not
a loop-generated one's reactive bindings).
