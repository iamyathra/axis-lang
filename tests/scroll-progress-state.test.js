// Covers `scrollProgress: "name"` - the data half of scroll, alongside
// `scrollTimeline`'s animation half: an element's own scroll progress
// (0-1, the exact same measurement `scrollTimeline` already uses) written
// into a `state`/`let` through the *existing* reactive-state machinery
// (Environment.set + reRender), not a bespoke scroll-to-value pipeline.
// On a `viewport` it targets the *embedded scene's* own variable
// (validated at build time, like `scrollTimeline`); on any other element,
// the page's own (validated at runtime, like `scrollTimeline`'s page-scope
// case, since a page-level variable can be declared anywhere in the file).
//
// What's build-time-checkable (grammar, validation, what the DOM plan
// ships) is covered here; the actual per-frame write-and-reRender is
// client-side behavior with no Node-testable surface - see docs/
// language.md's Timelines section and session notes on real browser
// verification for that half.

import { test } from "node:test";
import assert from "node:assert/strict";
import { run } from "../src/run.js";
import { AxisRuntimeError } from "../src/interpreter.js";
import { buildDomPlan } from "../src/renderer/domPlan.js";

// ---- grammar & validation --------------------------------------------

test("'scrollProgress' is accepted on any page element, not just viewport", () => {
  const result = run(`
    page Home {
      state progress = 0
      container hero { scrollProgress: "progress" height: 2000 }
    }
  `);
  const hero = result.pages[0].nodes.find((n) => n.name === "hero");
  assert.equal(hero.scrollProgress, "progress");
});

test("'scrollProgress' and 'scrollTimeline' can be set together on the same element", () => {
  const result = run(`
    page Home {
      state progress = 0
      heading title { content: "hi" opacity: 0 }
      timeline intro { animate title { opacity -> 1 duration: 500 } }
      container hero { scrollTimeline: "intro" scrollProgress: "progress" height: 2000 }
    }
  `);
  const hero = result.pages[0].nodes.find((n) => n.name === "hero");
  assert.equal(hero.scrollTimeline, "intro");
  assert.equal(hero.scrollProgress, "progress");
});

test("on a viewport, 'scrollProgress' is validated against the embedded scene's own variables", () => {
  const result = run(`
    scene s { camera{} state amount = 0 cube box { scale: (1 + amount, 1, 1) } }
    page Home { viewport stage { scene: "s" scrollProgress: "amount" } }
  `);
  const stage = result.pages[0].nodes.find((n) => n.name === "stage");
  assert.equal(stage.scrollProgress, "amount");
});

test("on a viewport, an unknown 'scrollProgress' name is a clear build-time error", () => {
  assert.throws(
    () => run(`
      scene s { camera{} state amount = 0 cube box{} }
      page Home { viewport stage { scene: "s" scrollProgress: "nope" } }
    `),
    (err) => err instanceof AxisRuntimeError && /'scrollProgress' names 'nope' - no state\/let with that name in scene 's'/.test(err.message)
  );
});

test("on a viewport, a top-level 'let' (not just 'state') is a valid scrollProgress target - the same non-discriminating reactivity a state binding already gets", () => {
  const result = run(`
    scene s { camera{} let amount = 0 cube box{} }
    page Home { viewport stage { scene: "s" scrollProgress: "amount" } }
  `);
  assert.equal(result.pages[0].nodes.find((n) => n.name === "stage").scrollProgress, "amount");
});

test("a page-scoped 'scrollProgress' name isn't validated at build time (the state can be declared later in the file)", () => {
  const result = run(`
    page Home {
      container hero { scrollProgress: "laterState" height: 2000 }
      state laterState = 0
    }
  `);
  assert.equal(result.pages[0].nodes.find((n) => n.name === "hero").scrollProgress, "laterState");
});

test("'scrollProgress' with no matching declaration anywhere still parses/interprets cleanly (a runtime-only error, like page-scope scrollTimeline)", () => {
  const result = run(`page Home { container hero { scrollProgress: "neverDeclared" height: 2000 } }`);
  assert.equal(result.pages[0].nodes.find((n) => n.name === "hero").scrollProgress, "neverDeclared");
});

// ---- DOM plan -------------------------------------------------------------

test("the DOM plan carries 'scrollProgress' through on any node type", () => {
  const result = run(`
    page Home {
      state progress = 0
      container hero { scrollProgress: "progress" height: 2000 }
    }
  `);
  const plan = buildDomPlan(result);
  assert.equal(plan.nodes.find((n) => n.name === "hero").scrollProgress, "progress");
});

test("the DOM plan carries 'scrollProgress' through on a viewport node, alongside its scene plan", () => {
  const result = run(`
    scene s { camera{} state amount = 0 cube box{} }
    page Home { viewport stage { scene: "s" scrollProgress: "amount" } }
  `);
  const plan = buildDomPlan(result);
  const stage = plan.nodes.find((n) => n.name === "stage");
  assert.equal(stage.scrollProgress, "amount");
  assert.ok(stage.scene); // the embedded scene plan is still there, unaffected
});

test("the DOM plan omits 'scrollProgress' when an element doesn't set one", () => {
  const result = run(`page Home { heading t { content: "x" } }`);
  const plan = buildDomPlan(result);
  assert.equal(plan.nodes.find((n) => n.name === "t").scrollProgress, undefined);
});
