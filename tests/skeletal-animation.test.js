// Covers AXIS's clip-playback surface for a loaded `model` - see
// docs/architecture/skeletal-animation.md. The language surface is
// deliberately small: `clip: "Walk"` (which clip a model plays once loaded),
// `play CLIP on TARGET` / `stop TARGET` (runtime clip control from an `on`
// handler), and `progress` joining the existing `animate`/`timeline` scalar
// path vocabulary (alongside `intensity`/`color`) so a clip's normalized
// time is just another timeline-controlled property, not a second system.
//
// What's build-time-checkable (parsing, `clip` property validation, the
// render-plan shape, component-instance renaming) is covered here; the
// actual mixer/AnimationAction playback (reconcileClip, tick()'s own mixer
// loop) is client-side behavior with no Node-testable surface - see the
// session's browser verification for that half, same split every other
// scene3d.js-only feature (timelines, render-on-demand, viewport lifecycle)
// already has in this test suite.

import { test } from "node:test";
import assert from "node:assert/strict";
import { run } from "../src/run.js";
import { buildRenderPlan } from "../src/renderer/plan.js";

// ---- `clip:` on a model ---------------------------------------------------

test("a 'model' accepts a 'clip' property naming its initial animation clip", () => {
  const result = run(`scene main { model hero { src: "./hero.glb" clip: "Walk" } }`);
  assert.equal(result.scenes[0].objects[0].clip, "Walk");
});

test("a 'model' with no 'clip' property defaults to null - no clip selected", () => {
  const result = run(`scene main { model hero { src: "./hero.glb" } }`);
  assert.equal(result.scenes[0].objects[0].clip, null);
});

test("'clip' needs a string", () => {
  assert.throws(() => run(`scene main { model hero { src: "./hero.glb" clip: 3 } }`), /'clip' needs a string/);
});

test("'clip' isn't available on a shape - only a 'model' has animation clips", () => {
  assert.throws(() => run(`scene main { cube box { clip: "Walk" } }`), /'cube' doesn't have a 'clip' property/);
});

test("'clip' isn't reactive (like 'src') - a 'state'-read value doesn't become a live binding", () => {
  const result = run(`
    scene main {
      state chosen = "Walk"
      model hero { src: "./hero.glb" clip: chosen }
    }
  `);
  const model = result.scenes[0].objects[0];
  assert.equal(model.clip, "Walk");
  assert.equal(model.bindings?.clip, undefined);
});

// ---- render plan ----------------------------------------------------------

test("a model's 'clip' carries through into the render plan node", () => {
  const plan = buildRenderPlan(run(`scene main { model hero { src: "./hero.glb" clip: "Walk" } }`));
  assert.equal(plan.nodes[0].clip, "Walk");
});

test("a model with no 'clip' still gets a 'clip: null' field on its plan node (never undefined)", () => {
  const plan = buildRenderPlan(run(`scene main { model hero { src: "./hero.glb" } }`));
  assert.equal(plan.nodes[0].clip, null);
});

test("a top-level 'animate model { progress -> 1 }' resolves - 'progress' always starts from 0 at build time", () => {
  const plan = buildRenderPlan(run(`
    scene main {
      model hero { src: "./hero.glb" }
      animate hero { progress -> 1 duration: 2s }
    }
  `));
  assert.equal(plan.animations.length, 1);
  assert.deepEqual(plan.animations[0].changes[0], { path: ["progress"], from: 0, to: 1, color: false });
});

test("'progress' on a non-model is warned and skipped, same lenient behavior any unsupported path already has", () => {
  const plan = buildRenderPlan(run(`
    scene main {
      cube box { color: red }
      animate box { progress -> 1 duration: 2s }
    }
  `));
  assert.equal(plan.animations.length, 0);
  assert.match(plan.warnings[0], /can't animate 'progress' yet/);
});

test("a page-level timeline can drive a viewport's embedded model's 'progress' - the cross-scene 'progress' path resolves the same way any other scene property does", () => {
  const result = run(`
    scene reveal {
      model hero { src: "./hero.glb" }
    }
    page Home {
      viewport stage { scene: "reveal" }
      timeline intro {
        animate ("stage.hero") { progress -> 1 duration: 700 }
      }
    }
  `);
  const timeline = result.pages[0].timelines[0];
  assert.equal(timeline.steps[0].sceneTargetName, "hero");
  assert.equal(timeline.steps[0].changes[0].path, "progress");
});

// ---- parsing: `play CLIP on TARGET` / `stop TARGET` ------------------------

test("'play CLIP on TARGET' parses to a PlayClipStmt, distinct from plain 'play NAME'", () => {
  const result = run(`
    scene main {
      model hero { src: "./hero.glb" }
      on hero.click { play Walk on hero }
    }
  `);
  const stmt = result.scenes[0].handlers[0].body[0];
  assert.equal(stmt.kind, "PlayClipStmt");
  assert.equal(stmt.clip, "Walk");
  assert.equal(stmt.clipIsExpr, false);
  assert.equal(stmt.target, "hero");
  assert.equal(stmt.targetIsExpr, false);
});

test("plain 'play NAME' (a timeline) still parses exactly as before - no 'on' means no PlayClipStmt", () => {
  const result = run(`
    scene main {
      cube box { color: red }
      timeline intro { animate box { position.y -> 1 duration: 100 } }
      on box.click { play intro }
    }
  `);
  const stmt = result.scenes[0].handlers[0].body[0];
  assert.equal(stmt.kind, "PlayStmt");
  assert.equal(stmt.target, "intro");
});

test("a computed clip name and/or target both parse via the same parenthesized-expression convention 'animate'/'on' already use", () => {
  const result = run(`
    scene main {
      model hero { src: "./hero.glb" }
      on hero.click { play ("Wal" + "k") on (hero) }
    }
  `);
  const stmt = result.scenes[0].handlers[0].body[0];
  assert.equal(stmt.kind, "PlayClipStmt");
  assert.equal(stmt.clipIsExpr, true);
  assert.equal(stmt.targetIsExpr, true);
});

test("'stop TARGET' parses to a StopClipStmt", () => {
  const result = run(`
    scene main {
      model hero { src: "./hero.glb" }
      on hero.click { stop hero }
    }
  `);
  const stmt = result.scenes[0].handlers[0].body[0];
  assert.equal(stmt.kind, "StopClipStmt");
  assert.equal(stmt.target, "hero");
});

test("'play'/'stop' aren't build-time validated against the model's own clips (unknowable until the browser loads the file) - only parsing succeeds here", () => {
  // A bogus clip name or a target that isn't a model at all is a *runtime*
  // AxisRuntimeError (scene3d.js's requireModelClipState/reconcileClip),
  // exactly like a plain 'animate'/'play NAME' targeting a nonexistent
  // object already is - not something interpreter.js can catch at build
  // time, since it never inspects a handler body's statements at all
  // (see interpreter.js's interpretOnDecl - `body` is stored raw).
  assert.doesNotThrow(() => run(`
    scene main {
      cube notAModel { color: red }
      on notAModel.click {
        play Bogus on notAModel
        stop notAModel
      }
    }
  `));
});

// ---- components: PlayClipStmt/StopClipStmt get namespaced per instance ----

test("inside a component, 'play CLIP on TARGET'/'stop TARGET' target the *instance's* own model, not a bare name", () => {
  const result = run(`
    component Rig(src) {
      model body { src: src }
      on body.click {
        play Walk on body
        stop body
      }
    }
    scene main {
      Rig a { src: "./a.glb" }
      Rig b { src: "./b.glb" }
    }
  `);
  const [handlerA, handlerB] = result.scenes[0].handlers;
  assert.equal(handlerA.target, "a.body");
  assert.equal(handlerA.body[0].kind, "PlayClipStmt");
  assert.equal(handlerA.body[0].target, "a.body"); // namespaced to this instance, not the bare 'body' written in the component
  assert.equal(handlerA.body[0].clip, "Walk"); // a bareword clip name isn't a component-local binding, so it's untouched
  assert.equal(handlerA.body[1].kind, "StopClipStmt");
  assert.equal(handlerA.body[1].target, "a.body");

  assert.equal(handlerB.target, "b.body");
  assert.equal(handlerB.body[0].target, "b.body");
  assert.equal(handlerB.body[1].target, "b.body");
});
