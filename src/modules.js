// Resolves `import`s across multiple .ax files into one flat Program,
// before interpreter.js ever sees anything - interpreter.js and
// evaluator.js stay completely unaware modules exist, they just get a
// bigger flat list of top-level items, exactly like a single-file program.
// This file is the only place in AXIS that touches the filesystem for
// source resolution, which is deliberate: it's a Node-only orchestration
// layer, not part of the language core.

import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { tokenize, AxisSyntaxError } from "./lexer.js";
import { parse } from "./parser.js";
import { registerElementType } from "./extensionRegistry.js";

export class AxisModuleError extends Error {
  constructor(message) {
    super(message);
    this.name = "AxisModuleError";
  }
}

// Local-only package resolution (roadmap step 7 of the general-purpose-
// language pivot - see docs/architecture/2026-09-language-platform-audit.md).
// No registry, no lockfile anywhere - a "package" here is just a directory
// of .ax files, optionally carrying its own `axis.json` metadata. `import
// Foo from "physics"` (a bare name - no leading './' or '../', and not
// ending in '.ax') resolves to `axis_modules/physics/index.ax` by default
// (or wherever that package's own `axis.json` `main` field points, if it
// has one), found by walking upward from the importing file's own
// directory the same way Node walks node_modules - so a package used from
// a deeply nested file, or from inside another package's own source, still
// finds the project's one `axis_modules/` at its root without needing to
// know how deep it's nested.
const PACKAGE_DIR_NAME = "axis_modules";
const PACKAGE_ENTRY_FILE = "index.ax";
const PACKAGE_MANIFEST_FILE = "axis.json";

// `axis.json` is entirely optional and, today, deliberately thin: no
// registry or lockfile reads it, nothing resolves a version against
// anything else - `main` is the only field resolution actually acts on.
// `name`/`version` are accepted (so a package can state its own identity
// for a human or a future registry to read) but not yet cross-checked
// against anything. A package with no `axis.json` at all resolves exactly
// as before this existed: `index.ax`.
function readPackageManifest(packageDir, packageName) {
  const manifestPath = path.join(packageDir, PACKAGE_MANIFEST_FILE);
  if (!existsSync(manifestPath)) return { main: PACKAGE_ENTRY_FILE, runtimeExtension: null, buildExtension: null };

  let raw;
  try {
    raw = readFileSync(manifestPath, "utf8");
  } catch {
    throw new AxisModuleError(`can't read '${manifestPath}'`);
  }

  let manifest;
  try {
    manifest = JSON.parse(raw);
  } catch (err) {
    throw new AxisModuleError(`'${manifestPath}' isn't valid JSON: ${err.message}`);
  }
  if (manifest === null || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new AxisModuleError(`'${manifestPath}' must be a JSON object`);
  }

  const main = validateManifestFile(manifest, "main", PACKAGE_ENTRY_FILE, ".ax", manifestPath);

  // `runtimeExtension` (optional; no default) - a JS file, served to the
  // browser as its own <script type="module">, that registers a genuinely
  // new runtime capability (currently: a scalar 3D property) via
  // src/renderer/extensionRegistry.js's public API - see
  // docs/runtime-extensions.md for the full contract, including exactly
  // why this is the one thing in this manifest that names a .js file
  // instead of a .ax one. Unlike `main`, this is Node-side metadata only:
  // modules.js never reads or executes this file itself (it has no way
  // to - this is a browser-only capability), it just records where it is
  // so plan.js/html.js/server.js can serve and load it later. A package
  // with no `runtimeExtension` is an ordinary, pure-`.ax` package, exactly
  // as before this field existed.
  const runtimeExtension = "runtimeExtension" in manifest ? validateManifestFile(manifest, "runtimeExtension", null, ".js", manifestPath) : null;

  // `buildExtension` (optional; no default) - a second, Node-side-only JS
  // file, distinct from `runtimeExtension` above: it registers a new
  // *declarative* capability (currently: a new element type via
  // registerElementType) that interpreter.js/domHtml.js themselves need to
  // know about at build time - `axis check`/`axis build`/`axis run` would
  // otherwise reject the type as unknown before a browser ever exists to
  // load a `runtimeExtension` script into. It CANNOT be an ordinary ESM
  // `import()` the way loading a `.ax` file's own imports already works:
  // dynamic `import()` is inherently asynchronous, and making
  // `resolveModules` (and its ~15 call sites, several under a synchronous
  // `assert.throws`) async to accommodate one narrow capability would be
  // exactly the kind of disproportionate, cascading blast radius this
  // project's own testing/architecture discipline warns against. Instead
  // it's executed synchronously via Node's built-in `vm` module (see
  // resolveModules' own use of it, below) - zero new dependency, same
  // "hand-rolled, no new deps" choice lsp.js already made - as a plain
  // script (no import/export of its own) with a small `axis` object
  // already in scope, not as an ES module. See
  // docs/runtime-extensions.md's "Build-time element types" section for
  // the full, honest contract and its limits.
  const buildExtension = "buildExtension" in manifest ? validateManifestFile(manifest, "buildExtension", null, ".js", manifestPath) : null;

  return { main, name: manifest.name, version: manifest.version, runtimeExtension, buildExtension };
}

// Runs a package's own `buildExtension` script synchronously, in a fresh
// V8 context, with `axis.registerElementType` as the only capability it
// gets - deliberately not the full Node global scope (no `require`, no
// `process`, no filesystem access), matching the "explicit, static
// ownership, not a magic ambient value" principle extensionRegistry.js's
// own header already states for the browser-side registry. Errors are
// re-thrown as AxisModuleError so a broken extension reports through the
// same channel as every other package-resolution failure, with the file
// path that actually caused it.
function runBuildExtension(absPath) {
  const code = readFileSync(absPath, "utf8");
  const sandbox = { axis: { registerElementType }, console };
  try {
    vm.createContext(sandbox);
    vm.runInContext(code, sandbox, { filename: absPath });
  } catch (err) {
    throw new AxisModuleError(`'${absPath}' (a buildExtension) failed to run: ${err.message}`);
  }
}

// Module-level, not local to one resolveModules() call: registerElementType
// itself (extensionRegistry.js) is a process-lifetime singleton, and
// `axis lsp` (or any other long-running host) calls resolveModules() fresh
// on every file check/edit - without this living across calls, re-checking
// the *same* file a second time would re-run its buildExtension and hit
// registerElementType's own "already registered" guard, turning an ordinary
// edit-and-recheck into a spurious failure. A package's buildExtension is
// meant to run exactly once per process, the same lifetime its
// registration is meant to have.
const buildExtensionsRunGlobally = new Set(); // packageDir already executed, ever, this process

// Shared validation for any axis.json field naming a file inside the
// package directory (`main` - a required .ax entry point with a default;
// `runtimeExtension` - an optional .js file with none) - same rules
// either way: a non-empty string, the right extension, and no escaping
// the package directory via '../' or an absolute path.
function validateManifestFile(manifest, field, defaultValue, extension, manifestPath) {
  const value = field in manifest ? manifest[field] : defaultValue;
  if (typeof value !== "string" || value.length === 0) {
    throw new AxisModuleError(`'${manifestPath}': '${field}' must be a non-empty string`);
  }
  if (!value.endsWith(extension)) {
    throw new AxisModuleError(`'${manifestPath}': '${field}' ('${value}') must end in '${extension}'`);
  }
  // path.posix.normalize (not path.normalize) so a package authored on
  // Windows can't smuggle a '..\\' the '/'-only check above wouldn't catch.
  const normalized = path.posix.normalize(value.replace(/\\/g, "/"));
  if (normalized.startsWith("..") || path.isAbsolute(value)) {
    throw new AxisModuleError(`'${manifestPath}': '${field}' ('${value}') must stay inside the package directory`);
  }
  return value;
}

// Returns the resolved absolute path, or the list of candidates tried (so
// the caller can report exactly where it looked) if none exist. Also
// returns `runtimeExtension` (an absolute path, or null) whenever a
// package directory was actually found, regardless of whether its own
// `main` entry file exists - resolveModules records this against the
// package's own directory (deduplicated - see its own `extensions`
// collection) before it can fail on a missing `main`, so a package that's
// otherwise broken still gets its runtime extension noticed rather than
// silently dropped.
function findPackageEntry(fromDir, packageName) {
  const tried = [];
  let dir = fromDir;
  for (;;) {
    const packageDir = path.join(dir, PACKAGE_DIR_NAME, packageName);
    if (existsSync(packageDir)) {
      const manifest = readPackageManifest(packageDir, packageName);
      const runtimeExtension = manifest.runtimeExtension ? path.join(packageDir, manifest.runtimeExtension) : null;
      const buildExtension = manifest.buildExtension ? path.join(packageDir, manifest.buildExtension) : null;
      const candidate = path.join(packageDir, manifest.main);
      tried.push(candidate);
      if (existsSync(candidate)) return { found: candidate, tried, packageDir, runtimeExtension, buildExtension };
    } else {
      tried.push(path.join(packageDir, PACKAGE_ENTRY_FILE));
    }
    const parent = path.dirname(dir);
    if (parent === dir) return { found: null, tried, packageDir: null, runtimeExtension: null, buildExtension: null }; // reached the filesystem root
    dir = parent;
  }
}

// What `export` can be attached to (parser.js already rejects anything
// else at parse time - this is just the matching allowlist here).
const EXPORTABLE_KINDS = new Set(["FnDecl", "ComponentDecl", "LetDecl"]);

function parseFile(absPath) {
  let source;
  try {
    source = readFileSync(absPath, "utf8");
  } catch {
    throw new AxisModuleError(`can't find '${absPath}'`);
  }
  try {
    return { source, program: parse(tokenize(source)) };
  } catch (err) {
    // tag which file a syntax error actually came from, so cli.js can
    // print the right file's source snippet instead of the entry file's
    if (err instanceof AxisSyntaxError) err.filePath = absPath;
    throw err;
  }
}

// Resolves every `import` reachable from `entryPath` (transitively),
// returning one Program whose items are [...everything pulled in via
// import, ...the entry file's own non-import items]. Imported items are
// tagged with `.sourceFile` (their defining file's absolute path) so a
// runtime error inside one - a component's body, for instance - can be
// attributed to the right file too.
export function resolveModules(entryPath) {
  const absEntry = path.resolve(entryPath);
  const exportsCache = new Map(); // absPath -> Map<exportedName, item>
  const inProgress = new Set(); // absPath currently being resolved - circular-import detection
  const imported = [];
  const importedKeys = new Set(); // `${absPath}#${name}` already pushed onto `imported`
  // packageDir -> {name, jsFile} - every resolved package that declared its
  // own axis.json `runtimeExtension`, deduplicated by package directory (a
  // package imported from several files, or under several imported names,
  // still only needs its extension script loaded once). Exposed on the
  // returned Program as `.extensions` (see interpret()/buildRenderPlan's
  // own passthrough) - this is the one piece of information a runtime
  // extension actually needs Node-side resolution to hand forward; nothing
  // here executes or even reads the extension's own JS file.
  const extensionsByPackageDir = new Map();

  function loadExports(absPath) {
    if (exportsCache.has(absPath)) return exportsCache.get(absPath);
    if (inProgress.has(absPath)) {
      throw new AxisModuleError(`circular import: '${absPath}' imports itself, directly or indirectly`);
    }
    inProgress.add(absPath);

    const { program } = parseFile(absPath);
    for (const item of program.items) {
      if (item.kind === "ImportDecl") resolveImport(absPath, item);
    }

    const exportsByName = new Map();
    for (const item of program.items) {
      if (!item.exported) continue;
      if (!EXPORTABLE_KINDS.has(item.kind)) continue; // parser.js already prevents this; defensive only
      item.sourceFile = absPath;
      exportsByName.set(item.name, item);
    }

    inProgress.delete(absPath);
    exportsCache.set(absPath, exportsByName);
    return exportsByName;
  }

  // A relative path ('./x.ax', '../shared/y.ax') resolves to a real file,
  // same as always. A bare name ('physics', 'ui-kit' - no leading './' or
  // '../') resolves as a package instead (see findPackageEntry) - anything
  // else (a bare name that still ends in '.ax', almost always a relative
  // path that's missing its './') is a clear mistake, not a package name.
  function resolveImportTarget(fromPath, importPath) {
    const isRelative = importPath.startsWith("./") || importPath.startsWith("../");
    if (isRelative) {
      if (!importPath.endsWith(".ax")) {
        throw new AxisModuleError(`import '${importPath}' (in ${fromPath}) must end in '.ax'`);
      }
      return path.resolve(path.dirname(fromPath), importPath);
    }
    if (importPath.endsWith(".ax")) {
      throw new AxisModuleError(
        `import '${importPath}' (in ${fromPath}) doesn't start with './' or '../' - use a relative path for a file (e.g. './${importPath}'), or drop the '.ax' for a package name`
      );
    }
    const { found, tried, packageDir, runtimeExtension, buildExtension } = findPackageEntry(path.dirname(fromPath), importPath);
    if (!found) {
      throw new AxisModuleError(
        `can't find package '${importPath}' (imported in ${fromPath}) - looked for:\n${tried.map((p) => `  ${p}`).join("\n")}`
      );
    }
    if (runtimeExtension && !extensionsByPackageDir.has(packageDir)) {
      extensionsByPackageDir.set(packageDir, { name: importPath, jsFile: runtimeExtension });
    }
    // Run before this package's own `.ax` source is ever parsed/interpreted
    // (loadExports/interpretation both happen after resolveImport returns),
    // so a type it registers is already known by the time anything could
    // reference it.
    if (buildExtension && !buildExtensionsRunGlobally.has(packageDir)) {
      buildExtensionsRunGlobally.add(packageDir);
      runBuildExtension(buildExtension);
    }
    return found;
  }

  function resolveImport(fromPath, importDecl) {
    const targetPath = resolveImportTarget(fromPath, importDecl.path);
    const exportsByName = loadExports(targetPath);
    const found = exportsByName.get(importDecl.name);
    if (!found) {
      const available = [...exportsByName.keys()];
      throw new AxisModuleError(
        `'${importDecl.path}' (imported as '${importDecl.name}' in ${fromPath}) doesn't export '${importDecl.name}'` +
          (available.length ? ` - it exports: ${available.join(", ")}` : " - it doesn't export anything")
      );
    }
    const key = `${targetPath}#${importDecl.name}`;
    if (!importedKeys.has(key)) {
      importedKeys.add(key);
      imported.push(found);
    }
  }

  const { program: entryProgram } = parseFile(absEntry);
  for (const item of entryProgram.items) {
    if (item.kind === "ImportDecl") resolveImport(absEntry, item);
  }

  const ownItems = entryProgram.items.filter((item) => item.kind !== "ImportDecl");
  return { kind: "Program", items: [...imported, ...ownItems], extensions: [...extensionsByPackageDir.values()] };
}
