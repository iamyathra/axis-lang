// An `on` handler declared inside a `for` loop couldn't reference that
// loop's own variable - a real, pre-existing AXIS limitation (see the
// README: "'on' handlers only see the scene/page's own top-level
// variables, not ones local to a loop") that made a loop-generated
// interactive list (a per-row "remove this one" button, say) unable to
// know which row it belonged to. Fixed the same way a component's own
// params already are: baked into the stored handler body by value, at the
// point the handler is declared, via the internal `Captured` AST node
// (evaluator.js) - see interpreter.js's captureLoopVariables. This isn't
// scoped to reactive structure (docs/architecture/reactive-structure.md) -
// it fixes the exact same gap for an ordinary, non-reactive, build-once
// loop too, since both paths declare handlers through the same
// DeclarativeBuilder.interpretOnDecl.

import { test } from "node:test";
import assert from "node:assert/strict";
import { run } from "../src/run.js";
import { evaluate, Environment } from "../src/evaluator.js";

function findHandler(handlers, target) {
  const h = handlers.find((h) => h.target === target);
  assert.ok(h, `no handler found for target '${target}'`);
  return h;
}

test("a handler declared inside a 'for' loop captures the loop variable's value at that point, not a live reference", () => {
  const result = run(`
    page Home {
      for i in [10, 20, 30] {
        button ("btn" + i) { label: "x" }
        on ("btn" + i).click {
          let doubled = i * 2
        }
      }
    }
  `);
  const handlers = result.pages[0].handlers;
  const h20 = findHandler(handlers, "btn20");
  // the stored body's LetDecl value is `i * 2` - `i` itself should now be
  // a Captured node holding 20, not a live Identifier.
  const letStmt = h20.body[0];
  assert.equal(letStmt.kind, "LetDecl");
  assert.equal(letStmt.value.left.kind, "Captured");
  assert.equal(letStmt.value.left.value, 20);
});

test("the captured value actually evaluates correctly through the shared evaluator", () => {
  const result = run(`
    page Home {
      for i in [1, 2, 3] {
        button ("btn" + i) { label: "x" }
        on ("btn" + i).click {
          let n = i
        }
      }
    }
  `);
  const h2 = findHandler(result.pages[0].handlers, "btn2");
  const capturedNode = h2.body[0].value;
  assert.equal(evaluate(capturedNode, new Environment()), 2);
});

test("a handler can read a captured record field, the exact pattern a per-row 'remove this item' button needs", () => {
  const result = run(`
    state todos = [{ id: 1, label: "a" }, { id: 2, label: "b" }]
    page Home {
      for t in todos {
        button ("remove" + t.id) { label: "x" }
        on ("remove" + t.id).click {
          let target = t.id
        }
      }
    }
  `);
  const h1 = findHandler(result.pages[0].handlers, "remove1");
  const h2 = findHandler(result.pages[0].handlers, "remove2");
  // `t` itself is captured as a whole record - `.id` is read off it via an
  // ordinary Member access over a Captured node, no special-casing needed.
  assert.equal(h1.body[0].value.kind, "Member");
  assert.equal(h1.body[0].value.object.kind, "Captured");
  assert.equal(evaluate(h1.body[0].value, new Environment()), 1);
  assert.equal(evaluate(h2.body[0].value, new Environment()), 2);
});

test("nested loops: the inner loop's own variable shadows the outer one sharing the same name, same as ordinary variable shadowing", () => {
  const result = run(`
    page Home {
      for i in [1] {
        for i in [100, 200] {
          button ("btn" + i) { label: "x" }
          on ("btn" + i).click {
            let n = i
          }
        }
      }
    }
  `);
  const h100 = findHandler(result.pages[0].handlers, "btn100");
  assert.equal(evaluate(h100.body[0].value, new Environment()), 100);
});

test("a handler NOT inside any loop is completely unaffected - no Captured nodes appear at all", () => {
  const result = run(`
    page Home {
      let clicks = 0
      button go { label: "go" }
      on go.click { clicks = clicks + 1 }
    }
  `);
  const h = findHandler(result.pages[0].handlers, "go");
  assert.equal(h.body[0].kind, "Assignment");
  assert.equal(h.body[0].value.left.kind, "Identifier"); // still a live reference to the page's own top-level 'clicks'
});

test("a component's own params/state are still resolved via the existing rename mechanism, not captured by value - a component-local 'state' handler must stay a LIVE binding (it's mutated with += , which a frozen capture couldn't support)", () => {
  const result = run(`
    component Counter() {
      state count = 0
      button go { label: "go" }
      on go.click { count += 1 }
    }
    page Home {
      Counter only {}
    }
  `);
  const h = findHandler(result.pages[0].handlers, "only.go");
  // 'count' should have been renamed to 'only.count' (an Identifier),
  // never captured as a frozen value - captureLoopVariables never even
  // runs for this case (loopVarStack is empty; components aren't loops).
  assert.equal(h.body[0].kind, "Assignment");
  assert.equal(h.body[0].value.left.kind, "Identifier");
  assert.equal(h.body[0].value.left.value, "only.count");
});

test("the same fix applies inside a scene's own 'for' loop too, not just a page's - it's a DeclarativeBuilder-level fix, not a reactive-structure-only one", () => {
  const result = run(`
    scene main {
      camera { position: (0, 2, 5) }
      for i in [1, 2] {
        cube ("box" + i) { position: (i, 0, 0) }
        on ("box" + i).click {
          let n = i
        }
      }
    }
  `);
  const h = findHandler(result.scenes[0].handlers, "box2");
  assert.equal(evaluate(h.body[0].value, new Environment()), 2);
});
