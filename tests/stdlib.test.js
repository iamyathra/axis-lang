// The array/string/record stdlib expansion (Phase A of the general-purpose-
// language pivot - see docs/architecture/2026-09-language-platform-audit.md).
// Same harness style as evaluator.test.js: real source through the real
// tokenizer/parser/evaluator, not mocked builtins.
import { test } from "node:test";
import assert from "node:assert/strict";
import { tokenize } from "../src/lexer.js";
import { parse } from "../src/parser.js";
import { executeBlock, AxisRuntimeError } from "../src/evaluator.js";
import { createGlobalEnv } from "../src/globals.js";

function run(src, env = createGlobalEnv().child()) {
  const program = parse(tokenize(`fn __main() {\n${src}\n}`));
  executeBlock(program.items[0].body, env);
  return env;
}

function value(src) {
  const env = run(`let __result = ${src}`);
  return env.get("__result");
}

// ---- arrays ---------------------------------------------------------------

test("push/pop/shift/unshift mutate in place and return what JS's own do", () => {
  const env = run(`
    let arr = [1, 2, 3]
    let pushedLen = push(arr, 4)
    let popped = pop(arr)
    let shifted = shift(arr)
    let unshiftedLen = unshift(arr, 0)
  `);
  assert.equal(env.get("pushedLen"), 4);
  assert.equal(env.get("popped"), 4);
  assert.equal(env.get("shifted"), 1);
  assert.equal(env.get("unshiftedLen"), 3);
  assert.deepEqual(env.get("arr"), [0, 2, 3]);
});

test("pop/shift on an empty array is a clear error, not undefined", () => {
  assert.throws(() => run("pop([])"), AxisRuntimeError);
  assert.throws(() => run("shift([])"), AxisRuntimeError);
});

test("map/filter/find/some/every call a single-argument callback", () => {
  assert.deepEqual(value("map([1, 2, 3], fn(x) { return x * 2 })"), [2, 4, 6]);
  assert.deepEqual(value("filter([1, 2, 3, 4], fn(x) { return x % 2 == 0 })"), [2, 4]);
  assert.equal(value("find([1, 2, 3], fn(x) { return x > 1 })"), 2);
  assert.equal(value("find([1, 2, 3], fn(x) { return x > 10 })"), null);
  assert.equal(value("some([1, 2, 3], fn(x) { return x > 2 })"), true);
  assert.equal(value("every([1, 2, 3], fn(x) { return x > 0 })"), true);
  assert.equal(value("every([1, 2, 3], fn(x) { return x > 1 })"), false);
});

test("a callback with the wrong arity is a clear error, same as calling it directly would be", () => {
  assert.throws(() => run("map([1, 2], fn(x, i) { return x })"), AxisRuntimeError);
});

test("reduce passes (accumulator, item) and starts from the given initial value", () => {
  assert.equal(value("reduce([1, 2, 3, 4], fn(acc, x) { return acc + x }, 0)"), 10);
  assert.equal(value(`reduce(["a", "b", "c"], fn(acc, x) { return acc + x }, "")`), "abc");
});

test("reverse/sort/sortBy are pure - they return a new array, the original is untouched", () => {
  const env = run(`
    let original = [3, 1, 2]
    let reversed = reverse(original)
    let sorted = sort(original)
  `);
  assert.deepEqual(env.get("reversed"), [2, 1, 3]);
  assert.deepEqual(env.get("sorted"), [1, 2, 3]);
  assert.deepEqual(env.get("original"), [3, 1, 2]); // unchanged
});

test("sort works on strings lexicographically", () => {
  assert.deepEqual(value(`sort(["banana", "apple", "cherry"])`), ["apple", "banana", "cherry"]);
});

test("sort on a mixed-type array is a clear error, not a silent wrong order", () => {
  assert.throws(() => run(`sort([1, "two", 3])`), AxisRuntimeError);
});

test("sortBy orders by a key function's result, not the elements themselves", () => {
  const env = run(`
    let people = [{name: "Bea", age: 30}, {name: "Al", age: 20}]
    let byAge = sortBy(people, fn(p) { return p.age })
  `);
  assert.deepEqual(
    env.get("byAge").map((p) => p.name),
    ["Al", "Bea"]
  );
});

test("join stringifies non-string elements", () => {
  assert.equal(value(`join(["a", "b", "c"], ", ")`), "a, b, c");
  assert.equal(value(`join([1, 2, 3], "-")`), "1-2-3");
});

test("slice works on both arrays and strings, end is optional", () => {
  assert.deepEqual(value("slice([1, 2, 3, 4, 5], 1, 3)"), [2, 3]);
  assert.deepEqual(value("slice([1, 2, 3, 4, 5], 2)"), [3, 4, 5]);
  assert.equal(value(`slice("hello world", 0, 5)`), "hello");
});

test("indexOf/includes work on both arrays (by value) and strings (by substring)", () => {
  assert.equal(value("indexOf([10, 20, 30], 20)"), 1);
  assert.equal(value("indexOf([10, 20, 30], 99)"), -1);
  assert.equal(value(`indexOf("hello", "ll")`), 2);
  assert.equal(value("includes([1, 2, 3], 2)"), true);
  assert.equal(value(`includes("hello world", "wor")`), true);
  assert.equal(value(`includes("hello", "xyz")`), false);
});

test("indexOf/includes compare array elements deeply, e.g. records and vectors", () => {
  assert.equal(value(`indexOf([{x: 1}, {x: 2}], {x: 2})`), 1);
  assert.equal(value("includes([(1, 2), (3, 4)], (3, 4))"), true);
});

// ---- strings ----------------------------------------------------------

test("split/trim/upper/lower/startsWith/endsWith", () => {
  assert.deepEqual(value(`split("a,b,c", ",")`), ["a", "b", "c"]);
  assert.equal(value(`trim("  hi  ")`), "hi");
  assert.equal(value(`upper("hi")`), "HI");
  assert.equal(value(`lower("HI")`), "hi");
  assert.equal(value(`startsWith("hello", "he")`), true);
  assert.equal(value(`endsWith("hello", "lo")`), true);
});

test("replace replaces every occurrence, not just the first", () => {
  assert.equal(value(`replace("a-b-c", "-", "_")`), "a_b_c");
});

test("replace rejects an empty search string instead of looping forever", () => {
  assert.throws(() => run(`replace("abc", "", "x")`), AxisRuntimeError);
});

// ---- records ------------------------------------------------------------

test("values/entries/has/merge", () => {
  const env = run(`
    let point = {x: 1, y: 2}
    let vals = values(point)
    let pairs = entries(point)
    let hasX = has(point, "x")
    let hasZ = has(point, "z")
    let merged = merge(point, {y: 99, z: 3})
  `);
  assert.deepEqual(env.get("vals"), [1, 2]);
  assert.equal(env.get("pairs").length, 2);
  assert.equal(env.get("pairs")[0].key, "x");
  assert.equal(env.get("pairs")[0].value, 1);
  assert.equal(env.get("hasX"), true);
  assert.equal(env.get("hasZ"), false);
  assert.deepEqual({ x: env.get("merged").x, y: env.get("merged").y, z: env.get("merged").z }, { x: 1, y: 99, z: 3 });
});

test("merge doesn't mutate either input", () => {
  const env = run(`
    let a = {x: 1}
    let b = {x: 2}
    let merged = merge(a, b)
  `);
  assert.equal(env.get("a").x, 1);
  assert.equal(env.get("b").x, 2);
  assert.equal(env.get("merged").x, 2);
});

test("has/values/entries/merge reject a non-record the same way keys/get already do", () => {
  assert.throws(() => run(`values([1, 2])`), AxisRuntimeError);
  assert.throws(() => run(`merge({x: 1}, [1])`), AxisRuntimeError);
});
