// README's own roadmap item 12 ("An audit of pre-pivot examples for the
// same literal-vector-binding bug item 8 fixed - not verified affected,
// not verified clean either") was still open: every existing regression
// test for the isLiteralExpr bug (tests/browser/tick.test.js,
// tests/browser/vector-accumulation.test.js, ...) checks a HAND-COPIED
// mirror of examples/tick.ax's scene, not the actual shipped file - and
// none of them run it long enough to reach its own bounce (velocity 2,
// starting at x=0, needs 1.5s to reach the x>3 boundary; the existing
// mirror test only waits 500ms). So the exact behavior the file's own
// comment advertises - "the bounce itself is just ordinary AXIS code (an
// 'if' and a velocity flip)" - had zero coverage of the flip actually
// happening, on the real file, until now.
//
// This test reads examples/tick.ax's real source from disk (proving
// against drift the way tests/self-binding.test.js's own postmortem says
// a same-process/hand-copied test cannot - see this project's testing
// philosophy) and only transforms it just enough to observe
// `box.position.x` from a page (tick.ax is scene-only, and the browser
// harness has no debug hook for reading an object's live position other
// than through the AXIS-language `state` mechanism itself) - a targeted,
// exact-line replace that fails loudly if examples/tick.ax's own
// accumulation line ever changes shape, rather than silently testing
// something else.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { withPage, closeSharedBrowser } from "./harness.js";

const tickExamplePath = fileURLToPath(new URL("../../examples/tick.ax", import.meta.url));
const realSource = readFileSync(tickExamplePath, "utf8");

const accumulationLine = "box.position = (box.position.x + velocityX * dt, box.position.y, box.position.z)";
assert.ok(
  realSource.includes(accumulationLine),
  "examples/tick.ax's own accumulation line has changed shape - update this test's mirrored `boxX = box.position.x` splice to match before relying on it"
);

// The one addition: mirror the real file's own `box.position.x` into a
// shared `state` right after the real line sets it, so a page can observe
// it - no other line of the real scene body is touched.
const sceneSource = realSource.replace(accumulationLine, `${accumulationLine}\n        boxX = box.position.x`);
const source = `
  state boxX = 0

  ${sceneSource}

  page Home {
    text boxXLabel { content: str(boxX) }
    viewport stage { scene: "main" width: 200 height: 200 }
  }
`;

test("examples/tick.ax's real bounce actually reverses direction after crossing the boundary, not just accumulates one-way", async () => {
  await withPage(source, async (page, consoleErrors) => {
    await page.locator('[data-axis-name="stage"] canvas').waitFor({ timeout: 5000 });
    const label = page.locator('[data-axis-name="boxXLabel"]');

    // Sampled shape, not fixed wall-clock thresholds tied to an assumed
    // tick throughput (headless Chromium's actual frame rate/latency here
    // varies with the host machine) - proves both real accumulation (an
    // early sample already well past one tick's worth) AND a genuine
    // rise-then-fall (a peak strictly after the first sample and strictly
    // before the last, with the last sample below the peak) over enough
    // real wall time to comfortably contain a full bounce cycle regardless
    // of exact throughput.
    const samples = [];
    for (let i = 0; i < 10; i++) {
      await page.waitForTimeout(500);
      samples.push(Number(await label.textContent()));
    }

    assert.ok(samples[0] > 0.15, `expected real accumulation well past one tick's worth by the first checkpoint, got x=${samples[0]}`);

    let peakIndex = 0;
    for (let i = 1; i < samples.length; i++) {
      if (samples[i] > samples[peakIndex]) peakIndex = i;
    }
    assert.ok(
      peakIndex > 0 && peakIndex < samples.length - 1,
      `expected a genuine rise-then-fall shape (peak strictly between the first and last checkpoint) proving the bounce boundary was actually reached and reversed, got ${JSON.stringify(samples)}`
    );
    assert.ok(
      samples[samples.length - 1] < samples[peakIndex] - 0.3,
      `expected position to have reversed and decreased substantially after its peak (a broken/no-op 'if' + sign-flip would keep climbing instead), got ${JSON.stringify(samples)}`
    );

    assert.deepEqual(consoleErrors, []);
  });
});

after(closeSharedBrowser);
