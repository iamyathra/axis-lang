# Task 1 - Interactive 3D Hero

Defined before either implementation was written, so both are held to the
identical, literal spec below - no requirement was adjusted after seeing
which stack handled it better.

## Functional requirements

1. **Title** - a large heading: "Orbit Studio".
2. **Description** - one sentence of subtitle copy under the title.
3. **CTA** - a button labeled "Get started".
4. **3D object** - a single rotating icosahedron (or equivalent polyhedron)
   rendered in a canvas region of the page, always spinning slowly on its
   own Y axis (ambient idle animation, independent of user input).
5. **Camera motion** - the camera's position responds continuously to
   mouse position over the 3D canvas: moving the mouse left/right/up/down
   orbits the camera slightly around the object (a parallax-style look,
   not a full orbit-drag control - the object should visibly appear to
   turn to "follow" the cursor within a small angular range).
6. **Hover interaction** - hovering the 3D object changes its color (e.g.
   base color -> a distinct highlight color) and reverts on unhover.
7. **Click interaction** - clicking the 3D object increments a counter.
8. **Shared state** - the DOM side of the page displays the current
   click-counter value as text (e.g. "Interactions: 3"), updating live as
   the 3D object is clicked. This is the one requirement that specifically
   tests DOM state and 3D state interacting, not two independent halves.
9. The CTA button's own click does something observable (e.g. changes its
   own label to "Thanks!") - present so the page has more than one live
   interactive element, not just the 3D object.

## Non-functional / comparison-relevant constraits

- Single logical "page" - no client-side routing.
- No physics engine, no external 3D model asset (procedural geometry
  only) - keeps the task about hero-page plumbing, not asset pipelines.
- Must actually run in a real browser and be visually verified, not just
  "builds without errors."

## What's measured (recorded in results.md)

- Generation time (wall-clock time to reach a first complete attempt)
- First-pass correctness (did it run without manual intervention)
- Repair cycles (how many fix-and-recheck loops before all 9 requirements
  were met)
- Code size (lines, files)
- Dependencies pulled in
- How requirement 8 (DOM/3D shared state) was plumbed, concretely
- Functionality / interaction quality / visual quality / responsiveness /
  animation quality, each 0-5 per the shared benchmark rubric (see
  `benchmarks/README.md`)

## Limitation acknowledged up front

Both implementations in this repo were written by the same AI assistant
that also helps build and maintain AXIS itself - see
`benchmarks/README.md`'s "Familiarity bias" section. This is not a blind
trial. Numbers here describe what happened in this specific comparison,
not a claim about what a randomly-selected AI-assisted developer would
experience cold.
