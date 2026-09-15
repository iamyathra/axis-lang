// Viewport lifecycle (mountViewport/unmountViewport, scene3d.js's own
// disposed-state guards) is browser-runtime behavior with no *Node*-testable
// equivalent - there's no WebGL context, no requestAnimationFrame clock,
// and scene3d.js resolves its own imports (THREE, evaluator.js, ...) as
// absolute browser paths a dev-server's import map serves, not real
// filesystem paths Node can load. See render-on-demand.test.js's header for
// why this repo treats every other three.js-only behavior the same way.
//
// This IS covered by real, automated browser tests now, though - not just
// manual verification notes: tests/browser/dispose.test.js actually mounts
// and unmounts a viewport many times in a real headless Chromium (via
// Playwright) and checks for WebGL-context leaks; tests/browser/raycast.test.js
// and tests/browser/tick.test.js cover interaction and the real per-frame
// RAF loop the same way. That suite is deliberately opt-in
// (`npm run test:browser`, not part of plain `npm test` - see its own
// harness.js header for why) since it needs a real downloaded Chromium
// binary this file's own Node-only suite never requires.
//
// What's genuinely Node-testable here: the build-time contract a lifecycle
// feature depends on - that a page with several viewports (one animated,
// interactive, and scroll-linked) still produces the plan/served-HTML shape
// mountViewport/unmountViewport actually read at runtime (node.type,
// node.scene.animations/timelines/handlers, node.scrollTimeline/
// scrollProgress, one container element per viewport) - didn't shift
// underneath this purely-internal ownership/disposal change.

import { test } from "node:test";
import assert from "node:assert/strict";
import { run } from "../src/run.js";
import { buildDomPlan } from "../src/renderer/domPlan.js";
import { startDomServer } from "../src/renderer/domServer.js";

const THREE_VIEWPORT_SOURCE = `
  scene sceneA { cube box { color: blue } }
  scene sceneB {
    state progress = 0
    cube box { color: orange }
    sphere spinner { color: yellow }
    animate spinner { rotation.y -> 360deg duration: 1000 repeat: infinite }
    timeline spin { animate box { rotation.y -> 360deg duration: 4000 } }
    on box.click { }
  }
  scene sceneC { cube box { color: green } }
  page Home {
    container row {
      viewport A { scene: "sceneA" }
      viewport B { scene: "sceneB" scrollTimeline: "spin" scrollProgress: "progress" }
      viewport C { scene: "sceneC" }
    }
  }
`;

test("a page with three viewports (one animated/interactive/scroll-linked) builds a plan with independent per-viewport nodes - the shape unmountViewport reads at runtime", () => {
  const plan = buildDomPlan(run(THREE_VIEWPORT_SOURCE));
  const viewportNodes = plan.nodes.filter((n) => n.type === "viewport");
  assert.equal(viewportNodes.length, 3);
  const [a, b, c] = ["A", "B", "C"].map((name) => viewportNodes.find((n) => n.name === name));
  assert.ok(a && b && c, "all three viewports are present as distinct plan nodes");

  // B carries every kind of activity a disposed runtime must stop:
  // continuous animation, timeline playback, scroll-driven state, and
  // interaction - A and C carry none of it, which is exactly what makes
  // "does disposing B leave A/C alone" a meaningful browser check.
  assert.equal(b.scene.animations.length, 1);
  assert.equal(b.scene.timelines.length, 1);
  assert.equal(b.scene.handlers.length, 1);
  assert.equal(b.scrollTimeline, "spin");
  assert.equal(b.scrollProgress, "progress");
  for (const idle of [a, c]) {
    assert.equal(idle.scene.animations.length, 0);
    assert.equal(idle.scene.timelines.length, 0);
    assert.equal(idle.scrollTimeline, undefined);
    assert.equal(idle.scrollProgress, undefined);
  }
});

test("the served page has one real container element per viewport, by name, for mountViewport to find", async () => {
  const plan = buildDomPlan(run(THREE_VIEWPORT_SOURCE));
  const server = await startDomServer(plan);
  const port = server.address().port;
  try {
    const html = await (await fetch(`http://localhost:${port}/`)).text();
    for (const name of ["A", "B", "C"]) {
      assert.match(html, new RegExp(`data-axis-name="${name}"`));
    }
    assert.match(html, /\/domClient\.js/);
  } finally {
    server.close();
  }
});

test("examples/viewport-lifecycle.ax itself parses and builds a plan with exactly the three viewports the browser verification exercises", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../examples/viewport-lifecycle.ax", import.meta.url), "utf8");
  const plan = buildDomPlan(run(source));
  const viewportNodes = plan.nodes.filter((n) => n.type === "viewport");
  assert.deepEqual(
    viewportNodes.map((n) => n.name).sort(),
    ["A", "B", "C"]
  );
});
