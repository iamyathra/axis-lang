# Task 5 - Small Interactive Web Toy

Defined before either implementation was written. Deliberately small per
the mission brief - not a full game.

## Concept

"Zero-Gravity Playground" - a ball floats inside a bounded 3D box. Arrow
keys nudge it (an impulse, not held-continuous thrust); it drifts,
bounces off the box's walls, and slowly loses speed. Clicking the ball
cycles its color. A DOM counter tracks how many times it has bounced.

## Functional requirements

1. **Title + short instructions** in the DOM ("Arrow keys to nudge. Click
   the ball to change its color.").
2. **A ball in a bounded 3D region** - continuously in motion once
   nudged, never leaving a fixed cube-shaped boundary.
3. **Keyboard control** - the four arrow keys each apply an impulse to
   the ball's velocity in a distinct direction (left/right on one axis,
   up/down on another).
4. **Wall bounce** - hitting any boundary wall reverses the appropriate
   velocity component (a real bounce, not a stop or a clamp) and
   increments a "Bounces" counter shown in the DOM.
5. **Damping** - velocity decays gradually over time, so the ball settles
   rather than accelerating forever.
6. **Click-to-cycle color** - clicking the ball itself cycles it through
   a small set of distinct colors, independent of the keyboard/bounce
   mechanics.

## Non-functional / comparison-relevant constraints

- No physics engine - hand-rolled velocity/position integration and
  boundary-reversal only (the same technique `examples/tick.ax`'s bounce
  already proves works in AXIS, extended to a full 3D vector and
  keyboard-driven impulses instead of one fixed axis).
- No external assets.
- Verified in a real browser: pressing each arrow key visibly changes
  motion, the bounce counter increments on a real wall collision (not on
  every tick), and clicking the ball changes its color.

## What's measured (see `results.md`)

Same categories as Tasks 1-4, plus: this is the first task in the suite
driven by keyboard input rather than only mouse/click - whether that
introduces anything new on either stack's side.

## Limitation acknowledged up front

Same as Tasks 1-4 - see `benchmarks/README.md`'s "Familiarity bias"
section.
