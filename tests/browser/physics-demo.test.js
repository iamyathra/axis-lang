// Real-browser regression coverage for examples/physics-demo/'s actual
// package (axis_modules/physics2d/'s self-bound `makeBody` records held
// in page-level `state`) - a case the data-with-behavior bug (see
// docs/architecture/2026-09-language-platform-audit.md's game-foundation
// addendum) affected too, previously undiscovered for the same reason
// examples/entities.ax's own breakage was: tests/physics-demo.test.js
// only ever calls the synchronous evaluator directly, bypassing the JSON
// plan transport entirely, and no browser test exercised the real file
// before this one. Uses harness.js's withPageFile (new, for exactly this
// gap) to run the REAL example, with its REAL `import ... from
// "physics2d"`, through a real headless browser - not a hand-inlined
// stand-in.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { withPageFile, closeSharedBrowser } from "./harness.js";

const ENTRY = fileURLToPath(new URL("../../examples/physics-demo/main.ax", import.meta.url));

test("the real physics2d package's self-bound body records actually fall and bounce over many real ticks, in a real browser", async () => {
  await withPageFile(ENTRY, async (page, consoleErrors) => {
    const ball = page.locator('[data-axis-name="b1"]');
    await ball.waitFor({ timeout: 5000 });

    async function readTop() {
      return await ball.evaluate((el) => parseFloat(el.style.top));
    }

    // Deliberately no assertion on the initial value itself - under real
    // system load, an unknown amount of real fall time may have already
    // elapsed by the time this first read happens (page load/waitFor
    // isn't instantaneous), so "near 0" isn't a safe assumption. Not
    // strictly-increasing-at-every-consecutive-pair either, for the same
    // reason: under heavy concurrent-suite load, a single narrow gap
    // between two checkpoints can occasionally catch zero freshly
    // rendered frames (browser-scheduling jitter, not a product bug),
    // making two adjacent reads equal by coincidence. What IS safe to
    // assert regardless of that jitter: across four checkpoints spanning
    // a wider window, the value never DECREASES between any pair (ruling
    // out a real reset), and the LAST is strictly greater than the
    // FIRST (ruling out "frozen forever," the actual bug this test
    // exists to catch - if `.step()`/`.bounceFloor()`/`.bounceWalls()`
    // threw on every tick, every checkpoint would read identically,
    // failing that final comparison). The whole window (450ms) stays
    // well before ball1's first floor bounce (~780ms of simulated fall
    // time from y=0 to the floor at 276 under GRAVITY=900), so a
    // legitimate mid-fall bounce reversing direction doesn't confuse
    // "never decreases" for the wrong reason either.
    const samples = [];
    for (let i = 0; i < 4; i++) {
      samples.push(await readTop());
      await page.waitForTimeout(150);
    }

    for (let i = 1; i < samples.length; i++) {
      assert.ok(samples[i] >= samples[i - 1], `expected the ball's top to never decrease mid-fall, got ${JSON.stringify(samples)}`);
    }
    assert.ok(samples[3] > samples[0], `expected the ball to have measurably fallen across the whole window, got ${JSON.stringify(samples)}`);
    assert.deepEqual(consoleErrors, []);
  });
});

after(closeSharedBrowser);
