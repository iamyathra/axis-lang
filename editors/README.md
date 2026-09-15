# AXIS editor tooling

`axis lsp` (see [`../src/lsp.js`](../src/lsp.js)) is a real language server -
diagnostics, formatting, hover, go-to-definition, and document symbols,
speaking standard LSP over stdio - that works with **any** LSP-capable
editor, not just VS Code. It has no completion yet (see `src/lsp.js`'s own
header comment for why) and this directory has no packaged, installable
extension yet - both are real, tracked gaps.

## What's here

- `vscode/syntaxes/axis.tmLanguage.json` - a TextMate grammar for `.ax`
  syntax highlighting, built from AXIS's own real keyword list (see the
  grammar file's own comment for how to regenerate that list if it drifts).
- `vscode/language-configuration.json` - bracket matching/auto-closing.
- `vscode/package.json` + `vscode/src/extension.js` - a minimal VS Code
  extension that registers the grammar and spawns `axis lsp` via
  `vscode-languageclient`. **This has not been run inside an actual VS
  Code instance as part of this milestone** - the code follows the
  standard, well-documented `vscode-languageclient` activation pattern,
  but treat it as a verified-on-paper starting point, not a
  tested-and-shipped extension, until someone with VS Code installed
  actually loads it (`vscode:extension/development-host`) and confirms
  diagnostics/hover/formatting show up. If you do that and it needs a
  fix, that's expected - please fix it forward rather than assume it's
  finished.

## Using `axis lsp` with any other LSP client

Any editor with generic LSP support (Neovim's built-in LSP client, Helix,
Sublime's LSP package, Emacs's `eglot`/`lsp-mode`, ...) can point directly
at the server - it needs no VS Code-specific glue:

- **Command**: `axis lsp` (or `node /path/to/axis-lang/bin/axis.js lsp` if
  `axis` isn't on `PATH`)
- **Transport**: stdio
- **Filetype**: `.ax`
- **Capabilities**: `textDocument/publishDiagnostics` (on open/save, not
  every keystroke for a file with `import`s - see `src/lsp.js`'s own
  header comment for exactly why), `textDocument/formatting`,
  `textDocument/hover`, `textDocument/definition`,
  `textDocument/documentSymbol`.

Example, Neovim (`init.lua`, using `vim.lsp.start` directly - no plugin
needed):

```lua
vim.api.nvim_create_autocmd("FileType", {
  pattern = "axis",
  callback = function()
    vim.lsp.start({
      name = "axis",
      cmd = { "axis", "lsp" },
      root_dir = vim.fn.getcwd(),
    })
  end,
})
```

(You'd also want a small `ftdetect`/`ftplugin` mapping `*.ax` to the
`axis` filetype, and optionally the TextMate grammar translated to
Neovim's tree-sitter/syntax format for highlighting - not included here;
this example only wires up the language server.)
