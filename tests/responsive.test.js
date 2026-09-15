// `responsive: { tablet: { ... } mobile: { ... } }` - the smallest coherent
// mechanism for responsive layout (see docs/architecture/responsive-layout.md):
// two fixed breakpoints, compiling straight to real `@media` CSS rather
// than a JS-driven `state`, so it's correct on the very first paint,
// before any hydration.

import { test } from "node:test";
import assert from "node:assert/strict";
import { run } from "../src/run.js";
import { buildDomPlan } from "../src/renderer/domPlan.js";
import { renderPageHtml } from "../src/renderer/domHtml.js";

test("a container's 'responsive' overrides are validated and stored per breakpoint", () => {
  const result = run(`
    page Home {
      container hero {
        direction: "row"
        gap: 24
        responsive: {
          tablet: { gap: 16 }
          mobile: { direction: "column" gap: 8 }
        }
      }
    }
  `);
  const hero = result.pages[0].nodes[0];
  assert.deepEqual(hero.responsive, { tablet: { gap: 16 }, mobile: { direction: "column", gap: 8 } });
});

test("an unknown breakpoint name is a clear error with a suggestion", () => {
  assert.throws(
    () => run(`page Home { container hero { responsive: { desktop: { gap: 8 } } } }`),
    /'responsive' doesn't have a 'desktop' breakpoint.*try tablet or mobile/
  );
});

test("'responsive' itself must be a record", () => {
  assert.throws(() => run(`page Home { container hero { responsive: "mobile" } }`), /'responsive' needs a record/);
});

test("a breakpoint's own value must be a record too", () => {
  assert.throws(() => run(`page Home { container hero { responsive: { mobile: "column" } } }`), /'responsive.mobile' needs a record of properties/);
});

test("only a real, CSS-mappable property can appear inside a breakpoint - 'content' can't, since there's no way to change it via CSS alone", () => {
  assert.throws(
    () => run(`page Home { text label { content: "hi" responsive: { mobile: { content: "hey" } } } }`),
    /'responsive' can't override 'content'/
  );
});

test("a property the element type doesn't have at all is still rejected the same way inside 'responsive' as it would be at the top level", () => {
  assert.throws(
    () => run(`page Home { button go { label: "go" responsive: { mobile: { align: "center" } } } }`),
    /'responsive' can't override 'align' on a 'button'/
  );
});

test("'responsive' is not tracked as a live binding - it's evaluated once, like every other static-in-v1 property", () => {
  const result = run(`
    state gapAmount = 24
    page Home {
      container hero {
        gap: gapAmount
        responsive: { mobile: { gap: 8 } }
      }
    }
  `);
  const hero = result.pages[0].nodes[0];
  assert.equal(hero.bindings.gap !== undefined, true); // the base 'gap' IS reactive
  assert.equal(hero.bindings.responsive, undefined); // 'responsive' itself never is
});

test("domPlan.js compiles a node's 'responsive' data into CSS-ready declarations, grouped by breakpoint", () => {
  const result = run(`
    page Home {
      container hero {
        direction: "row"
        responsive: { mobile: { direction: "column" padding: 8 } }
      }
    }
  `);
  const plan = buildDomPlan(result);
  assert.deepEqual(plan.responsiveRules, [
    { name: "hero", tier: "mobile", style: { display: "flex", flexDirection: "column", padding: "8px" } },
  ]);
});

test("a page with no 'responsive' property anywhere carries an empty responsiveRules list - no wasted output", () => {
  const plan = buildDomPlan(run(`page Home { text label { content: "hi" } }`));
  assert.deepEqual(plan.responsiveRules, []);
});

test("domHtml.js renders a real <style> block with @media rules, tablet before mobile, using !important so it can actually override the element's own inline style", () => {
  const result = run(`
    page Home {
      container hero {
        direction: "row"
        responsive: {
          tablet: { gap: 16 }
          mobile: { direction: "column" }
        }
      }
    }
  `);
  const plan = buildDomPlan(result);
  const html = renderPageHtml(plan);

  const tabletIndex = html.indexOf("@media (max-width: 1024px)");
  const mobileIndex = html.indexOf("@media (max-width: 640px)");
  assert.ok(tabletIndex !== -1 && mobileIndex !== -1);
  assert.ok(tabletIndex < mobileIndex, "tablet rule must come before mobile so mobile wins at narrower widths");
  assert.match(html, /\[data-axis-name="hero"\] \{ gap: 16px !important; \}/);
  assert.match(html, /\[data-axis-name="hero"\] \{ display: flex !important; flex-direction: column !important; \}/);
});

test("a page with no 'responsive' anywhere emits no extra <style> block at all", () => {
  const plan = buildDomPlan(run(`page Home { text label { content: "hi" } }`));
  const html = renderPageHtml(plan);
  assert.ok(!html.includes("@media"));
});

test("the page's own <html> tag declares lang=\"en\" - a basic, always-on accessibility fix", () => {
  const html = renderPageHtml(buildDomPlan(run(`page Home { text label { content: "hi" } }`)));
  assert.match(html, /<html lang="en">/);
});

test("'responsive' works on a viewport's own box sizing too (width/height/etc - the plain style properties, not 'visible')", () => {
  const result = run(`
    scene s { camera { position: (0, 2, 5) } }
    page Home {
      viewport stage {
        scene: "s"
        width: 800
        height: 500
        responsive: { mobile: { height: 300 } }
      }
    }
  `);
  const viewport = result.pages[0].nodes[0];
  assert.deepEqual(viewport.responsive, { mobile: { height: 300 } });
});

test("'visible' can't be used inside 'responsive' yet - a real, current limitation, not silently ignored", () => {
  assert.throws(
    () => run(`page Home { container hero { responsive: { mobile: { visible: false } } } }`),
    /'responsive' can't override 'visible'/
  );
});
