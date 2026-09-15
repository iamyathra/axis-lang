# Task 2 - 3D Product Configurator

Defined before either implementation was written.

## Functional requirements

1. **Title + description** - a heading "Configure your product" and one
   sentence of subtitle copy, in the DOM.
2. **3D product** - a single procedural object (a cube stand-in - no
   external model asset, consistent with Task 1's constraints) rendered in
   a canvas region.
3. **Orbit** - dragging inside the 3D canvas orbits the camera around the
   product (a real click-and-drag orbit control, not just a hover tilt).
4. **Color** - at least 3 DOM buttons that change the product's color
   live.
5. **Size** - DOM `-`/`+` controls that change the product's scale live,
   clamped to a sane range (doesn't shrink to nothing or grow unbounded).
6. **Toggle an accessory** - a DOM toggle button that shows/hides a second,
   smaller 3D object positioned near the product (e.g. sitting on top of
   it), with an **animated** transition (a smooth scale/fade, not an
   instant snap-in/snap-out).
7. **Live price** - DOM text showing a computed price that updates
   whenever size or the accessory toggle changes (e.g. a base price, a
   size multiplier, and a flat accessory surcharge when it's on).
8. **Click the product** - clicking the product itself (not the
   accessory) increments an "Interactions" counter shown in the DOM - the
   same DOM/3D shared-state shape Task 1 tested, kept here so both tasks
   are comparable on that specific dimension.

## Non-functional / comparison-relevant constraints

- No external 3D model asset, no physics engine.
- Orbit control may come from a library/built-in the stack already
  provides (AXIS's `camera { controls: "orbit" }`, React's
  `OrbitControls`) - hand-rolling a drag-to-orbit camera isn't the point
  of this task.
- Must run in a real browser and be interaction-tested (drag, click,
  color pick, size change, accessory toggle), not just "builds cleanly."

## What's measured (see `results.md`)

Same categories as Task 1's `results.md`, plus: how the accessory's
animated toggle was implemented in each stack (AXIS has a declarative
`animate` block for a triggered property transition; a plain
`@react-three/fiber` scene has no built-in equivalent - whether that
needed a new dependency or manual per-frame lerp code is itself a data
point).

## Limitation acknowledged up front

Same as Task 1 - see `benchmarks/README.md`'s "Familiarity bias" section.
