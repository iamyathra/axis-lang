// The ternary/conditional expression - `condition ? a : b` - README's own
// longest-standing open roadmap item (since v3.5), landed as Phase B of the
// general-purpose-language pivot alongside the stdlib (see
// docs/architecture/2026-09-language-platform-audit.md).
import { test } from "node:test";
import assert from "node:assert/strict";
import { tokenize } from "../src/lexer.js";
import { parse } from "../src/parser.js";
import { evaluate, executeBlock, executeBlockAsync, AxisRuntimeError } from "../src/evaluator.js";
import { createGlobalEnv } from "../src/globals.js";
import { formatSource } from "../src/format.js";

function parseExpr(src) {
  const program = parse(tokenize(`let __x = ${src}`));
  return program.items[0].value;
}

function evalExpr(src, env = createGlobalEnv().child()) {
  return evaluate(parseExpr(src), env);
}

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

test("a basic ternary picks the right branch", () => {
  assert.equal(evalExpr("true ? 1 : 2"), 1);
  assert.equal(evalExpr("false ? 1 : 2"), 2);
  assert.equal(evalExpr("1 > 0 ? \"yes\" : \"no\""), "yes");
});

test("only the taken branch is evaluated - the other side's error never fires", () => {
  const env = createGlobalEnv().child();
  assert.equal(evalExpr(`true ? 1 : undefinedVariable`, env), 1);
  assert.equal(evalExpr(`false ? undefinedVariable : 2`, env), 2);
});

test("ternary works as a call argument, a return value, and a property-style let binding", () => {
  const env = run(`
    let x = 5
    let sign = x > 0 ? "positive" : "negative"
    let doubled = str(x > 0 ? x * 2 : 0 - x)
  `);
  assert.equal(env.get("sign"), "positive");
  assert.equal(env.get("doubled"), "10");
});

test("chained ternaries are right-associative: a ? b : c ? d : e == a ? b : (c ? d : e)", () => {
  assert.equal(evalExpr(`false ? "a" : false ? "b" : "c"`), "c");
  assert.equal(evalExpr(`true ? "a" : false ? "b" : "c"`), "a");
  assert.equal(evalExpr(`false ? "a" : true ? "b" : "c"`), "b");
});

test("a ternary nested in the 'then' branch binds to the nearer ':' - a ? (b ? c : d) : e", () => {
  // If this parsed the wrong way, the outer ternary's ':' would bind to
  // the inner '?' instead, and this would throw a parse error (dangling
  // 'e' with no ternary to attach to) rather than silently misevaluate.
  assert.equal(evalExpr(`true ? (false ? "b" : "c") : "e"`), "c");
  assert.equal(evalExpr(`true ? false ? "b" : "c" : "e"`), "c");
});

test("a non-parenthesized ternary as a Binary operand needs its own parens in source", () => {
  // 'a ? b : c' is looser than every binary operator - it's not legal to
  // write '1 + a ? b : c' and mean '1 + (a ? b : c)'; that parses as
  // '(1 + a) ? b : c' instead, same rule JS/C follow. Parenthesize it.
  assert.equal(evalExpr(`1 + (true ? 2 : 3)`), 3);
  assert.equal(evalExpr(`(true ? 1 : 2) + 1`), 2);
});

test("ternary works inside an async function, awaiting only the taken branch", async () => {
  const env = await runAsync(`
    let ok = async fn() { return "yes" }
    let result = await (true ? ok() : ok())
  `);
  assert.equal(env.get("result"), "yes");
});

test("a missing ':' is a clear syntax error, not a confusing one", () => {
  assert.throws(() => parse(tokenize("let x = true ? 1")), /ternary/);
});

// ---- formatting ---------------------------------------------------------

test("axis fmt round-trips a plain ternary", () => {
  const src = `fn main() {\n    let x = a ? 1 : 2\n}\n`;
  const formatted = formatSource(src);
  assert.equal(formatted, src);
  assert.equal(formatSource(formatted), formatted);
});

test("axis fmt round-trips right-associative chained ternaries without extra parens", () => {
  const src = `fn main() {\n    let x = a ? 1 : b ? 2 : 3\n}\n`;
  const formatted = formatSource(src);
  assert.equal(formatted, src);
});

test("axis fmt preserves required parens around a ternary used as a binary operand", () => {
  const src = `fn main() {\n    let x = 1 + (a ? 2 : 3)\n}\n`;
  const formatted = formatSource(src);
  assert.equal(formatted, src);
});
