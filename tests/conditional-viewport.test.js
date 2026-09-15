// Conditional viewport rendering (`visible: expr` on a `viewport`, wired to
// mountViewport/unmountViewport - see
// docs/architecture/conditional-viewport.md) is, like the rest of the
// viewport lifecycle, mostly browser-runtime behavior with no Node-testable
// equivalent: mounting/unmounting a scene3d.js runtime needs a WebGL
// context and a real requestAnimationFrame clock, neither of which exist
// under `node --test`. See viewport-lifecycle.test.js's header for why this
// repo treats every other three.js-only behavior the same way - the actual
// mount/unmount/re-mount/race behavior is covered by the browser
// verification in this slice's session notes instead.
//
// What's genuinely Node-testable here is the build-time contract
// domClient.js's own conditional-mount logic depends on: that `visible`
// parses, type-checks, defaults correctly, is scoped to `viewport` only
// (not a general conditional-rendering property), and survives the
// interpreter -> domPlan pipeline as exactly the shape domClient.js reads
// (`node.visible`, `node.bindings.visible`, and - for an initially-hidden
// viewport - `node.style.display`) without disturbing anything else the
// render-on-demand/scroll/lifecycle slices already established.

import { test } from "node:test";
import assert from "node:assert/strict";
import { run } from "../src/run.js";
import { buildDomPlan } from "../src/renderer/domPlan.js";
import { startDomServer } from "../src/renderer/domServer.js";

// ---- interpreter: parsing/type-checking/defaults --------------------------

test("a viewport defaults to visible: true when the property isn't set", () => {
  const result = run(`
    scene s { cube box { color: red } }
    page Home { viewport v { scene: "s" } }
  `);
  const viewport = result.pages[0].nodes.find((n) => n.name === "v");
  assert.equal(viewport.visible, true);
  assert.equal(viewport.bindings?.visible, undefined); // a literal default isn't worth tracking as a live binding
});

test("'visible: false' (a literal) is accepted, and isn't stashed as a binding either - literals never change", () => {
  const result = run(`
    scene s { cube box { color: red } }
    page Home { viewport v { scene: "s" visible: false } }
  `);
  const viewport = result.pages[0].nodes.find((n) => n.name === "v");
  assert.equal(viewport.visible, false);
  assert.equal(viewport.bindings?.visible, undefined);
});

test("'visible: someState' (a non-literal expression) is captured live, as a binding - the reactive case", () => {
  const result = run(`
    state showScene = true
    scene s { cube box { color: red } }
    page Home { viewport v { scene: "s" visible: showScene } }
  `);
  const viewport = result.pages[0].nodes.find((n) => n.name === "v");
  assert.equal(viewport.visible, true); // the state's own initial value, resolved at build time
  assert.ok(viewport.bindings?.visible, "the raw expression is stashed for domClient.js to re-evaluate reactively");
});

test("'visible' needs a real boolean, not a string/number - a clear error, not a silent coercion", () => {
  assert.throws(
    () => run(`scene s { cube box { color: red } } page Home { viewport v { scene: "s" visible: "yes" } }`),
    /'visible' needs true or false/
  );
  assert.throws(
    () => run(`scene s { cube box { color: red } } page Home { viewport v { scene: "s" visible: 1 } }`),
    /'visible' needs true or false/
  );
});

test("'visible' also works on any other element now - a plain display toggle, not a 3D-runtime lifecycle switch (that stays viewport-only)", () => {
  const boxResult = run(`page Home { container box { visible: true } }`);
  assert.equal(boxResult.pages[0].nodes[0].visible, true);

  const labelResult = run(`page Home { text label { content: "hi" visible: false } }`);
  const plan = buildDomPlan(labelResult);
  assert.equal(plan.nodes[0].visible, false);
  assert.equal(plan.nodes[0].style.display, "none");
});

test("a plain element with no 'visible' property carries no 'visible' field at all - the plan stays lean for the common case", () => {
  const result = run(`page Home { container box {} }`);
  const plan = buildDomPlan(result);
  assert.equal(plan.nodes[0].visible, undefined);
  assert.equal(plan.nodes[0].style.display, undefined);
});

test("'visible' still needs a boolean, on any element type", () => {
  assert.throws(() => run(`page Home { container box { visible: "yes" } }`), /'visible' needs true or false/);
});

test("toggling 'showScene = !showScene' from an 'on click' handler is ordinary AXIS - '!' on a real boolean state just works", () => {
  const result = run(`
    state showScene = true
    scene s { cube box { color: red } }
    page Home {
      viewport v { scene: "s" visible: showScene }
      button toggle { label: "Toggle" }
      on toggle.click { showScene = !showScene }
    }
  `);
  const page = result.pages[0];
  assert.equal(page.handlers.length, 1);
  assert.equal(page.handlers[0].target, "toggle");
  assert.equal(page.handlers[0].event, "click");
});

// ---- domPlan: what domClient.js actually reads at runtime -----------------

test("the DOM plan carries 'visible' through as a plain boolean field on the viewport node", () => {
  const plan = buildDomPlan(run(`
    scene s { cube box { color: red } }
    page Home { viewport v { scene: "s" visible: false } }
  `));
  const v = plan.nodes.find((n) => n.name === "v");
  assert.equal(v.visible, false);
});

test("an initially-hidden viewport is baked into the SSR style as display: none - no flash of an empty box before domClient.js hydrates", () => {
  const plan = buildDomPlan(run(`
    scene s { cube box { color: red } }
    page Home { viewport v { scene: "s" visible: false } }
  `));
  const v = plan.nodes.find((n) => n.name === "v");
  assert.equal(v.style.display, "none");
});

test("a visible (default or explicit true) viewport's style carries no 'display' override - ordinary flow, unchanged from before this slice", () => {
  const plan = buildDomPlan(run(`
    scene s { cube box { color: red } }
    page Home {
      viewport a { scene: "s" }
      viewport b { scene: "s" visible: true }
    }
  `));
  for (const name of ["a", "b"]) {
    const node = plan.nodes.find((n) => n.name === name);
    assert.equal(node.style.display, undefined);
  }
});

test("a reactive 'visible' binding survives into the DOM plan as node.bindings.visible - the exact AST domClient.js's reRender() re-evaluates", () => {
  const plan = buildDomPlan(run(`
    state showScene = true
    scene s { cube box { color: red } }
    page Home { viewport v { scene: "s" visible: showScene } }
  `));
  const v = plan.nodes.find((n) => n.name === "v");
  assert.ok(v.bindings.visible, "the binding is present");
  assert.equal(v.bindings.visible.kind, "Identifier");
  assert.equal(v.bindings.visible.value, "showScene");
});

test("multiple viewports track 'visible' fully independently - one hidden, one not, no cross-talk in the plan", () => {
  const plan = buildDomPlan(run(`
    state showB = false
    scene s { cube box { color: red } }
    page Home {
      viewport a { scene: "s" }
      viewport b { scene: "s" visible: showB }
      viewport c { scene: "s" visible: false }
    }
  `));
  const [a, b, c] = ["a", "b", "c"].map((name) => plan.nodes.find((n) => n.name === name));
  assert.equal(a.visible, true);
  assert.equal(a.style.display, undefined);
  assert.equal(a.bindings.visible, undefined);

  assert.equal(b.visible, false); // showB's own initial value
  assert.equal(b.style.display, "none");
  assert.ok(b.bindings.visible);

  assert.equal(c.visible, false);
  assert.equal(c.style.display, "none");
  assert.equal(c.bindings.visible, undefined); // a literal, not a binding
});

// ---- regression: everything the render-on-demand/scroll/lifecycle slices
// already established still builds the exact same shape it always did -----

test("examples/conditional-viewport.ax itself parses and builds a plan with both viewports, B carrying scroll/animation/timeline exactly as authored", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../examples/conditional-viewport.ax", import.meta.url), "utf8");
  const plan = buildDomPlan(run(source));
  const [a, b] = ["A", "B"].map((name) => plan.nodes.find((n) => n.name === name));
  assert.ok(a && b);
  assert.equal(a.visible, true);
  assert.equal(a.bindings.visible, undefined);
  assert.equal(b.bindings.visible !== undefined, true);
  assert.equal(b.scene.animations.length, 1);
  assert.equal(b.scene.timelines.length, 1);
  assert.equal(b.scrollTimeline, "spin");
  assert.equal(b.scrollProgress, "progress");
});

test("examples/viewport-lifecycle.ax, examples/render-on-demand.ax, and examples/scroll-progress.ax are unaffected - none of them use 'visible', so every viewport still defaults to visible: true", async () => {
  const { readFile } = await import("node:fs/promises");
  for (const file of ["viewport-lifecycle.ax", "render-on-demand.ax", "scroll-progress.ax"]) {
    const source = await readFile(new URL(`../examples/${file}`, import.meta.url), "utf8");
    const plan = buildDomPlan(run(source));
    const viewports = plan.nodes.filter((n) => n.type === "viewport");
    assert.ok(viewports.length > 0, `${file} has at least one viewport`);
    for (const v of viewports) {
      assert.equal(v.visible, true);
      assert.equal(v.style.display, undefined);
    }
  }
});

test("the served page for examples/conditional-viewport.ax still renders one real container element per viewport, by name", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../examples/conditional-viewport.ax", import.meta.url), "utf8");
  const plan = buildDomPlan(run(source));
  const server = await startDomServer(plan);
  const port = server.address().port;
  try {
    const html = await (await fetch(`http://localhost:${port}/`)).text();
    for (const name of ["A", "B"]) {
      assert.match(html, new RegExp(`data-axis-name="${name}"`));
    }
    assert.match(html, /\/domClient\.js/);
  } finally {
    server.close();
  }
});
