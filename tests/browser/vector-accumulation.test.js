// Regression coverage for the isLiteralExpr bug (see
// tests/literal-bindings.test.js and
// docs/architecture/2026-09-language-platform-audit.md's game-dev-
// foundation addendum), at the level that actually caught it: real,
// multi-cycle runtime behavior in a real browser, not a single write.
//
// The bug's signature was specifically "initial -> update -> RESET ->
// update -> RESET", not "nothing happens" - a single before/after
// snapshot over a long hold could look identical to correct accumulation
// if the sampling window happened to land after the last tick's own
// delta (see this file's sibling test in tick.test.js, which is exactly
// that shape and did originally pass against the buggy code by
// coincidence during development). These tests instead sample at several
// distinct checkpoints and assert values are STRICTLY progressing at
// every checkpoint, not just up over the full window - the only way to
// actually distinguish "accumulated correctly" from "reset every tick,
// happened to look fine at the edges."
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { withPage, closeSharedBrowser } from "./harness.js";

async function sampleThreeTimes(page, locatorFor) {
  const samples = [];
  for (let i = 0; i < 3; i++) {
    await page.waitForTimeout(100);
    samples.push(Number(await page.locator(locatorFor).textContent()));
  }
  return samples;
}

function assertStrictlyIncreasing(samples, label) {
  for (let i = 1; i < samples.length; i++) {
    assert.ok(
      samples[i] > samples[i - 1],
      `expected ${label} to strictly increase at every checkpoint (a reset-every-tick bug would show a value that drops back down between checkpoints instead), got ${JSON.stringify(samples)}`
    );
  }
}

test("a literally-declared position accumulates strictly across multiple checkpoints, in a scene", async () => {
  const source = `
    state x = 0
    scene demo {
      cube box { position: (0, 0, 0) color: red }
      on tick {
        box.position = (box.position.x + 1 * dt, box.position.y, box.position.z)
        x = box.position.x
      }
    }
    page Home {
      text xLabel { content: str(x) }
      viewport stage { scene: "demo" width: 200 height: 200 }
    }
  `;
  await withPage(source, async (page, consoleErrors) => {
    await page.locator('[data-axis-name="stage"] canvas').waitFor({ timeout: 5000 });
    const samples = await sampleThreeTimes(page, '[data-axis-name="xLabel"]');
    assertStrictlyIncreasing(samples, "position.x");
    assert.deepEqual(consoleErrors, []);
  });
});

test("a literally-declared rotation accumulates strictly across multiple checkpoints", async () => {
  const source = `
    state ry = 0
    scene demo {
      cube box { position: (0, 0, 0) rotation: (0, 0, 0) color: red }
      on tick {
        box.rotation = (box.rotation.x, box.rotation.y + 90 * dt, box.rotation.z)
        ry = box.rotation.y
      }
    }
    page Home {
      text ryLabel { content: str(ry) }
      viewport stage { scene: "demo" width: 200 height: 200 }
    }
  `;
  await withPage(source, async (page, consoleErrors) => {
    await page.locator('[data-axis-name="stage"] canvas').waitFor({ timeout: 5000 });
    const samples = await sampleThreeTimes(page, '[data-axis-name="ryLabel"]');
    assertStrictlyIncreasing(samples, "rotation.y");
    assert.deepEqual(consoleErrors, []);
  });
});

test("a literally-declared scale accumulates strictly across multiple checkpoints", async () => {
  const source = `
    state sx = 1
    scene demo {
      cube box { position: (0, 0, 0) scale: (1, 1, 1) color: red }
      on tick {
        box.scale = (box.scale.x + 0.5 * dt, box.scale.y, box.scale.z)
        sx = box.scale.x
      }
    }
    page Home {
      text sxLabel { content: str(sx) }
      viewport stage { scene: "demo" width: 200 height: 200 }
    }
  `;
  await withPage(source, async (page, consoleErrors) => {
    await page.locator('[data-axis-name="stage"] canvas').waitFor({ timeout: 5000 });
    const samples = await sampleThreeTimes(page, '[data-axis-name="sxLabel"]');
    assertStrictlyIncreasing(samples, "scale.x");
    assert.deepEqual(consoleErrors, []);
  });
});

test("a camera's literally-declared target accumulates strictly, not just its position", async () => {
  const source = `
    state tz = -1
    scene demo {
      camera { position: (0, 0, 0) target: (0, 0, -1) }
      cube box { color: red }
      on tick {
        camera.target = (camera.target.x, camera.target.y, camera.target.z - 1 * dt)
        tz = camera.target.z
      }
    }
    page Home {
      text tzLabel { content: str(tz) }
      viewport stage { scene: "demo" width: 200 height: 200 }
    }
  `;
  await withPage(source, async (page, consoleErrors) => {
    await page.locator('[data-axis-name="stage"] canvas').waitFor({ timeout: 5000 });
    const samples = await sampleThreeTimes(page, '[data-axis-name="tzLabel"]');
    // Decreasing, not increasing - the assertion still needs to see three
    // genuinely different, monotonically-moving values.
    for (let i = 1; i < samples.length; i++) {
      assert.ok(samples[i] < samples[i - 1], `expected camera.target.z to strictly decrease at every checkpoint, got ${JSON.stringify(samples)}`);
    }
    assert.deepEqual(consoleErrors, []);
  });
});

test("a vector literal inside a component's own object is not spuriously bound either", async () => {
  const source = `
    state x = 0

    component Mover() {
      cube box { position: (0, 0, 0) color: red }
      on tick {
        box.position = (box.position.x + 1 * dt, box.position.y, box.position.z)
        x = box.position.x
      }
    }

    scene demo {
      Mover thing {}
    }

    page Home {
      text xLabel { content: str(x) }
      viewport stage { scene: "demo" width: 200 height: 200 }
    }
  `;
  await withPage(source, async (page, consoleErrors) => {
    await page.locator('[data-axis-name="stage"] canvas').waitFor({ timeout: 5000 });
    const samples = await sampleThreeTimes(page, '[data-axis-name="xLabel"]');
    assertStrictlyIncreasing(samples, "a component instance's own box.position.x");
    assert.deepEqual(consoleErrors, []);
  });
});

// Game-foundation phase, item 5 of the post-milestone directive: "Ensure
// entities/objects can consistently work with... parent/child
// relationships where supported... Especially test accumulated state
// over many frames." `group` (docs/language.md's Groups section) is
// AXIS's own parent/child primitive - moving/rotating it moves everything
// nested inside. This proves that propagation actually happens, not just
// that the group's own position value accumulates (already no different
// from a plain cube - the earlier position test above already covers
// that): a real raycast click at the CHILD's own expected on-screen
// location, after the PARENT has moved several ticks' worth, only lands
// if the child genuinely moved along with its parent in the renderer.
test("moving a group over many ticks actually carries its child object along with it - a real raycast proves it, not just a stored value", async () => {
  const source = `
    state childClicks = 0

    scene demo {
      camera { position: (0, 0, 10) }
      group rig {
        position: (0, 0, 0)
        cube child { position: (0, 0, 0) scale: (3, 3, 3) color: red }
      }
      on child.click {
        childClicks = childClicks + 1
      }
      on tick {
        rig.position = (rig.position.x + 1 * dt, rig.position.y, rig.position.z)
      }
    }

    page Home {
      text clicksLabel { content: str(childClicks) }
      viewport stage { scene: "demo" width: 400 height: 400 }
    }
  `;
  await withPage(source, async (page, consoleErrors) => {
    const canvas = page.locator('[data-axis-name="stage"] canvas');
    await canvas.waitFor({ timeout: 5000 });
    const box = await canvas.boundingBox();
    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;

    // Clicking dead center hits the child while the rig is still at (or
    // very near) its starting x=0 - sanity-checks the raycast/setup
    // itself before relying on it to prove movement.
    await page.mouse.click(centerX, centerY);
    await page.waitForTimeout(50);
    assert.equal(await page.locator('[data-axis-name="clicksLabel"]').textContent(), "1", "expected the initial click (rig at x~0) to hit the child dead center");

    // Let the rig accumulate real movement across many real ticks - `rig`
    // moves at 1 unit/second in world X, entirely off where it started.
    // A click at the ORIGINAL center should now miss (nothing left there
    // to hit)...
    await page.waitForTimeout(1500);
    await page.mouse.click(centerX, centerY);
    await page.waitForTimeout(50);
    assert.equal(
      await page.locator('[data-axis-name="clicksLabel"]').textContent(),
      "1",
      "expected the child to no longer be at its original screen position after the parent group moved for over a second"
    );

    // ...while a click to the right (where the child should now actually
    // be, since the rig moved in +X - at this camera distance and FOV,
    // roughly 1 world unit per second maps to roughly 35px/s, so ~1.5s
    // of movement lands here; the child's own 3x scale gives a generous
    // +-50px raycast target, tolerant of exact timing variance) hits it -
    // proof the child really did move with its parent, not just that
    // `rig.position`'s own stored value changed independently of the
    // renderer.
    await page.mouse.click(centerX + 50, centerY);
    await page.waitForTimeout(50);
    assert.equal(
      await page.locator('[data-axis-name="clicksLabel"]').textContent(),
      "2",
      "expected the child to actually be at its parent-moved screen position, proving real parent-to-child transform propagation, not just a stored value"
    );

    assert.deepEqual(consoleErrors, []);
  });
});

after(closeSharedBrowser);
