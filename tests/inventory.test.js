// Third-Party Extension Proof: examples/third-party-extension/'s
// axis_modules/axis-inventory/ package - a small, reusable stack-based
// item tracker, the second of two independently-authored packages proving
// the same architecture generalizes (see docs/extensions.md). Built
// entirely from self-bound record methods, arrays, and the stdlib's
// map/filter/reduce, with zero changes to AXIS's own source. Same house
// style as tests/physics-demo.test.js and tests/tween.test.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { resolveModules } from "../src/modules.js";
import { tokenize } from "../src/lexer.js";
import { parse } from "../src/parser.js";
import { evaluate, executeBlock } from "../src/evaluator.js";
import { createGlobalEnv } from "../src/globals.js";

const ENTRY = fileURLToPath(new URL("../examples/third-party-extension/main.ax", import.meta.url));

function inventoryEnv() {
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

test("a fresh inventory has no items and a total count of zero", () => {
  const env = run(
    inventoryEnv(),
    `
    let inv = createInventory()
    let gold = inv.countOf("gold")
    let total = inv.totalCount()
    let has = inv.hasItem("gold", 1)
  `
  );
  assert.equal(env.get("gold"), 0);
  assert.equal(env.get("total"), 0);
  assert.equal(env.get("has"), false);
});

test("addItem accumulates strictly across many repeated calls, not just once", () => {
  const env = run(
    inventoryEnv(),
    `
    let inv = createInventory()
    let checkpoints = []
    for i in range(0, 5) {
      inv.addItem("gold", 3)
      push(checkpoints, inv.countOf("gold"))
    }
  `
  );
  assert.deepEqual(env.get("checkpoints"), [3, 6, 9, 12, 15]);
});

test("addItem on a brand new item name creates a new entry alongside existing ones", () => {
  const env = run(
    inventoryEnv(),
    `
    let inv = createInventory()
    inv.addItem("gold", 10)
    inv.addItem("potion", 2)
    let gold = inv.countOf("gold")
    let potion = inv.countOf("potion")
    let total = inv.totalCount()
  `
  );
  assert.equal(env.get("gold"), 10);
  assert.equal(env.get("potion"), 2);
  assert.equal(env.get("total"), 12);
});

test("removeItem decreases the count and returns true when there's enough", () => {
  const env = run(
    inventoryEnv(),
    `
    let inv = createInventory()
    inv.addItem("gold", 10)
    let ok = inv.removeItem("gold", 4)
    let remaining = inv.countOf("gold")
  `
  );
  assert.equal(env.get("ok"), true);
  assert.equal(env.get("remaining"), 6);
});

test("removeItem fails cleanly (returns false, no mutation) when there isn't enough, rather than going negative", () => {
  const env = run(
    inventoryEnv(),
    `
    let inv = createInventory()
    inv.addItem("gold", 3)
    let ok = inv.removeItem("gold", 10)
    let remaining = inv.countOf("gold")
  `
  );
  assert.equal(env.get("ok"), false);
  assert.equal(env.get("remaining"), 3);
});

test("removeItem fails cleanly on an item that was never added at all", () => {
  const env = run(
    inventoryEnv(),
    `
    let inv = createInventory()
    let ok = inv.removeItem("nonexistent", 1)
  `
  );
  assert.equal(env.get("ok"), false);
});

test("removing exactly all of an item drops it from the list entirely, not a lingering zero-quantity entry", () => {
  const env = run(
    inventoryEnv(),
    `
    let inv = createInventory()
    inv.addItem("gold", 5)
    inv.removeItem("gold", 5)
    let items = inv.listItems()
    let count = inv.countOf("gold")
  `
  );
  assert.equal(env.get("items").length, 0);
  assert.equal(env.get("count"), 0);
});

test("multiple item kinds are tracked independently across many add/remove cycles - state evolves correctly, not just once", () => {
  const env = run(
    inventoryEnv(),
    `
    let inv = createInventory()
    let goldCheckpoints = []
    let potionCheckpoints = []
    for i in range(0, 4) {
      inv.addItem("gold", 5)
      inv.addItem("potion", 1)
      push(goldCheckpoints, inv.countOf("gold"))
      push(potionCheckpoints, inv.countOf("potion"))
    }
    inv.removeItem("gold", 8)
    let goldAfterSpend = inv.countOf("gold")
    let total = inv.totalCount()
  `
  );
  assert.deepEqual(env.get("goldCheckpoints"), [5, 10, 15, 20]);
  assert.deepEqual(env.get("potionCheckpoints"), [1, 2, 3, 4]);
  assert.equal(env.get("goldAfterSpend"), 12);
  assert.equal(env.get("total"), 12 + 4); // 12 gold + 4 potions
});

test("hasItem reflects the current quantity threshold correctly, including at the exact boundary", () => {
  const env = run(
    inventoryEnv(),
    `
    let inv = createInventory()
    inv.addItem("gold", 5)
    let exact = inv.hasItem("gold", 5)
    let tooMany = inv.hasItem("gold", 6)
    let lessThanHave = inv.hasItem("gold", 4)
  `
  );
  assert.equal(env.get("exact"), true);
  assert.equal(env.get("tooMany"), false);
  assert.equal(env.get("lessThanHave"), true);
});

test("listItems reflects the inventory's current state after each mutation, checked at several points, not just once", () => {
  const env = run(
    inventoryEnv(),
    `
    let inv = createInventory()
    inv.addItem("gold", 5)
    let afterFirst = inv.listItems()
    inv.addItem("gold", 5)
    let afterSecond = inv.listItems()
    inv.addItem("potion", 1)
    let afterThird = inv.listItems()
  `
  );
  assert.equal(env.get("afterFirst").length, 1);
  assert.equal(env.get("afterFirst")[0].qty, 5);
  assert.equal(env.get("afterSecond")[0].qty, 10);
  assert.equal(env.get("afterThird").length, 2);
});
