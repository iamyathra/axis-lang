// Real browser coverage for 'on keydown'/'on keyup' - proves a real
// keyboard event, dispatched through an actual browser, reaches AXIS's
// runtime and runs the right handler with 'key' bound - something
// node --test alone can't exercise (no real KeyboardEvent dispatch/window
// listener wiring outside a real DOM). Same rationale as
// tests/browser/tick.test.js's own header comment.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { withPage, closeSharedBrowser } from "./harness.js";

test("a page-level 'on keydown'/'on keyup' handler receives the real key that was pressed", async () => {
  const source = `
    page Home {
      state lastDown = "none"
      state lastUp = "none"
      text downLabel { content: lastDown }
      text upLabel { content: lastUp }

      on keydown {
        lastDown = key
      }

      on keyup {
        lastUp = key
      }
    }
  `;
  await withPage(source, async (page, consoleErrors) => {
    await page.keyboard.down("a");
    await page.waitForTimeout(50);
    assert.equal(await page.locator('[data-axis-name="downLabel"]').textContent(), "a");

    await page.keyboard.up("a");
    await page.waitForTimeout(50);
    assert.equal(await page.locator('[data-axis-name="upLabel"]').textContent(), "a");
    assert.deepEqual(consoleErrors, []);
  });
});

test("a scene-level 'on keydown' handler works too, and can write to state shared with the page", async () => {
  const source = `
    state sceneKey = "none"

    scene demo {
      cube box { color: red }
      on keydown { sceneKey = key }
    }

    page Home {
      text keyLabel { content: sceneKey }
      viewport stage { scene: "demo" width: 200 height: 200 }
    }
  `;
  await withPage(source, async (page, consoleErrors) => {
    await page.locator('[data-axis-name="stage"] canvas').waitFor({ timeout: 5000 });
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(50);
    assert.equal(await page.locator('[data-axis-name="keyLabel"]').textContent(), "ArrowRight");
    assert.deepEqual(consoleErrors, []);
  });
});

after(closeSharedBrowser);
