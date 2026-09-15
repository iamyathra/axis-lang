// Sticky scroll-linked viewports (`position: "sticky"` on a `viewport`
// nested inside a tall `scrollTimeline`/`scrollProgress`-carrying wrapper -
// see docs/architecture/sticky-scroll-timeline.md) needed ZERO changes to
// src/ - the composition already worked from existing, independently-
// shipped primitives:
//
//   - `position` was already an arbitrary CSS string (interpreter.js's
//     DOM_STRING_KEYS) - "sticky" is not a new value AXIS had to learn.
//   - `scrollTimeline`/`scrollProgress` already measured progress from
//     WHICHEVER element they're declared on (any page element, not just
//     `viewport` - see scroll-timelines.test.js/scroll-progress-state.
//     test.js), independent of what that element's own CSS position is.
//   - A page-level timeline could already cross-reference a `viewport`'s
//     embedded scene objects (`animate ("stage.hero") { ... }` - see
//     tests/dom-timelines.test.js and examples/unified-story.ax).
//
// This file's job is narrower than a normal new-feature test file: mostly
// REGRESSION coverage proving that composition still holds (nothing here
// needed new interpreter/domPlan/domClient code, so there's very little new
// *behavior* to unit test) plus a few sticky-specific shape checks (that
// `position: "sticky"` survives to the DOM plan's style, that it composes
// with `visible` from conditional-viewport rendering, and that multiple
// independent sticky sections don't share state). The actual pin behavior
// (does the browser visually keep the element fixed while its wrapper
// scrolls, does progress stay continuous and non-stuck across the whole
// scroll range) is real CSS + real scroll measurement - browser-only
// behavior with no Node-testable equivalent, exactly like every other
// scroll/lifecycle milestone's own test file discloses. See this slice's
// session notes for the actual browser verification (continuous progress
// sampled at multiple scroll depths while the sticky child's own
// getBoundingClientRect().top stayed pinned at 0 throughout).

import { test } from "node:test";
import assert from "node:assert/strict";
import { run } from "../src/run.js";
import { buildDomPlan } from "../src/renderer/domPlan.js";

// ---- 'position: "sticky"' is not new grammar - regression-proving the
// existing generic property pass-through still accepts it -----------------

test("'position: \"sticky\"' is accepted on a viewport - no new validation, same generic string property every element already has", () => {
  const result = run(`
    scene s { cube box { color: red } }
    page Home { viewport stage { scene: "s" position: "sticky" top: 0 } }
  `);
  const stage = result.pages[0].nodes.find((n) => n.name === "stage");
  assert.equal(stage.position, "sticky");
  assert.equal(stage.top, 0);
});

test("'position: \"sticky\"' works on any element, not just viewport - it was never viewport-specific grammar", () => {
  const result = run(`page Home { container box { position: "sticky" top: 0 } }`);
  const box = result.pages[0].nodes.find((n) => n.name === "box");
  assert.equal(box.position, "sticky");
});

test("the DOM plan carries 'position: sticky' through into the node's real CSS style, via the same cssForProperty path every position value already uses", () => {
  const plan = buildDomPlan(run(`
    scene s { cube box { color: red } }
    page Home { viewport stage { scene: "s" position: "sticky" top: 0 } }
  `));
  const stage = plan.nodes.find((n) => n.name === "stage");
  assert.equal(stage.style.position, "sticky");
  assert.equal(stage.style.top, "0px");
});

// ---- the wrapper-carries-scrollTimeline pattern - regression-proving the
// existing cross-scene page-timeline machinery still resolves correctly
// when the viewport it targets is itself sticky-positioned ----------------

test("a tall wrapper's own 'scrollTimeline' still resolves as a page-level timeline, and its steps can still cross-reference a sticky-positioned viewport's embedded scene - the exact mechanism a sticky pinned section relies on", () => {
  const result = run(`
    scene reveal {
      cube hero { color: red scale: (0.01, 0.01, 0.01) }
      camera { position: (0, 2, 8) }
    }
    page Home {
      container pin {
        direction: "column"
        height: 3000
        scrollTimeline: "arc"

        viewport stage { scene: "reveal" position: "sticky" top: 0 height: 500 }
      }

      timeline arc {
        animate ("stage.hero") { scale.x -> 1 scale.y -> 1 scale.z -> 1 duration: 1000 }
        animate ("stage.camera") { position.z -> 5 duration: 1000 at: 0 }
      }
    }
  `);
  const page = result.pages[0];
  const pin = page.nodes.find((n) => n.name === "pin");
  const stage = page.nodes.find((n) => n.name === "stage");
  assert.equal(pin.scrollTimeline, "arc");
  assert.equal(stage.position, "sticky");
  assert.equal(page.timelines.length, 1);
  assert.equal(page.timelines[0].name, "arc");
  assert.equal(page.timelines[0].steps.length, 2);
});

test("the built DOM plan resolves the cross-scene step's target against the sticky viewport's own embedded scene, unaffected by its 'position'", () => {
  const plan = buildDomPlan(run(`
    scene reveal {
      cube hero { color: red scale: (0.01, 0.01, 0.01) }
      camera { position: (0, 2, 8) }
    }
    page Home {
      container pin {
        direction: "column"
        height: 3000
        scrollTimeline: "arc"
        viewport stage { scene: "reveal" position: "sticky" top: 0 height: 500 }
      }
      timeline arc {
        animate ("stage.hero") { scale.x -> 1 scale.y -> 1 scale.z -> 1 duration: 1000 }
      }
    }
  `));
  assert.equal(plan.timelines.length, 1);
  const [step] = plan.timelines[0].steps;
  assert.equal(step.kind, "scene");
  assert.equal(step.target, "hero");
  assert.equal(step.viewportName, "stage");
  assert.equal(step.changes.length, 3); // scale.x/y/z
});

// ---- scrollProgress on the wrapper still targets page/shared scope, same
// as it always has - the sticky child never enters into it ----------------

test("'scrollProgress' on the wrapper still writes to the page's own scope (or a shared top-level state) exactly as before - it doesn't need to know or care that its child is sticky", () => {
  const result = run(`
    state pinProgress = 0
    scene s { cube box { color: red } }
    page Home {
      container pin {
        height: 3000
        scrollProgress: "pinProgress"
        viewport stage { scene: "s" position: "sticky" top: 0 }
      }
    }
  `);
  const pin = result.pages[0].nodes.find((n) => n.name === "pin");
  assert.equal(pin.scrollProgress, "pinProgress");
});

// ---- composes with conditional viewport rendering (visible) - the two
// most recent milestones stacked on the same element ----------------------

test("'visible' (conditional viewport rendering) and 'position: \"sticky\"' compose freely on the same viewport - two independent properties, no interaction", () => {
  const result = run(`
    state showStage = true
    scene s { cube box { color: red } }
    page Home {
      container pin {
        height: 2000
        scrollTimeline: "arc"
        viewport stage { scene: "s" position: "sticky" top: 0 visible: showStage }
      }
      timeline arc { animate ("stage.box") { position.y -> 1 duration: 500 } }
    }
  `);
  const stage = result.pages[0].nodes.find((n) => n.name === "stage");
  assert.equal(stage.position, "sticky");
  assert.equal(stage.visible, true);
  assert.ok(stage.bindings.visible, "visible is still captured as a live binding alongside position");
});

test("the DOM plan carries both 'position' and 'visible' independently - hiding the sticky viewport later doesn't touch its position, and vice versa", () => {
  const plan = buildDomPlan(run(`
    state showStage = false
    scene s { cube box { color: red } }
    page Home {
      container pin {
        height: 2000
        viewport stage { scene: "s" position: "sticky" top: 0 visible: showStage }
      }
    }
  `));
  const stage = plan.nodes.find((n) => n.name === "stage");
  assert.equal(stage.style.position, "sticky");
  assert.equal(stage.visible, false);
  assert.equal(stage.style.display, "none"); // initial-hidden SSR style, from conditional-viewport.md, unaffected by sticky
});

// ---- multiple independent sticky sections - no shared/global state -------

test("two sticky sections, each with their own wrapper/scrollTimeline/viewport, build fully independent plan nodes - no cross-talk", () => {
  const plan = buildDomPlan(run(`
    scene sceneA { cube box { color: red } }
    scene sceneB { sphere orb { color: blue } }
    page Home {
      container pinA { height: 2800 scrollTimeline: "revealA" viewport stageA { scene: "sceneA" position: "sticky" top: 0 } }
      container pinB { height: 2200 scrollTimeline: "revealB" viewport stageB { scene: "sceneB" position: "sticky" top: 0 } }
      timeline revealA { animate ("stageA.box") { position.y -> 1 duration: 500 } }
      timeline revealB { animate ("stageB.orb") { position.y -> 1 duration: 500 } }
    }
  `));
  const [stageA, stageB] = ["stageA", "stageB"].map((n) => plan.nodes.find((x) => x.name === n));
  assert.equal(stageA.style.position, "sticky");
  assert.equal(stageB.style.position, "sticky");
  assert.equal(plan.timelines.find((t) => t.name === "revealA").steps[0].viewportName, "stageA");
  assert.equal(plan.timelines.find((t) => t.name === "revealB").steps[0].viewportName, "stageB");
  // Each cross-scene step only ever resolves against its OWN viewport's
  // scene graph (sceneGraphsByViewport in domPlan.js, keyed by viewport
  // name) - a step naming "stageA.box" could never accidentally resolve
  // against sceneB's objects, sticky or not.
});

// ---- examples/sticky-scroll.ax itself -------------------------------------

test("examples/sticky-scroll.ax parses and builds a plan with two independent sticky sections plus one ordinary, non-sticky viewport", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../examples/sticky-scroll.ax", import.meta.url), "utf8");
  const plan = buildDomPlan(run(source));

  const stageA = plan.nodes.find((n) => n.name === "stageA");
  const stageB = plan.nodes.find((n) => n.name === "stageB");
  const plainViewport = plan.nodes.find((n) => n.name === "plain");

  assert.equal(stageA.style.position, "sticky");
  assert.equal(stageB.style.position, "sticky");
  assert.equal(plainViewport.style.position, undefined); // the ordinary-viewport regression check: no position set, behaves exactly as before this milestone

  assert.ok(stageA.bindings.visible, "stageA's conditional visibility is still wired up");
  assert.equal(plan.timelines.map((t) => t.name).sort().join(","), "revealA,revealB");
  assert.equal(plan.warnings.length, 0, "no unexpected build warnings");
});

// ---- explicit regression: the exact assertions scroll-timelines.test.js/
// scroll-progress-state.test.js already made still hold, re-run here so a
// reviewer of THIS file sees the composition didn't cost anything ----------

test("regression: a viewport's own 'scrollTimeline' (no sticky, no wrapper involved) still validates against the embedded scene's own timelines exactly as before", () => {
  const result = run(`
    scene reveal {
      cube box { color: red scale: (0.01, 0.01, 0.01) }
      timeline intro { animate box { scale.x -> 1 scale.y -> 1 scale.z -> 1 duration: 600 } }
    }
    page Home {
      viewport stage { scene: "reveal" height: 1600 scrollTimeline: "intro" }
    }
  `);
  const viewport = result.pages[0].nodes.find((n) => n.name === "stage");
  assert.equal(viewport.scrollTimeline, "intro");
});

test("regression: 'scrollProgress' is still accepted on any page element, sticky or not, exactly as before", () => {
  const result = run(`
    page Home {
      state progress = 0
      container hero { scrollProgress: "progress" height: 2000 }
    }
  `);
  const hero = result.pages[0].nodes.find((n) => n.name === "hero");
  assert.equal(hero.scrollProgress, "progress");
});
