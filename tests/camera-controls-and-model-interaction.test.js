// Covers the two 3D-native gaps this milestone closes: `camera { controls:
// "orbit" }` (an interactive camera, not just a fixed viewpoint) and a
// loaded `model`'s meshes becoming real raycast targets - the thing that
// made examples/configurator.ax fake a real Blender model with a plain
// cube, because clicking a loaded model silently did nothing. The actual
// three.js/browser behavior (drag-to-orbit, a raycast hit landing on a
// specific glTF submesh) isn't Node-testable without a browser - that's
// covered by session notes on real browser verification instead. What's
// covered here is the build-time contract every runtime file depends on.

import { test } from "node:test";
import assert from "node:assert/strict";
import { run } from "../src/run.js";
import { AxisRuntimeError } from "../src/interpreter.js";
import { buildRenderPlan } from "../src/renderer/plan.js";
import { buildDomPlan } from "../src/renderer/domPlan.js";
import { neededJsmFilesFor, ORBIT_CONTROLS_URL, GLTF_JSM_URLS } from "../src/renderer/threeVendor.js";
import { renderHtml } from "../src/renderer/html.js";
import { renderPageHtml } from "../src/renderer/domHtml.js";

test("camera accepts controls: \"orbit\"", () => {
  const result = run(`scene main { camera { position: (0, 2, 6) controls: "orbit" } cube box { color: red } }`);
  assert.equal(result.scenes[0].camera.controls, "orbit");
});

test("an unknown camera controls value is a clear error with a suggestion", () => {
  assert.throws(
    () => run(`scene main { camera { controls: "fly" } cube box { color: red } }`),
    (err) => err instanceof AxisRuntimeError && /unknown camera controls 'fly'/.test(err.message) && /try "orbit"/.test(err.message)
  );
});

test("a camera with no controls carries controls: null through the plan, not undefined", () => {
  const result = run(`scene main { cube box { color: red } }`);
  const plan = buildRenderPlan(result);
  assert.equal(plan.camera.controls, null);
});

test("buildRenderPlan carries camera.controls through for a standalone scene", () => {
  const result = run(`scene main { camera { controls: "orbit" } cube box { color: red } }`);
  const plan = buildRenderPlan(result);
  assert.equal(plan.camera.controls, "orbit");
});

test("neededJsmFilesFor requests OrbitControls only when controls: \"orbit\" is set, independent of models", () => {
  const withOrbit = buildRenderPlan(run(`scene main { camera { controls: "orbit" } cube box { color: red } }`));
  assert.ok(neededJsmFilesFor(withOrbit).has(ORBIT_CONTROLS_URL));
  for (const url of GLTF_JSM_URLS) assert.ok(!neededJsmFilesFor(withOrbit).has(url));

  const withoutOrbit = buildRenderPlan(run(`scene main { cube box { color: red } }`));
  assert.ok(!neededJsmFilesFor(withoutOrbit).has(ORBIT_CONTROLS_URL));
});

test("neededJsmFilesFor requests GLTFLoader's files for a model, independent of orbit controls", () => {
  const plan = buildRenderPlan(run(`scene main { model m { src: "./a.glb" } }`));
  const needed = neededJsmFilesFor(plan);
  for (const url of GLTF_JSM_URLS) assert.ok(needed.has(url));
  assert.ok(!needed.has(ORBIT_CONTROLS_URL));
});

test("a scene-only file's HTML shell includes the import map when orbit controls are used, even with no model", () => {
  const plan = buildRenderPlan(run(`scene main { camera { controls: "orbit" } cube box { color: red } }`));
  const html = renderHtml(plan);
  assert.match(html, /importmap/);
});

test("a page's HTML shell includes the import map when an embedded viewport uses orbit controls, even with no model", () => {
  const result = run(`
    scene Earth { camera { controls: "orbit" } cube box { color: red } }
    page Home { viewport hero { scene: "Earth" } }
  `);
  const plan = buildDomPlan(result);
  const html = renderPageHtml(plan);
  assert.match(html, /importmap/);
});

test("a loaded model with an 'on' handler is a real, distinct capability from one without - both parse and build cleanly", () => {
  const result = run(`
    scene main {
      camera { controls: "orbit" }
      model piece { src: "./piece.glb" }
      on piece.click { print("clicked") }
      on piece.hover { print("hovered") }
    }
  `);
  const plan = buildRenderPlan(result);
  assert.equal(plan.handlers.length, 2);
  assert.equal(plan.camera.controls, "orbit");
  assert.deepEqual(plan.assets, ["./piece.glb"]);
});
