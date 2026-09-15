// Real-browser proof for the Third-Party Extension Proof milestone (see
// docs/extensions.md): examples/third-party-extension/main.ax, with its
// REAL `import ... from "axis-tween"` / `import ... from "axis-inventory"`
// resolved through the real module resolver, served, and driven end to
// end in a real headless browser - the actual production transport path
// (server -> JSON plan -> browser), not a same-process unit test that
// bypasses it. Uses harness.js's withPageFile for exactly this reason -
// see tests/browser/physics-demo.test.js's own header for the class of
// bug (the "data with behavior" closure-serialization bug) that only a
// real-browser test through this exact path can catch, and which this
// project's own regression audit found recurring in package after
// package until every one was checked this way.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { withPageFile, closeSharedBrowser } from "./harness.js";

const ENTRY = fileURLToPath(new URL("../../examples/third-party-extension/main.ax", import.meta.url));

test("axis-tween's createTween, held in page state, actually advances every real tick - sampled at several checkpoints, not just once", async () => {
  await withPageFile(ENTRY, async (page, consoleErrors) => {
    const title = page.locator('[data-axis-name="title"]');
    await title.waitFor({ timeout: 5000 });

    function progressOf(text) {
      const match = /Progress: (\d+)%/.exec(text);
      assert.ok(match, `expected title text to contain 'Progress: N%', got '${text}'`);
      return Number(match[1]);
    }

    // Same "don't assume timing, assume ordering" discipline as
    // tests/browser/physics-demo.test.js - no assertion on the exact
    // starting value (unknown real time may have already elapsed by the
    // first read), just that later checkpoints across a real window
    // never go backwards and the whole window shows real forward
    // progress. The tween's own 2s duration comfortably outlasts this
    // window, so "never decreases" isn't confused by it finishing early.
    const samples = [];
    for (let i = 0; i < 4; i++) {
      samples.push(progressOf(await title.textContent()));
      await page.waitForTimeout(150);
    }
    for (let i = 1; i < samples.length; i++) {
      assert.ok(samples[i] >= samples[i - 1], `expected progress to never decrease, got ${JSON.stringify(samples)}`);
    }
    assert.ok(samples[3] > samples[0], `expected measurable forward progress across the whole window, got ${JSON.stringify(samples)}`);
    assert.deepEqual(consoleErrors, []);
  });
});

test("switching easing (a real self-bound record reassigned from an on-click handler) resets progress and changes which curve drives it", async () => {
  await withPageFile(ENTRY, async (page, consoleErrors) => {
    const title = page.locator('[data-axis-name="title"]');
    const useLinear = page.locator('[data-axis-name="useLinear"]');
    await title.waitFor({ timeout: 5000 });

    function progressOf(text) {
      return Number(/Progress: (\d+)%/.exec(text)[1]);
    }

    // Let real, measurable progress accumulate first (so a post-click
    // drop is unambiguous evidence of a reset, not just "hadn't moved
    // yet") before switching easing.
    await page.waitForTimeout(500);
    const before = progressOf(await title.textContent());
    assert.ok(before > 0, `expected measurable progress before switching easing, got ${before}%`);

    await useLinear.click();
    await page.waitForTimeout(30);
    const text = await title.textContent();
    assert.match(text, /\(Linear\)/, `expected the easing label to switch to 'Linear', got '${text}'`);
    const after = progressOf(text);
    assert.ok(after < before, `expected switching easing to reset progress (a whole new record from createTween), got ${before}% -> ${after}%`);

    assert.deepEqual(consoleErrors, []);
  });
});

test("axis-inventory's createInventory, held in page state, accumulates additions correctly across many real clicks, not just once", async () => {
  await withPageFile(ENTRY, async (page, consoleErrors) => {
    const gold = page.locator('[data-axis-name="goldLabel"]');
    const addGold = page.locator('[data-axis-name="addGold"]');
    await gold.waitFor({ timeout: 5000 });

    assert.equal(await gold.textContent(), "Gold: 0");

    await addGold.click();
    await page.waitForTimeout(80);
    assert.equal(await gold.textContent(), "Gold: 5", "expected the first click to add 5 gold");

    await addGold.click();
    await page.waitForTimeout(80);
    assert.equal(await gold.textContent(), "Gold: 10", "expected a second click to keep accumulating, not reset");

    await addGold.click();
    await page.waitForTimeout(80);
    assert.equal(await gold.textContent(), "Gold: 15", "expected a third click to keep accumulating too");

    assert.deepEqual(consoleErrors, []);
  });
});

test("spending gold via axis-inventory's removeItem sticks across further ticks/clicks, including a clean failure when there isn't enough", async () => {
  await withPageFile(ENTRY, async (page, consoleErrors) => {
    const gold = page.locator('[data-axis-name="goldLabel"]');
    const status = page.locator('[data-axis-name="status"]');
    const addGold = page.locator('[data-axis-name="addGold"]');
    const spendGold = page.locator('[data-axis-name="spendGold"]');
    await gold.waitFor({ timeout: 5000 });

    await addGold.click();
    await page.waitForTimeout(80);
    assert.equal(await gold.textContent(), "Gold: 5");

    await spendGold.click();
    await page.waitForTimeout(80);
    assert.equal(await gold.textContent(), "Gold: 0", "expected spending exactly what was held to succeed and stick");

    await spendGold.click();
    await page.waitForTimeout(80);
    assert.equal(await gold.textContent(), "Gold: 0", "expected spending with insufficient gold to fail cleanly, not go negative");
    assert.equal(await status.textContent(), "Not enough gold to spend.");

    assert.deepEqual(consoleErrors, []);
  });
});

test("axis-tween and axis-inventory both work correctly together in the same running page, with no cross-package interference", async () => {
  await withPageFile(ENTRY, async (page, consoleErrors) => {
    const title = page.locator('[data-axis-name="title"]');
    const gold = page.locator('[data-axis-name="goldLabel"]');
    const total = page.locator('[data-axis-name="totalLabel"]');
    const addGold = page.locator('[data-axis-name="addGold"]');
    const addPotion = page.locator('[data-axis-name="addPotion"]');
    await title.waitFor({ timeout: 5000 });

    await addGold.click();
    await addPotion.click();
    await page.waitForTimeout(100);

    assert.equal(await gold.textContent(), "Gold: 5");
    assert.equal(await total.textContent(), "Total items: 6"); // 5 gold + 1 potion

    // The tween's own on-tick progress should still be advancing while
    // the inventory's click-driven state changed - proof neither package
    // stalled or reset the other's state.
    const before = /Progress: (\d+)%/.exec(await title.textContent())[1];
    await page.waitForTimeout(200);
    const after = /Progress: (\d+)%/.exec(await title.textContent())[1];
    assert.ok(Number(after) >= Number(before), `expected progress to keep advancing (or hold at 100) alongside inventory clicks, got ${before} -> ${after}`);

    assert.deepEqual(consoleErrors, []);
  });
});

after(closeSharedBrowser);
