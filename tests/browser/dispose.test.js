// Real browser coverage for scene3d.js's dispose() - the audit finding this
// whole suite exists to close: "no leak found in this layer" was previously
// only ever verified by hand (see tests/viewport-lifecycle.test.js's own
// header, which documents exactly that). This actually mounts and unmounts
// a real `viewport` many times in a real browser and checks for the one
// unambiguous, hard-to-fake signal a real leak would produce: a headless
// Chromium process only tolerates a bounded number of *simultaneously live*
// WebGL contexts (documented browser behavior, not an AXIS-specific limit) -
// if scene3d.js's dispose() didn't actually free the previous renderer's
// context before the next mount created a new one, this would eventually
// fail to acquire a context at all, or Chromium would start evicting/
// warning about lost contexts. Neither happens if dispose() is doing its
// job.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { withPage, closeSharedBrowser } from "./harness.js";

// \`visible: expr\` directly on the viewport - not a reactive \`if\` wrapping
// it - is the documented, supported mount/unmount mechanism (see
// docs/language.md's Viewports section and
// docs/architecture/conditional-viewport.md): a real lifecycle switch for
// the 3D runtime itself, not just a display toggle. A \`viewport\` nested
// inside a reactive \`if\`/\`for\` is a separate, different, still-unsupported
// combination (documented as a real, current limitation) - deliberately not
// what this test exercises.
const SOURCE = `
scene demo {
  cube box { color: red }
}

page Home {
  state shown = true
  button toggle { label: "toggle" }
  viewport stage { scene: "demo" width: 200 height: 200 visible: shown }
  on toggle.click { shown = !shown }
}
`;

test("mounting and unmounting a viewport many times doesn't accumulate canvases or leak WebGL contexts", async () => {
  await withPage(SOURCE, async (page, consoleErrors) => {
    const STAGE_CANVAS = '[data-axis-name="stage"] canvas';
    const TOGGLE = '[data-axis-name="toggle"]';
    await page.waitForSelector(STAGE_CANVAS, { timeout: 5000 });
    assert.equal(await page.locator("canvas").count(), 1);

    const CYCLES = 15;
    for (let i = 0; i < CYCLES; i++) {
      await page.click(TOGGLE); // unmount
      await page.waitForSelector(STAGE_CANVAS, { state: "detached", timeout: 5000 });
      assert.equal(await page.locator("canvas").count(), 0, `cycle ${i}: expected no canvas while hidden`);

      await page.click(TOGGLE); // remount
      await page.waitForSelector(STAGE_CANVAS, { timeout: 5000 });
      assert.equal(await page.locator("canvas").count(), 1, `cycle ${i}: expected exactly one canvas after remount`);
    }

    const contextErrors = consoleErrors.filter((m) => /context|WEBGL|lost/i.test(m));
    assert.deepEqual(contextErrors, [], `expected no WebGL-context-related console errors after ${CYCLES} mount/unmount cycles, got: ${contextErrors.join("; ")}`);
  });
});

after(closeSharedBrowser);
