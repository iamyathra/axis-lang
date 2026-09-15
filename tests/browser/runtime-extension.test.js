// Real-browser proof for the AXIS Runtime Extension Architecture milestone
// (see docs/runtime-extensions.md): examples/runtime-extension-demo/
// main.ax, with its REAL `import ... from "axis-wireframe"`/
// `"axis-line-width"` resolved through the real module resolver, served,
// and driven end to end in a real headless browser - the actual chain the
// milestone asks for: external extension package -> package resolution ->
// module/script loading -> AXIS application -> extension behavior ->
// browser-visible result. Uses harness.js's withPageFile so this exercises
// the real files on disk, not hand-inlined stand-ins - same reasoning as
// tests/browser/physics-demo.test.js and
// tests/browser/third-party-extension.test.js.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { withPageFile, withPage, closeSharedBrowser } from "./harness.js";

const ENTRY = fileURLToPath(new URL("../../examples/runtime-extension-demo/main.ax", import.meta.url));

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

test("clicking the cube toggles a real, externally-registered 'wireframe' property on its actual three.js material - and toggles back on a second click, not just once", async () => {
  await withPageFile(ENTRY, async (page, consoleErrors) => {
    const canvas = page.locator('[data-axis-name="stage"] canvas');
    await canvas.waitFor({ timeout: 5000 });
    const status = page.locator('[data-axis-name="wireframeStatus"]');
    await status.waitFor({ timeout: 5000 });

    assert.equal(await status.textContent(), "wireframe: false");

    const box = await canvas.boundingBox();
    // box (the cube) sits left of center - see main.ax's own position.
    const cubeX = box.x + box.width * 0.35;
    const cubeY = box.y + box.height * 0.5;

    await page.mouse.click(cubeX, cubeY);
    await assertEventually(() => status.textContent(), (t) => t === "wireframe: true", "expected wireframe to turn on after the first click");

    await page.mouse.click(cubeX, cubeY);
    await assertEventually(() => status.textContent(), (t) => t === "wireframe: false", "expected wireframe to turn back off after a second click - proves the registered get() reads the real live value back, not just the set() firing once");

    assert.deepEqual(consoleErrors, []);
  });
});

test("clicking the sphere animates a real, externally-registered numeric 'wireframeLinewidth' property over real time, sampled at several checkpoints", async () => {
  await withPageFile(ENTRY, async (page, consoleErrors) => {
    const canvas = page.locator('[data-axis-name="stage"] canvas');
    await canvas.waitFor({ timeout: 5000 });
    const status = page.locator('[data-axis-name="lineWidthStatus"]');
    await status.waitFor({ timeout: 5000 });

    assert.equal(await status.textContent(), "line width: 1");

    const box = await canvas.boundingBox();
    // widthDemo (the sphere) sits right of center.
    const sphereX = box.x + box.width * 0.65;
    const sphereY = box.y + box.height * 0.5;
    await page.mouse.click(sphereX, sphereY);

    function valueOf(text) {
      return Number(text.replace("line width: ", ""));
    }

    // Same "don't assume timing, assume ordering" discipline as
    // tests/browser/physics-demo.test.js's own animation-over-real-time
    // checks - sample several checkpoints across the animate's own 1.2s
    // duration (main.ax) and assert forward progress, not an exact mid-
    // animation value. The 1.2s duration is deliberately generous - a
    // first draft used 0.3s, which passed reliably in isolation but
    // failed intermittently inside the full `npm run test:browser` suite
    // (more concurrent browser load means more real time can elapse
    // before this test's own first read happens, exactly the lesson
    // physics-demo.test.js's own header already documents - the fix
    // there was the same one applied here: don't assume the first
    // checkpoint arrives before a short animation has already finished).
    const samples = [];
    for (let i = 0; i < 4; i++) {
      samples.push(valueOf(await status.textContent()));
      await page.waitForTimeout(90);
    }
    for (let i = 1; i < samples.length; i++) {
      assert.ok(samples[i] >= samples[i - 1], `expected line width to never decrease during the animation, got ${JSON.stringify(samples)}`);
    }
    assert.ok(samples[3] > samples[0], `expected measurable progress toward 6, got ${JSON.stringify(samples)}`);

    assert.deepEqual(consoleErrors, []);
  });
});

test("animating an unregistered property from an 'on' handler fails cleanly with a real AxisRuntimeError, not a silent no-op or a crash elsewhere", async () => {
  const SOURCE = `
scene demo {
  cube box { color: red }
  on box.click {
    animate box {
      totallyMadeUpProperty -> 5
      duration: 0.2
    }
  }
}
page Home {
  viewport stage { scene: "demo" width: 300 height: 300 }
}
`;
  await withPage(SOURCE, async (page, consoleErrors) => {
    const canvas = page.locator('[data-axis-name="stage"] canvas');
    await canvas.waitFor({ timeout: 5000 });
    const box = await canvas.boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await new Promise((r) => setTimeout(r, 200));

    assert.ok(consoleErrors.length > 0, "expected a real error to surface, not a silent no-op");
    assert.ok(
      consoleErrors.some((e) => e.includes("can't animate 'totallyMadeUpProperty'")),
      `expected a clear "can't animate" error naming the unknown property, got: ${JSON.stringify(consoleErrors)}`
    );
  });
});

after(closeSharedBrowser);
