// The actual curve math behind every 'easing:' name a .ax file can use (see
// docs/language.md's Easing section) - every curve is a real function of
// t in [0, 1], and every one of them (even the overshooting 'Back' curves
// and the piecewise 'Bounce' one) must still start exactly at 0 and land
// exactly at 1, or a t=0/t=1 animation frame would render at the wrong
// value even though the animation itself is otherwise correct.

import { test } from "node:test";
import assert from "node:assert/strict";
import { EASINGS } from "../src/renderer/easing.js";
import { EASING_NAMES } from "../src/globals.js";

test("every named easing curve starts at f(0)=0 and ends at f(1)=1", () => {
  for (const name of EASING_NAMES) {
    const f = EASINGS[name];
    assert.ok(typeof f === "function", `EASINGS is missing an implementation for '${name}'`);
    assert.ok(Math.abs(f(0)) < 1e-9, `${name}(0) should be 0, got ${f(0)}`);
    assert.ok(Math.abs(f(1) - 1) < 1e-9, `${name}(1) should be 1, got ${f(1)}`);
  }
});

test("EASINGS has no extra curves beyond what globals.js's EASING_NAMES declares as valid", () => {
  assert.deepEqual(Object.keys(EASINGS).sort(), [...EASING_NAMES].sort());
});

test("the quad/cubic 'In' curves start slow (below the linear diagonal) at t=0.25", () => {
  assert.ok(EASINGS.easeIn(0.25) < 0.25);
  assert.ok(EASINGS.easeInCubic(0.25) < EASINGS.easeIn(0.25)); // cubic accelerates harder than quad
});

test("the quad/cubic 'Out' curves start fast (above the linear diagonal) at t=0.25", () => {
  assert.ok(EASINGS.easeOut(0.25) > 0.25);
  assert.ok(EASINGS.easeOutCubic(0.25) > EASINGS.easeOut(0.25)); // cubic decelerates harder than quad
});

test("'Back' curves genuinely overshoot past 0/1, not just approach it", () => {
  assert.ok(EASINGS.easeOutBack(0.9) > 1, "easeOutBack should overshoot past 1 before settling");
  assert.ok(EASINGS.easeInBack(0.1) < 0, "easeInBack should dip below 0 before accelerating");
});

test("easeOutBounce genuinely bounces - it dips back down after a local peak, not a monotonic curve", () => {
  // Sampled: rises to a local peak around t=0.37, then dips before the
  // next (smaller) bounce - a plain monotonic curve never does this.
  const peak = EASINGS.easeOutBounce(0.37);
  const afterDip = EASINGS.easeOutBounce(0.39);
  assert.ok(afterDip < peak, `expected a dip after the local peak (peak=${peak}, after=${afterDip})`);
});
