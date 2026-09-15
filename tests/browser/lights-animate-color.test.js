// Real-browser regression test for a fix made while consolidating
// scene3d.js's scalar-property dispatch into one registry
// (SCALAR_PROPERTIES - see
// docs/architecture/2026-09-language-platform-audit.md's registry
// addendum): `currentLiveValue`'s own `color` case only ever checked a
// material's color, never a light's own `color` (a real THREE.Color
// directly on the light object, not on any material - lights aren't
// Meshes, so `collectMaterials` always found nothing for one).
//
// `currentLiveValue` is only reached by an `animate` *triggered from an
// `on` handler* (`triggerAnimation`) - a plain top-level, plays-on-load
// `animate` resolves its own starting value at build time instead (see
// interpreter.js), never calling this function at all, so a test using a
// load-time `animate` would not actually exercise this code path (an
// earlier version of this test made exactly that mistake and passed
// against both the buggy and the fixed code, proving nothing - fixed
// here by triggering the animation from an `on click` instead).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { withPage, closeSharedBrowser } from "./harness.js";

test("triggering an animation of a light's own color (from an on-handler) starts from its actual current color, not a white fallback", async () => {
  const source = `
    state midColor = "none"

    scene demo {
      camera { position: (0, 2, 6) }
      pointLight lamp { position: (0, 3, 0) color: "#0000ff" intensity: 1 }
      cube box { color: "#888888" }

      on box.click {
        animate lamp {
          color -> "#ff0000"
          duration: 1000
        }
      }

      on tick {
        midColor = lamp.color
      }
    }

    page Home {
      text colorLabel { content: midColor }
      viewport stage { scene: "demo" width: 200 height: 200 }
    }
  `;
  await withPage(source, async (page, consoleErrors) => {
    const canvas = page.locator('[data-axis-name="stage"] canvas');
    await canvas.waitFor({ timeout: 5000 });

    assert.equal(await page.locator('[data-axis-name="colorLabel"]').textContent(), "#0000ff", "expected the initial color to be blue, confirming lamp.color reads the light's own color correctly");

    const box = await canvas.boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

    // Sample partway through the 1000ms animation - if it started from
    // the buggy "#ffffff" fallback, the midpoint would trend toward white
    // mixed with red (a high green channel, ~0.4*255=102 at t=0.4); if it
    // correctly started from blue (#0000ff), the green channel stays at
    // 0 throughout (neither blue nor red has any green component).
    await page.waitForTimeout(400);
    const mid = await page.locator('[data-axis-name="colorLabel"]').textContent();
    const g = parseInt(mid.slice(3, 5), 16);
    const b = parseInt(mid.slice(5, 7), 16);
    assert.ok(g < 20, `expected the green channel to stay at ~0 throughout a blue->red animation (a white starting fallback would push it toward ~100), got ${mid}`);
    assert.ok(b > 20, `expected real leftover blue partway through (fading out from blue, not from white), got ${mid}`);
    assert.deepEqual(consoleErrors, []);
  });
});

after(closeSharedBrowser);
