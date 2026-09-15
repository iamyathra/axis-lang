import { test } from "node:test";
import assert from "node:assert/strict";
import { tokenize } from "../src/lexer.js";
import { parse } from "../src/parser.js";
import { evaluate, executeBlock, Environment, AxisRuntimeError, makeVector } from "../src/evaluator.js";
import { createGlobalEnv } from "../src/globals.js";

function parseExpr(src) {
  // wrap in a let so we can reuse the full statement grammar to get an expression
  const program = parse(tokenize(`let __x = ${src}`));
  return program.items[0].value;
}

function evalExpr(src, env = createGlobalEnv().child()) {
  return evaluate(parseExpr(src), env);
}

function run(src, env = createGlobalEnv().child()) {
  const program = parse(tokenize(`fn __main() {\n${src}\n}`));
  const fn = program.items[0];
  executeBlock(fn.body, env);
  return env;
}

test("evaluates arithmetic with correct precedence", () => {
  assert.equal(evalExpr("1 + 2 * 3"), 7);
  assert.equal(evalExpr("(1 + 2) * 3"), 9);
  assert.equal(evalExpr("10 % 3"), 1);
});

test("'null' is a real literal - falsy, equal to itself, distinct from any other value", () => {
  assert.equal(evalExpr("null"), null);
  assert.equal(evalExpr("null == null"), true);
  assert.equal(evalExpr("null != 0"), true);
  assert.equal(evalExpr("!null"), true); // falsy
  const env = createGlobalEnv().child();
  env.define("x", null);
  assert.equal(evalExpr("x == null", env), true);
});

test("evaluates comparisons and logical operators", () => {
  assert.equal(evalExpr("1 < 2"), true);
  assert.equal(evalExpr("2 <= 2"), true);
  assert.equal(evalExpr("true && false"), false);
  assert.equal(evalExpr("true || false"), true);
  assert.equal(evalExpr("!true"), false);
});

test("&& and || short-circuit", () => {
  const env = createGlobalEnv().child();
  env.define("calls", []);
  env.define("sideEffect", (args) => {
    env.get("calls").push(args[0]);
    return args[0];
  });
  evalExpr("false && sideEffect(true)", env);
  assert.deepEqual(env.get("calls"), []);
  evalExpr("true || sideEffect(true)", env);
  assert.deepEqual(env.get("calls"), []);
});

test("string concatenation coerces the other operand", () => {
  assert.equal(evalExpr('"n=" + 5'), "n=5");
});

test("vector arithmetic is component-wise", () => {
  const env = createGlobalEnv().child();
  const v = evalExpr("(1, 2, 3) + (1, 1, 1)", env);
  assert.equal(v.x, 2);
  assert.equal(v.y, 3);
  assert.equal(v.z, 4);
  const scaled = evalExpr("(1, 2, 3) * 2", env);
  assert.equal(scaled.x, 2);
  assert.equal(scaled.z, 6);
});

test("member access reads vector components", () => {
  assert.equal(evalExpr("(1, 2, 3).y"), 2);
});

test("arrays support indexing and length via len()", () => {
  const env = createGlobalEnv().child();
  assert.equal(evalExpr("[10, 20, 30][1]", env), 20);
  assert.equal(evalExpr("len([1, 2, 3])", env), 3);
});

test("undefined variable throws with a suggestion", () => {
  const env = createGlobalEnv().child();
  env.define("boxCount", 5);
  assert.throws(() => evalExpr("boxCont", env), /undefined variable 'boxCont'.*boxCount/);
});

test("const reassignment throws", () => {
  const env = createGlobalEnv().child();
  assert.throws(() => run("const x = 1\nx = 2", env), /can't assign to 'x'/);
});

test("if/else executes the right branch", () => {
  const env = createGlobalEnv().child();
  run("let x = 0\nif (1 < 2) { x = 1 } else { x = 2 }", env);
  assert.equal(env.get("x"), 1);
});

test("while loop counts down", () => {
  const env = createGlobalEnv().child();
  run("let n = 3\nlet total = 0\nwhile (n > 0) { total = total + n\nn = n - 1 }", env);
  assert.equal(env.get("total"), 6);
});

test("for-in iterates an array and range()", () => {
  const env = createGlobalEnv().child();
  run("let total = 0\nfor i in range(0, 4) { total = total + i }", env);
  assert.equal(env.get("total"), 6);
});

test("functions return values and create their own scope", () => {
  const globalEnv = createGlobalEnv();
  const program = parse(tokenize(`
    fn double(x) { return x * 2 }
  `));
  globalEnv.define("double", { __axisType: "function", name: "double", params: ["x"], body: program.items[0].body, closure: globalEnv });
  assert.equal(evalExpr("double(21)", globalEnv.child()), 42);
});

test("calling a function with the wrong number of args throws", () => {
  const globalEnv = createGlobalEnv();
  globalEnv.define("f", { __axisType: "function", name: "f", params: ["a", "b"], body: [], closure: globalEnv });
  assert.throws(() => evalExpr("f(1)", globalEnv.child()), /expects 2 argument/);
});

test("assigning into a vector's field mutates it in place", () => {
  const env = createGlobalEnv().child();
  env.define("v", makeVector([1, 2, 3]));
  run("v.x = 9", env);
  assert.equal(env.get("v").x, 9);
});

test("a mutable variable in a shared parent env persists across separate executeBlock calls", () => {
  // this is the exact mechanism the browser runtime relies on for an
  // `on click` handler to hold state (a counter, a toggle) between clicks:
  // one shared "scene" env holds the `let`, and each call gets its own
  // throwaway child scope, but assigning to the shared name walks up and
  // mutates the shared env in place.
  const sceneEnv = createGlobalEnv().child();
  sceneEnv.define("clicks", 0);

  const handlerBody = parse(tokenize("fn __handler() { clicks = clicks + 1 }")).items[0].body;
  executeBlock(handlerBody, sceneEnv.child());
  executeBlock(handlerBody, sceneEnv.child());
  executeBlock(handlerBody, sceneEnv.child());

  assert.equal(sceneEnv.get("clicks"), 3);
});

test("a const in the shared parent env can't be mutated by a later executeBlock call", () => {
  const sceneEnv = createGlobalEnv().child();
  sceneEnv.define("limit", 10, true);
  const body = parse(tokenize("fn __handler() { limit = 20 }")).items[0].body;
  assert.throws(() => executeBlock(body, sceneEnv.child()), /can't assign to 'limit'/);
});

test("assigning into an array index mutates it in place", () => {
  const env = createGlobalEnv().child();
  env.define("arr", [1, 2, 3]);
  run("arr[1] = 99", env);
  assert.deepEqual(env.get("arr"), [1, 99, 3]);
});

test("a record literal evaluates to a value with readable fields", () => {
  const record = evalExpr(`{ name: "Earth" radius: 1 }`);
  assert.equal(record.name, "Earth");
  assert.equal(record.radius, 1);
});

test("reading a missing field on a record is a clear error with a suggestion", () => {
  const env = createGlobalEnv().child();
  env.define("planet", evalExpr(`{ name: "Earth" }`));
  assert.throws(() => evaluate(parseExpr("planet.nam"), env), /doesn't have a '\.nam' field.*did you mean 'name'/s);
});

test("typeName/str on a record", () => {
  assert.equal(evalExpr(`str({ a: 1 })`), "{a: 1}");
});

test("two records compare equal by structure, not identity", () => {
  const env = createGlobalEnv().child();
  assert.equal(evaluate(parseExpr(`{ a: 1, b: 2 } == { a: 1, b: 2 }`), env), true);
  assert.equal(evaluate(parseExpr(`{ a: 1 } == { a: 2 }`), env), false);
  assert.equal(evaluate(parseExpr(`{ a: 1 } == { a: 1, b: 2 }`), env), false);
});

test("a record can nest vectors, arrays, and other records, and they read back correctly", () => {
  const record = evalExpr(`{ pos: (1, 2, 3), tags: ["a", "b"], meta: { ok: true } }`);
  assert.equal(record.pos.x, 1);
  assert.deepEqual(record.tags, ["a", "b"]);
  assert.equal(record.meta.ok, true);
});

test("assigning to a record field mutates it in place", () => {
  const env = createGlobalEnv().child();
  env.define("planet", evalExpr(`{ name: "Earth" }`));
  run("planet.name = \"Mars\"", env);
  assert.equal(env.get("planet").name, "Mars");
});

test("'keys' lists a record's field names in declaration order", () => {
  assert.deepEqual(evalExpr(`keys({ b: 1 a: 2 })`), ["b", "a"]);
});

test("'keys' rejects a non-record", () => {
  const env = createGlobalEnv().child();
  assert.throws(() => evaluate(parseExpr("keys(5)"), env), AxisRuntimeError);
});

test("an array of records works with for..in, matching the data-driven-scene pattern", () => {
  const env = createGlobalEnv().child();
  env.define("planets", [
    evalExpr(`{ name: "Earth" }`),
    evalExpr(`{ name: "Mars" }`),
  ]);
  env.define("names", []);
  run(`
    for p in planets {
      names = names + [p.name]
    }
  `, env);
  assert.deepEqual(env.get("names"), ["Earth", "Mars"]);
});
