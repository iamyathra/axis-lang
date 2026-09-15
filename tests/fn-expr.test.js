// Anonymous function expressions - `fn(x) { ... }` usable anywhere an
// expression is, not just as a top-level named `fn` declaration. Added
// alongside the array/string/record stdlib (tests/stdlib.test.js) since
// map/filter/reduce/etc. need a way to write a callback inline - see
// docs/architecture/2026-09-language-platform-audit.md.
import { test } from "node:test";
import assert from "node:assert/strict";
import { tokenize } from "../src/lexer.js";
import { parse } from "../src/parser.js";
import { executeBlock, executeBlockAsync, AxisRuntimeError } from "../src/evaluator.js";
import { createGlobalEnv } from "../src/globals.js";
import { formatSource } from "../src/format.js";
import { AxisFormatError } from "../src/format.js";

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

test("a bare 'fn(...) { ... }' expression is a real closure, callable like any other function value", () => {
  const env = run(`
    let double = fn(x) { return x * 2 }
    let result = double(21)
  `);
  assert.equal(env.get("result"), 42);
});

test("an inline fn expression closes over its enclosing scope, not just its own params", () => {
  const env = run(`
    let factor = 10
    let scaled = fn(x) { return x * factor }
    let result = scaled(5)
  `);
  assert.equal(env.get("result"), 50);
});

test("an inline fn expression can be passed directly as a call argument, no 'let' needed", () => {
  assert.equal(value("map([1, 2, 3], fn(x) { return x + 1 })[2]"), 4);
});

test("an inline fn expression has the same fixed-arity call checking a named fn does", () => {
  assert.throws(() => run(`let f = fn(x) { return x }\nf(1, 2)`), AxisRuntimeError);
});

test("'async fn(...) { ... }' as an expression can 'await' inside its own body", async () => {
  // 'delayed' is itself a 'let'-bound inline fn expression, not a nested
  // named 'fn' declaration - AXIS doesn't support declaring a named
  // function inside another function's body (only at the top level of a
  // program), a pre-existing limitation this test isn't about.
  const env = await runAsync(`
    let delayed = async fn() { return 5 }
    let wrapped = async fn() { return await delayed() + 1 }
    let result = await wrapped()
  `);
  assert.equal(env.get("result"), 6);
});

test("calling an async inline fn expression synchronously is refused, same as a named async fn", () => {
  assert.throws(() => run(`let f = async fn() { return 1 }\nf()`), AxisRuntimeError);
});

test("axis fmt round-trips a single-statement inline fn expression", () => {
  const src = `fn main() {\n    let double = fn(x) { return x * 2 }\n}\n`;
  const formatted = formatSource(src);
  assert.equal(formatted, src);
  assert.equal(formatSource(formatted), formatted); // idempotent
});

test("axis fmt refuses a multi-statement inline fn expression rather than mis-formatting it", () => {
  const src = `fn main() {\n  let f = fn(x) {\n    let y = x * 2\n    return y\n  }\n}\n`;
  assert.throws(() => formatSource(src), AxisFormatError);
});
