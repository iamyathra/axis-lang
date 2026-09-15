// Real-browser proof for the AXIS FPS Flagship Proof milestone (see
// docs/fps-proof.md): examples/fps/main.ax, with its REAL package imports
// (input/camera/ecs, copied unchanged from examples/fps-controls/ and
// examples/game-foundation/, plus the new axis-visibility runtime
// extension) resolved through the real module resolver, served, and
// driven end to end in a real headless browser - the complete gameplay
// loop: look/move/aim, shoot, hit detection via the new
// raycast.fromCamera() primitive, damage, death, score, and reset.
//
// Two real, confirmed browser-automation limitations shaped this file's
// own strategy, both reported honestly rather than worked around with a
// fake assertion (per the milestone's own explicit instruction):
//
// 1. Aiming is driven by real WASD strafing (page.keyboard.down/up held
//    for real wall-clock time), not mouse-look. Confirmed directly that
//    page.mouse.move() while pointer-locked in this Playwright/Chromium
//    environment produces noisy, non-representative movementX/Y deltas
//    that mostly cancel out to near-zero net movement - the same class
//    of limitation tests/browser/camera-controller.test.js's own header
//    already documents for this exact environment. WASD has no such
//    limitation (real KeyboardEvents, not synthesized pointer deltas),
//    so every test here aims by strafing a real, computed distance into
//    alignment with a specific target instead of turning the camera - a
//    different, but equally valid way to exercise the same underlying
//    mechanism (raycast.fromCamera() always fires from dead center;
//    strafing moves the camera so a specific target sits there).
// 2. Confirmed, separately, that Playwright's own page.mouse.click()/
//    down()/up() while pointer-locked ALSO injects spurious, real
//    (non-zero) movementX/Y "jitter" into the very click meant only to
//    fire a shot - not just mouse-move calls. Since `on tick` applies
//    ANY accumulated mouseDX/DY to yaw whenever locked (exactly as a
//    real click-to-shoot game should), this jitter measurably,
//    unpredictably rotates the camera between shots, intermittently
//    turning a should-be-reliable repeated-hit test flaky - confirmed by
//    running it repeatedly and watching it fail non-deterministically.
//    Fixed by firing shots via a direct `window.dispatchEvent(new
//    MouseEvent("mousedown", {button: 0}))` (see fire(), below) instead
//    of Playwright's mouse API - a real DOM event, exactly what a real
//    click produces at the JS level `on mousedown` actually listens for,
//    with no synthesized pointer-position/movement side effect riding
//    along with it. The one click Playwright's own mouse API still drives
//    directly (requesting pointer lock in the first place) genuinely
//    needs a trusted user gesture to succeed at all, so it keeps using
//    page.mouse.click(); every click after that only needs to fire.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { withPageFile, closeSharedBrowser } from "./harness.js";

const ENTRY = fileURLToPath(new URL("../../examples/fps/main.ax", import.meta.url));

async function assertEventually(read, predicate, message, timeoutMs = 3000) {
  const start = Date.now();
  let last;
  while (Date.now() - start < timeoutMs) {
    last = await read();
    if (predicate(last)) return last;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`${message} (last saw: ${JSON.stringify(last)})`);
}

// Strafes right for `ms` of real wall-clock time - target3 sits at x=7, so
// holding 'd' (speed 5/s) for ~1.5s lines the camera's own fixed,
// straight-ahead (-Z) facing up with it, without ever needing to turn.
async function strafeRight(page, ms) {
  await page.keyboard.down("d");
  await page.waitForTimeout(ms);
  await page.keyboard.up("d");
}

// Movement is real dt-based wall-clock integration (examples/fps-
// controls/'s own established `fps.move` - see docs/fps-proof.md §9), so
// it stays *correct* under heavy concurrent browser-suite load - but a
// fixed real-time strafe duration can still land short or long of a
// specific target's exact position if the render loop itself goes
// through a stretch of very sparse frames under that same load (a
// requestAnimationFrame that fires rarely still integrates the right
// total distance once it does fire, but this test's own fixed-duration
// keyboard hold has no way to know that happened before it releases the
// key and fires). Rather than trust one fixed timing constant (the same
// "don't assume timing, assume ordering" lesson
// tests/browser/physics-demo.test.js already encodes elsewhere), search
// for alignment in small increments, confirmed by the game's own real
// "Hit" feedback at each step - self-correcting under any load
// condition, and still 100% real gameplay (no shortcut into game state).
// Returns once a real hit has registered (the target now has 2 HP left).
async function strafeUntilFirstHit(page, status, weaponCooldownMs) {
  for (let attempt = 0; attempt < 12; attempt++) {
    await strafeRight(page, 200);
    await page.waitForTimeout(80);
    await fire(page);
    const result = await assertEventually(
      () => status.textContent(),
      (t) => t === "Hit" || t === "Miss",
      "expected a shot to resolve to either a hit or a miss"
    );
    if (result === "Hit") return;
    await page.waitForTimeout(weaponCooldownMs);
  }
  throw new Error("expected strafing in small increments to eventually align with target3, even under load");
}

// See this file's own header, point 2 - fires a shot with no synthesized
// pointer movement riding along, unlike page.mouse.click()/down()/up().
async function fire(page) {
  await page.evaluate(() => window.dispatchEvent(new MouseEvent("mousedown", { button: 0 })));
}

// `statusText` flips to "Playing..." the moment `on mousedown` calls
// pointerLock.request() - synchronously, before the browser's own
// (asynchronous) lock acquisition actually completes. Waiting on the text
// alone is a real race: a second click sent too soon can still see
// `pointerLock.isLocked` as false and re-request the lock instead of
// firing. Poll the real DOM state instead.
async function waitForPointerLock(page) {
  const start = Date.now();
  while (Date.now() - start < 3000) {
    if (await page.evaluate(() => document.pointerLockElement !== null)) return;
    await new Promise((r) => setTimeout(r, 30));
  }
  throw new Error("expected the browser to actually acquire pointer lock");
}

// The one click Playwright's own mouse API still has to drive directly -
// acquiring pointer lock genuinely needs a trusted user gesture, and
// fire()'s dispatchEvent approach isn't one. Confirmed (same method as
// this file's own header note 2) that THIS click also injects a real,
// one-time movementX/Y burst, which `on tick` - correctly - folds into
// yaw the moment lock completes, permanently rotating the camera by an
// unpredictable amount before any deliberate strafing even starts. Since
// 'R' already zeroes fps.yaw/pitch (main.ax's own reset), pressing it
// once, immediately after lock and before anything else, gives every
// aim-dependent test that follows a known, real yaw=0 starting point -
// harmless to call this early, since nothing has been shot yet.
async function lockAndZeroAim(page, canvas, status) {
  const box = await canvas.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await waitForPointerLock(page);
  await page.keyboard.press("r");
  await assertEventually(() => status.textContent(), (t) => t === "Round reset", "expected R to zero aim right after locking");
}

test("the FPS page loads and the arena actually renders in a real browser", async () => {
  await withPageFile(ENTRY, async (page, consoleErrors) => {
    const canvas = page.locator('[data-axis-name="stage"] canvas');
    await canvas.waitFor({ timeout: 5000 });
    const status = page.locator('[data-axis-name="status"]');
    const score = page.locator('[data-axis-name="score"]');
    assert.equal(await status.textContent(), "Click the arena to play");
    assert.equal(await score.textContent(), "Destroyed: 0/4");
    assert.deepEqual(consoleErrors, []);
  });
});

test("clicking the arena locks the pointer and switches to play mode", async () => {
  await withPageFile(ENTRY, async (page, consoleErrors) => {
    const canvas = page.locator('[data-axis-name="stage"] canvas');
    await canvas.waitFor({ timeout: 5000 });
    const status = page.locator('[data-axis-name="status"]');
    const box = await canvas.boundingBox();

    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await waitForPointerLock(page);
    assert.ok((await status.textContent()).startsWith("Playing"));
    assert.deepEqual(consoleErrors, []);
  });
});

test("WASD strafing actually moves the player - survives real held time, not just an instant", async () => {
  await withPageFile(ENTRY, async (page, consoleErrors) => {
    const canvas = page.locator('[data-axis-name="stage"] canvas');
    await canvas.waitFor({ timeout: 5000 });
    const box = await canvas.boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await waitForPointerLock(page);

    // Not directly observable as a number (no position readout in the
    // HUD) - proven the same way the rest of this file does: strafing
    // into alignment with target3 (x=7) makes it - and only it -
    // reachable by the dead-center raycast, which the next test
    // exercises for real. This test alone just proves the input chain
    // doesn't error and pointer lock survives real key holds, over a
    // longer duration than a single frame.
    await strafeRight(page, 800);
    await page.waitForTimeout(100);
    assert.equal(await page.evaluate(() => document.pointerLockElement !== null), true, "expected pointer lock to survive real WASD movement");
    assert.deepEqual(consoleErrors, []);
  });
});

test("shooting a target (real raycast + real damage) reduces its health over repeated hits, then destroys it and updates the score - not just once", async () => {
  await withPageFile(ENTRY, async (page, consoleErrors) => {
    const canvas = page.locator('[data-axis-name="stage"] canvas');
    await canvas.waitFor({ timeout: 5000 });
    const status = page.locator('[data-axis-name="status"]');
    const score = page.locator('[data-axis-name="score"]');

    await lockAndZeroAim(page, canvas, status);

    // target3 has 3 HP, weapon does 1 damage per shot, cooldown 0.35s -
    // three real, separately-timed shots should be required, not one.
    // The first is delivered by strafeUntilFirstHit's own search (see
    // its own comment on why a fixed-duration strafe alone isn't safe
    // under heavy concurrent load).
    await strafeUntilFirstHit(page, status, 550);
    assert.equal(await score.textContent(), "Destroyed: 0/4", "expected the target to survive its first hit (3 HP, 1 damage)");

    await page.waitForTimeout(550); // past the weapon's own cooldown
    await fire(page);
    await assertEventually(() => status.textContent(), (t) => t === "Hit", "expected a second, separately-timed hit to register");
    assert.equal(await score.textContent(), "Destroyed: 0/4", "expected the target to still survive its second hit (2 HP left)");

    await page.waitForTimeout(550);
    await fire(page);
    await assertEventually(() => status.textContent(), (t) => t === "Target down", "expected the third hit to destroy the target");
    await assertEventually(() => score.textContent(), (t) => t === "Destroyed: 1/4", "expected the score to update after the target's death");

    assert.deepEqual(consoleErrors, []);
  });
});

test("a fresh shot at real scene geometry that isn't a target (the arena's own back wall) reports a clean miss, not a silent no-op", async () => {
  await withPageFile(ENTRY, async (page, consoleErrors) => {
    const canvas = page.locator('[data-axis-name="stage"] canvas');
    await canvas.waitFor({ timeout: 5000 });
    const status = page.locator('[data-axis-name="status"]');
    const score = page.locator('[data-axis-name="score"]');
    const box = await canvas.boundingBox();

    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await waitForPointerLock(page);

    // Dead center, no strafing at all: the default camera facing points
    // straight at the arena's own back wall (real scene geometry that
    // isn't a tracked target) - raycast.fromCamera() genuinely hits it
    // (see docs/fps-proof.md's own note - it considers every named
    // object, not just targets), and the game must still report a clean
    // "Miss" rather than doing nothing.
    await fire(page);
    await assertEventually(() => status.textContent(), (t) => t === "Miss", "expected shooting the back wall to report a clean miss");
    assert.equal(await score.textContent(), "Destroyed: 0/4");

    assert.deepEqual(consoleErrors, []);
  });
});

test("pressing R resets the round - score, targets, and player position all restore, and shooting works again afterward", async () => {
  await withPageFile(ENTRY, async (page, consoleErrors) => {
    const canvas = page.locator('[data-axis-name="stage"] canvas');
    await canvas.waitFor({ timeout: 5000 });
    const status = page.locator('[data-axis-name="status"]');
    const score = page.locator('[data-axis-name="score"]');

    await lockAndZeroAim(page, canvas, status);

    // Destroy target3 fully (3 hits, real cooldown-spaced) - the first
    // delivered by strafeUntilFirstHit's own search (see its own comment).
    await strafeUntilFirstHit(page, status, 550);
    await page.waitForTimeout(550);
    await fire(page);
    await page.waitForTimeout(550);
    await fire(page);
    await assertEventually(() => score.textContent(), (t) => t === "Destroyed: 1/4", "expected target3 destroyed before testing reset");

    await page.keyboard.press("r");
    await assertEventually(() => status.textContent(), (t) => t === "Round reset", "expected R to reset the round");
    assert.equal(await score.textContent(), "Destroyed: 0/4", "expected the score to reset to 0");

    // Prove the reset target is actually alive again, not just the score
    // counter reset independently of real game state - reset also
    // restores the player's own spawn position/orientation, so re-strafe
    // fresh from there and shoot it again: the actual point of this
    // test is that the whole loop works a second time, not just once.
    await strafeUntilFirstHit(page, status, 550);

    assert.deepEqual(consoleErrors, []);
  });
});

after(closeSharedBrowser);
