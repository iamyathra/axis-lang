// A real regression this session hit: scene3d.js statically imports
// three.js, and domServer.js only serves three.js when a page actually has
// a `viewport` - but domClient.js used to statically import scene3d.js
// unconditionally. A static ES module import that 404s poisons the *whole*
// importing module's evaluation - not just the missing piece - so every
// page silently lost all its interactivity (no `on` handler ran, no
// reactive re-render happened) the moment that combination existed, with
// no error visible anywhere a status-code-only test would look. Fixed by
// making that import dynamic, gated on whether the page actually has a
// viewport (see domClient.js).
//
// This test is the general safety net for that whole *class* of mistake:
// it actually walks the static import graph a browser would resolve,
// starting from the entry script the HTML shell references, and asserts
// every file in it is servable. dom-e2e-server.test.js and
// page-scene-fusion.test.js check individual routes; this checks the graph
// holds together as a whole, the way a real page load actually depends on.

import { test } from "node:test";
import assert from "node:assert/strict";
import { run } from "../src/run.js";
import { buildDomPlan } from "../src/renderer/domPlan.js";
import { buildRenderPlan } from "../src/renderer/plan.js";
import { startDomServer } from "../src/renderer/domServer.js";
import { startServer } from "../src/renderer/server.js";

// Deliberately simple (no real JS parser) - this only ever looks at AXIS's
// own small, hand-written set of browser runtime files, not arbitrary code.
const STATIC_IMPORT_RE = /^\s*import\s+(?:[^"'{}]+|\{[^}]*\})\s+from\s+["']([^"']+)["'];?\s*$/gm;

async function assertModuleGraphResolves(base, entryPath, visited = new Set()) {
  if (visited.has(entryPath)) return;
  visited.add(entryPath);
  const res = await fetch(`${base}${entryPath}`);
  assert.equal(res.status, 200, `${entryPath} must be servable - a 404 here would silently break every static importer of it`);
  const text = await res.text();
  for (const [, spec] of text.matchAll(STATIC_IMPORT_RE)) {
    if (!spec.startsWith("/")) continue; // a bare specifier ("three") only resolves via an importmap, not a fetchable path here
    await assertModuleGraphResolves(base, spec, visited);
  }
}

test("a page with no viewport: domClient.js's whole static import graph resolves (no 404s)", async () => {
  const plan = buildDomPlan(run(`page Home { button go { label: "Go" } on go.click { } }`));
  const server = await startDomServer(plan);
  try {
    await assertModuleGraphResolves(`http://localhost:${server.address().port}`, "/domClient.js");
  } finally {
    server.close();
  }
});

test("a page WITH a viewport: domClient.js's whole static import graph resolves (no 404s)", async () => {
  const plan = buildDomPlan(run(`scene Earth { cube box { color: red } } page Home { viewport hero { scene: "Earth" } }`));
  const server = await startDomServer(plan);
  try {
    await assertModuleGraphResolves(`http://localhost:${server.address().port}`, "/domClient.js");
  } finally {
    server.close();
  }
});

test("a whole-scene file: client.js's whole static import graph resolves, including three.js (no 404s)", async () => {
  const plan = buildRenderPlan(run(`scene main { cube box { color: red } }`));
  const server = await startServer(plan);
  try {
    await assertModuleGraphResolves(`http://localhost:${server.address().port}`, "/client.js");
  } finally {
    server.close();
  }
});
