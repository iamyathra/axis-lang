// A major, previously-undiscovered bug found while building the game-
// foundation phase (see
// docs/architecture/2026-09-language-platform-audit.md's game-foundation
// addendum): Phase E's "data with behavior" mechanism (self-bound record
// methods, examples/entities.ax) never actually worked in a real browser,
// for ANY scene or page - only tests/self-binding.test.js's unit-level
// coverage existed, which calls the sync evaluator directly and never
// goes through the actual browser transport.
//
// Root cause: a scene/page's top-level `let`/`state` VALUE is computed
// once, server-side, then JSON.stringify'd into the page/scene plan
// embedded as `window.__AXIS_PLAN__`/`window.__AXIS_PAGE_PLAN__`. A
// function value's `.closure` is a real `Environment` class instance -
// JSON can't round-trip a class instance's prototype, so after
// JSON.parse on the browser side, `.closure` becomes a plain object with
// the same data but none of Environment's own methods (`.child()`
// included). The moment any `on` handler reads that method off the
// record - evaluator.js's getMember, which binds `self` via
// `value.closure.child()` - it throws a native TypeError and the whole
// handler body aborts silently (well, not silently - a real console
// error, but nothing in the UI ever visibly breaks either, since the
// handler just never gets to its own state-mutating statements).
//
// Fixed: interpreter.js's `containsFunction` (evaluator.js) now flags any
// top-level `let`/`state` whose value contains a function anywhere, and
// ships that binding's own INITIALIZER EXPRESSION alongside the (broken)
// precomputed value; scene3d.js/pageRuntime.js re-evaluate that
// initializer fresh, client-side, against their own real, live
// environment - giving every function field a real, working closure,
// exactly as if the scene/page had just built itself in the browser.
//
// Verified via this project's git-stash methodology: this test fails
// against the pre-fix interpreter.js/scene3d.js/pageRuntime.js (a real
// TypeError, and the displayed HP never changes) and passes after.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { withPage, closeSharedBrowser } from "./harness.js";

// The exact pattern examples/entities.ax uses - a factory function
// returning a record whose methods read/mutate it via `self` - held in a
// PAGE-level `state` (this is not scene-specific; see the second test,
// below, for the identical scene-level case).
const PAGE_SOURCE = `
  fn makeHealth(maxValue) {
    let health = { max: maxValue, value: maxValue }
    health.damage = fn(amount) { self.value = max(0, self.value - amount) }
    health.isDead = fn() { return self.value <= 0 }
    return health
  }

  state player = makeHealth(100)

  page "Entities" {
    text hp { content: str(player.value) }
    button hit { label: "hit" }
    on hit.click {
      player.damage(20)
    }
  }
`;

test("a page-level state's self-bound record method (data with behavior) actually mutates the record when called from a real click, repeatedly", async () => {
  await withPage(PAGE_SOURCE, async (page, consoleErrors) => {
    const hp = page.locator('[data-axis-name="hp"]');
    const hit = page.locator('[data-axis-name="hit"]');
    await hp.waitFor({ timeout: 5000 });

    assert.equal(await hp.textContent(), "100");

    await hit.click();
    await page.waitForTimeout(100);
    assert.equal(await hp.textContent(), "80", "expected the first click's damage(20) to actually apply");

    await hit.click();
    await page.waitForTimeout(100);
    assert.equal(await hp.textContent(), "60", "expected damage to keep accumulating correctly across a second click, not just work once");

    await hit.click();
    await page.waitForTimeout(100);
    assert.equal(await hp.textContent(), "40", "expected a third click to keep accumulating correctly too");

    assert.deepEqual(consoleErrors, []);
  });
});

// The identical pattern, but the self-bound record lives in a SCENE-level
// `let` instead of a page-level `state` - a different code path in
// interpreter.js (captureVariables vs. the top-level sharedVariables
// loop) and a different browser runtime (scene3d.js vs. pageRuntime.js),
// so this needs its own, separate proof rather than assuming the fix for
// one domain covers the other.
const SCENE_SOURCE = `
  fn makeHealth(maxValue) {
    let health = { max: maxValue, value: maxValue }
    health.damage = fn(amount) { self.value = max(0, self.value - amount) }
    return health
  }

  state hp = "unknown"

  scene demo {
    camera { position: (0, 2, 6) }
    cube box { color: "#888888" }

    let player = makeHealth(100)

    on box.click {
      player.damage(20)
    }

    on tick {
      hp = player.value
    }
  }

  page Home {
    text hpLabel { content: str(hp) }
    viewport stage { scene: "demo" width: 200 height: 200 }
  }
`;

test("a scene-level let's self-bound record method actually mutates the record when called from a real click, repeatedly", async () => {
  await withPage(SCENE_SOURCE, async (page, consoleErrors) => {
    const canvas = page.locator('[data-axis-name="stage"] canvas');
    const hpLabel = page.locator('[data-axis-name="hpLabel"]');
    await canvas.waitFor({ timeout: 5000 });
    await page.waitForTimeout(100);

    assert.equal(await hpLabel.textContent(), "100");

    const box = await canvas.boundingBox();
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    await page.mouse.click(cx, cy);
    await page.waitForTimeout(150);
    assert.equal(await hpLabel.textContent(), "80", "expected the first click's damage(20) to actually apply");

    await page.mouse.click(cx, cy);
    await page.waitForTimeout(150);
    assert.equal(await hpLabel.textContent(), "60", "expected damage to keep accumulating correctly across a second click");

    assert.deepEqual(consoleErrors, []);
  });
});

after(closeSharedBrowser);
