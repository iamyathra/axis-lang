// 'on tick { ... }' - a global, per-frame handler with no target, the
// first per-frame execution hook AXIS has ever had (Phase C of the
// general-purpose-language pivot - see
// docs/architecture/2026-09-language-platform-audit.md). Real end-to-end,
// real-wall-clock coverage of the runtime actually firing it every frame
// lives in tests/browser/tick.test.js (needs a real requestAnimationFrame
// clock); this file covers parsing/interpretation/formatting, which plain
// node --test can verify directly.
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

test("'on tick { ... }' parses to an OnDecl with a null target, distinct from 'target.event'", () => {
  const program = parse(tokenize(`page Home {\n  on tick {\n    let x = 1\n  }\n}\n`));
  const onDecl = program.items[0].body.find((e) => e.kind === "OnDecl");
  assert.equal(onDecl.target, null);
  assert.equal(onDecl.event, "tick");
});

test("'name.tick { ... }' (an object actually named 'tick') still parses as an ordinary targeted 'on'", () => {
  const program = parse(tokenize(`page Home {\n  button tick { label: "hi" }\n  on tick.click {\n    let x = 1\n  }\n}\n`));
  const onDecl = program.items[0].body.find((e) => e.kind === "OnDecl");
  assert.equal(onDecl.target, "tick");
  assert.equal(onDecl.targetIsExpr, false);
  assert.equal(onDecl.event, "click");
});

test("a page's 'on tick' becomes a handler with target: null in the interpreted graph", () => {
  const page = buildPage(`page Home {\n  state n = 0\n  on tick {\n    n += 1\n  }\n}\n`);
  const tickHandlers = page.handlers.filter((h) => h.target === null);
  assert.equal(tickHandlers.length, 1);
  assert.equal(tickHandlers[0].event, "tick");
});

test("a scene's 'on tick' becomes a handler too - ticking isn't page-only", () => {
  const scene = buildScene(`scene demo {\n  cube box { color: red }\n  on tick {\n    let x = 1\n  }\n}\n`);
  const tickHandlers = scene.handlers.filter((h) => h.target === null);
  assert.equal(tickHandlers.length, 1);
});

test("multiple independent 'on tick' handlers in the same scene/page are all kept, not overwritten", () => {
  const page = buildPage(`page Home {\n  state a = 0\n  state b = 0\n  on tick {\n    a += 1\n  }\n  on tick {\n    b += 1\n  }\n}\n`);
  assert.equal(page.handlers.filter((h) => h.target === null).length, 2);
});

test("a per-object 'tick' event (with a target) is rejected - ticking is global only", () => {
  assert.throws(
    () => buildPage(`page Home {\n  button go { label: "hi" }\n  on go.tick {\n    let x = 1\n  }\n}\n`),
    /unknown event 'tick'/
  );
});

test("'on tick' inside a component body works the same as inside a scene/page", () => {
  const program = parse(
    tokenize(`component Widget() {\n  container box {\n    on tick {\n      let x = 1\n    }\n  }\n}\n\npage Home {\n  Widget w {}\n}\n`)
  );
  const { pages } = interpret(program);
  assert.equal(pages[0].handlers.filter((h) => h.target === null).length, 1);
});

test("'dt' is only meaningful inside an 'on tick' body - it isn't a global", () => {
  // Referencing 'dt' outside a tick handler is an ordinary undefined-
  // variable error, the same as any other typo'd name - it's bound only
  // as a local inside the tick handler's own env (see scene3d.js/
  // pageRuntime.js's runTickHandlers), not added to the global environment.
  assert.throws(() => buildPage(`page Home {\n  text label { content: str(dt) }\n}\n`), /undefined variable 'dt'/);
});

test("axis fmt round-trips 'on tick { ... }' with no target/dot printed", () => {
  const src = `page Home {\n    on tick {\n        let x = 1\n    }\n}\n`;
  const formatted = formatSource(src);
  assert.equal(formatted, src);
  assert.equal(formatSource(formatted), formatted);
});
