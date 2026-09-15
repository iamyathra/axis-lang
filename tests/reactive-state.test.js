// Covers the reactive-state milestone: a top-level `state`/`let` is shared
// live between every scene and page in a file, and a scene's own shape
// properties (not just a page's DOM properties) can now be reactive
// bindings too. See docs/architecture/reactive-state.md. The actual
// cross-domain mutation (Environment.set walking up to a shared ancestor
// cell) is client-side JS logic with no Node-testable surface - that's
// verified in a real browser instead; what's covered here is the build-time
// contract every runtime file depends on: what a plan actually ships.

import { test } from "node:test";
import assert from "node:assert/strict";
import { run } from "../src/run.js";
import { AxisRuntimeError } from "../src/interpreter.js";
import { buildRenderPlan } from "../src/renderer/plan.js";
import { buildDomPlan } from "../src/renderer/domPlan.js";

test("a top-level 'state' is collected into sharedVariables as reactive, a top-level 'let' as not", () => {
  const result = run(`
    let name = "Earth"
    state count = 0
    scene main { cube box { color: red } }
  `);
  assert.deepEqual(result.sharedVariables.name, { value: "Earth", constant: false, reactive: false });
  assert.deepEqual(result.sharedVariables.count, { value: 0, constant: false, reactive: true });
});

test("a top-level 'const' is shared but not assignable (constant: true)", () => {
  const result = run(`const pi = 3 scene main { }`);
  assert.deepEqual(result.sharedVariables.pi, { value: 3, constant: true, reactive: false });
});

test("a scene's shape property referencing a variable becomes a live binding, same as a page element's", () => {
  const result = run(`
    state baseColor = "gray"
    scene main {
      cube box { color: baseColor }
    }
  `);
  const box = result.scenes[0].objects[0];
  assert.ok(box.bindings, "expected a bindings entry for a non-literal color expression");
  assert.equal(box.bindings.color.kind, "Identifier");
});

test("a scene's bare-literal property does NOT become a binding", () => {
  const result = run(`scene main { cube box { color: "red" } }`);
  assert.equal(result.scenes[0].objects[0].bindings, undefined);
});

test("a model's 'src' never becomes a binding, even when computed", () => {
  const result = run(`let path = "./a.glb" scene main { model m { src: path } }`);
  const model = result.scenes[0].objects[0];
  assert.equal(model.bindings, undefined);
});

test("'state' now works inside a scene, not just a page - scene-level and top-level are independent", () => {
  const result = run(`scene main { state spin = 0 cube box { rotation: (0, spin, 0) } }`);
  assert.deepEqual(result.scenes[0].variables.spin, { value: 0, constant: false, reactive: true });
  const box = result.scenes[0].objects[0];
  assert.ok(box.bindings.rotation);
});

test("buildRenderPlan (a standalone scene file) carries sharedVariables through", () => {
  const result = run(`state count = 0 scene main { cube box { color: "red" } }`);
  const plan = buildRenderPlan(result);
  assert.deepEqual(plan.sharedVariables.count, { value: 0, constant: false, reactive: true });
});

test("buildDomPlan carries sharedVariables through, and a viewport's embedded scene keeps its own bindings nested under node.scene", () => {
  const result = run(`
    state count = 0
    scene Earth {
      cube box { color: "blue" rotation: (0, count, 0) }
    }
    page Home { viewport hero { scene: "Earth" } }
  `);
  const plan = buildDomPlan(result);
  assert.deepEqual(plan.sharedVariables.count, { value: 0, constant: false, reactive: true });
  const viewport = plan.nodes.find((n) => n.name === "hero");
  const box = viewport.scene.nodes.find((n) => n.name === "box");
  assert.ok(box.bindings.rotation, "expected the embedded scene's own binding to survive into the nested plan");
});

test("a page-level 'on' handler can assign to a top-level 'state' by bare name, same as a scene-level 'let'", () => {
  // This only proves the language accepts and evaluates the assignment
  // during interpretation (the interpreter runs handler bodies textually
  // as declared, not on click) - the live cross-domain mutation itself is
  // a runtime (browser) behavior, verified separately.
  assert.doesNotThrow(() =>
    run(`
      state count = 0
      scene Earth { cube box { color: "red" } }
      page Home {
        viewport hero { scene: "Earth" }
        button go { label: "Go" }
        on go.click { count = count + 1 }
      }
    `)
  );
});

test("a scene-level 'state' may reuse a top-level 'state' name - it shadows, it doesn't collide", () => {
  const result = run(`state x = 1 scene main { state x = 2 cube box { color: "red" } }`);
  assert.equal(result.sharedVariables.x.value, 1);
  assert.equal(result.scenes[0].variables.x.value, 2);
});
