// Covers `timeline` inside a `page` - DOM elements as first-class timeline
// targets (the same label/at/previous/stagger/play engine a scene's own
// timeline already has, just validated against a page element's small
// path vocabulary), and the flagship capability this unlocks: a single
// timeline step can cross-reference a `viewport`'s own embedded-scene
// object (`animate ("stage.centerpiece") { ... }`), so one timeline
// genuinely choreographs DOM and 3D together - not two timelines manually
// kept in sync. Also covers the generic `scrollTimeline` property (any
// element, not just `viewport`, driving a *page*-level timeline the same
// deterministic way `viewport.scrollTimeline` drives a scene-level one).
//
// What's build-time-checkable (parsing, target/path validation, scheduling
// math, what the DOM plan ships) is covered here; actual DOM mutation/
// scroll measurement is client-side behavior with no Node-testable surface
// - see docs/language.md's Timelines section and session notes on real
// browser verification for that half.

import { test } from "node:test";
import assert from "node:assert/strict";
import { run } from "../src/run.js";
import { AxisRuntimeError } from "../src/interpreter.js";
import { buildDomPlan } from "../src/renderer/domPlan.js";

// ---- DOM-only page timelines ------------------------------------------

test("a page timeline sequences plain DOM steps with the same label/at/previous engine a scene's has", () => {
  const result = run(`
    page Home {
      heading title { content: "hi" opacity: 0 }
      text subtitle { content: "sub" opacity: 0 }

      timeline intro {
        animate title { opacity -> 1 duration: 500 }
        label mid
        animate subtitle { opacity -> 1 duration: 300 at: mid + 100 }
      }
    }
  `);
  const [first, second] = result.pages[0].timelines[0].steps;
  assert.equal(first.at, 0);
  assert.equal(second.at, 600); // mid=500, +100
});

test("stagger works in a page timeline via an ordinary for-loop, same as a scene's", () => {
  const result = run(`
    page Home {
      for i in range(0, 3) {
        text ("card" + i) { content: "x" opacity: 0 }
      }
      timeline reveal {
        for i in range(0, 3) {
          animate ("card" + i) { opacity -> 1 duration: 200 at: i * 80 }
        }
      }
    }
  `);
  const steps = result.pages[0].timelines[0].steps;
  assert.deepEqual(steps.map((s) => s.at), [0, 80, 160]);
});

test("'play NAME' parses and resolves inside a page 'on' handler", () => {
  const result = run(`
    page Home {
      button go { label: "Go" opacity: 0 }
      timeline intro { animate go { opacity -> 1 duration: 200 } }
      on go.click { play intro }
    }
  `);
  assert.equal(result.pages[0].handlers[0].body[0].kind, "PlayStmt");
});

test("a duplicate page timeline name is a clear error", () => {
  assert.throws(
    () => run(`
      page Home {
        heading t { content: "x" }
        timeline intro { animate t { opacity -> 1 duration: 100 } }
        timeline intro { animate t { opacity -> 1 duration: 100 } }
      }
    `),
    (err) => err instanceof AxisRuntimeError && /timeline 'intro' is already defined in page 'Home'/.test(err.message)
  );
});

test("a page timeline step still validates against the page's own animatable paths", () => {
  assert.throws(
    () => run(`
      page Home {
        heading t { content: "x" }
        timeline intro { animate t { blur -> 4 duration: 100 } }
      }
    `),
    (err) => err instanceof AxisRuntimeError && /can't animate 'blur' on a page element/.test(err.message)
  );
});

test("a page timeline can animate 'color'/'background' on a DOM element with a color string", () => {
  const result = run(`
    page Home {
      heading t { content: "x" color: "#000000" }
      timeline intro {
        animate t { color -> "#ffffff" duration: 100 }
        animate t { background -> blue duration: 100 at: previous }
      }
    }
  `);
  const [colorStep, bgStep] = result.pages[0].timelines[0].steps;
  assert.deepEqual(colorStep.changes[0], { path: "color", toValue: "#ffffff", unit: null });
  assert.deepEqual(bgStep.changes[0], { path: "background", toValue: "blue", unit: null });
});

test("animating 'color' with a non-string value on a page element is a clear error", () => {
  assert.throws(
    () => run(`page Home { heading t { content: "x" } animate t { color -> 5 duration: 100 } }`),
    /animated value for 'color' must be a color name or a string/
  );
});

// ---- cross-domain (DOM + 3D in one timeline) ---------------------------

test("a page timeline step can cross-reference a viewport's own embedded-scene object", () => {
  const result = run(`
    scene reveal {
      camera { position: (0, 2, 10) }
      model centerpiece { src: "./x.glb" scale: (0.01, 0.01, 0.01) }
    }
    page Home {
      heading title { content: "hi" opacity: 0 }
      viewport stage { scene: "reveal" }

      timeline hero {
        animate title { opacity -> 1 duration: 500 }
        animate ("stage.centerpiece") { scale.x -> 1 scale.y -> 1 scale.z -> 1 duration: 700 at: previous }
        animate ("stage.camera") { position.z -> 6 duration: 700 at: previous }
      }
    }
  `);
  const [domStep, modelStep, cameraStep] = result.pages[0].timelines[0].steps;
  assert.equal(domStep.kind, "dom");
  assert.equal(modelStep.kind, "scene");
  assert.equal(modelStep.viewportName, "stage");
  assert.equal(modelStep.sceneTargetName, "centerpiece");
  assert.equal(cameraStep.sceneTargetName, "camera");
  // one continuous schedule across both domains, not two independent ones
  assert.equal(domStep.at, 0);
  assert.equal(modelStep.at, 500);
  assert.equal(cameraStep.at, 1200);
});

test("cross-referencing a nonexistent viewport is a clear error", () => {
  assert.throws(
    () => run(`
      scene s { camera{} cube box{} }
      page Home {
        viewport stage { scene: "s" }
        timeline t { animate ("nope.box") { position.y -> 1 duration: 100 } }
      }
    `),
    (err) => err instanceof AxisRuntimeError && /'nope' isn't a viewport in page 'Home'/.test(err.message)
  );
});

test("cross-referencing a real viewport but a nonexistent scene object is a clear error", () => {
  assert.throws(
    () => run(`
      scene s { camera{} cube box{} }
      page Home {
        viewport stage { scene: "s" }
        timeline t { animate ("stage.ghost") { position.y -> 1 duration: 100 } }
      }
    `),
    (err) => err instanceof AxisRuntimeError && /no object named 'ghost' in the scene viewport 'stage' embeds/.test(err.message)
  );
});

test("a cross-domain target with more than one dot is a clear error", () => {
  assert.throws(
    () => run(`
      scene s { camera{} cube box{} }
      page Home {
        viewport stage { scene: "s" }
        timeline t { animate ("stage.box.extra") { position.y -> 1 duration: 100 } }
      }
    `),
    (err) => err instanceof AxisRuntimeError && /exactly one '\.'/.test(err.message)
  );
});

test("a cross-domain step follows the scene's own value rules (color allowed, matching a 3D color path)", () => {
  const result = run(`
    scene s { camera{} cube box { color: red } }
    page Home {
      viewport stage { scene: "s" }
      timeline t { animate ("stage.box") { color -> blue duration: 100 } }
    }
  `);
  assert.equal(result.pages[0].timelines[0].steps[0].changes[0].toValue, "blue");
});

// ---- generic scrollTimeline (any element, page-scoped) ------------------

test("'scrollTimeline' is accepted on any page element, not just viewport", () => {
  const result = run(`
    page Home {
      container hero { scrollTimeline: "intro" height: 2000 }
      timeline intro { animate hero { opacity -> 1 duration: 500 } }
    }
  `);
  const hero = result.pages[0].nodes.find((n) => n.name === "hero");
  assert.equal(hero.scrollTimeline, "intro");
});

test("a page-scoped 'scrollTimeline' name isn't validated at build time (a page timeline can be declared later in the file)", () => {
  const result = run(`
    page Home {
      container hero { scrollTimeline: "laterTimeline" height: 2000 }
      heading t { content: "x" opacity: 0 }
      timeline laterTimeline { animate t { opacity -> 1 duration: 300 } }
    }
  `);
  assert.equal(result.pages[0].nodes.find((n) => n.name === "hero").scrollTimeline, "laterTimeline");
});

// ---- DOM plan -------------------------------------------------------------

test("the DOM plan resolves a DOM-only page timeline's steps (from/to/property)", () => {
  const result = run(`
    page Home {
      heading title { content: "hi" opacity: 0 }
      timeline intro { animate title { opacity -> 1 duration: 500 } }
    }
  `);
  const plan = buildDomPlan(result);
  const [step] = plan.timelines[0].steps;
  assert.equal(step.kind, "dom");
  assert.deepEqual(step.changes[0], { property: "opacity", from: 0, to: 1 });
});

test("the DOM plan resolves a cross-domain step's from/to against the viewport's own raw scene graph", () => {
  const result = run(`
    scene reveal {
      camera { position: (0, 2, 10) }
      model centerpiece { src: "./x.glb" scale: (0.2, 0.2, 0.2) }
    }
    page Home {
      viewport stage { scene: "reveal" }
      timeline hero { animate ("stage.centerpiece") { scale.x -> 1 duration: 500 } }
    }
  `);
  const plan = buildDomPlan(result);
  const [step] = plan.timelines[0].steps;
  assert.equal(step.kind, "scene");
  assert.equal(step.viewportName, "stage");
  assert.deepEqual(step.changes[0].path, ["scale", "x"]);
  assert.equal(step.changes[0].from, 0.2);
  assert.equal(step.changes[0].to, 1);
});

test("a mixed DOM+3D page timeline resolves both kinds of step in the DOM plan", () => {
  const result = run(`
    scene reveal { camera { position: (0, 2, 10) } cube box { color: red } }
    page Home {
      heading title { content: "hi" opacity: 0 }
      viewport stage { scene: "reveal" }
      timeline hero {
        animate title { opacity -> 1 duration: 400 }
        animate ("stage.box") { position.y -> 1 duration: 400 at: previous }
      }
    }
  `);
  const plan = buildDomPlan(result);
  const kinds = plan.timelines[0].steps.map((s) => s.kind);
  assert.deepEqual(kinds, ["dom", "scene"]);
});

test("the DOM plan warns and skips a page timeline step targeting an unsupported DOM path", () => {
  const result = run(`
    page Home {
      heading title { content: "hi" }
      timeline t { animate title { position.x -> 1 duration: 100 } }
    }
  `);
  // position.x IS supported (PATH_TO_PROPERTY has it) - use a genuinely
  // unsupported one by constructing a graph manually, mirroring the
  // existing renderer-plan.test.js pattern for this defensive check.
  result.pages[0].timelines[0].steps.push({ target: "title", kind: "dom", changes: [{ path: "not-a-real-path", toValue: 1, unit: null }], duration: 100, easing: "linear", at: 999 });
  const plan = buildDomPlan(result);
  assert.ok(plan.warnings.some((w) => w.includes("not-a-real-path")));
});

test("plan.timelines is empty for a page with none", () => {
  const result = run(`page Home { heading t { content: "x" } }`);
  const plan = buildDomPlan(result);
  assert.deepEqual(plan.timelines, []);
});
