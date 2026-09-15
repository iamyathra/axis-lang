// Game-foundation phase (post-milestone directive, item 8: "be extremely
// careful here... tests must verify semantic behavior, not just formula
// equivalence"). examples/fps-controls/axis_modules/camera/'s
// makeFpsCamera is tested at two levels here:
//   - unit: does look()/lookTarget()/move() produce the numerically
//     correct result for known inputs.
//   - semantic: does a rightward mouse move actually turn the camera
//     right, not left - the exact class of bug (a flipped yaw sign) this
//     project's own audit already caught once in this same math, before
//     it was packaged (see
//     docs/architecture/2026-09-language-platform-audit.md's game-dev-
//     foundation addendum). A self-consistent-but-backwards formula would
//     pass a pure unit check and still fail this.
// Real browser integration (mouse-look + WASD + pointer lock, together,
// in a running scene) is tests/browser/camera-controller.test.js's job -
// this file is deliberately math-only, no browser needed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { resolveModules } from "../src/modules.js";
import { tokenize } from "../src/lexer.js";
import { parse } from "../src/parser.js";
import { evaluate, executeBlock } from "../src/evaluator.js";
import { createGlobalEnv } from "../src/globals.js";

const ENTRY = fileURLToPath(new URL("../examples/fps-controls/main.ax", import.meta.url));

function cameraEnv() {
  const program = resolveModules(ENTRY);
  const env = createGlobalEnv();
  for (const item of program.items) {
    if (item.kind === "LetDecl") env.define(item.name, evaluate(item.value, env), item.constant);
    if (item.kind === "FnDecl") {
      env.define(item.name, { __axisType: "function", name: item.name, params: item.params, body: item.body, closure: env, isAsync: item.isAsync });
    }
  }
  return env;
}

function run(env, src) {
  const child = env.child();
  const program = parse(tokenize(`fn __test() {\n${src}\n}`));
  executeBlock(program.items[0].body, child);
  return child;
}

test("look() with zero mouse movement leaves yaw/pitch unchanged", () => {
  const env = run(
    cameraEnv(),
    `
    let cam = makeFpsCamera({})
    cam.look(0, 0)
  `
  );
  const cam = env.get("cam");
  assert.equal(cam.yaw, 0);
  assert.equal(cam.pitch, 0);
});

test("look() accumulates yaw/pitch proportionally to dx/dy and sensitivity - unit-level formula check", () => {
  const env = run(
    cameraEnv(),
    `
    let cam = makeFpsCamera({ sensitivity: 0.5 })
    cam.look(10, 4)
  `
  );
  const cam = env.get("cam");
  assert.equal(cam.yaw, 5); // 10 * 0.5
  assert.equal(cam.pitch, -2); // -(4 * 0.5) - see the sign note just below
});

test("SEMANTIC: moving the mouse right increases yaw (turns the camera right), not left - the exact sign error this math caught once before", () => {
  const env = run(
    cameraEnv(),
    `
    let cam = makeFpsCamera({})
    cam.look(10, 0)
    let yawAfterRight = cam.yaw
  `
  );
  assert.ok(env.get("yawAfterRight") > 0, `expected a rightward mouse move (positive dx) to INCREASE yaw (turn right), got ${env.get("yawAfterRight")}`);
});

test("SEMANTIC: moving the mouse up (negative dy) increases pitch (looks up), not down", () => {
  const env = run(
    cameraEnv(),
    `
    let cam = makeFpsCamera({})
    cam.look(0, -10)
    let pitchAfterUp = cam.pitch
  `
  );
  assert.ok(env.get("pitchAfterUp") > 0, `expected moving the mouse up (negative dy) to increase pitch (look up), got ${env.get("pitchAfterUp")}`);
});

test("pitch is clamped to +/-pitchLimit even after many large look() calls in a row, not just once", () => {
  const env = run(
    cameraEnv(),
    `
    let cam = makeFpsCamera({ pitchLimit: 89, sensitivity: 1 })
    for i in range(0, 20) {
      cam.look(0, -100)
    }
    let clampedUp = cam.pitch
    for i in range(0, 40) {
      cam.look(0, 100)
    }
    let clampedDown = cam.pitch
  `
  );
  assert.equal(env.get("clampedUp"), 89);
  assert.equal(env.get("clampedDown"), -89);
});

test("lookTarget() computes a point straight ahead (yaw=0, pitch=0 means looking in -Z) relative to the camera's own position", () => {
  const env = run(
    cameraEnv(),
    `
    let cam = makeFpsCamera({})
    let target = cam.lookTarget((0, 2, 0))
  `
  );
  const target = env.get("target");
  assert.ok(Math.abs(target.x - 0) < 1e-9);
  assert.ok(Math.abs(target.y - 2) < 1e-9);
  assert.ok(target.z < 0, `expected looking straight ahead at yaw 0 to point toward -Z, got z=${target.z}`);
});

test("move() with forwardInput=1 at yaw=0 moves in -Z (forward), and accumulates correctly across many ticks", () => {
  const env = run(
    cameraEnv(),
    `
    let cam = makeFpsCamera({ speed: 4 })
    let pos = (0, 0, 0)
    for i in range(0, 60) {
      pos = cam.move(pos, 1, 0, 1.0 / 60.0)
    }
  `
  );
  const pos = env.get("pos");
  // 60 ticks at dt=1/60 is exactly 1 second at speed 4 -> 4 units forward.
  assert.ok(Math.abs(pos.x - 0) < 1e-9, `expected no sideways drift, got x=${pos.x}`);
  assert.ok(Math.abs(pos.z - -4) < 1e-6, `expected -4 on the Z axis after 1s of forward movement at speed 4, got ${pos.z}`);
});

test("SEMANTIC: after turning right 90 degrees, forwardInput=1 moves in +X, not back the way it came", () => {
  const env = run(
    cameraEnv(),
    `
    let cam = makeFpsCamera({ sensitivity: 1, speed: 4 })
    cam.look(90, 0)
    let pos = cam.move((0, 0, 0), 1, 0, 1.0)
  `
  );
  const pos = env.get("pos");
  assert.ok(pos.x > 3.9, `expected moving forward after a 90-degree right turn to go in +X, got x=${pos.x}`);
  assert.ok(Math.abs(pos.z) < 1e-6, `expected no Z movement after turning a full 90 degrees, got z=${pos.z}`);
});

test("move() with strafeInput=1 (no forward) moves sideways relative to facing, not forward", () => {
  const env = run(
    cameraEnv(),
    `
    let cam = makeFpsCamera({ speed: 4 })
    let pos = cam.move((0, 0, 0), 0, 1, 1.0)
  `
  );
  const pos = env.get("pos");
  assert.ok(pos.x > 3.9, `expected strafing right at yaw 0 to move in +X, got x=${pos.x}`);
  assert.ok(Math.abs(pos.z) < 1e-6, `expected no forward/backward movement from pure strafe, got z=${pos.z}`);
});
