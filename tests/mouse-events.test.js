// 'on mousemove'/'on mousedown'/'on mouseup' - rounds out Phase H's input
// primitives (see tests/keyboard-events.test.js). Same zero-target 'on'
// shape as 'on tick'/'on keydown' - global handlers, not tied to any
// object - just with 'dx'/'dy' (mousemove) or 'button' (mousedown/mouseup)
// bound instead of 'dt'/'key'. Real over-wall-clock-time proof that these
// fire from real browser mouse events lives in
// tests/browser/mouse-events.test.js; this file covers parsing/
// interpretation/formatting.
import { test } from "node:test";
import assert from "node:assert/strict";
import { tokenize } from "../src/lexer.js";
import { parse } from "../src/parser.js";
import { interpret } from "../src/interpreter.js";
import { formatSource } from "../src/format.js";

function buildPage(src) {
  const program = parse(tokenize(src));
  const { pages } = interpret(program);
  return pages[0];
}

function buildScene(src) {
  const program = parse(tokenize(src));
  const { scenes } = interpret(program);
  return scenes[0];
}

test("'on mousemove'/'on mousedown'/'on mouseup' parse to a null-target OnDecl", () => {
  const program = parse(
    tokenize(`page Home {\n  on mousemove {\n    let a = 1\n  }\n  on mousedown {\n    let b = 2\n  }\n  on mouseup {\n    let c = 3\n  }\n}\n`)
  );
  const onDecls = program.items[0].body.filter((e) => e.kind === "OnDecl");
  assert.deepEqual(onDecls.map((d) => [d.target, d.event]), [
    [null, "mousemove"],
    [null, "mousedown"],
    [null, "mouseup"],
  ]);
});

test("a page's mouse handlers become handlers with target: null", () => {
  const page = buildPage(`page Home {\n  state x = 0\n  on mousemove {\n    x = dx\n  }\n}\n`);
  assert.equal(page.handlers.filter((h) => h.target === null && h.event === "mousemove").length, 1);
});

test("a scene's mouse handlers work too, not just a page's", () => {
  const scene = buildScene(`scene demo {\n  cube box { color: red }\n  on mousedown {\n    let x = 1\n  }\n}\n`);
  assert.equal(scene.handlers.filter((h) => h.target === null && h.event === "mousedown").length, 1);
});

test("a per-object mousemove event (with a target) is rejected - mouse input is global only", () => {
  assert.throws(
    () => buildPage(`page Home {\n  button go { label: "hi" }\n  on go.mousemove {\n    let x = 1\n  }\n}\n`),
    /unknown event 'mousemove'/
  );
});

test("'dx'/'dy'/'button' are only meaningful inside their own handler bodies - none of them are globals", () => {
  assert.throws(() => buildPage(`page Home {\n  text label { content: dx }\n}\n`), /undefined variable 'dx'/);
  assert.throws(() => buildPage(`page Home {\n  text label { content: dy }\n}\n`), /undefined variable 'dy'/);
  assert.throws(() => buildPage(`page Home {\n  text label { content: button }\n}\n`), /undefined variable 'button'/);
});

test("axis fmt round-trips 'on mousemove'/'on mousedown'/'on mouseup' with no target/dot printed", () => {
  const src = `page Home {\n    on mousemove {\n        let a = 1\n    }\n\n    on mousedown {\n        let b = 2\n    }\n\n    on mouseup {\n        let c = 3\n    }\n}\n`;
  const formatted = formatSource(src);
  assert.equal(formatted, src);
  assert.equal(formatSource(formatted), formatted);
});
