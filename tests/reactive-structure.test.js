// Reactive structure - a `for`/non-literal `if` directly inside a
// page/container/component body now stays live after load, not just its
// bound property *values* (see docs/architecture/reactive-structure.md).
// The actual DOM add/remove/patch behavior only exists in the browser (it's
// domClient.js's job, mounted on real elements with real event listeners -
// no jsdom dependency here, same "three.js-only behavior is browser-verified,
// not Node-tested" call viewport-lifecycle.test.js/conditional-viewport.test.js
// already make). What's genuinely Node-testable is the build-time contract
// domClient.js's client-side reconciliation depends on: which `if`/`for`
// statements get flagged reactive, what shape a reactive block carries
// through interpret() -> domPlan.js, and that a scratch `PageBuilder` (the
// same class domClient.js re-runs client-side) really does behave like an
// ordinary one when driven directly.

import { test } from "node:test";
import assert from "node:assert/strict";
import { run, tokenize, parse } from "../src/run.js";
import { buildDomPlan } from "../src/renderer/domPlan.js";
import { PageBuilder, AxisRuntimeError } from "../src/interpreter.js";
import { createGlobalEnv } from "../src/globals.js";

// Parses `page Scratch { <src> }` and returns just the page body's own
// statement list - the exact shape PageBuilder.runStatements expects,
// without needing a full interpret() pass to get it.
function parseBody(src) {
  const program = parse(tokenize(`page Scratch { ${src} }`));
  return program.items[0].body;
}

test("a 'for' loop directly inside a page body is recorded as a reactive block", () => {
  const result = run(`
    state items = ["a", "b"]
    page Home {
      for i in items {
        text (i) { content: i }
      }
    }
  `);
  const page = result.pages[0];
  assert.equal(page.reactiveBlocks.length, 1);
  assert.equal(page.reactiveBlocks[0].id, 0);
  assert.equal(page.reactiveBlocks[0].stmt.kind, "ForStmt");
  assert.equal(page.reactiveBlocks[0].parentName, null);
});

test("a 'for' loop inside a container is reactive too, and its parentName is the container's own (namespaced) name", () => {
  const result = run(`
    state items = [1, 2, 3]
    page Home {
      container list {
        for i in items {
          text ("item" + i) { content: str(i) }
        }
      }
    }
  `);
  const page = result.pages[0];
  assert.equal(page.reactiveBlocks.length, 1);
  assert.equal(page.reactiveBlocks[0].parentName, "list");
});

test("an 'if' with a non-literal condition is reactive", () => {
  const result = run(`
    state show = true
    page Home {
      if (show) {
        text label { content: "hi" }
      }
    }
  `);
  assert.equal(result.pages[0].reactiveBlocks.length, 1);
  assert.equal(result.pages[0].reactiveBlocks[0].stmt.kind, "IfStmt");
});

test("an 'if' with a bare literal condition is NOT reactive - it can never change, same reasoning isLiteralExpr already uses for property bindings", () => {
  const result = run(`
    page Home {
      if (true) {
        text label { content: "hi" }
      }
    }
  `);
  assert.equal(result.pages[0].reactiveBlocks.length, 0);
});

test("every 'for' loop is reactive, even over a literal array - re-running a handful of iterations is cheap, and it means the mechanism never has to guess whether something 'could' change", () => {
  const result = run(`
    page Home {
      for i in [1, 2, 3] {
        text ("n" + i) { content: str(i) }
      }
    }
  `);
  assert.equal(result.pages[0].reactiveBlocks.length, 1);
});

test("reactive blocks are recorded in document order", () => {
  const result = run(`
    state a = true
    state b = [1]
    page Home {
      if (a) { text x { content: "x" } }
      for i in b { text (str(i)) { content: str(i) } }
    }
  `);
  const blocks = result.pages[0].reactiveBlocks;
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].stmt.kind, "IfStmt");
  assert.equal(blocks[1].stmt.kind, "ForStmt");
});

test("an 'if' nested inside a container inside a 'for' is NOT independently registered - it references the outer loop's own variable, which only the outer 'for's own rebuild can resolve", () => {
  const result = run(`
    state faqOpen = ""
    let faqs = [{ id: "a", q: "Q1" }, { id: "b", q: "Q2" }]
    page Home {
      for f in faqs {
        container (f.id + "Row") {
          button (f.id + "Toggle") { label: f.q }
          if (faqOpen == f.id) {
            text (f.id + "Answer") { content: "answer" }
          }
        }
      }
    }
  `);
  const blocks = result.pages[0].reactiveBlocks;
  // Only the outer 'for' - the nested 'if' (inside the per-row container's
  // children) would have been picked up too under the old, naive rule.
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].stmt.kind, "ForStmt");
});

test("an 'if'/'for' nested inside a plain (non-loop) 'if' is still registered independently - there's no enclosing loop variable to worry about", () => {
  const result = run(`
    state showPanel = true
    state items = [1]
    page Home {
      if (showPanel) {
        container panel {
          for i in items {
            text (str(i)) { content: str(i) }
          }
        }
      }
    }
  `);
  const blocks = result.pages[0].reactiveBlocks;
  // Both the outer 'if' (page-level) AND the nested 'for' (registered
  // separately, when `panel`'s own children are scanned) - no enclosing
  // loop variable is in play here, so nothing needs suppressing.
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].stmt.kind, "IfStmt");
  assert.equal(blocks[1].stmt.kind, "ForStmt");
  assert.equal(blocks[1].parentName, "panel");
});

test("a scene's own 'if'/'for' are never reactive - v1 is DOM-only, a scene's objects still only ever build once", () => {
  const result = run(`
    state n = [1, 2]
    scene main {
      camera { position: (0, 2, 5) }
      for i in n {
        cube (str(i)) { position: (i, 0, 0) }
      }
    }
  `);
  assert.equal(result.scenes[0].reactiveBlocks, undefined);
});

test("domPlan.js carries reactiveBlocks through, and ships 'components' only when the page actually has one - keeps a plain page's plan lean", () => {
  const withReactive = buildDomPlan(
    run(`
      state items = [1]
      page Home { for i in items { text (str(i)) { content: str(i) } } }
    `)
  );
  assert.equal(withReactive.reactiveBlocks.length, 1);

  const plain = buildDomPlan(run(`page Home { text label { content: "hi" } }`));
  assert.deepEqual(plain.reactiveBlocks, []);
  assert.deepEqual(plain.components, []);
});

test("interpret() exposes every declared component (name/params/body) for the client-side rebuild to instantiate", () => {
  const result = run(`
    component Card(title) {
      heading h { content: title }
    }
    page Home {
      Card only { title: "hi" }
    }
  `);
  assert.equal(result.components.length, 1);
  assert.equal(result.components[0].name, "Card");
  assert.deepEqual(result.components[0].params, ["title"]);
});

// ---- PageBuilder, exported for domClient.js's client-side scratch rebuild --

test("PageBuilder is a real exported class, constructible standalone (the same shape domClient.js instantiates it with)", () => {
  assert.equal(typeof PageBuilder, "function");
  const globalEnv = createGlobalEnv();
  const builder = new PageBuilder("scratch", new Map(), globalEnv, new Map());
  assert.equal(builder.kind, "page");
  assert.deepEqual(builder.objects, []);
});

test("a scratch PageBuilder can re-run an ordinary object declaration against a live env, the same way domClient.js's reactive-block rebuild does", () => {
  const globalEnv = createGlobalEnv();
  const env = globalEnv.child();
  env.define("label", "hello");
  const builder = new PageBuilder("scratch", new Map(), globalEnv, new Map());
  builder.runStatements(parseBody(`text greeting { content: label }`), env, null);
  assert.equal(builder.objects.length, 1);
  assert.equal(builder.objects[0].name, "greeting");
  assert.equal(builder.objects[0].content, "hello");
});

test("a scratch PageBuilder still validates - an unknown property throws the same clear error build time would give", () => {
  const globalEnv = createGlobalEnv();
  const builder = new PageBuilder("scratch", new Map(), globalEnv, new Map());
  assert.throws(
    () => builder.runStatements(parseBody(`text greeting { bogus: 1 }`), globalEnv.child(), null),
    (e) => e instanceof AxisRuntimeError && /doesn't have a 'bogus' property/.test(e.message)
  );
});

test("re-running the same 'for' body against a scratch builder twice, with a different array each time, produces a fresh, independent object list each time (nothing is retained between calls - a new scratch is exactly what domClient.js constructs per rebuild pass)", () => {
  const globalEnv = createGlobalEnv();
  const body = parseBody(`for i in items { text ("t" + i) { content: str(i) } }`);

  const firstEnv = globalEnv.child();
  firstEnv.define("items", [1, 2]);
  const first = new PageBuilder("scratch", new Map(), globalEnv, new Map());
  first.runStatements(body, firstEnv, null);
  assert.deepEqual(first.objects.map((o) => o.name), ["t1", "t2"]);

  const secondEnv = globalEnv.child();
  secondEnv.define("items", [1, 2, 3]);
  const second = new PageBuilder("scratch", new Map(), globalEnv, new Map());
  second.runStatements(body, secondEnv, null);
  assert.deepEqual(second.objects.map((o) => o.name), ["t1", "t2", "t3"]);
});
