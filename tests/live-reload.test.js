// Covers the `axis run` live-reload mechanism's server-side half (the
// SSE hub and the updatePlan/notifyReload hooks cli.js's file watcher
// calls) - the actual "browser tab reloads on save" behavior was verified
// directly in a real browser (see the session's own notes), not just here;
// this file covers what's Node-testable: the wiring itself.

import { test } from "node:test";
import assert from "node:assert/strict";
import { run } from "../src/run.js";
import { buildDomPlan } from "../src/renderer/domPlan.js";
import { buildRenderPlan } from "../src/renderer/plan.js";
import { startDomServer } from "../src/renderer/domServer.js";
import { startServer } from "../src/renderer/server.js";

test("without liveReload, a page server has no updatePlan/notifyReload and no reload script in its HTML", async () => {
  const plan = buildDomPlan(run(`page Home { button go { label: "Go" } }`));
  const server = await startDomServer(plan);
  try {
    assert.equal(server.updatePlan, undefined);
    assert.equal(server.notifyReload, undefined);
    const html = await (await fetch(`http://localhost:${server.address().port}/`)).text();
    assert.doesNotMatch(html, /__axis_reload__/);
  } finally {
    server.close();
  }
});

test("with liveReload, a page server exposes updatePlan/notifyReload and embeds the reload script", async () => {
  const plan = buildDomPlan(run(`page Home { button go { label: "Go" } }`));
  const server = await startDomServer(plan, { liveReload: true });
  try {
    assert.equal(typeof server.updatePlan, "function");
    assert.equal(typeof server.notifyReload, "function");
    const html = await (await fetch(`http://localhost:${server.address().port}/`)).text();
    assert.match(html, /__axis_reload__/);
  } finally {
    server.close();
  }
});

test("the /__axis_reload__ route is a live SSE stream that pushes a message on notifyReload()", async () => {
  const plan = buildDomPlan(run(`page Home { button go { label: "Go" } }`));
  const server = await startDomServer(plan, { liveReload: true });
  try {
    const res = await fetch(`http://localhost:${server.address().port}/__axis_reload__`);
    assert.equal(res.headers.get("content-type"), "text/event-stream");
    const reader = res.body.getReader();
    await reader.read(); // the initial newline written on connect

    server.notifyReload();
    const { value } = await reader.read();
    assert.match(new TextDecoder().decode(value), /data: reload/);
    await reader.cancel();
  } finally {
    server.close();
  }
});

test("updatePlan swaps what a page server serves without restarting it", async () => {
  const plan = buildDomPlan(run(`page Home { text a { content: "before" } }`));
  const server = await startDomServer(plan, { liveReload: true });
  try {
    const before = await (await fetch(`http://localhost:${server.address().port}/`)).text();
    assert.match(before, />before</);

    server.updatePlan(buildDomPlan(run(`page Home { text a { content: "after" } }`)));

    const after = await (await fetch(`http://localhost:${server.address().port}/`)).text();
    assert.match(after, />after</);
  } finally {
    server.close();
  }
});

test("a scene server (not just a page) also supports liveReload, symmetrically", async () => {
  const plan = buildRenderPlan(run(`scene main { cube box { color: red } }`));
  const server = await startServer(plan, { liveReload: true });
  try {
    assert.equal(typeof server.updatePlan, "function");
    assert.equal(typeof server.notifyReload, "function");
    const html = await (await fetch(`http://localhost:${server.address().port}/`)).text();
    assert.match(html, /__axis_reload__/);
  } finally {
    server.close();
  }
});
