// Real browser coverage for scene3d.js's raycasting/interaction - "does
// clicking the actual canvas, at the actual pixel a 3D shape renders to,
// actually fire that shape's `on click` handler." Verified through a shared
// top-level `state` (scene and page share one - see docs/language.md) that
// the scene's own handler writes and the page's own DOM reads, rather than
// by reading pixels back off the WebGL canvas (fragile - depends on
// `preserveDrawingBuffer` and exact compositor timing) or reaching for a
// debug hook scene3d.js deliberately doesn't expose.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { withPage, closeSharedBrowser } from "./harness.js";

const SOURCE = `
fn statusText(done) {
  if (done) { return "clicked" }
  return "not clicked"
}

state clicked = false

scene demo {
  cube box { color: red }
  on box.click { clicked = true }
}

page Home {
  text status { content: statusText(clicked) }
  viewport stage { scene: "demo" width: 300 height: 300 }
}
`;

test("clicking a 3D shape at its actual rendered position fires its 'on click' handler", async () => {
  await withPage(SOURCE, async (page, consoleErrors) => {
    const canvas = page.locator('[data-axis-name="stage"] canvas');
    await canvas.waitFor({ timeout: 5000 });

    const status = page.locator('[data-axis-name="status"]');
    assert.equal(await status.textContent(), "not clicked");

    // The default camera + a bare `cube` (no explicit position) always
    // frames the shape centered in its own viewport - see docs/language.md's
    // Camera section - so the canvas's own center is always a real hit,
    // without this test needing to know anything about camera/projection
    // math itself.
    const box = await canvas.boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

    await assert_eventually(() => status.textContent(), (text) => text === "clicked", "expected 'status' to read 'clicked' after clicking the cube");
    assert.deepEqual(consoleErrors, []);
  });
});

// Polls `read()` until `predicate` is true or a timeout elapses - a click's
// own handler runs asynchronously (executeBlockAsync) and reRenderAll only
// happens after it resolves, so the DOM update isn't guaranteed to be
// visible the instant `page.mouse.click()` returns.
async function assert_eventually(read, predicate, message, timeoutMs = 3000) {
  const start = Date.now();
  let last;
  while (Date.now() - start < timeoutMs) {
    last = await read();
    if (predicate(last)) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`${message} (last saw: ${JSON.stringify(last)})`);
}

after(closeSharedBrowser);
