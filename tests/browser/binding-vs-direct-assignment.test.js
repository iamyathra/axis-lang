// A second, more severe bug found during the pre-pivot example audit
// (see docs/architecture/2026-09-language-platform-audit.md's addendum):
// scene3d.js's applyBindings unconditionally re-applied every bound
// property's expression on every single reRender() - including the
// reRender() called in the very `finally` block of the *same* handler
// that had just directly assigned a new value to that property
// (`box.color = green`, an explicitly documented, supported pattern -
// see docs/language.md's Interaction section: "on-handler-mutable...
// box.color = red... assigning to .color actually moves/recolors the
// real thing on screen"). Any property declared with a non-literal
// expression (even a bare color-name identifier like `red`, which is a
// global constant that can never actually change) was affected: the very
// same click that set it to a new value would immediately - within its
// own handler's own finally block, before the browser ever painted a
// frame - see the stale binding recompute to the SAME value it always
// computes, and stomp the direct assignment right back.
//
// This is exactly why examples/interaction.ax's click-to-toggle-color
// (its oldest, most canonical demo) never actually changed anything
// visible: `color: red` made `color` a binding (a bare identifier is
// never literal), and clicking to set `box.color = green` was undone by
// that same click's own reRender() before a human could ever see it.
//
// Fixed: scene3d.js's applyBindings now caches the last value each
// binding's own expression computed (keyed by object name + property,
// via deepEqual since scene properties are often vectors, not
// primitives) and skips re-applying it when unchanged - bringing it in
// line with pageRuntime.js's own reRender, which already had this exact
// guard (`lastBoundValues`, `===`-keyed, sufficient there since DOM
// properties are always primitives).
//
// A note on how this was verified: an earlier attempt to check this via
// re-triggering `on hover` (mouse away, then back) as a read-only
// observer gave a false "still broken" result even after the fix landed
// - hovering away and back didn't reliably re-fire a fresh hover event in
// that exact sequence, so it just read a stale pre-click value. `on tick`
// (continuous, unambiguous, no state-transition-detection involved) is
// what actually gave a trustworthy answer both before and after the fix -
// a second illustration, on top of the original literal-vector bug, of
// why continuous/repeated observation matters more than a single
// snapshot for anything involving reactive re-render.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { withPage, closeSharedBrowser } from "./harness.js";

test("a direct 'on click' assignment to a property bound to a never-changing identifier (a named color constant) survives that same click's own re-render", async () => {
  const source = `
    state observedColor = "none"

    scene demo {
      camera { position: (0, 2, 6) }
      let isOn = false
      cube box { position: (0, 0, 0) color: red }
      on box.click {
        isOn = !isOn
        if (isOn) { box.color = green } else { box.color = red }
      }
      on tick { observedColor = box.color }
    }

    page Home {
      text colorLabel { content: observedColor }
      viewport stage { scene: "demo" width: 200 height: 200 }
    }
  `;
  await withPage(source, async (page, consoleErrors) => {
    const canvas = page.locator('[data-axis-name="stage"] canvas');
    await canvas.waitFor({ timeout: 5000 });
    const box = await canvas.boundingBox();
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    assert.equal(await page.locator('[data-axis-name="colorLabel"]').textContent(), "#ff0000", "expected the initial color to be red");

    await page.mouse.click(cx, cy);
    // Several real animation frames, not one snapshot - this is the part
    // that actually distinguishes "the assignment stuck" from "it stuck
    // for a moment and then got reset," which the original bug required.
    await page.waitForTimeout(200);
    assert.equal(
      await page.locator('[data-axis-name="colorLabel"]').textContent(),
      "#008000",
      "expected the click's direct assignment (box.color = green) to survive many subsequent re-renders, not be reset back to the original 'color: red' binding"
    );

    await page.mouse.click(cx, cy);
    await page.waitForTimeout(200);
    assert.equal(await page.locator('[data-axis-name="colorLabel"]').textContent(), "#ff0000", "expected toggling back to also stick");

    assert.deepEqual(consoleErrors, []);
  });
});

after(closeSharedBrowser);
