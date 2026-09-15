// A minimal AXIS language server - LSP (Language Server Protocol) over
// stdio, hand-rolled (no `vscode-languageserver` dependency: the wire
// protocol this file actually needs - Content-Length-framed JSON-RPC, five
// request kinds, one notification kind - is small enough that adding a
// framework dependency for it would be the opposite of AXIS's own
// low-dependency discipline, see package.json's single runtime dependency).
//
// This file is a thin PROTOCOL ADAPTER, nothing more - it contains no AXIS
// grammar or semantics of its own:
//   diagnostics      -> check.js (the exact same engine `axis check` runs)
//   formatting        -> format.js (the exact same engine `axis fmt` runs)
//   documentSymbol    -> symbols.js
//   hover/definition  -> definitions.js
// One language core, four consumers (CLI text, CLI --json, this file,
// tests) - see docs/architecture/2026-audit.md's own framing for why that
// matters.
//
// Diagnostics vs. live editing, stated honestly: `textDocument/didOpen`
// and `textDocument/didSave` re-run checkFile() (see check.js), which
// resolves `import`s from *disk* - the same thing `axis check` does, and
// for the same reason (import resolution needs real file paths, not just
// the buffer LSP handed this process). `textDocument/didChange` does NOT
// re-run diagnostics against every keystroke for a file that has imports,
// since there is no live/unsaved-buffer-aware module resolution here (a
// real gap, not a design choice - see docs/architecture/ for the state of
// reactive structure work this would want to build on). Formatting, hover,
// definition, and document symbols all operate on the *live* buffer text
// instead (no disk I/O, no import resolution needed for any of them), so
// those stay accurate on every keystroke regardless.
//
// LIMITATIONS, stated rather than hidden (see definitions.js for the
// hover/definition ones specifically): no completion (AXIS's parser is
// all-or-nothing, not error-tolerant, so there's no reliable "what's valid
// here" for a document that doesn't currently parse - see this file's own
// git history/PR description for the reasoning); no rename, references,
// or code actions.

import { checkFile } from "./check.js";
import { formatSource } from "./format.js";
import { collectSymbols } from "./symbols.js";
import { findDefinition, hoverText } from "./definitions.js";
import { tokenize } from "./lexer.js";
import { parse } from "./parser.js";
import { fileURLToPath, pathToFileURL } from "node:url";

// ---- JSON-RPC framing (Content-Length: N\r\n\r\n<json>) -------------------

// Exported so tests can speak the exact same framing back at the server
// (and parse its responses) without a second, hand-rolled implementation
// of Content-Length framing living in a test file.
export class MessageReader {
  constructor(onMessage) {
    this.onMessage = onMessage;
    this.buffer = Buffer.alloc(0);
  }

  push(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) return;
      const header = this.buffer.subarray(0, headerEnd).toString("utf8");
      const match = /Content-Length: (\d+)/i.exec(header);
      if (!match) {
        // malformed frame - drop everything up to and past the header we
        // couldn't parse and try to resynchronize on the next chunk
        this.buffer = this.buffer.subarray(headerEnd + 4);
        continue;
      }
      const length = Number(match[1]);
      const bodyStart = headerEnd + 4;
      if (this.buffer.length < bodyStart + length) return; // wait for more data
      const body = this.buffer.subarray(bodyStart, bodyStart + length).toString("utf8");
      this.buffer = this.buffer.subarray(bodyStart + length);
      try {
        this.onMessage(JSON.parse(body));
      } catch {
        // an unparseable message body - ignore it rather than crash the
        // server over one bad frame
      }
    }
  }
}

export function writeMessage(stream, message) {
  const json = JSON.stringify(message);
  stream.write(`Content-Length: ${Buffer.byteLength(json, "utf8")}\r\n\r\n${json}`);
}

// ---- LSP <-> AXIS shape conversions ---------------------------------------

function uriToPath(uri) {
  return uri.startsWith("file://") ? fileURLToPath(uri) : uri;
}

function pathToUri(path) {
  return path.startsWith("file://") ? path : pathToFileURL(path).toString();
}

// AXIS locations/diagnostics are 1-indexed lines (and columns, when known)
// - LSP positions are 0-indexed. A diagnostic/symbol with no column gets a
//   whole-line range (character 0 to Number.MAX_SAFE_INTEGER, which every
//   LSP client clamps to the actual line length) rather than a fabricated
//   column.
function lineRange(line, column) {
  const l = Math.max(0, line - 1);
  if (column == null) return { start: { line: l, character: 0 }, end: { line: l, character: Number.MAX_SAFE_INTEGER } };
  const c = Math.max(0, column - 1);
  return { start: { line: l, character: c }, end: { line: l, character: c + 1 } };
}

function diagnosticToLsp(d) {
  return {
    range: lineRange(d.location?.start?.line ?? 1, d.location?.start?.column ?? null),
    severity: d.severity === "warning" ? 2 : 1, // LSP: 1=Error, 2=Warning
    code: d.code,
    source: "axis",
    message: d.suggestion ? `${d.message}\n\n${d.suggestion}` : d.message,
  };
}

// LSP's SymbolKind enum (only the values AXIS's own symbol kinds map onto
// meaningfully - see symbols.js for the full, real list of kinds this
// switches over).
const SYMBOL_KIND = {
  scene: 3, // Namespace
  page: 3, // Namespace
  component: 5, // Class
  function: 12, // Function
  object: 6, // Method (closest fit: a named, typed instance)
  timeline: 6, // Method
  let: 13, // Variable
  const: 14, // Constant
  state: 13, // Variable
  route: 20, // EnumMember (closest fit: a fixed, named mapping)
  redirect: 20,
  import: 2, // Module
};

function symbolToLsp(sym) {
  const range = { start: { line: Math.max(0, sym.line - 1), character: 0 }, end: { line: Math.max(0, (sym.endLine ?? sym.line) - 1), character: 0 } };
  const selectionRange = { start: { line: Math.max(0, sym.line - 1), character: 0 }, end: { line: Math.max(0, sym.line - 1), character: sym.name.length } };
  return {
    name: sym.name,
    kind: SYMBOL_KIND[sym.kind] ?? 13,
    range,
    selectionRange,
    children: (sym.children ?? []).map(symbolToLsp),
  };
}

// ---- server ----------------------------------------------------------------

export function createServer({ input, output, log = () => {} } = {}) {
  const documents = new Map(); // uri -> text (the live, possibly-unsaved buffer)

  function publishDiagnosticsFromDisk(uri) {
    const path = uriToPath(uri);
    let result;
    try {
      result = checkFile(path);
    } catch (err) {
      log(`checkFile threw for ${path}: ${err.message}`);
      return;
    }
    writeMessage(output, {
      jsonrpc: "2.0",
      method: "textDocument/publishDiagnostics",
      params: { uri, diagnostics: result.diagnostics.map(diagnosticToLsp) },
    });
  }

  function parsedDoc(uri) {
    const text = documents.get(uri);
    if (text == null) return null;
    try {
      const tokens = tokenize(text);
      const program = parse(tokens);
      return { text, tokens, program };
    } catch {
      return null; // not currently valid syntax - hover/definition/symbols honestly return nothing rather than guess
    }
  }

  function handleRequest(msg) {
    const { id, method, params } = msg;
    const respond = (result) => writeMessage(output, { jsonrpc: "2.0", id, result });
    const respondError = (code, message) => writeMessage(output, { jsonrpc: "2.0", id, error: { code, message } });

    switch (method) {
      case "initialize":
        respond({
          capabilities: {
            textDocumentSync: 1, // Full
            documentFormattingProvider: true,
            documentSymbolProvider: true,
            hoverProvider: true,
            definitionProvider: true,
          },
          serverInfo: { name: "axis-lsp", version: "1" },
        });
        return;

      case "shutdown":
        respond(null);
        return;

      case "textDocument/formatting": {
        const doc = documents.get(params.textDocument.uri);
        if (doc == null) return respond([]);
        try {
          const formatted = formatSource(doc);
          if (formatted === doc) return respond([]);
          const lineCount = doc.split("\n").length;
          respond([
            {
              range: { start: { line: 0, character: 0 }, end: { line: lineCount, character: 0 } },
              newText: formatted,
            },
          ]);
        } catch {
          respond([]); // invalid syntax, or an unformattable edge case (see format.js) - nothing to apply, not an error the client needs to surface twice (diagnostics already will)
        }
        return;
      }

      case "textDocument/documentSymbol": {
        const doc = parsedDoc(params.textDocument.uri);
        respond(doc ? collectSymbols(doc.program).map(symbolToLsp) : []);
        return;
      }

      case "textDocument/hover": {
        const doc = parsedDoc(params.textDocument.uri);
        if (!doc) return respond(null);
        const text = hoverText(doc.program, doc.tokens, params.position.line + 1, params.position.character + 1);
        respond(text ? { contents: { kind: "markdown", value: text } } : null);
        return;
      }

      case "textDocument/definition": {
        const doc = parsedDoc(params.textDocument.uri);
        if (!doc) return respond(null);
        const def = findDefinition(doc.program, doc.tokens, params.position.line + 1, params.position.character + 1);
        if (!def) return respond(null);
        respond({
          uri: params.textDocument.uri,
          range: { start: { line: Math.max(0, def.line - 1), character: 0 }, end: { line: Math.max(0, def.line - 1), character: def.name.length } },
        });
        return;
      }

      default:
        respondError(-32601, `method not found: ${method}`);
    }
  }

  function handleNotification(msg) {
    const { method, params } = msg;
    switch (method) {
      case "initialized":
        return;
      case "textDocument/didOpen":
        documents.set(params.textDocument.uri, params.textDocument.text);
        publishDiagnosticsFromDisk(params.textDocument.uri);
        return;
      case "textDocument/didChange":
        // full sync (see initialize's textDocumentSync: 1) - the last
        // content change *is* the whole document.
        documents.set(params.textDocument.uri, params.contentChanges.at(-1).text);
        return;
      case "textDocument/didSave":
        publishDiagnosticsFromDisk(params.textDocument.uri);
        return;
      case "textDocument/didClose":
        documents.delete(params.textDocument.uri);
        writeMessage(output, { jsonrpc: "2.0", method: "textDocument/publishDiagnostics", params: { uri: params.textDocument.uri, diagnostics: [] } });
        return;
      case "exit":
        process.exit(0);
        return;
      default:
      // an unhandled notification - LSP notifications never expect a reply, silently ignore
    }
  }

  const reader = new MessageReader((msg) => {
    try {
      if (msg.id !== undefined && msg.method) handleRequest(msg);
      else if (msg.method) handleNotification(msg);
      // a bare response to a request we never sent (this server sends none) - ignore
    } catch (err) {
      log(`unhandled error processing ${msg?.method}: ${err.stack ?? err.message}`);
    }
  });

  input.on("data", (chunk) => reader.push(chunk));

  return { documents }; // exposed for tests, not part of the protocol
}

export function startStdioServer() {
  createServer({ input: process.stdin, output: process.stdout, log: (m) => process.stderr.write(`[axis-lsp] ${m}\n`) });
  process.stdin.resume();
}
