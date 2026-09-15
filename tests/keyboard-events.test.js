// 'on keydown { ... }' / 'on keyup { ... }' - the input primitive added
// after Phase G's own physics-package proof found AXIS had no way for a
// package (or anything) to hear a raw keyboard event at all. Same
// zero-target 'on' shape as 'on tick' (see tests/tick.test.js) - a global
// handler, not tied to any object - just with 'key' bound instead of 'dt'.
// Real over-wall-clock-time proof that these actually fire from a real
// browser keyboard event lives in tests/browser/keyboard-events.test.js;
// this file covers parsing/interpretation/formatting.
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

test("'on keydown { ... }' and 'on keyup { ... }' parse to a null-target OnDecl, same shape as 'on tick'", () => {
  const program = parse(tokenize(`page Home {\n  on keydown {\n    let x = 1\n  }\n  on keyup {\n    let y = 2\n  }\n}\n`));
  const onDecls = program.items[0].body.filter((e) => e.kind === "OnDecl");
  assert.equal(onDecls[0].target, null);
  assert.equal(onDecls[0].event, "keydown");
  assert.equal(onDecls[1].target, null);
  assert.equal(onDecls[1].event, "keyup");
});

test("a page's keydown/keyup handlers become handlers with target: null", () => {
  const page = buildPage(`page Home {\n  state lastKey = ""\n  on keydown {\n    lastKey = key\n  }\n}\n`);
  const keydownHandlers = page.handlers.filter((h) => h.target === null && h.event === "keydown");
  assert.equal(keydownHandlers.length, 1);
});

test("a scene's keydown/keyup handlers work too, not just a page's", () => {
  const scene = buildScene(`scene demo {\n  cube box { color: red }\n  on keydown {\n    let x = 1\n  }\n}\n`);
  assert.equal(scene.handlers.filter((h) => h.target === null && h.event === "keydown").length, 1);
});

test("multiple independent keydown handlers are all kept, not overwritten", () => {
  const page = buildPage(`page Home {\n  state a = 0\n  state b = 0\n  on keydown {\n    a += 1\n  }\n  on keydown {\n    b += 1\n  }\n}\n`);
  assert.equal(page.handlers.filter((h) => h.target === null && h.event === "keydown").length, 2);
});

test("a per-object keydown event (with a target) is rejected - keyboard input is global only", () => {
  assert.throws(
    () => buildPage(`page Home {\n  button go { label: "hi" }\n  on go.keydown {\n    let x = 1\n  }\n}\n`),
    /unknown event 'keydown'/
  );
});

test("'key' is only meaningful inside a keydown/keyup body - it isn't a global", () => {
  assert.throws(() => buildPage(`page Home {\n  text label { content: key }\n}\n`), /undefined variable 'key'/);
});

test("axis fmt round-trips 'on keydown'/'on keyup' with no target/dot printed", () => {
  const src = `page Home {\n    on keydown {\n        let x = 1\n    }\n\n    on keyup {\n        let y = 2\n    }\n}\n`;
  const formatted = formatSource(src);
  assert.equal(formatted, src);
  assert.equal(formatSource(formatted), formatted);
});
