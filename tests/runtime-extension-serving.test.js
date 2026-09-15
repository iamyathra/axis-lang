// Node-level coverage (a real HTTP server, real fetch() calls - no browser
// needed, same style as tests/e2e-server.test.js/tests/dom-e2e-server.test.js)
// that a package's own `runtimeExtension` (axis.json) actually reaches the
// browser: the right <script type="module"> tag, before /client.js's own
// (or /domClient.js's, for a page), and the extension's real file content
// served at that exact URL - both the scene-renderer path (server.js/
// html.js) and the DOM/page path (domServer.js/domHtml.js), since a page's
// embedded `viewport` shares scene3d.js with a whole-scene file. The actual
// "the extension's own code runs and the property works" proof is
// tests/browser/runtime-extension.test.js's job; this file only proves the
// resolution -> plan -> HTML -> serving pipeline carries the file through
// correctly. See docs/runtime-extensions.md.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveModules } from "../src/modules.js";
import { interpret } from "../src/interpreter.js";
import { buildRenderPlan } from "../src/renderer/plan.js";
import { buildDomPlan } from "../src/renderer/domPlan.js";
import { startServer, writeStaticSite } from "../src/renderer/server.js";
import { startDomServer, writeDomStaticSite } from "../src/renderer/domServer.js";

const SCENE_ENTRY = fileURLToPath(new URL("./fixtures/modules/uses-extension-package.ax", import.meta.url));
const EXTENSION_FILE = fileURLToPath(new URL("./fixtures/modules/axis_modules/with-extension/extension.js", import.meta.url));
const EXTENSION_SOURCE = readFileSync(EXTENSION_FILE, "utf8");

// The fixture (tests/fixtures/modules/uses-extension-package.ax) is a
// `page` - reused here for both the scene-renderer test (wrapping it isn't
// necessary; buildRenderPlan on a page-only program just renders no scene,
// but still carries `.extensions` through, which is the one thing this
// file actually checks) and the DOM test.

test("html.js emits an extension's <script> tag before /client.js's own", async () => {
  const program = resolveModules(SCENE_ENTRY);
  const plan = buildRenderPlan(interpret(program));
  assert.deepEqual(plan.extensions, [{ name: "with-extension", jsFile: EXTENSION_FILE }]);

  const server = await startServer(plan);
  try {
    const res = await fetch(`http://localhost:${server.address().port}/`);
    const html = await res.text();
    const extensionTagIndex = html.indexOf('src="/extensions/with-extension.js"');
    const clientTagIndex = html.indexOf('src="/client.js"');
    assert.ok(extensionTagIndex >= 0, "expected the extension's own <script> tag in the served HTML");
    assert.ok(clientTagIndex >= 0, "expected /client.js's own <script> tag in the served HTML");
    assert.ok(extensionTagIndex < clientTagIndex, "expected the extension's script tag before /client.js's - document order is what guarantees registration runs first");
  } finally {
    server.close();
  }
});

test("server.js serves the extension's real file content at its own URL", async () => {
  const program = resolveModules(SCENE_ENTRY);
  const plan = buildRenderPlan(interpret(program));
  const server = await startServer(plan);
  try {
    const res = await fetch(`http://localhost:${server.address().port}/extensions/with-extension.js`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "text/javascript");
    assert.equal(await res.text(), EXTENSION_SOURCE);
  } finally {
    server.close();
  }
});

test("server.js also serves /extensionRegistry.js unconditionally, since scene3d.js always imports it", async () => {
  const server = await startServer(buildRenderPlan(interpret({ kind: "Program", items: [] })));
  try {
    const res = await fetch(`http://localhost:${server.address().port}/extensionRegistry.js`);
    assert.equal(res.status, 200);
    assert.match(await res.text(), /registerScalarProperty/);
  } finally {
    server.close();
  }
});

test("a program with no extension-carrying imports serves a plain, extension-script-free page", async () => {
  const server = await startServer(buildRenderPlan(interpret({ kind: "Program", items: [] })));
  try {
    const res = await fetch(`http://localhost:${server.address().port}/`);
    const html = await res.text();
    assert.doesNotMatch(html, /\/extensions\//);
  } finally {
    server.close();
  }
});

// ---- the DOM/page path - domServer.js/domHtml.js ----

test("domHtml.js emits an extension's <script> tag before /domClient.js's own", async () => {
  const program = resolveModules(SCENE_ENTRY);
  const plan = buildDomPlan(interpret(program));
  assert.deepEqual(plan.extensions, [{ name: "with-extension", jsFile: EXTENSION_FILE }]);

  const server = await startDomServer(plan);
  try {
    const res = await fetch(`http://localhost:${server.address().port}/`);
    const html = await res.text();
    const extensionTagIndex = html.indexOf('src="/extensions/with-extension.js"');
    const domClientTagIndex = html.indexOf('src="/domClient.js"');
    assert.ok(extensionTagIndex >= 0);
    assert.ok(domClientTagIndex >= 0);
    assert.ok(extensionTagIndex < domClientTagIndex);
  } finally {
    server.close();
  }
});

test("domServer.js serves the extension's real file content, and /extensionRegistry.js + /extensionUrl.js unconditionally (domHtml.js is also loaded client-side, for reactive re-render)", async () => {
  const program = resolveModules(SCENE_ENTRY);
  const plan = buildDomPlan(interpret(program));
  const server = await startDomServer(plan);
  try {
    const port = server.address().port;
    const extRes = await fetch(`http://localhost:${port}/extensions/with-extension.js`);
    assert.equal(extRes.status, 200);
    assert.equal(await extRes.text(), EXTENSION_SOURCE);

    const registryRes = await fetch(`http://localhost:${port}/extensionRegistry.js`);
    assert.equal(registryRes.status, 200);

    const urlHelperRes = await fetch(`http://localhost:${port}/extensionUrl.js`);
    assert.equal(urlHelperRes.status, 200);
  } finally {
    server.close();
  }
});

// ---- static builds (`axis build`) - writeStaticSite/writeDomStaticSite ----

test("writeStaticSite (axis build, scene-renderer path) copies the extension's real file to extensions/<name>.js", async () => {
  const outDir = mkdtempSync(path.join(tmpdir(), "axis-build-"));
  try {
    const program = resolveModules(SCENE_ENTRY);
    const plan = buildRenderPlan(interpret(program));
    await writeStaticSite(plan, outDir);
    const written = readFileSync(path.join(outDir, "extensions", "with-extension.js"), "utf8");
    assert.equal(written, EXTENSION_SOURCE);
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});

test("writeDomStaticSite (axis build, DOM/page path) copies the extension's real file too", async () => {
  const outDir = mkdtempSync(path.join(tmpdir(), "axis-build-dom-"));
  try {
    const program = resolveModules(SCENE_ENTRY);
    const plan = buildDomPlan(interpret(program));
    await writeDomStaticSite(plan, outDir);
    const written = readFileSync(path.join(outDir, "extensions", "with-extension.js"), "utf8");
    assert.equal(written, EXTENSION_SOURCE);
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});
