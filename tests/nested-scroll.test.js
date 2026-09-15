// `scrollRoot: "wrapper"` - the one piece of the "tall wrapper, pinned
// inner element" scrollytelling pattern that was still missing (see
// docs/architecture/nested-scroll.md and the README's own roadmap #1):
// `scrollTimeline`/`scrollProgress` can now measure against a scrollable
// *ancestor* container instead of always the document.

import { test } from "node:test";
import assert from "node:assert/strict";
import { run } from "../src/run.js";
import { buildDomPlan } from "../src/renderer/domPlan.js";

test("'scrollRoot' naming a real ancestor is accepted and carried through to the plan", () => {
  const result = run(`
    page Home {
      container outer {
        css: "overflow-y: auto"
        height: 400

        container inner {
          scrollTimeline: "arc"
          scrollRoot: "outer"
          height: 2000
        }

        timeline arc { animate inner { opacity -> 1 duration: 500 } }
      }
    }
  `);
  const plan = buildDomPlan(result);
  const inner = plan.nodes.find((n) => n.name === "inner");
  assert.equal(inner.scrollRoot, "outer");
});

test("'scrollRoot' naming something that isn't an ancestor is a clear error", () => {
  assert.throws(
    () => run(`
      page Home {
        container outer { height: 400 }
        container inner { scrollRoot: "outer" scrollProgress: "p" }
      }
      state p = 0
    `),
    /'scrollRoot' names 'outer' - that's not an ancestor of 'inner'/
  );
});

test("'scrollRoot' naming a sibling (not an ancestor) is rejected the same way", () => {
  assert.throws(
    () => run(`
      state p = 0
      page Home {
        container a { height: 400 }
        container b { scrollRoot: "a" scrollProgress: "p" }
      }
    `),
    /that's not an ancestor of 'b'/
  );
});

test("'scrollRoot' naming a name that doesn't exist at all gets a 'did you mean' suggestion", () => {
  assert.throws(
    () => run(`
      state p = 0
      page Home {
        container outer {
          container innerish { scrollRoot: "outr" scrollProgress: "p" }
        }
      }
    `),
    /'scrollRoot' names 'outr'.*did you mean 'outer'/
  );
});

test("a deeply-nested element can name a grandparent (or further) as its scrollRoot, not just its immediate parent", () => {
  const result = run(`
    state p = 0
    page Home {
      container outer {
        container middle {
          container inner { scrollRoot: "outer" scrollProgress: "p" }
        }
      }
    }
  `);
  const plan = buildDomPlan(result);
  assert.equal(plan.nodes.find((n) => n.name === "inner").scrollRoot, "outer");
});

test("an element can't name itself as its own scrollRoot", () => {
  assert.throws(
    () => run(`
      state p = 0
      page Home { container outer { scrollRoot: "outer" scrollProgress: "p" } }
    `),
    /that's not an ancestor of 'outer'/
  );
});

test("'scrollRoot' also validates on a 'viewport' element, not just plain containers", () => {
  const result = run(`
    scene s { camera { position: (0, 2, 5) } timeline arc { animate camera { position.z -> 4 duration: 500 } } }
    page Home {
      container outer {
        viewport stage { scene: "s" scrollTimeline: "arc" scrollRoot: "outer" }
      }
    }
  `);
  const plan = buildDomPlan(result);
  assert.equal(plan.nodes.find((n) => n.name === "stage").scrollRoot, "outer");
});

test("'scrollRoot' works without either scrollTimeline or scrollProgress set too - validated independently, since it's a UNIVERSAL_DOM_PROP", () => {
  // Not a useful thing to do, but not an error either - the property
  // itself doesn't require its siblings to be present.
  const result = run(`page Home { container outer { container inner { scrollRoot: "outer" } } }`);
  assert.equal(result.pages[0].nodes.find((n) => n.name === "inner").scrollRoot, "outer");
});

test("omitting 'scrollRoot' entirely still means 'measure against the document' - fully backward compatible", () => {
  const result = run(`
    state p = 0
    page Home { container hero { height: 2000 scrollProgress: "p" } }
  `);
  const plan = buildDomPlan(result);
  assert.equal(plan.nodes[0].scrollRoot, undefined);
});
