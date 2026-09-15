// colorLerp.js is browser-only (resolveRgb/prepareColorChange need a real
// <canvas> to parse an arbitrary CSS color string - see the module's own
// header comment), but lerpColorRgb itself is pure component-wise math with
// no DOM dependency at all - genuinely Node-testable, unlike the rest of
// that file's browser-verified behavior (see docs/architecture and the
// dom-plan.test.js/dom-timelines.test.js coverage of the build-time half of
// DOM color/background animation).

import { test } from "node:test";
import assert from "node:assert/strict";
import { lerpColorRgb } from "../src/renderer/colorLerp.js";

test("lerpColorRgb at t=0 returns the 'from' color exactly", () => {
  assert.equal(lerpColorRgb([0, 0, 0], [255, 255, 255], 0), "#000000");
});

test("lerpColorRgb at t=1 returns the 'to' color exactly", () => {
  assert.equal(lerpColorRgb([0, 0, 0], [255, 255, 255], 1), "#ffffff");
});

test("lerpColorRgb at t=0.5 is the componentwise midpoint", () => {
  assert.equal(lerpColorRgb([0, 0, 0], [255, 255, 255], 0.5), "#808080"); // round(127.5) = 128 = 0x80
});

test("lerpColorRgb interpolates each channel independently", () => {
  // red -> blue: R falls, G stays 0, B rises
  assert.equal(lerpColorRgb([255, 0, 0], [0, 0, 255], 0.25), "#bf0040");
});

test("lerpColorRgb rounds a fractional channel value to the nearest whole byte", () => {
  assert.equal(lerpColorRgb([0, 0, 0], [1, 1, 1], 0.5), "#010101"); // 0.5 rounds up to 1
});
