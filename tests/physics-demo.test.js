// Phase G of the general-purpose-language pivot: examples/physics-demo/'s
// axis_modules/physics2d/ package is the actual test of the pivot's
// thesis - built entirely from primitives that already existed (on tick's
// dt, self-bound record methods, ordinary math), with zero changes to
// AXIS's own source. This tests the package directly (resolveModules +
// running real .ax snippets against its exports), not through a full
// page/tick-handler simulation - tests/examples.test.js already proves the
// whole example builds; this proves the physics itself is actually
// correct.
//
// Every method call below runs through the real tokenizer/parser/
// evaluator (tokenize+parse+executeBlock), not a raw JS `.step(...)` call
// on the record - a body's methods only get `self` bound when read via
// AXIS's own Member access (evaluator.js's getMember), so calling them any
// other way would fail with "undefined variable 'self'". Reading a plain
// data field back afterward (`body.y`) is fine either way - only a
// function-valued field's *access* is special.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { resolveModules } from "../src/modules.js";
import { tokenize } from "../src/lexer.js";
import { parse } from "../src/parser.js";
import { evaluate, executeBlock } from "../src/evaluator.js";
import { createGlobalEnv } from "../src/globals.js";

const ENTRY = fileURLToPath(new URL("../examples/physics-demo/main.ax", import.meta.url));

// resolveModules needs a real .ax file to resolve imports *from* - reuses
// the actual example's own entry file (so this test breaks if the example
// and the package ever drift apart) rather than hand-rolling a duplicate
// fixture. Only pulls GRAVITY/makeBody into a fresh global env - mirrors
// interpret()'s own top-level FnDecl/LetDecl handling, not a copy of its
// full page-building logic.
function physicsEnv() {
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

// Runs real AXIS source against a child of `env`, returns that child env
// so the caller can read back whatever `let`s the source declared.
function run(env, src) {
  const child = env.child();
  const program = parse(tokenize(`fn __test() {\n${src}\n}`));
  executeBlock(program.items[0].body, child);
  return child;
}

test("a body falls under gravity - y and vy both increase over time", () => {
  const env = run(
    physicsEnv(),
    `
    let body = makeBody(0, 0, 0, 0)
    for i in range(0, 30) {
      body.step(1.0 / 60.0, GRAVITY)
    }
  `
  );
  const body = env.get("body");
  assert.ok(body.y > 0, "expected the body to have fallen");
  assert.ok(body.vy > 0, "expected downward velocity to have built up");
});

test("bounceFloor clamps the body to the floor and reflects velocity, damped by restitution", () => {
  const env = run(
    physicsEnv(),
    `
    let body = makeBody(0, 300, 0, 100)
    body.bounceFloor(276, 0.75)
  `
  );
  const body = env.get("body");
  assert.equal(body.y, 276);
  assert.equal(body.vy, -75); // -100 * 0.75
});

test("bounceFloor is a no-op above the floor - a body mid-air doesn't get clamped early", () => {
  const env = run(
    physicsEnv(),
    `
    let body = makeBody(0, 100, 0, 50)
    body.bounceFloor(276, 0.75)
  `
  );
  const body = env.get("body");
  assert.equal(body.y, 100);
  assert.equal(body.vy, 50);
});

test("bounceWalls reflects off both the left and right bound, damped by restitution", () => {
  const env = run(
    physicsEnv(),
    `
    let right = makeBody(400, 0, 120, 0)
    right.bounceWalls(0, 376, 0.9)
    let left = makeBody(-10, 0, -60, 0)
    left.bounceWalls(0, 376, 0.9)
  `
  );
  assert.equal(env.get("right").x, 376);
  assert.equal(env.get("right").vx, -108); // -120 * 0.9
  assert.equal(env.get("left").x, 0);
  assert.equal(env.get("left").vx, 54); // -(-60) * 0.9
});

test("a dropped body eventually settles near the floor - gravity + damped bouncing converges, doesn't diverge", () => {
  // Same three calls examples/physics-demo/main.ax's own 'on tick' makes.
  const env = run(
    physicsEnv(),
    `
    let body = makeBody(0, 0, 0, 0)
    for i in range(0, 600) {
      body.step(1.0 / 60.0, GRAVITY)
      body.bounceFloor(276, 0.75)
      body.bounceWalls(0, 376, 0.9)
    }
  `
  );
  const body = env.get("body");
  assert.ok(Math.abs(body.y - 276) < 5, `expected the body to have settled near the floor (276), got ${body.y}`);
  assert.ok(Math.abs(body.vy) < 50, `expected residual velocity to have damped out, got ${body.vy}`);
});
