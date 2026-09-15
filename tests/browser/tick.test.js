// Real browser coverage for the actual per-frame tick()/requestAnimationFrame
// loop - both domains. Every other test in this project that touches
// animation timing (tests/timeline-playback.test.js, tests/dom-plan.test.js,
// ...) verifies the *scheduling math* directly (tickTimeline/stepAnimation
// called with synthetic timestamps) or the *build-time plan* - genuinely
// good coverage, but none of it proves requestAnimationFrame itself is
// actually wired up and firing repeatedly over real wall-clock time in a
// real browser. These tests wait for real milliseconds to pass and check
// state that can only have changed if RAF fired many times in between.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { withPage, closeSharedBrowser } from "./harness.js";

test("a scene timeline actually completes over real time, firing 'on TIMELINE.complete' end to end", async () => {
  const source = `
    fn statusText(done) {
      if (done) { return "done" }
      return "pending"
    }

    state finished = false

    scene demo {
      cube box { color: red }
      timeline intro { animate box { position.x -> 3 duration: 300 } }
      on intro.complete { finished = true }
    }

    page Home {
      text status { content: statusText(finished) }
      viewport stage { scene: "demo" width: 200 height: 200 }
    }
  `;
  await withPage(source, async (page, consoleErrors) => {
    const status = page.locator('[data-axis-name="status"]');
    await page.locator('[data-axis-name="stage"] canvas').waitFor({ timeout: 5000 });

    // A timeline plays automatically on load (docs/language.md's Timelines
    // section) - shortly after mount, before its 300ms duration elapses, it
    // must still genuinely be running, not already done (which would mean
    // it snapped to the end instantly instead of actually ticking).
    await page.waitForTimeout(80);
    assert.equal(await status.textContent(), "pending", "expected the timeline to still be running well before its 300ms duration elapses");

    // Comfortably past 300ms - real per-frame ticking, not a single instant
    // jump, is what gets it here.
    await page.waitForTimeout(600);
    assert.equal(await status.textContent(), "done");
    assert.deepEqual(consoleErrors, []);
  });
});

test("a page DOM 'animate' block actually interpolates color over real time, not just at start/end", async () => {
  const source = `
    page Home {
      heading title { content: "Hi" color: "#000000" }
      animate title { color -> "#ffffff" duration: 400ms }
    }
  `;
  await withPage(source, async (page, consoleErrors) => {
    const title = page.locator('[data-axis-name="title"]');

    const readColor = () => title.evaluate((el) => getComputedStyle(el).color);

    await page.waitForTimeout(60);
    const early = await readColor();
    assert.notEqual(early, "rgb(255, 255, 255)", "expected the color to still be mid-transition well before the 400ms duration elapses");
    assert.notEqual(early, "rgb(0, 0, 0)", "expected the color to have already started moving away from black");

    await page.waitForTimeout(600);
    const final = await readColor();
    assert.equal(final, "rgb(255, 255, 255)");
    assert.deepEqual(consoleErrors, []);
  });
});

test("a page-level 'on tick' handler actually runs every frame over real time, with a sensible dt", async () => {
  const source = `
    page Home {
      state frames = 0
      state totalDt = 0
      text frameCount { content: str(frames) }
      text elapsed { content: str(totalDt) }

      on tick {
        frames += 1
        totalDt += dt
      }
    }
  `;
  await withPage(source, async (page, consoleErrors) => {
    const frameCount = page.locator('[data-axis-name="frameCount"]');
    const elapsed = page.locator('[data-axis-name="elapsed"]');

    await page.waitForTimeout(300);
    const frames = Number(await frameCount.textContent());
    const totalDt = Number(await elapsed.textContent());

    // A handful of frames at minimum over 300ms - proves 'on tick' actually
    // ran repeatedly, not once (a bug that would have snuck past any test
    // using synthetic timestamps instead of real wall-clock time).
    assert.ok(frames > 3, `expected 'on tick' to have run several times in 300ms, got ${frames}`);
    // dt accumulates real elapsed seconds - loosely bounded (headless
    // Chromium's frame rate isn't guaranteed), just enough to catch dt
    // being wildly wrong (always 0, or in milliseconds instead of seconds).
    assert.ok(totalDt > 0.05 && totalDt < 2, `expected accumulated dt to be a small number of seconds, got ${totalDt}`);
    assert.deepEqual(consoleErrors, []);
  });
});

test("a scene-level 'on tick' handler runs too, and can write to state shared with the page", async () => {
  const source = `
    state sceneFrames = 0

    scene demo {
      cube box { color: red }
      on tick { sceneFrames += 1 }
    }

    page Home {
      text frameCount { content: str(sceneFrames) }
      viewport stage { scene: "demo" width: 200 height: 200 }
    }
  `;
  await withPage(source, async (page, consoleErrors) => {
    await page.locator('[data-axis-name="stage"] canvas').waitFor({ timeout: 5000 });
    await page.waitForTimeout(300);
    const frames = Number(await page.locator('[data-axis-name="frameCount"]').textContent());
    assert.ok(frames > 3, `expected the scene's 'on tick' to have run several times in 300ms, got ${frames}`);
    assert.deepEqual(consoleErrors, []);
  });
});

test("a scene object's literal-declared position actually accumulates movement across many ticks, not just one", async () => {
  // Regression test for a real interpreter bug (isLiteralExpr not
  // recognizing a vector literal like `(0, 0, 0)` as literal - see
  // tests/literal-bindings.test.js and
  // docs/architecture/2026-09-language-platform-audit.md's game-dev-
  // foundation addendum) that silently broke examples/tick.ax's own bounce:
  // `box.position` got re-applied to its original literal value after
  // every single tick, so movement never actually accumulated past one
  // frame's worth. This is exactly examples/tick.ax's own scene, mirrored
  // into shared state so it can be checked from the page.
  const source = `
    state boxX = 0

    scene demo {
      let velocityX = 2
      cube box { position: (0, 0, 0) color: red }

      on tick {
        if (box.position.x > 3 || box.position.x < -3) {
          velocityX = 0 - velocityX
        }
        box.position = (box.position.x + velocityX * dt, box.position.y, box.position.z)
        boxX = box.position.x
      }
    }

    page Home {
      text boxXLabel { content: str(boxX) }
      viewport stage { scene: "demo" width: 200 height: 200 }
    }
  `;
  await withPage(source, async (page, consoleErrors) => {
    await page.locator('[data-axis-name="stage"] canvas').waitFor({ timeout: 5000 });
    await page.waitForTimeout(500);
    const x = Number(await page.locator('[data-axis-name="boxXLabel"]').textContent());
    // velocity 2 units/sec for ~0.5s, well past one tick's worth (~0.03) -
    // proves real accumulation, not a per-tick reset.
    assert.ok(x > 0.3, `expected the box to have moved well past one tick's worth of distance, got x=${x}`);
    assert.deepEqual(consoleErrors, []);
  });
});

after(closeSharedBrowser);
