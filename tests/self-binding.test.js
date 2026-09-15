// Phase E of the general-purpose-language pivot: giving a record's own
// function fields a way to reference the record they belong to. No new
// syntax - `self` is bound automatically, at the moment a function is read
// off a record via '.', not at call time (see evaluator.js's getMember).
// See docs/architecture/2026-09-language-platform-audit.md and
// docs/language.md's "Data with behavior" section.
import { test } from "node:test";
import assert from "node:assert/strict";
import { tokenize } from "../src/lexer.js";
import { parse } from "../src/parser.js";
import { executeBlock, executeBlockAsync, AxisRuntimeError } from "../src/evaluator.js";
import { createGlobalEnv } from "../src/globals.js";
import { interpret } from "../src/interpreter.js";

function run(src, env = createGlobalEnv().child()) {
  const program = parse(tokenize(`fn __main() {\n${src}\n}`));
  executeBlock(program.items[0].body, env);
  return env;
}

async function runAsync(src, env = createGlobalEnv().child()) {
  const program = parse(tokenize(`async fn __main() {\n${src}\n}`));
  await executeBlockAsync(program.items[0].body, env);
  return env;
}

function value(src) {
  return run(`let __result = ${src}`).get("__result");
}

test("a record's own function field can read and mutate the record via 'self'", () => {
  const env = run(`
    let counter = {
      value: 0,
      increment: fn() { self.value = self.value + 1 },
      reset: fn() { self.value = 0 }
    }
    counter.increment()
    counter.increment()
    counter.increment()
    counter.reset()
    counter.increment()
  `);
  assert.equal(env.get("counter").value, 1);
});

test("self binding happens at access time, not call time - a detached reference stays correctly bound", () => {
  const env = run(`
    let counter = { value: 10, increment: fn() { self.value = self.value + 1 } }
    let detached = counter.increment
    detached()
    detached()
  `);
  assert.equal(env.get("counter").value, 12);
});

test("merge(a, b).method() sees the merged record as self, not the one that originally defined the field", () => {
  const env = run(`
    let a = { value: 1, describe: fn() { return self.value } }
    let merged = merge(a, { value: 99 })
    let result = merged.describe()
  `);
  assert.equal(env.get("result"), 99);
  // 'a' itself is untouched - self-binding never mutates the original record
  assert.equal(env.get("a").value, 1);
});

test("a method can call a sibling method on the same record via self", () => {
  const env = run(`
    let health = {
      value: 100,
      damage: fn(amount) { self.value = self.value - amount },
      isDead: fn() { return self.value <= 0 }
    }
    health.damage(150)
    let dead = health.isDead()
  `);
  assert.equal(env.get("dead"), true);
});

test("a plain (non-function) record field is completely unaffected", () => {
  assert.equal(value(`{ x: 1, y: 2 }.x`), 1);
});

test("a native builtin stored on a record (e.g. api.get) still works, unaffected by self-binding", async () => {
  // 'api' (globals.js) is a record whose fields are plain JS functions, not
  // AXIS function values - getMember's self-binding only ever wraps an
  // AXIS-defined function (one with a real .closure), so this must be a
  // no-op for api.get/post/etc. If self-binding had mistakenly wrapped it,
  // calling it would throw about a missing .closure instead of an ordinary
  // network failure.
  await assert.rejects(() => runAsync(`await api.get("http://example.invalid")`), /fetch failed/);
});

test("'self' isn't defined outside of a record method's own body", () => {
  assert.throws(() => run(`let x = self`), /undefined variable 'self'/);
});

test("an inline fn expression stored in a record works exactly like a named one", () => {
  const env = run(`
    let cell = { value: 5 }
    cell.double = fn() { return self.value * 2 }
    let result = cell.double()
  `);
  assert.equal(env.get("result"), 10);
});

test("self-binding works inside an async record method too", async () => {
  const env = await runAsync(`
    let task = {
      status: "pending",
      finish: async fn() { self.status = "done" }
    }
    await task.finish()
  `);
  assert.equal(env.get("task").status, "done");
});

test("self-binding works the same way inside a page's 'on' handler, not just plain functions", () => {
  const program = parse(
    tokenize(`
      page Home {
        state health = { value: 100, damage: fn(amount) { self.value = self.value - amount } }
        button hit { label: "Hit" }
        on hit.click {
          health.damage(10)
        }
      }
    `)
  );
  // Just needs to build without error - proves the grammar/evaluator
  // accept 'self' inside a page's own reactive/handler machinery, which
  // shares evaluator.js's evaluate/execute with plain functions.
  const { pages } = interpret(program);
  assert.equal(pages.length, 1);
});
