import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveModules, AxisModuleError } from "../src/modules.js";
import { interpret } from "../src/interpreter.js";
import { AxisSyntaxError } from "../src/lexer.js";
import { registeredElementTypes } from "../src/extensionRegistry.js";

const FIXTURES = fileURLToPath(new URL("./fixtures/modules/", import.meta.url));

function fixture(name) {
  return path.join(FIXTURES, name);
}

test("resolves a simple import - the imported fn is prepended ahead of the entry file's own items", () => {
  const program = resolveModules(fixture("uses-utils.ax"));
  const kinds = program.items.map((i) => i.kind);
  assert.deepEqual(kinds, ["FnDecl", "PageDecl"]);
  assert.equal(program.items[0].name, "shout");
});

test("an imported item is tagged with its defining file's absolute path", () => {
  const program = resolveModules(fixture("uses-utils.ax"));
  const [shout] = program.items;
  assert.equal(shout.sourceFile, fixture("utils.ax"));
});

test("transitively resolves an imported file's own imports", () => {
  const program = resolveModules(fixture("left.ax")); // left.ax isn't a page/scene on its own, so resolve it directly
  const kinds = program.items.map((i) => i.kind);
  // left.ax exports useLeft and itself imports helper from shared.ax -
  // both should be present, helper first (resolved before left.ax's own items)
  assert.deepEqual(kinds, ["FnDecl", "FnDecl"]);
  assert.equal(program.items[0].name, "helper");
  assert.equal(program.items[1].name, "useLeft");
});

test("a diamond-shaped import graph doesn't duplicate the shared dependency", () => {
  const program = resolveModules(fixture("diamond.ax"));
  const helperCount = program.items.filter((i) => i.name === "helper").length;
  assert.equal(helperCount, 1);
  assert.ok(program.items.some((i) => i.name === "useLeft"));
  assert.ok(program.items.some((i) => i.name === "useRight"));
});

test("a full diamond program interprets and runs correctly (helper only defined once)", () => {
  const program = resolveModules(fixture("diamond.ax"));
  const result = interpret(program);
  const label = result.pages[0].nodes.find((n) => n.name === "label");
  assert.equal(label.content, "x-shared-left x-shared-right");
});

test("importing a component works the same way as importing a function", () => {
  const program = resolveModules(fixture("uses-card.ax"));
  const result = interpret(program);
  const heading = result.pages[0].nodes.find((n) => n.name === "projectA.h");
  assert.equal(heading.content, "AXIS!"); // Card's own body calls the utils.ax `shout` it imported
});

test("a missing imported file is a clear AxisModuleError", () => {
  assert.throws(() => resolveModules(fixture("missing-import.ax")), (err) => {
    assert.ok(err instanceof AxisModuleError);
    assert.match(err.message, /can't find/);
    return true;
  });
});

test("importing a name a module doesn't export is a clear error listing what it does export", () => {
  assert.throws(() => resolveModules(fixture("missing-export.ax")), (err) => {
    assert.ok(err instanceof AxisModuleError);
    assert.match(err.message, /doesn't export 'DoesNotExist'/);
    assert.match(err.message, /it exports: shout, greeting/);
    return true;
  });
});

test("an import path must end in .ax", () => {
  assert.throws(() => resolveModules(fixture("bad-extension.ax")), (err) => {
    assert.ok(err instanceof AxisModuleError);
    assert.match(err.message, /must end in '\.ax'/);
    return true;
  });
});

test("a circular import is a clear error, not infinite recursion", () => {
  assert.throws(() => resolveModules(fixture("circular-a.ax")), (err) => {
    assert.ok(err instanceof AxisModuleError);
    assert.match(err.message, /circular import/);
    return true;
  });
});

// ---- local package resolution (a bare specifier, not a relative path) ----

test("a bare import specifier resolves as a package under axis_modules/", () => {
  const program = resolveModules(fixture("uses-package.ax"));
  const kinds = program.items.map((i) => i.kind);
  assert.deepEqual(kinds, ["FnDecl", "PageDecl"]);
  assert.equal(program.items[0].name, "greet");
  assert.equal(program.items[0].sourceFile, fixture("axis_modules/greeter/index.ax"));
});

test("a package resolves correctly end to end - the imported fn actually runs", () => {
  const program = resolveModules(fixture("uses-package.ax"));
  const result = interpret(program);
  const label = result.pages[0].nodes.find((n) => n.name === "label");
  assert.equal(label.content, "Hello, AXIS!");
});

test("package resolution walks upward from a nested file to find axis_modules/", () => {
  const program = resolveModules(fixture("nested/deep/uses-package-from-parent.ax"));
  const result = interpret(program);
  const label = result.pages[0].nodes.find((n) => n.name === "label");
  assert.equal(label.content, "Hello, Nested!");
});

test("importing a package that doesn't exist is a clear error naming every path tried", () => {
  assert.throws(() => resolveModules(fixture("missing-package.ax")), (err) => {
    assert.ok(err instanceof AxisModuleError);
    assert.match(err.message, /can't find package 'nonexistent-package'/);
    assert.match(err.message, /axis_modules[/\\]nonexistent-package[/\\]index\.ax/);
    return true;
  });
});

test("a bare specifier ending in '.ax' (a relative path missing its './') is a clear, distinct error", () => {
  assert.throws(() => resolveModules(fixture("missing-relative-prefix.ax")), (err) => {
    assert.ok(err instanceof AxisModuleError);
    assert.match(err.message, /doesn't start with '\.\/' or '\.\.\/'/);
    return true;
  });
});

// ---- runtime extensions (axis.json's `runtimeExtension` field - a JS
// file resolveModules records but never itself reads/executes; see
// docs/runtime-extensions.md) ----

test("a package with no 'runtimeExtension' field resolves with an empty extensions list", () => {
  const program = resolveModules(fixture("uses-package.ax"));
  assert.deepEqual(program.extensions, []);
});

test("a package declaring 'runtimeExtension' is recorded on the resolved Program, by absolute path", () => {
  const program = resolveModules(fixture("uses-extension-package.ax"));
  assert.deepEqual(program.extensions, [{ name: "with-extension", jsFile: fixture("axis_modules/with-extension/extension.js") }]);
});

test("importing the same extension-carrying package twice (two different names) only records it once", () => {
  const program = resolveModules(fixture("uses-extension-package-twice.ax"));
  assert.equal(program.extensions.length, 1);
});

test("'runtimeExtension' can't escape the package directory via '../', same as 'main'", () => {
  assert.throws(() => resolveModules(fixture("uses-bad-extension-path-package.ax")), (err) => {
    assert.ok(err instanceof AxisModuleError);
    assert.match(err.message, /'runtimeExtension'.*must stay inside the package directory/);
    return true;
  });
});

// ---- build extensions (axis.json's `buildExtension` field - a JS file
// resolveModules DOES execute, synchronously via `vm`, unlike
// `runtimeExtension` above - see modules.js's own note on why. Registers a
// new element type via extensionRegistry.js's registerElementType; the
// real end-to-end "the new type actually renders and hydrates in a real
// browser" proof lives in tests/browser/element-type-extension.test.js. ----

test("a package declaring 'buildExtension' actually runs it, registering a real new element type", () => {
  resolveModules(fixture("uses-build-extension-package.ax"));
  const registered = registeredElementTypes().get("fixtureWidget");
  assert.ok(registered, "expected 'fixtureWidget' to be registered after resolving a file that imports its package");
  assert.equal(registered.tag, "b");
  assert.ok(registered.allowedProps.has("content"));
});

test("resolving the same buildExtension-carrying package again (a second file, or a re-check) doesn't throw", () => {
  // registerElementType itself throws on a genuine double-registration
  // (two different extensions claiming the same name) - this proves
  // resolveModules doesn't re-trigger that guard against itself just
  // because it's called more than once in the same process, the way
  // `axis lsp` calls it fresh on every edit.
  assert.doesNotThrow(() => resolveModules(fixture("uses-build-extension-package.ax")));
  assert.doesNotThrow(() => resolveModules(fixture("uses-build-extension-package.ax")));
});

test("a buildExtension that throws fails with a clear AxisModuleError, not a raw, unrelated-looking exception", () => {
  assert.throws(() => resolveModules(fixture("uses-broken-build-extension-package.ax")), (err) => {
    assert.ok(err instanceof AxisModuleError);
    assert.match(err.message, /buildExtension.*failed to run.*boom/);
    return true;
  });
});

// ---- package metadata (axis.json - optional, `main` is the only field
// resolution actually acts on) ----

test("a package with no axis.json still resolves to index.ax, unaffected", () => {
  const program = resolveModules(fixture("uses-package.ax"));
  assert.equal(program.items[0].sourceFile, fixture("axis_modules/greeter/index.ax"));
});

test("axis.json's 'main' field points resolution at a different entry file", () => {
  const program = resolveModules(fixture("uses-custom-main-package.ax"));
  const result = interpret(program);
  const label = result.pages[0].nodes.find((n) => n.name === "label");
  assert.equal(label.content, "Bye, AXIS!");
  assert.equal(program.items[0].sourceFile, fixture("axis_modules/custom-main/src/entry.ax"));
});

test("a malformed axis.json is a clear AxisModuleError, not a crash", () => {
  assert.throws(() => resolveModules(fixture("uses-bad-manifest-package.ax")), (err) => {
    assert.ok(err instanceof AxisModuleError);
    assert.match(err.message, /axis\.json' isn't valid JSON/);
    return true;
  });
});

test("axis.json's 'main' can't escape the package directory via '../'", () => {
  assert.throws(() => resolveModules(fixture("uses-escaping-main-package.ax")), (err) => {
    assert.ok(err instanceof AxisModuleError);
    assert.match(err.message, /must stay inside the package directory/);
    return true;
  });
});

test("a syntax error inside an imported file is tagged with that file's path", () => {
  assert.throws(() => resolveModules(fixture("imports-broken.ax")), (err) => {
    assert.ok(err instanceof AxisSyntaxError);
    assert.equal(err.filePath, fixture("broken-syntax.ax"));
    return true;
  });
});
