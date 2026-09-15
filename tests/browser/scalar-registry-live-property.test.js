// Regression/proof test for the SCALAR_PROPERTIES registry consolidation in
// scene3d.js (see docs/architecture/2026-09-language-platform-audit.md's
// registry addendum). The user's own stated test for that work was: "Can a
// capability be registered without editing the core runtime's hardcoded
// vocabulary?" `castShadow`/`receiveShadow` are the concrete proof - before
// this registry existed, `LiveObject` had no getter/setter for either (only
// a one-time, construction-time write: `mesh.castShadow = node.castShadow ??
// true`), and `BINDABLE_KEYS` didn't include them either, so neither an `on`
// handler's direct assignment (`box.castShadow = false`) nor a `state`
// binding could ever change either property live. Adding two entries to
// SCALAR_PROPERTIES was the *entire* change required to make both live -
// LiveObject's getter/setter and BINDABLE_KEYS are both auto-derived from
// that registry now, with zero further touches to either.
//
// Verified via this project's established git-stash methodology: this test
// fails against the commit before the castShadow/receiveShadow entries were
// added (the click has no effect, textContent stays "true") and passes
// after.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { withPage, closeSharedBrowser } from "./harness.js";

test("an on-handler's direct assignment to castShadow is live-settable via the scalar-property registry, and sticks across repeated re-renders", async () => {
  const source = `
    state shadowState = "unknown"

    scene demo {
      camera { position: (0, 2, 6) }
      pointLight lamp { position: (0, 3, 0) color: "#ffffff" intensity: 1 }
      cube box { position: (0, 0, 0) castShadow: true }
      let isCast = true

      on box.click {
        isCast = !isCast
        box.castShadow = isCast
      }

      on tick {
        shadowState = box.castShadow
      }
    }

    page Home {
      text shadowLabel { content: shadowState }
      viewport stage { scene: "demo" width: 200 height: 200 }
    }
  `;
  await withPage(source, async (page, consoleErrors) => {
    const canvas = page.locator('[data-axis-name="stage"] canvas');
    await canvas.waitFor({ timeout: 5000 });

    assert.equal(await page.locator('[data-axis-name="shadowLabel"]').textContent(), "true", "expected the initial castShadow value to read back as true");

    const box = await canvas.boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

    // Several real animation frames, not one snapshot - the part that
    // distinguishes "the assignment stuck" from "it stuck for a moment and
    // then got reset by the next reRender," matching this project's own
    // testing philosophy.
    await page.waitForTimeout(200);
    assert.equal(
      await page.locator('[data-axis-name="shadowLabel"]').textContent(),
      "false",
      "expected the click's direct assignment (box.castShadow = false) to take effect and survive many subsequent re-renders"
    );

    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(200);
    assert.equal(await page.locator('[data-axis-name="shadowLabel"]').textContent(), "true", "expected toggling castShadow back and forth to also work (not a one-shot fluke)");

    assert.deepEqual(consoleErrors, []);
  });
});

after(closeSharedBrowser);
