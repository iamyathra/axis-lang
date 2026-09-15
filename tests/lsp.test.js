// Protocol-level tests for src/lsp.js - real Content-Length-framed JSON-RPC
// messages through createServer(), not just calling its internal functions
// directly, so a framing bug (not just a logic bug) would actually fail
// these.
import { test } from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createServer, MessageReader, writeMessage } from "../src/lsp.js";

function makeClient() {
  const toServer = new PassThrough();
  const fromServer = new PassThrough();
  const pending = []; // {resolve} waiting for the next message, in arrival order
  const backlog = []; // messages that arrived before anyone awaited them

  const reader = new MessageReader((msg) => {
    const waiter = pending.shift();
    if (waiter) waiter.resolve(msg);
    else backlog.push(msg);
  });
  fromServer.on("data", (chunk) => reader.push(chunk));

  function nextMessage() {
    if (backlog.length) return Promise.resolve(backlog.shift());
    return new Promise((resolve) => pending.push({ resolve }));
  }

  let nextId = 1;
  function request(method, params) {
    const id = nextId++;
    writeMessage(toServer, { jsonrpc: "2.0", id, method, params });
    return nextMessage();
  }
  function notify(method, params) {
    writeMessage(toServer, { jsonrpc: "2.0", method, params });
  }

  createServer({ input: toServer, output: fromServer });
  return { request, notify, nextMessage };
}

function tempAxFile(contents) {
  const dir = mkdtempSync(path.join(tmpdir(), "axis-lsp-test-"));
  const file = path.join(dir, "main.ax");
  writeFileSync(file, contents);
  return { dir, file, uri: pathToFileURL(file).toString() };
}

test("initialize reports the capabilities this server actually implements", async () => {
  const client = makeClient();
  const res = await client.request("initialize", { capabilities: {} });
  assert.equal(res.result.capabilities.documentFormattingProvider, true);
  assert.equal(res.result.capabilities.documentSymbolProvider, true);
  assert.equal(res.result.capabilities.hoverProvider, true);
  assert.equal(res.result.capabilities.definitionProvider, true);
});

test("didOpen on a valid file publishes an empty diagnostics list", async () => {
  const { dir, file, uri } = tempAxFile("scene main { cube box { color: red } }");
  try {
    const client = makeClient();
    await client.request("initialize", {});
    client.notify("initialized", {});
    client.notify("textDocument/didOpen", { textDocument: { uri, text: "scene main { cube box { color: red } }", version: 1 } });
    const push = await client.nextMessage();
    assert.equal(push.method, "textDocument/publishDiagnostics");
    assert.equal(push.params.uri, uri);
    assert.deepEqual(push.params.diagnostics, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("didOpen on an invalid file publishes a real diagnostic with the canonical code/message/range", async () => {
  const { dir, file, uri } = tempAxFile("scene main { cube box { colr: red } }");
  try {
    const client = makeClient();
    await client.request("initialize", {});
    client.notify("textDocument/didOpen", { textDocument: { uri, text: "scene main { cube box { colr: red } }", version: 1 } });
    const push = await client.nextMessage();
    assert.equal(push.params.diagnostics.length, 1);
    const d = push.params.diagnostics[0];
    assert.equal(d.code, "AXIS_SEMANTIC_UNKNOWN_PROPERTY");
    assert.equal(d.severity, 1);
    assert.equal(d.source, "axis");
    assert.equal(typeof d.range.start.line, "number");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("documentSymbol reflects the live (possibly-unsaved) buffer via didChange, not disk", async () => {
  const { dir, file, uri } = tempAxFile("scene main { cube box { color: red } }");
  try {
    const client = makeClient();
    await client.request("initialize", {});
    client.notify("textDocument/didOpen", { textDocument: { uri, text: "scene main { cube box { color: red } }", version: 1 } });
    await client.nextMessage(); // diagnostics push from didOpen

    // change the live buffer to add a second object - disk is untouched
    client.notify("textDocument/didChange", {
      textDocument: { uri, version: 2 },
      contentChanges: [{ text: "scene main { cube box { color: red } sphere ball { color: blue } }" }],
    });

    const res = await client.request("textDocument/documentSymbol", { textDocument: { uri } });
    const names = res.result.flatMap((s) => [s.name, ...s.children.map((c) => c.name)]);
    assert.ok(names.includes("ball"), "documentSymbol should see the unsaved 'ball' object");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("hover resolves a named color", async () => {
  const source = "scene main { cube box { color: red } }";
  const { dir, uri } = tempAxFile(source);
  try {
    const client = makeClient();
    await client.request("initialize", {});
    client.notify("textDocument/didOpen", { textDocument: { uri, text: source, version: 1 } });
    await client.nextMessage();
    const col = source.indexOf("red");
    const res = await client.request("textDocument/hover", { textDocument: { uri }, position: { line: 0, character: col } });
    assert.match(res.result.contents.value, /named color `red`/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("definition resolves an animate target to its object declaration", async () => {
  const source = `scene main {
    cube box { color: red }
    animate box { rotation.y -> 1deg duration: 500 }
}`;
  const { dir, uri } = tempAxFile(source);
  try {
    const client = makeClient();
    await client.request("initialize", {});
    client.notify("textDocument/didOpen", { textDocument: { uri, text: source, version: 1 } });
    await client.nextMessage();
    const line3 = source.split("\n")[2];
    const col = line3.indexOf("box");
    const res = await client.request("textDocument/definition", { textDocument: { uri }, position: { line: 2, character: col } });
    assert.equal(res.result.uri, uri);
    assert.equal(res.result.range.start.line, 1); // 0-indexed line 1 == source line 2, where 'cube box' is declared
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("formatting returns a single full-document TextEdit for unformatted content", async () => {
  const messy = "scene main{cube box{color:red}}";
  const { dir, uri } = tempAxFile(messy);
  try {
    const client = makeClient();
    await client.request("initialize", {});
    client.notify("textDocument/didOpen", { textDocument: { uri, text: messy, version: 1 } });
    await client.nextMessage();
    const res = await client.request("textDocument/formatting", { textDocument: { uri } });
    assert.equal(res.result.length, 1);
    assert.match(res.result[0].newText, /scene main \{\n {4}cube box \{\n {8}color: red\n {4}\}\n\}\n/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("formatting on an already-formatted document returns no edits", async () => {
  const formatted = "scene main {\n    cube box {\n        color: red\n    }\n}\n";
  const { dir, uri } = tempAxFile(formatted);
  try {
    const client = makeClient();
    await client.request("initialize", {});
    client.notify("textDocument/didOpen", { textDocument: { uri, text: formatted, version: 1 } });
    await client.nextMessage();
    const res = await client.request("textDocument/formatting", { textDocument: { uri } });
    assert.deepEqual(res.result, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("didClose clears diagnostics for that document", async () => {
  const { dir, uri } = tempAxFile("scene main { cube box { colr: red } }");
  try {
    const client = makeClient();
    await client.request("initialize", {});
    client.notify("textDocument/didOpen", { textDocument: { uri, text: "scene main { cube box { colr: red } }", version: 1 } });
    await client.nextMessage();
    client.notify("textDocument/didClose", { textDocument: { uri } });
    const push = await client.nextMessage();
    assert.equal(push.method, "textDocument/publishDiagnostics");
    assert.deepEqual(push.params.diagnostics, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an unknown method gets a proper JSON-RPC error response, not a hang or a crash", async () => {
  const client = makeClient();
  await client.request("initialize", {});
  const res = await client.request("textDocument/completion", {});
  assert.equal(res.error.code, -32601);
});
