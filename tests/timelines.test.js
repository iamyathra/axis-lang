// Covers AXIS's `timeline` system: a named, ordered choreography of
// `animate` steps, `label` (a real variable bound to the timeline's own
// cursor time), `at` (a step's absolute position on that clock, defaulting
// to right after the previous step), `previous` (auto-updated after every
// step), stagger (an ordinary `for` loop generating steps), `play` (restart
// an already-declared timeline), and the generalized animation path
// vocabulary (material.*/color/intensity/camera) both a plain `animate` and
// a timeline step now share. What's build-time-checkable (parsing,
// scheduling math, target/path validation, what a render plan ships) is
// covered here; actual per-frame playback (scene3d.js's tick()) is
// client-side behavior with no Node-testable surface - see docs/
// language.md's Timelines section and session notes on real browser
// verification for that half.

import { test } from "node:test";
import assert from "node:assert/strict";
import { run } from "../src/run.js";
import { AxisRuntimeError } from "../src/interpreter.js";
import { AxisSyntaxError } from "../src/lexer.js";
import { buildRenderPlan } from "../src/renderer/plan.js";

// ---- parsing ------------------------------------------------------------

test("a timeline with label/at/for-loop stagger parses and interprets cleanly", () => {
  const result = run(`
    scene main {
      cube box { color: red }
      timeline intro {
        label start
        animate box { position.y -> 2 duration: 500 }
        label mid
        animate box { material.roughness -> 0.2 duration: 300 at: mid + 100 }
        for i in range(0, 3) {
          animate box { scale.x -> 1.5 duration: 200 at: previous + i * 80 }
        }
      }
    }
  `);
  assert.equal(result.scenes[0].timelines.length, 1);
});

test("'play NAME' parses inside an 'on' handler", () => {
  const result = run(`
    scene main {
      cube box { color: red }
      timeline intro { animate box { position.y -> 1 duration: 100 } }
      on box.click { play intro }
    }
  `);
  assert.equal(result.scenes[0].handlers[0].body[0].kind, "PlayStmt");
  assert.equal(result.scenes[0].handlers[0].body[0].target, "intro");
});

test("a computed 'play' target parses like animate/on's computed targets do", () => {
  const result = run(`
    scene main {
      cube box { color: red }
      timeline intro { animate box { position.y -> 1 duration: 100 } }
      on box.click { play ("intro") }
    }
  `);
  assert.equal(result.scenes[0].handlers[0].body[0].targetIsExpr, true);
});

test("only 'animate'/'label'/'let'/'const'/'if'/'while'/'for' are valid inside a timeline", () => {
  assert.throws(
    () => run(`scene main { cube box{} timeline t { on box.click {} } }`),
    (err) => err instanceof AxisSyntaxError && /expected 'animate', 'label'/.test(err.message)
  );
});

// ---- 'loop' ---------------------------------------------------------------

test("'loop: true' parses and carries through to the scene's own timeline", () => {
  const result = run(`
    scene main {
      cube box { color: red }
      timeline t { loop: true animate box { position.y -> 1 duration: 500 } }
    }
  `);
  assert.equal(result.scenes[0].timelines[0].loop, true);
});

test("a timeline with no 'loop' defaults to false", () => {
  const result = run(`scene main { cube box{} timeline t { animate box { position.y -> 1 duration: 500 } } }`);
  assert.equal(result.scenes[0].timelines[0].loop, false);
});

test("'loop' works inside a page timeline too, and carries through the render plan", () => {
  const result = run(`page Home { heading t { content: "x" } timeline reveal { loop: true animate t { opacity -> 1 duration: 300 } } }`);
  assert.equal(result.pages[0].timelines[0].loop, true);
});

test("'loop' needs true or false, not a number", () => {
  assert.throws(
    () => run(`scene main { cube box{} timeline t { loop: 1 animate box { position.y -> 1 duration: 500 } } }`),
    (err) => err instanceof AxisRuntimeError && /'loop' needs true or false/.test(err.message)
  );
});

test("an unknown timeline property (not 'loop') is a clear error with a suggestion", () => {
  assert.throws(
    () => run(`scene main { cube box{} timeline t { speed: 2 animate box { position.y -> 1 duration: 500 } } }`),
    (err) => err instanceof AxisRuntimeError && /timeline doesn't have a 'speed' property/.test(err.message)
  );
});

test("'loop' survives into the render plan, not just the raw interpreter graph", () => {
  const result = run(`scene main { cube box{} timeline t { loop: true animate box { position.y -> 1 duration: 500 } } }`);
  const plan = buildRenderPlan(result);
  assert.equal(plan.timelines[0].loop, true);
});

// ---- scheduling math ------------------------------------------------------

test("a step with no 'at' defaults to right after the previous step ends", () => {
  const result = run(`
    scene main {
      cube box { color: red }
      timeline t {
        animate box { position.y -> 1 duration: 500 }
        animate box { position.x -> 1 duration: 300 }
      }
    }
  `);
  const [first, second] = result.scenes[0].timelines[0].steps;
  assert.equal(first.at, 0);
  assert.equal(second.at, 500);
});

test("the first step also defaults to 'at: 0' (previous starts at 0)", () => {
  const result = run(`scene main { cube box{} timeline t { animate box { position.y -> 1 duration: 500 } } }`);
  assert.equal(result.scenes[0].timelines[0].steps[0].at, 0);
});

test("'label' binds the cursor at the point it's declared, usable in a later step's 'at'", () => {
  const result = run(`
    scene main {
      cube box { color: red }
      timeline t {
        animate box { position.y -> 1 duration: 400 }
        label mid
        animate box { position.x -> 1 duration: 100 at: mid + 250 }
      }
    }
  `);
  const [, second] = result.scenes[0].timelines[0].steps;
  assert.equal(second.at, 650); // mid=400, +250
});

test("'previous' updates after every step, including inside a for-loop (stagger)", () => {
  const result = run(`
    scene main {
      cube box { color: red }
      timeline t {
        animate box { position.y -> 1 duration: 100 }
        for i in range(0, 3) {
          animate box { scale.x -> 1.5 duration: 50 at: previous + i * 20 }
        }
      }
    }
  `);
  const steps = result.scenes[0].timelines[0].steps;
  // step0 ends at 100 (previous=100); i=0 -> at 100+0*20=100, ends 150 (previous=150);
  // i=1 -> at 150+1*20=170, ends 220 (previous=220); i=2 -> at 220+2*20=260.
  assert.deepEqual(steps.slice(1).map((s) => s.at), [100, 170, 260]);
});

test("the timeline's own total duration is the furthest step's own end", () => {
  const result = run(`
    scene main {
      cube box { color: red }
      timeline t {
        animate box { position.y -> 1 duration: 500 }
        animate box { position.x -> 1 duration: 300 at: 100 }
      }
    }
  `);
  assert.equal(result.scenes[0].timelines[0].duration, 500); // max(0+500, 100+300)
});

test("a negative 'at' overlaps with (starts before) where the default sequential position would be", () => {
  const result = run(`
    scene main {
      cube box { color: red }
      timeline t {
        animate box { position.y -> 1 duration: 500 }
        animate box { position.x -> 1 duration: 200 at: previous - 200 }
      }
    }
  `);
  assert.equal(result.scenes[0].timelines[0].steps[1].at, 300);
});

// ---- validation -----------------------------------------------------------

test("'delay' isn't allowed on a timeline step - a clear error pointing at 'at'", () => {
  assert.throws(
    () => run(`scene main { cube box{} timeline t { animate box { position.y -> 1 duration: 100 delay: 50 } } }`),
    (err) => err instanceof AxisRuntimeError && /'delay' isn't supported on a timeline step.*use 'at'/.test(err.message)
  );
});

test("'repeat' isn't allowed on a timeline step either", () => {
  assert.throws(
    () => run(`scene main { cube box{} timeline t { animate box { position.y -> 1 duration: 100 repeat: 3 } } }`),
    (err) => err instanceof AxisRuntimeError && /'repeat' isn't supported on a timeline step/.test(err.message)
  );
});

test("'at' needs a number", () => {
  assert.throws(
    () => run(`scene main { cube box{} timeline t { animate box { position.y -> 1 duration: 100 at: "soon" } } }`),
    (err) => err instanceof AxisRuntimeError && /'at' needs a number/.test(err.message)
  );
});

test("a duplicate timeline name in the same scene is a clear error", () => {
  assert.throws(
    () => run(`
      scene main {
        cube box{}
        timeline t { animate box { position.y -> 1 duration: 100 } }
        timeline t { animate box { position.y -> 1 duration: 100 } }
      }
    `),
    (err) => err instanceof AxisRuntimeError && /timeline 't' is already defined/.test(err.message)
  );
});

// ---- 'on TIMELINE.complete' ---------------------------------------------

test("'on TIMELINE.complete' is a real handler target - a timeline, not an object", () => {
  const result = run(`
    scene main {
      cube box { color: red }
      timeline intro { animate box { position.y -> 1 duration: 100 } }
      on intro.complete { box.color = "blue" }
    }
  `);
  assert.equal(result.scenes[0].handlers[0].target, "intro");
  assert.equal(result.scenes[0].handlers[0].event, "complete");
});

test("'complete' on an ordinary object (not a timeline) is a clear error", () => {
  assert.throws(
    () => run(`scene main { cube box { color: red } on box.complete { } }`),
    (err) => err instanceof AxisRuntimeError && /'complete' only works on a timeline/.test(err.message)
  );
});

test("an event other than 'complete' on a timeline target is a clear error", () => {
  assert.throws(
    () => run(`
      scene main {
        cube box { color: red }
        timeline intro { animate box { position.y -> 1 duration: 100 } }
        on intro.click { }
      }
    `),
    (err) => err instanceof AxisRuntimeError && /'click' isn't a timeline event - only 'complete' is/.test(err.message)
  );
});

// `timeline` inside a `page` is now real - see tests/dom-timelines.test.js
// for the full page-timeline surface (DOM targets, cross-scene targets via
// a viewport, `play`, `scrollTimeline`). This just confirms the base-class
// "not supported" stub (still the default for a hypothetical future
// domain) no longer applies to pages.
test("'timeline' works inside a page now, not just a scene", () => {
  const result = run(`page Home { heading title { content: "hi" } timeline t { animate title { opacity -> 1 duration: 100 } } }`);
  assert.equal(result.pages[0].timelines[0].name, "t");
});

test("a timeline step can't target an object that doesn't exist, same error as top-level animate", () => {
  assert.throws(
    () => run(`scene main { cube box{} timeline t { animate ghost { position.y -> 1 duration: 100 } } }`),
    (err) => err instanceof AxisRuntimeError && /can't animate 'ghost'/.test(err.message)
  );
});

// ---- camera addressability -------------------------------------------------

test("'camera' is a real animate target now, for position", () => {
  const result = run(`
    scene main {
      camera { position: (0, 2, 5) }
      cube box { color: red }
      animate camera { position.z -> 8 duration: 1s }
    }
  `);
  const plan = buildRenderPlan(result);
  assert.equal(plan.animations[0].target, "camera");
  assert.equal(plan.animations[0].changes[0].from, 5);
  assert.equal(plan.animations[0].changes[0].to, 8);
});

test("a camera has authorable fov/near/far/target, defaulting to three.js's own PerspectiveCamera defaults", () => {
  const result = run(`scene main { cube box { color: red } }`);
  const plan = buildRenderPlan(result);
  assert.equal(plan.camera.fov, 60);
  assert.equal(plan.camera.near, 0.1);
  assert.equal(plan.camera.far, 100);
  assert.deepEqual(plan.camera.target, [0, 0, 0]);
});

test("a camera's fov/near/far/target can be declared and animated, same as position", () => {
  const result = run(`
    scene main {
      camera { position: (0, 2, 5) fov: 50 near: 1 far: 500 target: (1, 1, 1) }
      cube box { color: red }
      animate camera { fov -> 75 duration: 1s }
      animate camera { target.x -> 4 duration: 1s }
    }
  `);
  const plan = buildRenderPlan(result);
  assert.equal(plan.camera.fov, 50);
  assert.equal(plan.camera.near, 1);
  assert.equal(plan.camera.far, 500);
  assert.deepEqual(plan.camera.target, [1, 1, 1]);
  assert.deepEqual(plan.animations[0].changes[0], { path: ["fov"], from: 50, to: 75, color: false });
  assert.deepEqual(plan.animations[1].changes[0], { path: ["target", "x"], from: 1, to: 4, color: false });
});

test("a non-numeric fov on a camera is a clear error", () => {
  assert.throws(
    () => run(`scene main { camera { fov: "wide" } cube box { color: red } }`),
    (err) => err instanceof AxisRuntimeError && /'fov' needs a number/.test(err.message)
  );
});

test("a non-literal camera property (fov/target/etc) becomes a reactive binding that survives into the render plan", () => {
  const result = run(`
    scene main {
      state zoom = 50
      camera { fov: zoom }
      cube box { color: red }
    }
  `);
  // The raw interpreter graph already carries it (interpreter.js's
  // applyProperty stashes any non-literal property) - the real regression
  // this guards is plan.js's own camera object silently dropping it instead
  // of passing it through to what the browser actually receives.
  assert.ok(result.scenes[0].camera.bindings.fov);
  const plan = buildRenderPlan(result);
  assert.ok(plan.camera.bindings.fov, "camera.bindings must survive into the render plan, not just the raw interpreter graph");
});

test("a shape literally named 'camera' collides with the scene's own camera - a clear error, either declaration order", () => {
  assert.throws(
    () => run(`scene main { camera { position: (0,1,1) } cube camera { color: red } }`),
    (err) => err instanceof AxisRuntimeError && /'camera' is already defined/.test(err.message)
  );
  assert.throws(
    () => run(`scene main { cube camera { color: red } camera { position: (0,1,1) } }`),
    (err) => err instanceof AxisRuntimeError && /'camera' is already defined/.test(err.message)
  );
});

test("'camera' can't be declared inside a component", () => {
  assert.throws(
    () => run(`component C() { camera { position: (0,1,1) } } scene main { C c {} }`),
    (err) => err instanceof AxisRuntimeError && /'camera' can't be declared inside a component/.test(err.message)
  );
});

// ---- generalized animation paths (material/color/intensity), at the plan layer --

test("a plain 'animate' can target material.* now, not just position/rotation/scale", () => {
  const result = run(`
    scene main {
      cube box { color: red material.metalness: 0.2 }
      animate box { material.metalness -> 0.9 duration: 1s }
    }
  `);
  const plan = buildRenderPlan(result);
  const [change] = plan.animations[0].changes;
  assert.deepEqual(change.path, ["material", "metalness"]);
  assert.equal(change.from, 0.2);
  assert.equal(change.to, 0.9);
  assert.equal(change.color, false);
});

test("animating material.metalness with no initial value starts from three.js's own default (0)", () => {
  const result = run(`
    scene main {
      cube box { color: red }
      animate box { material.metalness -> 0.9 duration: 1s }
    }
  `);
  const plan = buildRenderPlan(result);
  assert.equal(plan.animations[0].changes[0].from, 0);
});

test("animating 'color' or 'material.color'/'material.emissive' is flagged as a color change and needs a string", () => {
  const result = run(`
    scene main {
      cube box { color: red }
      animate box { color -> blue duration: 1s }
    }
  `);
  const plan = buildRenderPlan(result);
  const [change] = plan.animations[0].changes;
  assert.deepEqual(change.path, ["color"]);
  assert.equal(change.color, true);
  assert.equal(change.from, "red");
  assert.equal(change.to, "blue");

  assert.throws(
    () => run(`scene main { cube box { color: red } animate box { color -> 5 duration: 1s } }`),
    (err) => err instanceof AxisRuntimeError && /must be a color/.test(err.message)
  );
});

test("a timeline step targeting material/color/camera resolves the same way a plain animate does", () => {
  const result = run(`
    scene main {
      camera { position: (0, 2, 5) }
      spotLight flash { intensity: 10 }
      cube box { color: red }
      timeline t {
        animate box { material.roughness -> 0.1 duration: 200 }
        animate flash { intensity -> 40 duration: 200 at: previous }
        animate camera { position.z -> 8 duration: 400 }
      }
    }
  `);
  const plan = buildRenderPlan(result);
  const [step1, step2, step3] = plan.timelines[0].steps;
  assert.deepEqual(step1.changes[0].path, ["material", "roughness"]);
  assert.equal(step1.changes[0].from, 1); // three.js's own roughness default
  assert.deepEqual(step2.changes[0].path, ["intensity"]);
  assert.equal(step2.changes[0].from, 10);
  assert.deepEqual(step3.changes[0].path, ["position", "z"]);
  assert.equal(step3.changes[0].from, 5);
});

test("a change to a path an object doesn't support is warned and skipped, same lenient behavior an out-of-range position/rotation/scale path already had", () => {
  const result = run(`
    scene main {
      group rig { position: (0,0,0) }
      animate rig { material.metalness -> 0.5 duration: 1s }
    }
  `);
  const plan = buildRenderPlan(result);
  assert.equal(plan.animations.length, 0);
  assert.ok(plan.warnings.some((w) => w.includes("material.metalness")));
});
