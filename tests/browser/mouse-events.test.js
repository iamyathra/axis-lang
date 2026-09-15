// Real browser coverage for 'on mousemove'/'on mousedown'/'on mouseup' -
// proves a real mouse event, dispatched through an actual browser, reaches
// AXIS's runtime and runs the right handler with dx/dy/button bound -
// something node --test alone can't exercise. Same rationale as
// tests/browser/keyboard-events.test.js's own header comment.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { withPage, closeSharedBrowser } from "./harness.js";

test("a page-level 'on mousemove' handler receives real movement deltas", async () => {
  const source = `
    page Home {
      state totalDx = 0
      state totalDy = 0
      text dxLabel { content: str(totalDx) }
      text dyLabel { content: str(totalDy) }

      on mousemove {
        totalDx = totalDx + dx
        totalDy = totalDy + dy
      }
    }
  `;
  await withPage(source, async (page, consoleErrors) => {
    await page.mouse.move(100, 50);
    await page.waitForTimeout(50);
    await page.mouse.move(140, 90);
    await page.waitForTimeout(50);

    const totalDx = Number(await page.locator('[data-axis-name="dxLabel"]').textContent());
    const totalDy = Number(await page.locator('[data-axis-name="dyLabel"]').textContent());
    // Playwright's virtual mouse starts at (0,0) - two moves to (100,50)
    // then (140,90) should accumulate to the final absolute position.
    assert.equal(totalDx, 140);
    assert.equal(totalDy, 90);
    assert.deepEqual(consoleErrors, []);
  });
});

test("a page-level 'on mousedown'/'on mouseup' handler receives the real button that was pressed", async () => {
  const source = `
    page Home {
      state lastDown = -1
      state lastUp = -1
      text downLabel { content: str(lastDown) }
      text upLabel { content: str(lastUp) }

      on mousedown {
        lastDown = button
      }

      on mouseup {
        lastUp = button
      }
    }
  `;
  await withPage(source, async (page, consoleErrors) => {
    await page.mouse.move(50, 50);
    await page.mouse.down();
    await page.waitForTimeout(50);
    assert.equal(await page.locator('[data-axis-name="downLabel"]').textContent(), "0");

    await page.mouse.up();
    await page.waitForTimeout(50);
    assert.equal(await page.locator('[data-axis-name="upLabel"]').textContent(), "0");
    assert.deepEqual(consoleErrors, []);
  });
});

test("a scene-level mouse handler works too, and can write to state shared with the page", async () => {
  const source = `
    state clicks = 0

    scene demo {
      cube box { color: red }
      on mousedown { clicks = clicks + 1 }
    }

    page Home {
      text clickLabel { content: str(clicks) }
      viewport stage { scene: "demo" width: 200 height: 200 }
    }
  `;
  await withPage(source, async (page, consoleErrors) => {
    await page.locator('[data-axis-name="stage"] canvas').waitFor({ timeout: 5000 });
    await page.mouse.move(250, 250); // outside the canvas - window-level listener, not canvas-scoped
    await page.mouse.down();
    await page.waitForTimeout(50);
    assert.equal(await page.locator('[data-axis-name="clickLabel"]').textContent(), "1");
    await page.mouse.up();
    assert.deepEqual(consoleErrors, []);
  });
});

after(closeSharedBrowser);
