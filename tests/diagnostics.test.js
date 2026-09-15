// Verifies the error-classification layer (diagnostics.js) against one real
// thrown error per rule, not synthetic messages - if a throw site's wording
// drifts, the matching rule's test below stops matching and this file goes
// red, which is the point (see diagnostics.js's own header comment).
import { test } from "node:test";
import assert from "node:assert/strict";
import { tokenize, AxisSyntaxError } from "../src/lexer.js";
import { parse } from "../src/parser.js";
import { interpret } from "../src/interpreter.js";
import { AxisRuntimeError } from "../src/evaluator.js";
import { AxisModuleError, resolveModules } from "../src/modules.js";
import {
  errorToDiagnostic,
  DIAGNOSTIC_SCHEMA_VERSION,
  CODE_CATALOG,
  SYNTAX_RULES,
  MODULE_RULES,
  RUNTIME_RULES,
  NON_RULE_CODES,
} from "../src/diagnostics.js";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

function throwFrom(source) {
  try {
    interpret(parse(tokenize(source)));
  } catch (err) {
    return err;
  }
  throw new Error("expected source to throw: " + source);
}

function syntaxErrorFrom(source) {
  try {
    parse(tokenize(source));
  } catch (err) {
    return err;
  }
  throw new Error("expected source to throw a syntax error: " + source);
}

function diag(err) {
  return errorToDiagnostic(err, { requestedPath: "test.ax", requestedSource: "" });
}

test("DIAGNOSTIC_SCHEMA_VERSION is a stable positive integer", () => {
  assert.equal(typeof DIAGNOSTIC_SCHEMA_VERSION, "number");
  assert.ok(Number.isInteger(DIAGNOSTIC_SCHEMA_VERSION) && DIAGNOSTIC_SCHEMA_VERSION >= 1);
});

test("every diagnostic has a severity, code, message, and file - even for an unclassified error", () => {
  const d = diag(new AxisRuntimeError("something this classifier has never heard of", 3));
  assert.equal(d.severity, "error");
  assert.equal(d.code, "AXIS_RUNTIME_ERROR");
  assert.equal(d.message, "something this classifier has never heard of");
  assert.equal(d.file, "test.ax");
  assert.deepEqual(d.location, { start: { line: 3 } });
});

test("a lexer error classifies as AXIS_LEX_UNTERMINATED_STRING with line+column", () => {
  const err = syntaxErrorFrom('scene main { cube box { color: "unterminated } }');
  assert.ok(err instanceof AxisSyntaxError);
  const d = diag(err);
  assert.equal(d.code, "AXIS_LEX_UNTERMINATED_STRING");
  assert.equal(d.location.start.line, err.line);
  assert.equal(d.location.start.column, err.column);
});

test("a missing-token parse error classifies as AXIS_PARSE_EXPECTED_TOKEN", () => {
  const err = syntaxErrorFrom("scene main { cube box { color red } }");
  const d = diag(err);
  assert.equal(d.code, "AXIS_PARSE_EXPECTED_TOKEN");
});

test("an invalid assignment target classifies as AXIS_PARSE_INVALID_ASSIGNMENT_TARGET", () => {
  const err = syntaxErrorFrom("fn bad() { 5 = 1 }");
  const d = diag(err);
  assert.equal(d.code, "AXIS_PARSE_INVALID_ASSIGNMENT_TARGET");
});

test("a duplicate record field classifies as AXIS_PARSE_DUPLICATE_FIELD", () => {
  const err = syntaxErrorFrom("let x = { a: 1, a: 2 }");
  assert.equal(diag(err).code, "AXIS_PARSE_DUPLICATE_FIELD");
});

test("an undefined variable classifies as AXIS_SEMANTIC_UNDEFINED_VARIABLE, with a 'did you mean' suggestion", () => {
  const err = throwFrom("let box = 1\nscene main { cube c { color: red } animate c { rotation.y -> boxx duration: 1s } }");
  const d = diag(err);
  assert.equal(d.code, "AXIS_SEMANTIC_UNDEFINED_VARIABLE");
  assert.match(d.suggestion, /Did you mean 'box'\?/);
});

test("assigning to a const classifies as AXIS_SEMANTIC_CONST_ASSIGNMENT", () => {
  const err = throwFrom("const x = 1\nfn bad() { x = 2 }\nlet ignored = bad()\nscene main { cube box { color: red } }");
  assert.equal(diag(err).code, "AXIS_SEMANTIC_CONST_ASSIGNMENT");
});

test("a duplicate object name classifies as AXIS_SEMANTIC_ALREADY_DEFINED", () => {
  const err = throwFrom("scene main { cube box { color: red } cube box { color: blue } }");
  assert.equal(diag(err).code, "AXIS_SEMANTIC_ALREADY_DEFINED");
});

test("a negative animate duration classifies as AXIS_VALIDATION_INVALID_DURATION with a suggestion", () => {
  const err = throwFrom("scene main { cube box { color: red } animate box { rotation.y -> 1deg duration: -500 } }");
  const d = diag(err);
  assert.equal(d.code, "AXIS_VALIDATION_INVALID_DURATION");
  assert.match(d.suggestion, /duration: 500/);
});

test("a negative animate delay classifies as AXIS_VALIDATION_INVALID_DELAY", () => {
  const err = throwFrom("scene main { cube box { color: red } animate box { rotation.y -> 1deg duration: 500 delay: -100 } }");
  assert.equal(diag(err).code, "AXIS_VALIDATION_INVALID_DELAY");
});

test("an unknown easing classifies as AXIS_VALIDATION_UNKNOWN_EASING", () => {
  const err = throwFrom(
    'let bounce = "bounce"\nscene main { cube box { color: red } animate box { rotation.y -> 1deg duration: 500 easing: bounce } }'
  );
  assert.equal(diag(err).code, "AXIS_VALIDATION_UNKNOWN_EASING");
});

test("animating an unknown target classifies as AXIS_SEMANTIC_UNKNOWN_TARGET", () => {
  const err = throwFrom("scene main { cube box { color: red } animate boxx { rotation.y -> 1deg duration: 1s } }");
  assert.equal(diag(err).code, "AXIS_SEMANTIC_UNKNOWN_TARGET");
});

test("an unknown object property classifies as AXIS_SEMANTIC_UNKNOWN_PROPERTY", () => {
  const err = throwFrom("scene main { cube box { colr: red } }");
  assert.equal(diag(err).code, "AXIS_SEMANTIC_UNKNOWN_PROPERTY");
});

test("an invalid color value classifies as AXIS_SEMANTIC_INVALID_COLOR", () => {
  const err = throwFrom("scene main { cube box { color: 5 } }");
  assert.equal(diag(err).code, "AXIS_SEMANTIC_INVALID_COLOR");
});

test("a while loop over the iteration cap classifies as AXIS_SEMANTIC_LOOP_LIMIT_EXCEEDED", () => {
  const err = throwFrom(
    "let i = 0\nfn spin() { while (true) { i = i + 1 } }\nlet ignored = spin()\nscene main { cube box { color: red } }"
  );
  assert.equal(diag(err).code, "AXIS_SEMANTIC_LOOP_LIMIT_EXCEEDED");
});

test("a type mismatch (subtracting a number from a string) classifies as AXIS_SEMANTIC_TYPE_MISMATCH", () => {
  const err = throwFrom('let x = "a" - 1\nscene main { cube box { color: red } }');
  assert.equal(diag(err).code, "AXIS_SEMANTIC_TYPE_MISMATCH");
});

test("a module that doesn't exist classifies as AXIS_MODULE_NOT_FOUND", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "axis-diag-test-"));
  try {
    const file = path.join(dir, "main.ax");
    writeFileSync(file, 'import thing from "./missing.ax"\nscene main { cube box { color: red } }');
    let err;
    try {
      resolveModules(file);
    } catch (e) {
      err = e;
    }
    assert.ok(err instanceof AxisModuleError);
    assert.equal(diag(err).code, "AXIS_MODULE_NOT_FOUND");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a circular import classifies as AXIS_MODULE_CIRCULAR_IMPORT", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "axis-diag-test-"));
  try {
    const a = path.join(dir, "a.ax");
    const b = path.join(dir, "b.ax");
    writeFileSync(a, 'import thing from "./b.ax"\nscene main { cube box { color: red } }');
    writeFileSync(b, 'import thing from "./a.ax"\nexport let thing = 1');
    let err;
    try {
      resolveModules(a);
    } catch (e) {
      err = e;
    }
    assert.ok(err instanceof AxisModuleError);
    assert.equal(diag(err).code, "AXIS_MODULE_CIRCULAR_IMPORT");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an error inside an imported component is attributed to that file's own source, not the entry file's", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "axis-diag-test-"));
  try {
    const compFile = path.join(dir, "comp.ax");
    const mainFile = path.join(dir, "main.ax");
    writeFileSync(compFile, "export component Bad() { cube box { colr: red } }");
    writeFileSync(mainFile, 'import Bad from "./comp.ax"\nscene main { Bad thing { } }');
    const program = resolveModules(mainFile);
    let err;
    try {
      interpret(program);
    } catch (e) {
      err = e;
    }
    assert.ok(err instanceof AxisRuntimeError);
    const d = errorToDiagnostic(err, { requestedPath: mainFile, requestedSource: "should not be used" });
    assert.equal(d.file, compFile);
    assert.match(d.source.line, /colr: red/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CODE_CATALOG (the source docs/ai/ERROR_CODES.md is generated from) has an entry for every code any rule can produce", () => {
  const allCodes = new Set([
    ...SYNTAX_RULES.map(([, code]) => code),
    ...MODULE_RULES.map(([, code]) => code),
    ...RUNTIME_RULES.map(([, code]) => code),
    ...NON_RULE_CODES,
  ]);
  const missing = [...allCodes].filter((code) => !(code in CODE_CATALOG));
  assert.deepEqual(missing, [], `CODE_CATALOG is missing a description for: ${missing.join(", ")}`);

  const stale = Object.keys(CODE_CATALOG).filter((code) => !allCodes.has(code));
  assert.deepEqual(stale, [], `CODE_CATALOG describes codes no rule (or NON_RULE_CODES) can actually produce: ${stale.join(", ")}`);
});

test("an unrecognized error class still returns a well-formed diagnostic (AXIS_INTERNAL_ERROR)", () => {
  const d = diag(new Error("something truly unexpected"));
  assert.equal(d.code, "AXIS_INTERNAL_ERROR");
  assert.equal(d.message, "something truly unexpected");
});
