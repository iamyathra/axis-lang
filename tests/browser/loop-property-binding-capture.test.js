// Real-browser regression coverage for two real bugs found while building
// benchmarks/task-03-data (see that task's results.md for the full
// writeup): a loop-generated 3D object's reactive property binding
// referencing the loop's own iteration variable never actually updated
// after the loop finished, for two independent reasons -
//
// 1. interpreter.js's `applyProperty` stashed a property's raw expression
//    AST for later re-evaluation (SceneBuilder.applyProperty/
//    PageBuilder.applyProperty) without ever running it through
//    captureLoopVariables the way an `on`/`animate` handler body already
//    does - so every loop iteration's binding was the exact same
//    `i`-referencing expression, correct only by coincidence at the
//    moment the loop originally ran.
// 2. Even once captured, captureLoopVariables' own AST walker had no
//    `Ternary` case - it fell through to the default "return unchanged"
//    branch, so `cond ? a : b` never got its `i` reference substituted
//    even though a structurally similar `Vector`/`Binary` expression
//    (like a `position` binding) did.
//
// Both together meant `color: selected == items[i].name ? white : c` on a
// loop-generated cube silently never recolored after any click, in either
// direction (scene-originated or page-originated) - `axis check` reported
// no diagnostics, and scene3d.js's applyBindings swallows the resulting
// "undefined variable 'i'" error rather than crashing, so nothing
// indicated anything was wrong short of actually watching the color.
//
// Verified across multiple distinct selections (not just once), per this
// project's own testing philosophy - a fix that "happens to
// look right" after exactly one click could still be reverting/resetting
// on the second one.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { withPage, closeSharedBrowser } from "./harness.js";

const source = `
  state selected = ""
  state colorA = ""
  state colorB = ""

  let items = [
      { name: "itemA", color: "#c1440e" },
      { name: "itemB", color: "#4a90e2" }
  ]

  scene demo {
      camera { position: (0, 2, 8) }
      ambientLight fill { intensity: 0.8 }
      directionalLight sun { direction: (-1, -1, -0.4) intensity: 1 }

      for i in range(0, len(items)) {
          cube (items[i].name) {
              position: (i * 2.5, 0, 0)
              color: selected == items[i].name ? "#ffffff" : items[i].color
          }

          on (items[i].name).click {
              selected = items[i].name
          }
      }

      on tick {
          colorA = itemA.color
          colorB = itemB.color
      }
  }

  page Home {
      text outA { content: colorA }
      text outB { content: colorB }
      button pickA { label: "Pick A" }
      viewport stage { scene: "demo" width: 300 height: 200 }

      on pickA.click {
          selected = "itemA"
      }
  }
`;

test("a loop-generated 3D object's ternary color binding re-checks correctly across multiple scene-originated clicks", async () => {
  await withPage(source, async (page, consoleErrors) => {
    const canvas = page.locator('[data-axis-name="stage"] canvas');
    await canvas.waitFor({ timeout: 5000 });
    const box = await canvas.boundingBox();

    const outA = () => page.locator('[data-axis-name="outA"]').textContent();
    const outB = () => page.locator('[data-axis-name="outB"]').textContent();

    await page.waitForTimeout(200);
    assert.equal(await outA(), "#c1440e", "itemA starts its own color, nothing selected yet");
    assert.equal(await outB(), "#4a90e2", "itemB starts its own color, nothing selected yet");

    // Calibrated against a real screenshot of this exact scene/camera -
    // itemA (local x=0) renders left-of-center, itemB (local x=2.5)
    // right-of-center, in this 300x200 canvas.
    await page.mouse.click(box.x + 142, box.y + 104);
    await page.waitForTimeout(300);
    assert.equal(await outA(), "#ffffff", "itemA highlights white once selected via a real 3D click");
    assert.equal(await outB(), "#4a90e2", "itemB stays its own color while itemA is selected");

    await page.mouse.click(box.x + 195, box.y + 100);
    await page.waitForTimeout(300);
    assert.equal(await outA(), "#c1440e", "itemA reverts to its own color once itemB is selected instead");
    assert.equal(await outB(), "#ffffff", "itemB highlights white on this second, separate click");

    assert.deepEqual(consoleErrors, []);
  });
});

test("the same loop-generated 3D object's color also re-checks correctly when the selection is driven from a page-side DOM handler", async () => {
  await withPage(source, async (page, consoleErrors) => {
    const canvas = page.locator('[data-axis-name="stage"] canvas');
    await canvas.waitFor({ timeout: 5000 });

    const outA = () => page.locator('[data-axis-name="outA"]').textContent();
    await page.waitForTimeout(200);
    assert.equal(await outA(), "#c1440e");

    await page.locator('[data-axis-name="pickA"]').click();
    await page.waitForTimeout(300);
    assert.equal(await outA(), "#ffffff", "a page-originated state change also re-checks the scene's loop-generated binding, not only a scene-originated one");

    assert.deepEqual(consoleErrors, []);
  });
});

after(closeSharedBrowser);
