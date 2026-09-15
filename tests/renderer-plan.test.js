import { test } from "node:test";
import assert from "node:assert/strict";
import { run } from "../src/run.js";
import { buildRenderPlan } from "../src/renderer/plan.js";

test("builds a camera and object plan with sensible defaults", () => {
  const sceneGraph = run(`
    scene main {
      cube box { color: red }
    }
  `);
  const plan = buildRenderPlan(sceneGraph);
  assert.deepEqual(plan.camera, { position: [0, 2, 5], controls: null, fov: 60, near: 0.1, far: 100, target: [0, 0, 0], bindings: {} });
  assert.equal(plan.nodes.length, 1);
  assert.deepEqual(plan.nodes[0].position, [0, 0, 0]);
  assert.deepEqual(plan.nodes[0].rotation, [0, 0, 0]);
  assert.deepEqual(plan.nodes[0].scale, [1, 1, 1]);
  assert.equal(plan.nodes[0].color, "red");
  assert.equal(plan.nodes[0].parent, null);
});

test("uses the scene's camera position when one is declared", () => {
  const sceneGraph = run(`
    scene main {
      camera { position: (1, 2, 3) }
      cube box { color: red }
    }
  `);
  const plan = buildRenderPlan(sceneGraph);
  assert.deepEqual(plan.camera.position, [1, 2, 3]);
});

test("converts an animation's rotation target from degrees to radians", () => {
  const sceneGraph = run(`
    scene main {
      cube box { color: red }
      animate box { rotation.y -> 180deg duration: 1s }
    }
  `);
  const plan = buildRenderPlan(sceneGraph);
  const [change] = plan.animations[0].changes;
  assert.deepEqual(change.path, ["rotation", "y"]);
  assert.equal(change.from, 0);
  assert.ok(Math.abs(change.to - Math.PI) < 1e-9);
});

// Real bug this slice fixed: `from` (the object's current rotation, read
// off the interpreter graph, always in degrees) used to be left
// unconverted while `to` was already correctly converted to radians -
// animating rotation on an object with a non-zero *initial* rotation would
// therefore ease toward a wildly wrong angle. Every existing example
// animated rotation only from a default (zero) starting rotation, where
// degrees and radians are indistinguishable (0 either way), which is
// exactly why this had never been caught.
test("an object with a non-zero initial rotation still animates from the correct (converted) starting angle", () => {
  const sceneGraph = run(`
    scene main {
      cube box { color: red rotation: (0, 90, 0) }
      animate box { rotation.y -> 180deg duration: 1s }
    }
  `);
  const plan = buildRenderPlan(sceneGraph);
  const [change] = plan.animations[0].changes;
  assert.ok(Math.abs(change.from - Math.PI / 2) < 1e-9, `expected 'from' to be π/2 radians (90°), got ${change.from}`);
  assert.ok(Math.abs(change.to - Math.PI) < 1e-9);
});

test("keeps radian rotation targets as-is", () => {
  const sceneGraph = run(`
    scene main {
      cube box { color: red }
      animate box { rotation.y -> 3.14rad duration: 1s }
    }
  `);
  const plan = buildRenderPlan(sceneGraph);
  assert.equal(plan.animations[0].changes[0].to, 3.14);
});

test("carries duration, delay, repeat, and easing through unchanged", () => {
  const sceneGraph = run(`
    scene main {
      cube box { color: red }
      animate box { rotation.y -> 360deg duration: 2s delay: 100ms repeat: infinite easing: easeOut }
    }
  `);
  const [anim] = buildRenderPlan(sceneGraph).animations;
  assert.equal(anim.duration, 2000);
  assert.equal(anim.delay, 100);
  assert.equal(anim.repeat, Infinity);
  assert.equal(anim.easing, "easeOut");
});

test("warns and skips when a file has more than one scene", () => {
  const sceneGraph = run(`
    scene a { cube box { color: red } }
    scene b { cube other { color: blue } }
  `);
  const plan = buildRenderPlan(sceneGraph);
  assert.equal(plan.nodes.length, 1);
  assert.equal(plan.nodes[0].name, "box");
  assert.ok(plan.warnings.some((w) => w.includes("2 scenes")));
});

test("returns an empty plan for a file with no scenes", () => {
  const plan = buildRenderPlan({ scenes: [], functions: [] });
  assert.deepEqual(plan.nodes, []);
  assert.deepEqual(plan.animations, []);
  assert.deepEqual(plan.timelines, []);
});

test("keeps parent pointers so a renderer can reconstruct group nesting", () => {
  const sceneGraph = run(`
    scene main {
      group rig {
        cube arm { color: red }
      }
    }
  `);
  const plan = buildRenderPlan(sceneGraph);
  const rig = plan.nodes.find((n) => n.name === "rig");
  const arm = plan.nodes.find((n) => n.name === "arm");
  assert.equal(rig.type, "group");
  assert.equal(rig.parent, null);
  assert.equal(arm.parent, "rig");
});

test("includes lights in the node list with their own fields", () => {
  const sceneGraph = run(`
    scene main {
      pointLight bulb { position: (1, 2, 3) intensity: 2 color: white }
    }
  `);
  const plan = buildRenderPlan(sceneGraph);
  const [bulb] = plan.nodes;
  assert.equal(bulb.type, "pointLight");
  assert.deepEqual(bulb.position, [1, 2, 3]);
  assert.equal(bulb.intensity, 2);
});

test("carries functions, variables, and handlers through for the browser runtime", () => {
  const sceneGraph = run(`
    fn double(x) { return x * 2 }
    scene main {
      let spacing = 3
      cube box { color: red }
      on box.click { box.color = green }
    }
  `);
  const plan = buildRenderPlan(sceneGraph);
  assert.equal(plan.functions[0].name, "double");
  assert.deepEqual(plan.variables.spacing, { value: 3, constant: false, reactive: false });
  assert.equal(plan.handlers[0].target, "box");
  assert.equal(plan.handlers[0].event, "click");
});

test("warns and skips an animation targeting an unsupported property path", () => {
  const sceneGraph = run(`
    scene main {
      ambientLight sun { intensity: 0.5 }
    }
  `);
  // manually construct a scene graph animation the interpreter itself
  // wouldn't produce, to exercise the renderer's own defensive check -
  // "opacity" (unlike "intensity", which a light genuinely does support
  // animating now) isn't a field an ambientLight has at all.
  sceneGraph.scenes[0].animations.push({
    target: "sun",
    changes: [{ path: "opacity", toValue: 1, unit: null }],
    duration: 1000,
    delay: 0,
    repeat: 1,
    easing: "linear",
  });
  const plan = buildRenderPlan(sceneGraph);
  assert.equal(plan.animations.length, 0);
  assert.ok(plan.warnings.some((w) => w.includes("opacity")));
});

test("a light's intensity is a real animatable path now", () => {
  const sceneGraph = run(`
    scene main {
      pointLight bulb { intensity: 1 }
      animate bulb { intensity -> 3 duration: 1s }
    }
  `);
  const plan = buildRenderPlan(sceneGraph);
  const [change] = plan.animations[0].changes;
  assert.deepEqual(change.path, ["intensity"]);
  assert.equal(change.from, 1);
  assert.equal(change.to, 3);
});

test("a 'model' node carries its src through, and has no 'color'", () => {
  const sceneGraph = run(`scene main { model rock { src: "./rock.glb" position: (1, 0, 0) } }`);
  const plan = buildRenderPlan(sceneGraph);
  assert.equal(plan.nodes[0].type, "model");
  assert.equal(plan.nodes[0].src, "./rock.glb");
  assert.deepEqual(plan.nodes[0].position, [1, 0, 0]);
  assert.equal(plan.nodes[0].color, undefined);
});

test("plan.assets collects every distinct model src, deduplicated", () => {
  const sceneGraph = run(`
    scene main {
      model a { src: "./rock.glb" }
      model b { src: "./rock.glb" }
      model c { src: "./tree.gltf" }
    }
  `);
  const plan = buildRenderPlan(sceneGraph);
  assert.deepEqual(plan.assets, ["./rock.glb", "./tree.gltf"]);
});

test("plan.assets is empty for a scene with no models", () => {
  const sceneGraph = run(`scene main { cube box { color: red } }`);
  const plan = buildRenderPlan(sceneGraph);
  assert.deepEqual(plan.assets, []);
});

// A `group`'s and a `model`'s own position/rotation/scale used to be
// silently dropped here - the interpreter recorded their bindings just like
// a shape's, but buildNode only ever carried them through for shapes, which
// is why scene3d.js's reRender() (and, by extension, `on`-handler mutation
// and `state` re-render) never saw them. Both are real scene citizens now.
test("a 'group' node carries non-literal position/rotation/scale through as bindings, same as a shape", () => {
  const sceneGraph = run(`
    scene main {
      state lift = 2
      group rig {
        position: (0, lift, 0)
        cube arm { color: red }
      }
    }
  `);
  const plan = buildRenderPlan(sceneGraph);
  const rig = plan.nodes.find((n) => n.name === "rig");
  assert.ok(rig.bindings.position, "expected 'rig' to carry a position binding");
  assert.equal(rig.bindings.rotation, undefined);
});

test("a 'group' node has no rotation/scale bindings when only position is set", () => {
  const sceneGraph = run(`scene main { group rig { position: (0, 1, 0) } }`);
  const plan = buildRenderPlan(sceneGraph);
  const rig = plan.nodes.find((n) => n.name === "rig");
  assert.equal(rig.bindings.rotation, undefined);
  assert.equal(rig.bindings.scale, undefined);
});

test("a 'model' node carries a non-literal scale through as a binding, same as a shape", () => {
  const sceneGraph = run(`
    scene main {
      state grown = 1.2
      model rock { src: "./rock.glb" scale: (grown, grown, grown) }
    }
  `);
  const plan = buildRenderPlan(sceneGraph);
  const rock = plan.nodes.find((n) => n.name === "rock");
  assert.ok(rock.bindings.scale, "expected 'rock' to carry a scale binding");
});

test("a 'model' nested inside a 'group' keeps its parent pointer, like any other spatial node", () => {
  const sceneGraph = run(`
    scene main {
      group rig {
        model rock { src: "./rock.glb" }
      }
    }
  `);
  const plan = buildRenderPlan(sceneGraph);
  const rock = plan.nodes.find((n) => n.name === "rock");
  assert.equal(rock.parent, "rig");
});
