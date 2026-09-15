// Model asset lifecycle: `on model.load`/`on model.error` - the declarative
// escape hatch for "loading -> loaded -> reveal" (see
// docs/architecture/embedding.md and scene3d.js's own loadModel). Covers the
// build-time contract here (event-name grammar, the model-only restriction)
// at the Node level, same as every other event name. The actual live firing
// - scene3d.js's loadModel calling runHandler(node.name, "load"/"error") -
// is real three.js/GLTFLoader/fetch browser behavior with no Node-testable
// equivalent (same reasoning as viewport-lifecycle.md/reactive-structure.md
// for every other browser-only mechanism in this repo); verified with a
// real browser instead - see the embedding milestone's browser-verification
// notes.

import { test } from "node:test";
import assert from "node:assert/strict";
import { run } from "../src/run.js";
import { AxisRuntimeError } from "../src/interpreter.js";

test("'on model.load' and 'on model.error' parse and interpret cleanly on a model target", () => {
  const result = run(`
    scene main {
      state loaded = false
      state failed = false
      model thing {
        src: "./assets/pyramid.glb"
      }
      on thing.load {
        loaded = true
      }
      on thing.error {
        failed = true
      }
    }
  `);
  assert.equal(result.scenes[0].handlers.length, 2);
  assert.deepEqual(
    result.scenes[0].handlers.map((h) => h.event).sort(),
    ["error", "load"]
  );
});

test("'load'/'error' are rejected on a non-model target with a clear error", () => {
  assert.throws(
    () => run(`scene main { cube box { } on box.load { } }`),
    (err) => err instanceof AxisRuntimeError && /'load' only works on a 'model'/.test(err.message) && /'box' is a cube/.test(err.message)
  );
  assert.throws(
    () => run(`page Home { button go { label: "Go" } on go.error { } }`),
    (err) => err instanceof AxisRuntimeError && /'error' only works on a 'model'/.test(err.message)
  );
});

test("an unknown event name still lists the full, current vocabulary", () => {
  assert.throws(
    () => run(`scene main { cube box { } on box.bogus { } }`),
    (err) => err instanceof AxisRuntimeError && /click, hover, unhover, change, submit, load, error, or complete/.test(err.message)
  );
});

test("'on model.load' works the same way on a model embedded via a page's viewport", () => {
  const result = run(`
    scene inner {
      model thing { src: "./assets/pyramid.glb" }
      on thing.load { }
    }
    page Home {
      viewport v {
        scene: "inner"
        width: "400px"
        height: "300px"
      }
    }
  `);
  assert.equal(result.scenes[0].handlers[0].event, "load");
});
