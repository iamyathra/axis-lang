import { test } from "node:test";
import assert from "node:assert/strict";
import { tokenize, AxisSyntaxError } from "../src/lexer.js";

function types(tokens) {
  return tokens.map((t) => t.type);
}

test("tokenizes braces, colons and identifiers", () => {
  const tokens = tokenize("cube box { color: red }");
  assert.deepEqual(types(tokens), [
    "IDENT", "IDENT", "LBRACE", "IDENT", "COLON", "IDENT", "RBRACE", "EOF",
  ]);
});

test("tokenizes numbers with units", () => {
  const [duration] = tokenize("2s");
  assert.equal(duration.type, "NUMBER");
  assert.equal(duration.value, 2);
  assert.equal(duration.unit, "s");

  const [angle] = tokenize("360deg");
  assert.equal(angle.value, 360);
  assert.equal(angle.unit, "deg");
});

test("tokenizes negative and decimal numbers", () => {
  const [neg] = tokenize("-1.5");
  assert.equal(neg.value, -1.5);
  assert.equal(neg.unit, null);
});

test("tokenizes the arrow operator distinctly from minus", () => {
  const tokens = tokenize("rotation.y -> 360deg");
  assert.deepEqual(types(tokens), ["IDENT", "DOT", "IDENT", "ARROW", "NUMBER", "EOF"]);
});

test("skips line comments", () => {
  const tokens = tokenize("// hello\ncube");
  assert.deepEqual(types(tokens), ["IDENT", "EOF"]);
});

test("tokenizes strings", () => {
  const [str] = tokenize('"hello world"');
  assert.equal(str.type, "STRING");
  assert.equal(str.value, "hello world");
});

test("throws on unterminated strings", () => {
  assert.throws(() => tokenize('"unterminated'), AxisSyntaxError);
});

test("throws on unexpected characters", () => {
  assert.throws(() => tokenize("cube $ box"), AxisSyntaxError);
});

test("tokenizes arithmetic operators", () => {
  assert.deepEqual(types(tokenize("1 + 2 - 3 * 4 / 5 % 6")), [
    "NUMBER", "PLUS", "NUMBER", "MINUS", "NUMBER", "STAR", "NUMBER", "SLASH", "NUMBER", "PERCENT", "NUMBER", "EOF",
  ]);
});

test("subtraction with a space works even without a space on both sides", () => {
  // the digit-glued-to-minus rule only kicks in when '-' is immediately
  // followed by a digit, so "5 - 3" (space before the 3) is unambiguous
  assert.deepEqual(types(tokenize("5 - 3")), ["NUMBER", "MINUS", "NUMBER", "EOF"]);
});

test("tokenizes comparison and logical operators", () => {
  assert.deepEqual(types(tokenize("== != < <= > >= && || !")), [
    "EQEQ", "BANGEQ", "LT", "LTE", "GT", "GTE", "AND", "OR", "BANG", "EOF",
  ]);
});

test("tokenizes assignment distinctly from equality", () => {
  assert.deepEqual(types(tokenize("x = 1 y == 2")), ["IDENT", "EQ", "NUMBER", "IDENT", "EQEQ", "NUMBER", "EOF"]);
});

test("tokenizes compound assignment operators", () => {
  assert.deepEqual(types(tokenize("x += 1 x -= 1 x *= 1 x /= 1")), [
    "IDENT", "PLUSEQ", "NUMBER",
    "IDENT", "MINUSEQ", "NUMBER",
    "IDENT", "STAREQ", "NUMBER",
    "IDENT", "SLASHEQ", "NUMBER",
    "EOF",
  ]);
});

test("a negative number literal still tokenizes correctly right after '='", () => {
  // makes sure the new "-=" check doesn't swallow "x = -1"
  assert.deepEqual(types(tokenize("x = -1")), ["IDENT", "EQ", "NUMBER", "EOF"]);
});

test("tokenizes brackets for arrays and indexing", () => {
  assert.deepEqual(types(tokenize("[1, 2][0]")), [
    "LBRACKET", "NUMBER", "COMMA", "NUMBER", "RBRACKET", "LBRACKET", "NUMBER", "RBRACKET", "EOF",
  ]);
});
