// Third-Party Extension Proof: examples/third-party-extension/'s
// axis_modules/axis-tween/ package - a small, reusable value-interpolation
// package built entirely from primitives that already existed before this
// package was written (self-bound record methods, functions as first-class
// values, ordinary arithmetic), with zero changes to AXIS's own source
// (see docs/extensions.md and the "core freeze" commit in the git
// history). Tests the package directly (resolveModules + running real .ax
// snippets against its exports), the same house style as
// tests/physics-demo.test.js and tests/ecs.test.js - not through a full
// page/tick-handler simulation (tests/examples.test.js already proves the
// whole example builds; tests/browser/third-party-extension.test.js proves
// it survives the real server->browser plan-transport boundary).
//
// Every method call below runs through the real tokenizer/parser/
// evaluator (tokenize+parse+executeBlock), not a raw JS call on the
// record - a self-bound method only gets `self` bound when read via
// AXIS's own Member access, so calling it any other way would fail with
// "undefined variable 'self'".
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { resolveModules } from "../src/modules.js";
import { tokenize } from "../src/lexer.js";
import { parse } from "../src/parser.js";
import { evaluate, executeBlock } from "../src/evaluator.js";
import { createGlobalEnv } from "../src/globals.js";

const ENTRY = fileURLToPath(new URL("../examples/third-party-extension/main.ax", import.meta.url));

function tweenEnv() {
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

test("createTween starts at 'from', not yet done", () => {
  const env = run(tweenEnv(), `let t = createTween(0, 100, 2, linearEase)`);
  const t = env.get("t");
  assert.equal(t.value, 0);
  assert.equal(t.done, false);
});

test("linearEase/quadOutEase/cubicInOutEase all map 0 -> 0 and 1 -> 1 (any valid easing curve must)", () => {
  const env = run(
    tweenEnv(),
    `
    let l0 = linearEase(0)
    let l1 = linearEase(1)
    let q0 = quadOutEase(0)
    let q1 = quadOutEase(1)
    let c0 = cubicInOutEase(0)
    let c1 = cubicInOutEase(1)
  `
  );
  for (const name of ["l0", "q0", "c0"]) assert.equal(env.get(name), 0, `${name} should be 0`);
  for (const name of ["l1", "q1", "c1"]) assert.equal(env.get(name), 1, `${name} should be 1`);
});

test("linearEase is the identity everywhere - quadOutEase is not (except at the shared 0/0.5/1 crossing points a symmetric curve must pass through)", () => {
  const env = run(
    tweenEnv(),
    `
    let lin = linearEase(0.25)
    let quad = quadOutEase(0.25)
    let cubicEarly = cubicInOutEase(0.25)
    let cubicMid = cubicInOutEase(0.5)
  `
  );
  assert.equal(env.get("lin"), 0.25);
  assert.notEqual(env.get("quad"), 0.25); // quadOutEase is front-loaded, not linear
  assert.notEqual(env.get("cubicEarly"), 0.25); // cubicInOutEase eases in, not linear, away from its midpoint
  assert.equal(env.get("cubicMid"), 0.5); // a symmetric ease-in-out curve passes exactly through its own midpoint
});

test("update(dt) accumulates strictly toward 'to' across many real steps, not just once - sampled at several checkpoints", () => {
  const env = run(
    tweenEnv(),
    `
    let t = createTween(0, 100, 1, linearEase)
    let checkpoints = []
    for i in range(0, 10) {
      t.update(0.05)
      push(checkpoints, t.value)
    }
  `
  );
  const checkpoints = env.get("checkpoints");
  assert.equal(checkpoints.length, 10);
  for (let i = 1; i < checkpoints.length; i++) {
    assert.ok(checkpoints[i] > checkpoints[i - 1], `checkpoint ${i} (${checkpoints[i]}) should exceed checkpoint ${i - 1} (${checkpoints[i - 1]})`);
  }
  assert.ok(checkpoints[checkpoints.length - 1] < 100, "should not yet have reached 'to' after only half the duration");
});

test("update(dt) reaches exactly 'to' once elapsed time meets duration, and marks done", () => {
  const env = run(
    tweenEnv(),
    `
    let t = createTween(10, 50, 1, linearEase)
    for i in range(0, 20) {
      t.update(0.05)
    }
  `
  );
  const t = env.get("t");
  assert.equal(t.value, 50);
  assert.equal(t.done, true);
});

test("update(dt) never overshoots 'to', even with a dt larger than the remaining duration", () => {
  const env = run(
    tweenEnv(),
    `
    let t = createTween(0, 10, 1, linearEase)
    t.update(5)
  `
  );
  const t = env.get("t");
  assert.equal(t.value, 10);
  assert.equal(t.done, true);
});

test("once done, further update(dt) calls are no-ops - the value doesn't drift past 'to'", () => {
  const env = run(
    tweenEnv(),
    `
    let t = createTween(0, 10, 1, linearEase)
    t.update(5)
    let firstDoneValue = t.value
    for i in range(0, 5) {
      t.update(0.1)
    }
  `
  );
  assert.equal(env.get("firstDoneValue"), 10);
  const t = env.get("t");
  assert.equal(t.value, 10);
  assert.equal(t.done, true);
});

test("reset() returns a finished tween to its starting state - can run again, not just once", () => {
  const env = run(
    tweenEnv(),
    `
    let t = createTween(0, 10, 1, linearEase)
    t.update(5)
    t.reset()
    let afterReset = t.value
    let doneAfterReset = t.done
    t.update(0.5)
    let midSecondRun = t.value
  `
  );
  assert.equal(env.get("afterReset"), 0);
  assert.equal(env.get("doneAfterReset"), false);
  assert.equal(env.get("midSecondRun"), 5); // linear, half the 1s duration elapsed
});

test("a zero-or-negative duration resolves instantly to 'to', without dividing by zero into NaN", () => {
  const env = run(
    tweenEnv(),
    `
    let t = createTween(5, 25, 0, linearEase)
    t.update(0.016)
  `
  );
  const t = env.get("t");
  assert.equal(t.value, 25);
  assert.equal(t.done, true);
});

test("a custom, caller-supplied easing function works too - the package doesn't hardcode a fixed set of curves", () => {
  // A caller-authored easing (here: always fully applied, step-function
  // style) built inline with an FnExpr, not one of the package's own
  // three - proves `easing` really is an arbitrary function value, not a
  // closed set of named modes the package special-cases.
  const env = run(
    tweenEnv(),
    `
    let stepEase = fn(progress) { return 1 }
    let t = createTween(0, 40, 1, stepEase)
    t.update(0.01)
  `
  );
  assert.equal(env.get("t").value, 40);
});
