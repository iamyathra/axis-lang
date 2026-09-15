import { readFileSync, watch, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import nodePath from "node:path";
import { interpret } from "./interpreter.js";
import { resolveModules, AxisModuleError } from "./modules.js";
import { tokenize, AxisSyntaxError } from "./lexer.js";
import { parse } from "./parser.js";
import { AxisRuntimeError } from "./evaluator.js";
import { buildRenderPlan } from "./renderer/plan.js";
import { startServer, writeStaticSite } from "./renderer/server.js";
import { buildDomPlan, buildDomRouterPlan } from "./renderer/domPlan.js";
import { startDomServer, writeDomStaticSite, startDomRouterServer, writeDomRouterStaticSite } from "./renderer/domServer.js";
import { checkFile } from "./check.js";
import { formatSource, AxisFormatError } from "./format.js";
import { collectSymbols, flattenSymbols } from "./symbols.js";
import { startStdioServer } from "./lsp.js";

const { version } = createRequire(import.meta.url)("../package.json");

const USAGE = `axis - the AXIS language CLI

usage:
  axis create <name>              scaffold a new starter project in ./<name>
  axis run <file.ax>               render a .ax file's first scene or page in the browser, live-reloading on save
  axis build <file.ax> [--out dir]  write a static, servable copy of the render to disk (default out dir: dist)
  axis graph <file.ax>             parse and interpret a .ax file, print the scene/page graph as JSON
  axis check <file.ax> [--json]     validate a .ax file - lexing, parsing, imports, and semantics
  axis fmt <file.ax> [--check]      reformat a .ax file in place (--check: report only, don't write)
  axis inspect <file.ax> [--json]   print the scenes/pages/components/objects/etc. a .ax file declares
  axis lsp                         run the AXIS language server (speaks LSP over stdio - for editors, not humans)
  axis version                     print the AXIS version
  axis help                        show this message

AXIS is very early. See the README for what actually works right now.`;

// `axis create`'s starter project - small enough to read in a minute, but
// touches the language's actual shape: a page, an embedded 3D scene via
// `viewport`, and shared `state` driving both a DOM button's label and the
// 3D object's color - not "here's a red cube."
const STARTER_MAIN_AX = `// Welcome to AXIS. Run this with: axis run main.ax
// Edit anything below and save - the browser reloads on its own.

state spins = 0

scene Showpiece {
    camera { position: (0, 1.5, 4) }

    ambientLight fill { intensity: 0.6 }
    directionalLight sun { direction: (-1, -1, -0.4) intensity: 1 }

    cube box { color: "#4a90e2" }

    on box.click {
        spins = spins + 1
    }

    animate box {
        rotation.y -> 360deg
        duration: 6s
        repeat: infinite
        easing: linear
    }
}

page "My AXIS App" {
    container hero {
        direction: "column"
        align: "center"
        justify: "center"
        gap: 16
        padding: 48
        background: "#0b0b12"

        heading title { content: "Hello, AXIS" color: white size: 36 }
        paragraph subtitle { content: "Click the cube - clicks: " + spins color: "#9c9cb8" }

        viewport preview {
            scene: "Showpiece"
            width: 480
            height: 360
            radius: 12
        }
    }
}
`;

function readAxFile(path) {
  if (!path.endsWith(".ax")) {
    console.error(`error: expected a .ax file, got '${path}'`);
    process.exit(1);
  }
  try {
    return readFileSync(path, "utf8");
  } catch (err) {
    console.error(`error: couldn't read '${path}': ${err.message}`);
    process.exit(1);
  }
}

function sourceSnippet(source, line) {
  if (!source) return "";
  const lines = source.split("\n");
  const text = lines[line - 1];
  if (text === undefined) return "";
  return `\n\n  ${text}\n`;
}

function safeReadFile(filePath) {
  try {
    return readFileSync(filePath, "utf8");
  } catch {
    return undefined;
  }
}

// An error from a multi-file program can originate in an *imported* file,
// not the one the user ran - modules.js tags those with `.filePath` (an
// absolute path) so the snippet printed here is always the actual
// offending file's, not whatever happens to be at `path`/`source`.
function reportError(err, path, source) {
  if (err instanceof AxisModuleError) {
    console.error(`module error: ${err.message}`);
    process.exit(1);
  }

  // Prefer whatever the user actually typed for the common case (the
  // error is in the file they ran); only switch to modules.js's absolute
  // `.filePath` - and re-read that file - when the error genuinely came
  // from somewhere else (an imported file).
  const sameFile = !err.filePath || err.filePath === nodePath.resolve(path);
  const displayPath = sameFile ? path : err.filePath;
  const displaySource = sameFile ? source : safeReadFile(err.filePath);

  if (err instanceof AxisSyntaxError) {
    console.error(`syntax error in ${displayPath}: ${err.message}${sourceSnippet(displaySource, err.line)}`);
  } else if (err instanceof AxisRuntimeError) {
    console.error(`error in ${displayPath}: ${err.message}${err.line ? sourceSnippet(displaySource, err.line) : ""}`);
  } else {
    throw err;
  }
  process.exit(1);
}

// Human-readable rendering of one Diagnostic (see diagnostics.js) - the
// text `axis check` prints without `--json`. `--json` bypasses this
// entirely and prints the check.js result object as-is, so this function
// has no bearing on the machine-readable contract (docs/ai/VALIDATION.md).
function formatDiagnostic(d) {
  const loc = d.location ? `${d.file}:${d.location.start.line}${d.location.start.column != null ? `:${d.location.start.column}` : ""}` : d.file;
  const lines = [`${d.severity}[${d.code}] ${loc}`, d.message];
  if (d.source) {
    const lineNo = String(d.location.start.line);
    const gutter = " ".repeat(lineNo.length);
    lines.push("", `  ${lineNo} | ${d.source.line}`);
    if (d.source.pointerStart != null) {
      lines.push(`  ${gutter} | ${" ".repeat(d.source.pointerStart)}${"^".repeat(d.source.pointerLength)}`);
    }
  }
  if (d.suggestion) lines.push("", `suggestion: ${d.suggestion}`);
  return lines.join("\n");
}

// Human-readable tree for `axis inspect` - e.g.:
//   main (scene)
//   ├── fill (ambientLight)
//   └── box (cube)
//       └── intro (timeline)
function symbolLabel(sym) {
  if (sym.kind === "object") return `${sym.name} (${sym.objectType})`;
  if (sym.kind === "component" || sym.kind === "function") return `${sym.name}(${(sym.params ?? []).join(", ")}) (${sym.kind})`;
  if (sym.kind === "route") return `${sym.name} -> ${sym.pageName} (route)`;
  if (sym.kind === "redirect") return `${sym.name} -> ${sym.to} (redirect)`;
  return `${sym.name} (${sym.kind})`;
}

function printSymbolTree(symbols, prefix, lines) {
  symbols.forEach((sym, i) => {
    const isLast = i === symbols.length - 1;
    lines.push(`${prefix}${isLast ? "└── " : "├── "}${symbolLabel(sym)}`);
    if (sym.children?.length) printSymbolTree(sym.children, `${prefix}${isLast ? "    " : "│   "}`, lines);
  });
}

function openInBrowser(url) {
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    spawn(command, args, { detached: true, stdio: "ignore" }).unref();
  } catch {
    // best-effort only - the printed URL below is enough on its own
  }
}

// `--json` (axis check) is a boolean switch, not a value-taking flag like
// `--out` (axis build) - without this list, "axis check --json app.ax"
// would swallow "app.ax" as --json's value instead of leaving it as the
// positional path, since flag/positional order isn't fixed anywhere else
// in this CLI.
const BOOLEAN_FLAGS = new Set(["json", "check"]);

function parseFlags(args) {
  const flags = {};
  const rest = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      const name = args[i].slice(2);
      if (BOOLEAN_FLAGS.has(name)) {
        flags[name] = true;
      } else {
        flags[name] = args[i + 1];
        i++;
      }
    } else {
      rest.push(args[i]);
    }
  }
  return { flags, rest };
}

function interpretFile(path) {
  const source = readAxFile(path);
  try {
    const program = resolveModules(path);
    return { interpretResult: interpret(program), source };
  } catch (err) {
    reportError(err, path, source);
    throw err; // unreachable, reportError exits - keeps TypeScript-less callers happy
  }
}

// A file renders as a page if it has any `page` - a page can embed a
// `scene` via `viewport` (see docs/architecture/page-scene-fusion.md), so a
// file with both is normal now, not an error. A file with only `scene`s
// still renders the first one standalone, exactly as before. A file with
// at least one `route` renders as a *router* build instead - every page
// any route reaches, not just the first `page` declared (see
// docs/architecture/routing.md) - `route` and a plain multi-page file
// without any routes are mutually exclusive from the CLI's point of view:
// the moment a file opts into routing, "which page renders" stops being
// "the first one" and starts being "whichever URL matched."
function planFor(interpretResult, path) {
  const hasScenes = interpretResult.scenes.length > 0;
  const hasPages = interpretResult.pages.length > 0;
  const hasRoutes = (interpretResult.routes?.length ?? 0) > 0;

  if (!hasScenes && !hasPages) {
    console.error(`error in ${path}: no 'scene' or 'page' found to render`);
    process.exit(1);
  }

  if (hasRoutes) return { kind: "router", plan: buildDomRouterPlan(interpretResult) };
  return hasPages
    ? { kind: "page", plan: buildDomPlan(interpretResult) }
    : { kind: "scene", plan: buildRenderPlan(interpretResult) };
}

// The live-reload half of `axis run`: re-parses/re-interprets/re-builds
// `path` after a file-watch event fires. Deliberately never exits the
// process, unlike interpretFile/planFor above (which the *initial* build in
// `run`/`build` still uses, and rightly should - a genuinely broken entry
// file shouldn't open an empty dev server) - a typo mid-edit here should
// print to the terminal and leave the last good build running in the
// browser, not kill the whole dev server out from under the developer.
// Returns null (having already printed why) on any failure.
function tryRebuild(path) {
  let source;
  try {
    source = readFileSync(path, "utf8");
  } catch {
    return null; // a transient read failure mid-save - the next file-watch event will retry
  }
  try {
    const program = resolveModules(path);
    const interpretResult = interpret(program);
    const hasScenes = interpretResult.scenes.length > 0;
    const hasPages = interpretResult.pages.length > 0;
    const hasRoutes = (interpretResult.routes?.length ?? 0) > 0;
    if (!hasScenes && !hasPages) {
      console.error(`error in ${path}: no 'scene' or 'page' found to render`);
      return null;
    }
    const kind = hasRoutes ? "router" : hasPages ? "page" : "scene";
    const plan = hasRoutes ? buildDomRouterPlan(interpretResult) : hasPages ? buildDomPlan(interpretResult) : buildRenderPlan(interpretResult);
    for (const warning of plan.warnings) console.warn(`warning: ${warning}`);
    return { kind, plan };
  } catch (err) {
    if (err instanceof AxisModuleError) console.error(`module error: ${err.message}`);
    else if (err instanceof AxisSyntaxError) console.error(`syntax error in ${path}: ${err.message}${sourceSnippet(source, err.line)}`);
    else if (err instanceof AxisRuntimeError) console.error(`error in ${path}: ${err.message}${err.line ? sourceSnippet(source, err.line) : ""}`);
    else console.error(err);
    return null;
  }
}

export async function main(argv) {
  const [command, ...rest] = argv;

  if (!command || command === "--help" || command === "-h" || command === "help") {
    console.log(USAGE);
    return;
  }

  if (command === "version" || command === "--version" || command === "-v") {
    console.log(`axis ${version}`);
    return;
  }

  if (command === "create") {
    const [name] = rest;
    if (!name) {
      console.error("usage: axis create <name>");
      process.exit(1);
    }
    if (existsSync(name)) {
      console.error(`error: '${name}' already exists`);
      process.exit(1);
    }
    mkdirSync(name, { recursive: true });
    writeFileSync(nodePath.join(name, "main.ax"), STARTER_MAIN_AX);
    console.log(`created ${name}/main.ax`);
    console.log("");
    console.log(`  cd ${name}`);
    console.log(`  axis run main.ax`);
    console.log("");
    console.log("edit main.ax and save - the browser reloads on its own.");
    return;
  }

  if (command === "check") {
    const { flags, rest: positional } = parseFlags(rest);
    const [path] = positional;
    if (!path) {
      console.error("usage: axis check <file.ax> [--json]");
      process.exit(2);
    }
    const asJson = "json" in flags;

    // A .ax program can call the `print` builtin (globals.js) at
    // interpretation time (not just from a live handler) - during `--json`
    // that would corrupt stdout, which must be JSON and nothing else. Text
    // mode has no such constraint, but suppressing it there too keeps the
    // two modes behaving identically and keeps `axis check`'s own output
    // exactly what the diagnostics say, nothing more.
    const realLog = console.log;
    console.log = () => {};
    let checkResult;
    try {
      checkResult = checkFile(path);
    } catch (err) {
      console.log = realLog;
      const diagnostic = {
        severity: "error",
        code: "AXIS_INTERNAL_ERROR",
        message: err.message ?? String(err),
        file: path,
        location: null,
        source: null,
        suggestion: null,
      };
      if (asJson) console.log(JSON.stringify({ version: 1, valid: false, diagnostics: [diagnostic] }, null, 2));
      else {
        console.error(formatDiagnostic(diagnostic));
        console.error("\nThis is an internal AXIS error, not necessarily a problem with your program - please report it.");
      }
      process.exit(2);
    }
    console.log = realLog;

    if (asJson) {
      console.log(JSON.stringify(checkResult, null, 2));
    } else if (checkResult.valid) {
      console.log(`✓ ${path} is valid`);
      for (const w of checkResult.diagnostics) console.log(`\n${formatDiagnostic(w)}`);
    } else {
      console.error(`✗ ${path} is invalid`);
      for (const d of checkResult.diagnostics) console.error(`\n${formatDiagnostic(d)}`);
    }
    process.exit(checkResult.valid ? 0 : 1);
  }

  if (command === "fmt") {
    const { flags, rest: positional } = parseFlags(rest);
    const [path] = positional;
    if (!path) {
      console.error("usage: axis fmt <file.ax> [--check]");
      process.exit(2);
    }
    const checkOnly = "check" in flags;
    const original = readAxFile(path);
    let formatted;
    try {
      formatted = formatSource(original);
    } catch (err) {
      if (err instanceof AxisSyntaxError) {
        console.error(`syntax error in ${path}: ${err.message}${sourceSnippet(original, err.line)}`);
      } else if (err instanceof AxisFormatError) {
        console.error(`can't format ${path}: ${err.message}`);
      } else {
        throw err;
      }
      process.exit(2);
    }

    const alreadyFormatted = formatted === original;
    if (checkOnly) {
      if (alreadyFormatted) {
        console.log(`${path} is already formatted`);
        process.exit(0);
      }
      console.log(`${path} needs formatting - run 'axis fmt ${path}' to fix`);
      process.exit(1);
    }

    if (alreadyFormatted) {
      console.log(`${path} is already formatted`);
    } else {
      writeFileSync(path, formatted);
      console.log(`formatted ${path}`);
    }
    process.exit(0);
  }

  if (command === "inspect") {
    const { flags, rest: positional } = parseFlags(rest);
    const [path] = positional;
    if (!path) {
      console.error("usage: axis inspect <file.ax> [--json]");
      process.exit(2);
    }
    const asJson = "json" in flags;
    const source = readAxFile(path);
    let symbols;
    try {
      symbols = collectSymbols(parse(tokenize(source)));
    } catch (err) {
      if (err instanceof AxisSyntaxError) {
        if (asJson) {
          console.log(JSON.stringify({ version: 1, symbols: [] }, null, 2));
        } else {
          console.error(`syntax error in ${path}: ${err.message}${sourceSnippet(source, err.line)}`);
        }
        process.exit(1);
      }
      throw err;
    }

    if (asJson) {
      console.log(JSON.stringify({ version: 1, symbols: flattenSymbols(symbols) }, null, 2));
    } else if (symbols.length === 0) {
      console.log(`${path} declares no top-level scene/page/component/fn/route/let/const/state`);
    } else {
      const lines = [];
      printSymbolTree(symbols, "", lines);
      console.log(lines.join("\n"));
    }
    process.exit(0);
  }

  if (command === "lsp") {
    // Speaks LSP over stdio, indefinitely - an editor/client spawns this
    // process and keeps it running, it never exits on its own except via
    // the protocol's own 'exit' notification (see lsp.js). Nothing else
    // to do here; main() intentionally never returns for this command.
    startStdioServer();
    return new Promise(() => {});
  }

  if (command === "graph") {
    const [path] = rest;
    if (!path) {
      console.error("usage: axis graph <file.ax>");
      process.exit(1);
    }
    const source = readAxFile(path);
    try {
      const program = resolveModules(path);
      const result = interpret(program);
      // JSON has no way to represent Infinity (repeat: infinite), so swap
      // it for a string just for printing - the interpreter itself still
      // works with the real Infinity value.
      const json = JSON.stringify(result, (_key, value) => (value === Infinity ? "infinite" : value), 2);
      console.log(json);
    } catch (err) {
      reportError(err, path, source);
    }
    return;
  }

  if (command === "run") {
    const [path] = rest;
    if (!path) {
      console.error("usage: axis run <file.ax>");
      process.exit(1);
    }
    const { interpretResult } = interpretFile(path);
    const initial = planFor(interpretResult, path);
    const kind = initial.kind;
    let plan = initial.plan;
    for (const warning of plan.warnings) console.warn(`warning: ${warning}`);

    const baseDir = nodePath.dirname(nodePath.resolve(path));
    // `kind` (router vs. page vs. scene) picks which of these servers
    // starts - and, once running, never changes: a later edit can
    // add/remove scenes/pages/routes all it wants, but switching between
    // kinds after the dev server already started isn't handled by
    // hot-reload - see the watcher below.
    const server = await (kind === "router"
      ? startDomRouterServer(plan, { baseDir, liveReload: true })
      : kind === "page"
        ? startDomServer(plan, { baseDir, liveReload: true })
        : startServer(plan, { baseDir, liveReload: true }));
    const { port } = server.address();
    const url = `http://localhost:${port}`;
    console.log(`AXIS is running at ${url}`);
    console.log("watching for changes - press Ctrl+C to stop");
    openInBrowser(url);

    // Live reload: watch the entry file (not files it `import`s - a real,
    // current limitation, see docs/architecture/reactive-state.md) and
    // rebuild+reload the browser on every save. Watching the *directory*
    // and filtering by filename, rather than watching the file path
    // directly, is deliberate: many editors (and tools like `sed -i`)
    // save by writing a new temp file and renaming it over the original,
    // which replaces the inode - a watch on the file path itself can
    // silently stop firing after the first such save on some platforms,
    // where a directory watch keeps working since the directory itself
    // was never replaced. Debounced because some editors emit more than
    // one event per actual save.
    const entryFileName = nodePath.basename(path);
    let rebuildTimer = null;
    watch(baseDir, { persistent: true }, (eventType, filename) => {
      if (filename && filename !== entryFileName) return;
      clearTimeout(rebuildTimer);
      rebuildTimer = setTimeout(() => {
        const rebuilt = tryRebuild(path);
        if (!rebuilt) return; // error already printed; keep serving the last good build
        if (rebuilt.kind !== kind) {
          console.warn(`warning: ${path} switched between 'scene'/'page'/'router' (now '${rebuilt.kind}', was '${kind}') - restart 'axis run' to pick that up`);
          return;
        }
        plan = rebuilt.plan;
        server.updatePlan(plan, baseDir);
        server.notifyReload();
        console.log(`reloaded (${new Date().toLocaleTimeString()})`);
      }, 50);
    });
    return;
  }

  if (command === "build") {
    const { flags, rest: positional } = parseFlags(rest);
    const [path] = positional;
    if (!path) {
      console.error("usage: axis build <file.ax> [--out dir]");
      process.exit(1);
    }
    const outDir = flags.out ?? "dist";
    const { interpretResult } = interpretFile(path);
    const { kind, plan } = planFor(interpretResult, path);
    for (const warning of plan.warnings) console.warn(`warning: ${warning}`);
    const baseDir = nodePath.dirname(nodePath.resolve(path));
    if (kind === "router") await writeDomRouterStaticSite(plan, outDir, { baseDir });
    else if (kind === "page") await writeDomStaticSite(plan, outDir, { baseDir });
    else await writeStaticSite(plan, outDir, { baseDir });
    console.log(`wrote a static build to ${outDir}/ - open ${outDir}/index.html through a local server (not file://, browsers block ES module imports there)`);
    return;
  }

  console.error(`unknown command '${command}'\n`);
  console.log(USAGE);
  process.exit(1);
}
