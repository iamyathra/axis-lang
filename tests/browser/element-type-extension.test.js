// The extension test docs/architecture/2026-09-language-platform-audit.md's
// own "Addendum, 2026-09-14" calls for (mirroring §16 of the 2026-09-14
// proof-phase directive): a third-party package registers a genuinely new
// declarative element type ('badge', examples/element-extension-demo/
// axis_modules/axis-badge/) with zero changes to interpreter.js/domHtml.js/
// pageRuntime.js/domPlan.js beyond the one fallback lookup each needed to
// consult src/extensionRegistry.js's new registerElementType at all - the
// same shape registerScalarProperty already proved for a property on an
// EXISTING object, extended to a genuinely new dimension: the object/
// element TYPE itself, previously blocked entirely (see the audit's own
// "Answering the core question" table: "New object/element type... No -
// hardcoded dispatch"). This is real, in a real browser: 'badge' isn't a
// keyword anywhere in AXIS's own source (grep it - it only exists inside
// examples/element-extension-demo/), and the file it's used from goes
// through the real module resolver (`import ... from "axis-badge"`), a
// real `axis.json` (`buildExtension` + `runtimeExtension`), real
// server-rendered HTML, and a real page runtime - not a synthetic
// in-memory stand-in for any of those.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { withPageFile, closeSharedBrowser } from "./harness.js";

const ENTRY = fileURLToPath(new URL("../../examples/element-extension-demo/main.ax", import.meta.url));

test("a real third-party package's registerElementType makes a brand-new element type work end to end, in a real browser", async () => {
  await withPageFile(ENTRY, async (page, consoleErrors) => {
    const badge = page.locator('[data-axis-name="status"]');

    // Server-rendered HTML already has it, before any JS runs - a real
    // <span>, not a <div> (proves domHtml.js's own fallback picked up the
    // extension's registered tag, not just a default).
    await badge.waitFor({ state: "attached" });
    assert.equal(await badge.evaluate((el) => el.tagName), "SPAN");
    assert.equal(await badge.textContent(), "clicks: 0");

    // Its style properties (background/padding/radius/color) came through
    // AXIS's ordinary, type-agnostic style pipeline - proof a registered
    // type isn't a second-class citizen for anything BUT its own tag/
    // content/allowedProps.
    const bg = await badge.evaluate((el) => getComputedStyle(el).backgroundColor);
    assert.equal(bg, "rgb(42, 109, 244)");

    // Live interaction: clicking the real button re-renders the badge's
    // reactive `content` binding through pageRuntime.js's ordinary
    // `applyElementProperty` - proof the extension's element type isn't
    // just server-rendered once and then inert.
    await page.locator('[data-axis-name="bump"]').click();
    assert.equal(await badge.textContent(), "clicks: 1");
    await page.locator('[data-axis-name="bump"]').click();
    await page.locator('[data-axis-name="bump"]').click();
    assert.equal(await badge.textContent(), "clicks: 3");

    assert.deepEqual(consoleErrors, []);
  });
});

after(closeSharedBrowser);
