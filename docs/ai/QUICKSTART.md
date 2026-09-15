# AXIS quickstart for AI coding agents

You are writing AXIS - a small declarative language for 3D scenes
(`scene { ... }`, rendered via three.js) and web pages (`page { ... }`,
rendered to real server-rendered HTML), in `.ax` files. It looks like a
mix of JS and CSS but has its own, much smaller grammar. Don't assume a JS
construct works just because it looks plausible - AXIS's actual surface is
small enough to read in full (see [docs/language.md](../language.md)).

## Before you write anything

1. **Skim [docs/language.md](../language.md)'s table of contents** and read
   the section(s) that cover what you're building (Scenes, Pages, Animation,
   Timelines, Components, Routing, Async, Embedding - whichever applies).
2. **Find the closest existing example** in
   [`examples/`](../../examples/) (see the table in [README.md](README.md))
   and adapt it rather than starting from a blank file. Every example is
   test-verified to actually work right now.
3. **Skim [COMMON_MISTAKES.md](COMMON_MISTAKES.md)** once - most of it is
   about places AXIS deliberately differs from JS (parens required on
   `if`/`while`, `component Name()` always needs `()`, only 14 named
   colors, `:` not `=` for properties, top-level statements are
   declarations-only).

## While writing

- Never invent a keyword, property name, or builtin function. If you're not
  sure one exists, check `docs/language.md`'s relevant section or an
  example - don't guess from JS/CSS naming conventions.
- Colors: one of `red green blue yellow orange purple white black gray grey
  pink brown cyan magenta`, or a `"#rrggbb"` hex string. Nothing else.
- Easing: one of `linear easeIn easeOut easeInOut`. Nothing else.
- Every `animate` needs a `duration` (a positive number of milliseconds, or
  a `Ns`/`Nms` literal like `2s`/`500ms`).
- `if`/`while` conditions need parentheses. `component Name(...)` needs
  parentheses even with zero parameters. Properties use `color: red`, not
  `color = red` or `color red`.

## After writing (always, every time)

Run, in this order:

```bash
axis fmt <file.ax>
axis check <file.ax> --json
```

`axis fmt` reformats the file to AXIS's canonical style in place (an
invalid file is left untouched - `axis fmt` requires syntactically valid
AXIS, same as `axis check`). Formatting first means a subsequent diff is
about the actual change, not incidental whitespace, and matches the
convention every other AXIS file in this repo already follows. Then:

- **`"valid": true`** - done. (`"diagnostics"` may still list warnings -
  read them; they're real, just not fatal.)
- **`"valid": false`** - read `diagnostics[0].code`, `.message`, and
  `.suggestion` (if present). Fix *exactly* what it says, nothing more -
  don't rewrite unrelated code speculatively. Re-run `axis check`. Repeat.

Full schema, every field, exit codes: [VALIDATION.md](VALIDATION.md).
Every code's meaning: [ERROR_CODES.md](ERROR_CODES.md).

If a diagnostic is genuinely confusing (the code doesn't seem to match the
actual problem), don't loop indefinitely guessing - re-read the relevant
`docs/language.md` section for that construct; the fix is almost always
there.

## Project structure and running it for real

- `axis run <file.ax>` - render in a browser, live-reload on save. Use this
  to actually look at what you built, not just to validate it.
- `axis build <file.ax> [--out dir]` - write a static, servable build.
- `axis create <name>` - scaffold a starter project (a page with an
  embedded scene, reactive state) if you're starting a new project rather
  than editing an existing one.
- `npm test` (repo root) runs the whole test suite, including
  `tests/examples.test.js`, which re-validates every canonical example.
- `axis inspect <file.ax> [--json]` - prints the scenes/pages/components/
  objects/timelines/routes a file declares, as a tree (or a flattened,
  versioned JSON list with dot-joined paths like `main.box`). Useful for
  getting your bearings in an unfamiliar or generated file without reading
  the whole thing.
- `axis lsp` - runs the AXIS language server (diagnostics, formatting,
  hover, go-to-definition, document symbols) over stdio, for an editor to
  spawn - not something to run directly as a human/agent workflow step.

## Editor tooling (for a human working alongside you)

If the user's editor is LSP-capable, `axis lsp` gives them live
diagnostics/hover/definition/formatting backed by the exact same engine
`axis check`/`axis fmt` use (see src/lsp.js) - no separate setup needed
beyond pointing the editor at `axis lsp` for `.ax` files. There is
currently no completion (context-aware completion needs an error-tolerant
parser AXIS doesn't have yet - see src/lsp.js's own header comment) and no
packaged VS Code extension - both are real, tracked gaps, not silently
missing.

## Embedding in an existing app

Don't write raw `<script>` DOM/three.js glue by hand as a substitute for
AXIS embedding, and don't assume `import Foo from "./foo.ax"` works (see
[COMMON_MISTAKES.md](COMMON_MISTAKES.md) #10). Use:

- **React**: `import { Axis } from "axis-react"` - see
  [`examples/embed-react/`](../../examples/embed-react/) and
  `packages/axis-react/src/Axis.js`.
- **Plain HTML/JS**: `import { mount } from "axis-lang"` - see
  [`examples/embed-html/`](../../examples/embed-html/) and `src/mount.js`.

Both take the `.ax` file's raw source *text* (fetched, `?raw`-imported, or
read however your own tooling gets text into JS), not a module import of
the `.ax` file itself.
