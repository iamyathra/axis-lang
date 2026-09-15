// Real browser verification of examples/fps-controls/'s actual movement
// math (forward/right derived from yaw, applied to camera.position every
// tick) - not the full example file (the browser harness's withPage()
// runs single-file source only, no module resolution, so it can't load
// the real file's `import makeKeyTracker from "input"`) but the identical
// movement/look formulas, with a single boolean 'wDown' standing in for
// the package's own held-key tracker (already verified in isolation back
// when that package was built).
//
// This test is what actually caught two real bugs while this controller
// was being built (see docs/architecture/2026-09-language-platform-audit.md's
// game-dev-foundation addendum for the full account):
//   1. A yaw-direction sign error (mouse right turned the camera left) -
//      caught by reasoning through the expected turn direction, not by
//      this test, but this test is what verifies the fix end-to-end.
//   2. A real, pre-existing interpreter bug: `isLiteralExpr` didn't
//      recognize a vector literal like `(0, 2, 8)` as literal, so
//      `camera.position`/`box.position` declared that way got spuriously
//      treated as a reactive "binding" and silently reset to its original
//      value after every single handler call - meaning `on tick`-driven
//      movement of any object declared with a literal vector property
//      never actually accumulated. This test (checking *accumulated*
//      movement over many ticks, not just "no crash") is what surfaced it;
//      a build-time check or a single-tick assertion would not have.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { withPage, closeSharedBrowser } from "./harness.js";

const source = `
  state posX = 0
  state posZ = 8
  state yaw = 0

  scene demo {
    camera { position: (0, 2, 8) }
    cube box { position: (0, 0, -5) color: red }

    let wDown = false

    on keydown {
      if (key == "w") { wDown = true }
    }

    on keyup {
      if (key == "w") { wDown = false }
    }

    on mousemove {
      yaw = yaw + dx * 0.2
    }

    on tick {
      if (wDown) {
        camera.position = (camera.position.x + sin(yaw) * 4 * dt, camera.position.y, camera.position.z - cos(yaw) * 4 * dt)
      }
      posX = camera.position.x
      posZ = camera.position.z
    }
  }

  page Home {
    text xLabel { content: str(posX) }
    text zLabel { content: str(posZ) }
    viewport stage { scene: "demo" width: 200 height: 200 }
  }
`;

async function readPosition(page) {
  return {
    x: Number(await page.locator('[data-axis-name="xLabel"]').textContent()),
    z: Number(await page.locator('[data-axis-name="zLabel"]').textContent()),
  };
}

test("holding 'w' at yaw 0 moves the camera in -Z (forward), not sideways, and actually accumulates over many ticks", async () => {
  await withPage(source, async (page, consoleErrors) => {
    await page.locator('[data-axis-name="stage"] canvas').waitFor({ timeout: 5000 });
    const before = await readPosition(page);

    await page.keyboard.down("w");
    await page.waitForTimeout(300);
    await page.keyboard.up("w");
    await page.waitForTimeout(50);

    const after = await readPosition(page);
    // speed=4, ~0.3s held -> roughly 1.2 units, not one tick's worth
    // (~0.067) - the accumulation itself is the thing that was broken.
    assert.ok(after.z < before.z - 0.5, `expected forward movement to accumulate well past one tick's worth, went from ${before.z} to ${after.z}`);
    assert.ok(Math.abs(after.x - before.x) < 0.01, `expected no sideways drift at yaw 0, x moved from ${before.x} to ${after.x}`);
    assert.deepEqual(consoleErrors, []);
  });
});

test("turning right (yaw +90 via mouse) then holding 'w' moves the camera in +X, not back the way it came", async () => {
  await withPage(source, async (page, consoleErrors) => {
    await page.locator('[data-axis-name="stage"] canvas').waitFor({ timeout: 5000 });

    // yaw += dx * 0.2, so a total dx of 450 turns exactly 90 degrees right -
    // done as several smaller moves (real mice generate many small events,
    // not one huge jump, and a single very large synthetic movementX can
    // get clamped by the browser rather than reported in full).
    for (let i = 0; i < 9; i++) {
      await page.mouse.move(50 * (i + 1), 0);
    }
    await page.waitForTimeout(50);

    const before = await readPosition(page);
    await page.keyboard.down("w");
    await page.waitForTimeout(300);
    await page.keyboard.up("w");
    await page.waitForTimeout(50);
    const after = await readPosition(page);

    assert.ok(after.x > before.x + 0.5, `expected walking forward after a 90-degree right turn to move +X, went from ${before.x} to ${after.x}`);
    assert.ok(Math.abs(after.z - before.z) < 0.1, `expected negligible Z movement after turning fully sideways, z moved from ${before.z} to ${after.z}`);
    assert.deepEqual(consoleErrors, []);
  });
});

after(closeSharedBrowser);
