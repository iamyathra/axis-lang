// A real, previously-undiscovered bug found while building the first-
// person controller (Phase H/I of the general-purpose-language pivot -
// see docs/architecture/2026-09-language-platform-audit.md's game-dev-
// foundation addendum): `isLiteralExpr` didn't recognize a vector literal
// like `(0, 0, 0)` as literal, so `position: (0, 0, 0)` got stashed as a
// reactive "binding" (interpreter.js's applyProperty, both domains) -
// which scene3d.js's/pageRuntime.js's reRender() re-evaluates and
// re-applies after *every* handler call, including every `on tick`. In
// practice: an object declared with a literal vector position, then moved
// by reading and rewriting that same property from `on tick` (the natural
// way to write movement - see docs/language.md's Per-frame updates
// section), had its own movement silently undone right after every
// single tick. A real-browser test (tests/browser/fps-controls.test.js)
// is what actually caught this, by checking *accumulation* over many
// ticks instead of a single write; this file is the fast, non-browser
// regression test for the root cause itself.
import { test } from "node:test";
import assert from "node:assert/strict";
import { tokenize } from "../src/lexer.js";
import { parse } from "../src/parser.js";
import { interpret } from "../src/interpreter.js";

function buildScene(src) {
  const program = parse(tokenize(src));
  const { scenes } = interpret(program);
  return scenes[0];
}

function buildPage(src) {
  const program = parse(tokenize(src));
  const { pages } = interpret(program);
  return pages[0];
}

test("a literal vector property (position/rotation/scale) is NOT stashed as a binding, in a scene", () => {
  const scene = buildScene(`scene demo {\n  cube box {\n    position: (0, 0, 0)\n    rotation: (0, 45, 0)\n    scale: (1, 1, 1)\n    color: "#ff0000"\n  }\n}\n`);
  const box = scene.objects.find((o) => o.name === "box");
  assert.equal(box.bindings, undefined, `expected no bindings for an all-literal object, got ${JSON.stringify(box.bindings)}`);
});

// Same check, but isolating each property individually - a combined test
// (above) can pass for the wrong reason if only some of the three keys
// are actually fixed; these fail on exactly the one that regresses.
for (const [key, value] of [
  ["position", "(0, 0, 0)"],
  ["rotation", "(0, 45, 0)"],
  ["scale", "(1, 1, 1)"],
]) {
  test(`'${key}' specifically is not stashed as a binding when declared as a literal vector`, () => {
    const scene = buildScene(`scene demo {\n  cube box {\n    ${key}: ${value}\n    color: "#ff0000"\n  }\n}\n`);
    const box = scene.objects.find((o) => o.name === "box");
    assert.equal(box.bindings?.[key], undefined, `expected '${key}: ${value}' to not become a binding`);
  });
}

test("a camera's literal 'target' is not stashed as a binding either (a separate object from any shape)", () => {
  const scene = buildScene(`scene demo {\n  camera {\n    position: (0, 2, 8)\n    target: (0, 0, 0)\n  }\n  cube box { color: "#ff0000" }\n}\n`);
  assert.equal(scene.camera.bindings?.target, undefined);
  assert.equal(scene.camera.bindings?.position, undefined);
});

test("a spotLight's literal 'target' is not stashed as a binding (a third, differently-shaped object type)", () => {
  const scene = buildScene(`scene demo {\n  spotLight lamp {\n    position: (0, 5, 0)\n    target: (0, 0, 0)\n    color: "#ffffff"\n    intensity: 1\n  }\n  cube box { color: "#ff0000" }\n}\n`);
  const lamp = scene.objects.find((o) => o.name === "lamp");
  assert.equal(lamp.bindings, undefined);
});

test("a vector literal inside a component's own object is not stashed as a binding either", () => {
  const program = parse(
    tokenize(`component Mover() {\n  cube box {\n    position: (0, 0, 0)\n    color: "#ff0000"\n  }\n}\n\nscene demo {\n  Mover thing {}\n}\n`)
  );
  const { scenes } = interpret(program);
  const box = scenes[0].objects.find((o) => o.name === "thing.box");
  assert.equal(box.bindings, undefined, "expected a component instance's own literal vector property to not become a binding");
});

test("a literal vector property is NOT stashed as a binding, in a page", () => {
  const page = buildPage(`page Home {\n  container box {\n    width: 100\n    height: 100\n  }\n}\n`);
  const box = page.nodes.find((n) => n.name === "box");
  assert.equal(box.bindings, undefined);
});

test("a genuinely reactive vector property (referencing state/let) still becomes a binding", () => {
  const scene = buildScene(`scene demo {\n  let offset = 5\n  cube box {\n    position: (offset, 0, 0)\n    color: "#ff0000"\n  }\n}\n`);
  const box = scene.objects.find((o) => o.name === "box");
  assert.ok(box.bindings?.position, "expected a non-literal vector to still be tracked as a binding");
});

test("a negative-number vector component (already a single literal token, no space) stays non-bound", () => {
  const scene = buildScene(`scene demo {\n  cube box {\n    position: (-1, 0, 0)\n    color: "#ff0000"\n  }\n}\n`);
  const box = scene.objects.find((o) => o.name === "box");
  assert.equal(box.bindings, undefined);
});

test("an explicitly-spaced unary-minus vector component ('- 1', a Unary node, not a literal Number token) also stays non-bound", () => {
  const scene = buildScene(`scene demo {\n  cube box {\n    position: (- 1, 0, 0)\n    color: "#ff0000"\n  }\n}\n`);
  const box = scene.objects.find((o) => o.name === "box");
  assert.equal(box.bindings, undefined);
});
