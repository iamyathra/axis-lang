// Activates the AXIS language client - spawns `axis lsp` (src/lsp.js in
// the axis-lang package) as a child process and speaks LSP to it over
// stdio. This file is a thin activation shim; it contains no AXIS logic
// of its own - everything real lives in axis-lang's own src/lsp.js.
//
// How this resolves the `axis` binary: `node_modules/.bin/axis` in the
// *workspace* the user opened (i.e. `axis-lang` is a dependency of their
// own project) - the same resolution any other locally-installed CLI tool
// a VS Code extension shells out to would use. If it isn't found there,
// activation fails with a clear error message rather than silently doing
// nothing - see `resolveAxisBin` below.
const { workspace, window } = require("vscode");
const { LanguageClient, TransportKind } = require("vscode-languageclient/node");
const path = require("node:path");
const fs = require("node:fs");

let client;

function resolveAxisBin() {
  const folders = workspace.workspaceFolders ?? [];
  for (const folder of folders) {
    const binPath = path.join(folder.uri.fsPath, "node_modules", ".bin", process.platform === "win32" ? "axis.cmd" : "axis");
    if (fs.existsSync(binPath)) return binPath;
  }
  return null;
}

function activate(context) {
  const axisBin = resolveAxisBin();
  if (!axisBin) {
    window.showErrorMessage(
      "AXIS: couldn't find 'axis' in this workspace's node_modules/.bin - run 'npm install axis-lang' in your project first."
    );
    return;
  }

  const serverOptions = {
    run: { command: axisBin, args: ["lsp"], transport: TransportKind.stdio },
    debug: { command: axisBin, args: ["lsp"], transport: TransportKind.stdio },
  };
  const clientOptions = {
    documentSelector: [{ scheme: "file", language: "axis" }],
  };

  client = new LanguageClient("axis", "AXIS Language Server", serverOptions, clientOptions);
  context.subscriptions.push(client.start());
}

function deactivate() {
  return client?.stop();
}

module.exports = { activate, deactivate };
