// Game-foundation phase: examples/fps-controls/axis_modules/input/'s
// makeInputState is the reusable input-state abstraction (post-milestone
// directive, item 4) separating raw browser events from application
// logic - isKeyDown/wasKeyPressed/wasKeyReleased/mouse deltas/buttons,
// with an explicit endFrame() reset step. Tested here at the logic level
// (real evaluator, no browser needed - the raw `on keydown`/`on mousemove`
// wiring itself is already covered by tests/keyboard-events.test.js/
// tests/mouse-events.test.js and their browser counterparts); real
// end-to-end WASD+mouse-look+pointer-lock integration is
// tests/browser/camera-controller.test.js's job.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { resolveModules } from "../src/modules.js";
import { tokenize } from "../src/lexer.js";
import { parse } from "../src/parser.js";
import { evaluate, executeBlock } from "../src/evaluator.js";
import { createGlobalEnv } from "../src/globals.js";

const ENTRY = fileURLToPath(new URL("../examples/fps-controls/main.ax", import.meta.url));

function inputEnv() {
  const program = resolveModules(ENTRY);
  const env = createGlobalEnv();
  for (const item of program.items) {
    if (item.kind === "LetDecl") env.define(item.name, evaluate(item.value, env), item.constant);
    if (item.kind === "FnDecl") {
      env.define(item.name, { __axisType: "function", name: item.name, params: item.params, body: item.body, closure: env, isAsync: item.isAsync });
    }
  }
  return env;
}

function run(env, src) {
  const child = env.child();
  const program = parse(tokenize(`fn __test() {\n${src}\n}`));
  executeBlock(program.items[0].body, child);
  return child;
}

test("isKeyDown reflects held state correctly across a press/release cycle, and stays correct across repeated checks", () => {
  const env = run(
    inputEnv(),
    `
    let input = makeInputState()
    let beforePress = input.isKeyDown("w")
    input.handleKeyDown("w")
    let afterPress1 = input.isKeyDown("w")
    let afterPress2 = input.isKeyDown("w")
    input.handleKeyUp("w")
    let afterRelease = input.isKeyDown("w")
  `
  );
  assert.equal(env.get("beforePress"), false);
  assert.equal(env.get("afterPress1"), true);
  assert.equal(env.get("afterPress2"), true, "expected isKeyDown to keep reporting true while held, not just on the first check");
  assert.equal(env.get("afterRelease"), false);
});

test("wasKeyPressed is edge-triggered: true only until endFrame() runs, then false again even though the key is still held", () => {
  const env = run(
    inputEnv(),
    `
    let input = makeInputState()
    input.handleKeyDown("w")
    let pressedThisFrame = input.wasKeyPressed("w")
    input.endFrame()
    let pressedNextFrame = input.wasKeyPressed("w")
    let stillHeld = input.isKeyDown("w")
  `
  );
  assert.equal(env.get("pressedThisFrame"), true);
  assert.equal(env.get("pressedNextFrame"), false, "expected wasKeyPressed to reset after endFrame(), even with the key still held");
  assert.equal(env.get("stillHeld"), true, "expected isKeyDown (continuous) to be unaffected by endFrame(), unlike wasKeyPressed (edge-triggered)");
});

test("wasKeyReleased is edge-triggered the same way, and does not fire again on a frame where nothing changed", () => {
  const env = run(
    inputEnv(),
    `
    let input = makeInputState()
    input.handleKeyDown("w")
    input.endFrame()
    input.handleKeyUp("w")
    let releasedThisFrame = input.wasKeyReleased("w")
    input.endFrame()
    let releasedNextFrame = input.wasKeyReleased("w")
  `
  );
  assert.equal(env.get("releasedThisFrame"), true);
  assert.equal(env.get("releasedNextFrame"), false);
});

test("mouseDX/mouseDY accumulate multiple mousemove events within one frame, then reset to zero on endFrame() - not carried into the next frame", () => {
  const env = run(
    inputEnv(),
    `
    let input = makeInputState()
    input.handleMouseMove(3, -2)
    input.handleMouseMove(4, 1)
    let dxThisFrame = input.mouseDX
    let dyThisFrame = input.mouseDY
    input.endFrame()
    let dxNextFrame = input.mouseDX
    let dyNextFrame = input.mouseDY
  `
  );
  assert.equal(env.get("dxThisFrame"), 7);
  assert.equal(env.get("dyThisFrame"), -1);
  assert.equal(env.get("dxNextFrame"), 0, "expected mouseDX to reset after endFrame(), not keep accumulating forever");
  assert.equal(env.get("dyNextFrame"), 0);
});

test("mouse buttons track held state across down/up the same way keys do, independent of key state", () => {
  const env = run(
    inputEnv(),
    `
    let input = makeInputState()
    input.handleMouseDown(0)
    let leftDown = input.isMouseDown(0)
    let rightDown = input.isMouseDown(2)
    input.handleMouseUp(0)
    let leftAfterUp = input.isMouseDown(0)
  `
  );
  assert.equal(env.get("leftDown"), true);
  assert.equal(env.get("rightDown"), false);
  assert.equal(env.get("leftAfterUp"), false);
});

test("holding a key across many endFrame() calls in a row keeps isKeyDown true the whole time - not just for one frame", () => {
  const env = run(
    inputEnv(),
    `
    let input = makeInputState()
    input.handleKeyDown("w")
    let allHeld = true
    for i in range(0, 10) {
      input.endFrame()
      if (!input.isKeyDown("w")) {
        allHeld = false
      }
    }
  `
  );
  assert.equal(env.get("allHeld"), true, "expected a held key to still read as down after 10 real endFrame() cycles, not silently reset");
});
