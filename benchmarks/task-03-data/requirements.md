# Task 3 - Interactive Data / Information Experience

Defined before either implementation was written. The mission's stated
purpose for this task is specifically to test **bidirectional** DOM/3D
state interaction, not just DOM-drives-3D or 3D-drives-DOM alone - the
requirements below are built around that.

## Functional requirements

1. **Title + description** - a heading and one sentence of subtitle copy,
   in the DOM.
2. **Data-driven 3D scene** - a small solar system: one central star and
   4 orbiting planets, generated from an array of plain data (name,
   color, orbit distance, orbit period, a one-sentence fact), not 4
   hand-written objects. Orbits animate continuously.
3. **DOM sidebar list** - the same 4 planets, listed by name in the DOM,
   each individually clickable.
4. **3D -> DOM**: clicking a planet in the 3D scene selects it - it
   becomes visually highlighted (a distinct color/tint), and a DOM detail
   panel updates to show that planet's name, fact, and orbit distance.
5. **DOM -> 3D**: clicking a planet's name in the DOM sidebar list
   produces the *exact same effect* - that planet highlights in the 3D
   scene, and the same detail panel updates - proving the same piece of
   "which planet is selected" state drives both directions, not two
   separate mechanisms.
6. **Default state** - before anything is selected, the detail panel
   shows a neutral prompt ("Select a planet") rather than stale/undefined
   data.
7. Only one planet is highlighted at a time (selecting a new one
   un-highlights the previous one).

## Non-functional / comparison-relevant constraints

- The 4 planets must come from one array of data threaded through a
  loop/`.map()` - not 4 copy-pasted objects - since the task is explicitly
  about data-driven DOM+3D, not just DOM+3D existing side by side.
- No external assets, no physics.
- Verified in a real browser: click a planet in 3D, confirm the DOM
  panel and the sidebar's own selected-state agree; click a different
  planet in the DOM list, confirm the 3D highlight moves and the panel
  updates to match.

## What's measured (see `results.md`)

Same categories as Tasks 1-2, with special attention to: how much code
was needed specifically for the *loop + shared selection state* pattern
(a reactive binding that has to be correct per-iteration, referencing a
value shared across the DOM/3D boundary) - this is the single requirement
most likely to expose a real gap in either stack, since it combines three
things each stack handles separately (data-driven generation, DOM/3D
shared state, and per-item reactivity) into one place.

## Limitation acknowledged up front

Same as Tasks 1-2 - see `benchmarks/README.md`'s "Familiarity bias"
section.
