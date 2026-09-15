// Real browser verification of a mouse-look camera controller built
// entirely from existing primitives (on mousemove's dx/dy, sin/cos,
// camera.target) - the thing Phase H's own audit addendum deliberately
// deferred until it could be checked against a real running scene instead
// of just reasoned about. Computed yaw/pitch/target are mirrored into
// shared `state` (read by the page) so this test can assert on the exact
// numbers a real mouse movement produced, not just "it didn't crash".
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { withPage, closeSharedBrowser } from "./harness.js";

const SENSITIVITY = 0.2;

function expectedTarget(totalDx, totalDy) {
  const yaw = totalDx * SENSITIVITY;
  let pitch = -totalDy * SENSITIVITY;
  pitch = Math.max(-89, Math.min(89, pitch));
  const rad = (deg) => (deg * Math.PI) / 180;
  return {
    yaw,
    pitch,
    x: Math.cos(rad(pitch)) * Math.sin(rad(yaw)),
    y: Math.sin(rad(pitch)),
    z: -Math.cos(rad(pitch)) * Math.cos(rad(yaw)),
  };
}

const source = `
  state targetX = 0
  state targetY = 0
  state targetZ = 0
  state yaw = 0
  state pitch = 0

  scene demo {
    camera { position: (0, 0, 0) }
    cube box { color: red }

    on mousemove {
      yaw = yaw + dx * ${SENSITIVITY}
      pitch = pitch - dy * ${SENSITIVITY}
      if (pitch > 89) { pitch = 89 }
      if (pitch < -89) { pitch = -89 }
      targetX = camera.position.x + cos(pitch) * sin(yaw)
      targetY = camera.position.y + sin(pitch)
      targetZ = camera.position.z - cos(pitch) * cos(yaw)
      camera.target = (targetX, targetY, targetZ)
    }
  }

  page Home {
    text xLabel { content: str(targetX) }
    text yLabel { content: str(targetY) }
    text zLabel { content: str(targetZ) }
    text yawLabel { content: str(yaw) }
    text pitchLabel { content: str(pitch) }
    viewport stage { scene: "demo" width: 200 height: 200 }
  }
`;

async function readTargetState(page) {
  return {
    x: Number(await page.locator('[data-axis-name="xLabel"]').textContent()),
    y: Number(await page.locator('[data-axis-name="yLabel"]').textContent()),
    z: Number(await page.locator('[data-axis-name="zLabel"]').textContent()),
    yaw: Number(await page.locator('[data-axis-name="yawLabel"]').textContent()),
    pitch: Number(await page.locator('[data-axis-name="pitchLabel"]').textContent()),
  };
}

test("a mouse-look controller (dx/dy -> yaw/pitch -> camera.target) computes the mathematically correct look direction", async () => {
  await withPage(source, async (page, consoleErrors) => {
    await page.locator('[data-axis-name="stage"] canvas').waitFor({ timeout: 5000 });

    // A rightward-only look: yaw should turn, pitch should stay at 0.
    await page.mouse.move(100, 0);
    await page.waitForTimeout(50);
    let expected = expectedTarget(100, 0);
    let actual = await readTargetState(page);
    // The one assertion that actually catches a "turns the wrong way"
    // sign bug, not just an internal-arithmetic mismatch: a rightward
    // mouse movement must increase yaw (turn right), the opposite of what
    // an earlier, uncaught version of this controller did (see the audit
    // doc's game-dev-foundation addendum). expectedTarget alone can't
    // catch this - it was derived from the same formula as the source.
    assert.ok(actual.yaw > 0, `expected a rightward mouse movement to increase yaw (turn right), got ${actual.yaw}`);
    assert.ok(Math.abs(actual.yaw - expected.yaw) < 0.01, `yaw: expected ${expected.yaw}, got ${actual.yaw}`);
    assert.equal(actual.pitch, 0);
    assert.ok(Math.abs(actual.x - expected.x) < 0.01, `target.x: expected ${expected.x}, got ${actual.x}`);
    assert.ok(Math.abs(actual.y - expected.y) < 0.01, `target.y: expected ${expected.y}, got ${actual.y}`);
    assert.ok(Math.abs(actual.z - expected.z) < 0.01, `target.z: expected ${expected.z}, got ${actual.z}`);

    // Looking straight ahead with no yaw/pitch at all must point down -Z -
    // three.js's own default forward direction, matching every existing
    // AXIS example's camera (positioned on +Z, looking toward the origin).
    assert.ok(Math.abs(actual.x) < 0.5, "expected a small sideways component after only a modest yaw");
    assert.ok(actual.z < 0, "expected the look direction to still point mostly toward -Z");

    // Add a downward look too - pitch should now turn negative (dy > 0 is
    // a downward mouse movement in screen space, which should look down,
    // i.e. a negative Y component in the direction).
    await page.mouse.move(100, 100); // one more move, +100 dy from (100,0)
    await page.waitForTimeout(50);
    const totalDy = 100;
    expected = expectedTarget(200, totalDy); // dx accumulated to 200 total
    actual = await readTargetState(page);
    assert.ok(actual.pitch < 0, `expected a downward mouse movement to produce negative pitch, got ${actual.pitch}`);
    assert.ok(actual.y < 0, `expected the look direction's Y component to point downward, got ${actual.y}`);
    assert.ok(Math.abs(actual.y - expected.y) < 0.01, `target.y: expected ${expected.y}, got ${actual.y}`);

    // Pitch clamps at +/-89 - a very large downward movement shouldn't
    // flip the camera past straight down.
    await page.mouse.move(200, 100000);
    await page.waitForTimeout(50);
    actual = await readTargetState(page);
    assert.ok(actual.pitch >= -89 && actual.pitch <= 89, `expected pitch to stay clamped, got ${actual.pitch}`);

    assert.deepEqual(consoleErrors, []);
  });
});

after(closeSharedBrowser);
