// Game-foundation phase: examples/game-foundation/'s axis_modules/ecs/
// package is the actual proof of the entity/component/system design (see
// docs/architecture/2026-09-language-platform-audit.md's game-foundation
// addendum) - built with zero changes to src/, same as physics-demo/
// proved for Phase G. Tests the package directly (resolveModules + real
// AXIS source through the real evaluator), not through a full page/tick
// simulation - tests/examples.test.js already proves the whole example
// builds; this proves entity/component/system composition is actually
// correct, including across many execution cycles (this project's own
// testing philosophy).
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { resolveModules } from "../src/modules.js";
import { tokenize } from "../src/lexer.js";
import { parse } from "../src/parser.js";
import { evaluate, executeBlock } from "../src/evaluator.js";
import { createGlobalEnv } from "../src/globals.js";

const ENTRY = fileURLToPath(new URL("../examples/game-foundation/main.ax", import.meta.url));

function ecsEnv() {
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

test("makeEntity composes independent components under one entity, each reachable by its own type tag", () => {
  const env = run(
    ecsEnv(),
    `
    let e = makeEntity("thing").add(makeTransform(1, 2)).add(makeVelocity(3, 4))
    let t = e.get("Transform")
    let v = e.get("Velocity")
    let hasHealth = e.has("Health")
    let transformMatches = t == { type: "Transform", x: 1, y: 2 }
    let velocityMatches = v == { type: "Velocity", vx: 3, vy: 4 }
  `
  );
  assert.equal(env.get("transformMatches"), true);
  assert.equal(env.get("velocityMatches"), true);
  assert.equal(env.get("hasHealth"), false);
});

test("makeWorld.spawn assigns each entity a distinct, stable id - identity that survives structurally-identical components", () => {
  // Two entities with IDENTICAL component data - deliberately, since
  // AXIS's own '==' is structural (deepEqual), not reference identity.
  // If spawn's id-minting were broken, these two would be indistinguishable
  // and destroying one could accidentally remove the other.
  const env = run(
    ecsEnv(),
    `
    let world = makeWorld()
    let a = world.spawn(makeEntity("dup").add(makeTransform(0, 0)))
    let b = world.spawn(makeEntity("dup").add(makeTransform(0, 0)))
    let idsDistinct = a.id != b.id
    world.destroy(a.id)
    let remaining = len(world.entities)
    let survivorId = world.entities[0].id
  `
  );
  assert.equal(env.get("idsDistinct"), true);
  assert.equal(env.get("remaining"), 1, "expected destroying entity a to leave exactly entity b, not both or neither");
  assert.equal(env.get("survivorId"), env.get("b").id, "expected the SURVIVING entity to be b specifically, not whichever one happened to remain");
});

test("a component's dispose() runs exactly once when its entity is destroyed - cleanup, not just removal from the list", () => {
  const env = run(
    ecsEnv(),
    `
    let world = makeWorld()
    let disposeCalls = []
    let e = makeEntity("withResource")
    let resource = { type: "Resource" }
    resource.dispose = fn() { push(disposeCalls, "disposed") }
    e.add(resource)
    world.spawn(e)
    world.destroy(e.id)
    let count = len(disposeCalls)
  `
  );
  assert.equal(env.get("count"), 1);
});

test("movementSystem accumulates position correctly across many ticks (not merely 'position changed once')", () => {
  const env = run(
    ecsEnv(),
    `
    let world = makeWorld()
    let e = world.spawn(makeEntity("mover").add(makeTransform(0, 0)).add(makeVelocity(10, -5)))
    let checkpoints = []
    for i in range(0, 3) {
      for j in range(0, 30) {
        runSystems([movementSystem], world, 1.0 / 60.0)
      }
      let t = e.get("Transform")
      push(checkpoints, (t.x, t.y))
    }
  `
  );
  const checkpoints = env.get("checkpoints");
  assert.equal(checkpoints.length, 3);
  // Each half-second block of 30 ticks at dt=1/60 covers exactly 0.5s of
  // simulated time - x should be at 5, 10, 15 (not reset to 5 every block,
  // which a movementSystem that mutated a copy instead of the real
  // component record would produce).
  for (let i = 0; i < 3; i++) {
    const expectedX = 5 * (i + 1);
    const expectedY = -2.5 * (i + 1);
    assert.ok(Math.abs(checkpoints[i].x - expectedX) < 0.01, `checkpoint ${i}: expected x near ${expectedX}, got ${checkpoints[i].x}`);
    assert.ok(Math.abs(checkpoints[i].y - expectedY) < 0.01, `checkpoint ${i}: expected y near ${expectedY}, got ${checkpoints[i].y}`);
  }
});

test("healthSystem destroys an entity once its Health reaches zero, and it STAYS destroyed across many further ticks", () => {
  const env = run(
    ecsEnv(),
    `
    let world = makeWorld()
    let e = world.spawn(makeEntity("mortal").add(makeHealth(10)))
    e.get("Health").damage(10)
    let aliveCounts = []
    for i in range(0, 5) {
      runSystems([healthSystem], world, 1.0 / 60.0)
      push(aliveCounts, len(world.entities))
    }
  `
  );
  // Not just "eventually 0" - 0 at every single one of 5 subsequent ticks,
  // ruling out a bug where destroy() only removes it for one tick and a
  // stale reference somewhere re-adds it (this project's own "accumulated
  // correctly across many cycles" testing standard).
  assert.deepEqual(env.get("aliveCounts"), [0, 0, 0, 0, 0]);
});

test("movementSystem running before healthSystem (ordering matters): a particle that dies this frame has still moved this frame", () => {
  const env = run(
    ecsEnv(),
    `
    let world = makeWorld()
    let e = world.spawn(makeEntity("dying").add(makeTransform(0, 0)).add(makeVelocity(100, 0)).add(makeHealth(1)))
    e.get("Health").damage(1)
    runSystems([movementSystem, healthSystem], world, 1.0)
    let xAfterDeath = e.get("Transform").x
    let aliveAfter = len(world.entities)
  `
  );
  assert.equal(env.get("xAfterDeath"), 100, "expected movementSystem to have moved the entity this same frame, before healthSystem removed it from the world");
  assert.equal(env.get("aliveAfter"), 0, "expected the entity to be destroyed by healthSystem in the same runSystems call it moved in");
});
