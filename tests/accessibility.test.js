// Small, always-on accessibility fixes - see docs/architecture/
// accessibility-and-security.md. The reduced-motion extension (an
// infinite-repeat load-time `animate` now lands on its finished state for
// a `prefers-reduced-motion: reduce` visitor, not just a scroll-linked
// timeline) is pure runtime behavior with no Node-testable equivalent -
// see that doc for how it was actually verified (the same hand-rolled DOM
// shim reactive-structure.md and nested-scroll.md already used).

import { test } from "node:test";
import assert from "node:assert/strict";
import { run } from "../src/run.js";
import { buildDomPlan } from "../src/renderer/domPlan.js";
import { renderPageHtml } from "../src/renderer/domHtml.js";
import { renderHtml } from "../src/renderer/html.js";
import { buildRenderPlan } from "../src/renderer/plan.js";

test("a page's <html> tag declares lang=\"en\"", () => {
  const html = renderPageHtml(buildDomPlan(run(`page Home { text label { content: "hi" } }`)));
  assert.match(html, /^<!doctype html>\n<html lang="en">/);
});

test("a standalone scene file's <html> tag declares lang=\"en\" too - the same fix on the 3D-only renderer", () => {
  const html = renderHtml(buildRenderPlan(run(`scene main { camera { position: (0, 2, 5) } cube box { color: red } }`)));
  assert.match(html, /^<!doctype html>\n<html lang="en">/);
});
