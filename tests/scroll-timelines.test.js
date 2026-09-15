// Covers `viewport { scrollTimeline: "name" }` - turning ordinary page
// scroll into a `timeline`'s progress, a scroll *driver* for the existing
// timeline engine, not a second animation system. What's build-time-
// checkable (grammar, validating the name against the embedded scene's own
// timelines, what the DOM plan ships) is covered here; the actual
// scroll-position measurement, progress formula, and driver hand-off
// (playback <-> scroll) are client-side behavior with no Node-testable
// surface - see docs/language.md's Timelines section and session notes on
// real browser verification for that half.

import { test } from "node:test";
import assert from "node:assert/strict";
import { run } from "../src/run.js";
import { AxisRuntimeError } from "../src/interpreter.js";
import { buildDomPlan } from "../src/renderer/domPlan.js";

test("a viewport accepts 'scrollTimeline' naming a timeline the embedded scene actually declares", () => {
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

test("'scrollTimeline' naming a timeline that doesn't exist in the embedded scene is a clear error", () => {
  assert.throws(
    () => run(`
      scene reveal { cube box{} timeline intro { animate box { position.y -> 1 duration: 100 } } }
      page Home { viewport stage { scene: "reveal" scrollTimeline: "outro" } }
    `),
    (err) => err instanceof AxisRuntimeError && /'scrollTimeline' names 'outro' - no timeline with that name in scene 'reveal'/.test(err.message)
  );
});

test("'scrollTimeline' works even when the scene has more than one timeline", () => {
  const result = run(`
    scene reveal {
      cube box{}
      timeline intro { animate box { position.y -> 1 duration: 100 } }
      timeline outro { animate box { position.y -> 0 duration: 100 } }
    }
    page Home { viewport stage { scene: "reveal" scrollTimeline: "outro" } }
  `);
  const viewport = result.pages[0].nodes.find((n) => n.name === "stage");
  assert.equal(viewport.scrollTimeline, "outro");
});

test("a viewport with no 'scrollTimeline' is unaffected - plain embedding still works", () => {
  const result = run(`
    scene reveal { cube box{} }
    page Home { viewport stage { scene: "reveal" } }
  `);
  const viewport = result.pages[0].nodes.find((n) => n.name === "stage");
  assert.equal(viewport.scrollTimeline, undefined);
});

// ---- DOM plan -------------------------------------------------------------

test("the DOM plan carries 'scrollTimeline' through on the viewport node", () => {
  const result = run(`
    scene reveal { cube box{} timeline intro { animate box { position.y -> 1 duration: 100 } } }
    page Home { viewport stage { scene: "reveal" scrollTimeline: "intro" } }
  `);
  const plan = buildDomPlan(result);
  const viewport = plan.nodes.find((n) => n.name === "stage");
  assert.equal(viewport.scrollTimeline, "intro");
  assert.equal(viewport.scene.timelines[0].name, "intro");
});

test("the DOM plan omits 'scrollTimeline' when a viewport doesn't set one", () => {
  const result = run(`
    scene reveal { cube box{} }
    page Home { viewport stage { scene: "reveal" } }
  `);
  const plan = buildDomPlan(result);
  const viewport = plan.nodes.find((n) => n.name === "stage");
  assert.equal(viewport.scrollTimeline, undefined);
});

test("'scrollTimeline' works alongside every other viewport property (size, radius, position)", () => {
  const result = run(`
    scene reveal { cube box{} timeline intro { animate box { position.y -> 1 duration: 100 } } }
    page Home {
      viewport stage {
        scene: "reveal"
        scrollTimeline: "intro"
        width: "100%"
        height: 1600
        radius: 16
      }
    }
  `);
  const plan = buildDomPlan(result);
  const viewport = plan.nodes.find((n) => n.name === "stage");
  assert.equal(viewport.scrollTimeline, "intro");
  assert.equal(viewport.style.height, "1600px");
  assert.equal(viewport.style.borderRadius, "16px");
});
