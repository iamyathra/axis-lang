// Unit tests for check.js's checkFile() (the engine) plus subprocess tests
// for `axis check --json` (the CLI contract docs/ai/VALIDATION.md
// documents) - the two layers are tested separately so a check.js bug and a
// cli.js formatting bug fail in different tests.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkFile } from "../src/check.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const CLI = path.join(ROOT, "bin", "axis.js");

function withTempFile(contents, filename, fn) {
  const dir = mkdtempSync(path.join(tmpdir(), "axis-check-test-"));
  const file = path.join(dir, filename);
  writeFileSync(file, contents);
  try {
    return fn(file, dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// --- checkFile() unit tests -------------------------------------------------

test("checkFile: a valid scene is valid with no diagnostics", () => {
  withTempFile("scene main { cube box { color: red } }", "main.ax", (file) => {
    const result = checkFile(file);
    assert.equal(result.version, 1);
    assert.equal(result.valid, true);
    assert.deepEqual(result.diagnostics, []);
  });
});

test("checkFile: a valid page is valid", () => {
  withTempFile('page Home { button go { label: "Go" } }', "page.ax", (file) => {
    assert.equal(checkFile(file).valid, true);
  });
});

test("checkFile: semantic validation runs too, not just syntax - an unknown property is caught", () => {
  withTempFile("scene main { cube box { colr: red } }", "main.ax", (file) => {
    const result = checkFile(file);
    assert.equal(result.valid, false);
    assert.equal(result.diagnostics.length, 1);
    assert.equal(result.diagnostics[0].code, "AXIS_SEMANTIC_UNKNOWN_PROPERTY");
  });
});

test("checkFile: a plan-level issue (an unembedded scene) is a warning, not an error - still valid", () => {
  withTempFile(
    'scene Unused { cube box { color: red } }\npage Home { button go { label: "Go" } }',
    "main.ax",
    (file) => {
      const result = checkFile(file);
      assert.equal(result.valid, true);
      assert.equal(result.diagnostics.length, 1);
      assert.equal(result.diagnostics[0].severity, "warning");
      assert.equal(result.diagnostics[0].code, "AXIS_PLAN_WARNING");
    }
  );
});

test("checkFile: a file with no scene or page is invalid with a dedicated code", () => {
  withTempFile("let x = 1", "empty.ax", (file) => {
    const result = checkFile(file);
    assert.equal(result.valid, false);
    assert.equal(result.diagnostics[0].code, "AXIS_SEMANTIC_NO_RENDERABLE_ROOT");
  });
});

test("checkFile: a non-.ax path is invalid, doesn't throw", () => {
  withTempFile("not axis", "main.txt", (file) => {
    const result = checkFile(file);
    assert.equal(result.valid, false);
    assert.equal(result.diagnostics[0].code, "AXIS_CLI_INVALID_FILE_TYPE");
  });
});

test("checkFile: a missing file is invalid, doesn't throw", () => {
  const result = checkFile("/nonexistent/path/does-not-exist.ax");
  assert.equal(result.valid, false);
  assert.equal(result.diagnostics[0].code, "AXIS_IO_FILE_NOT_READABLE");
});

test("checkFile: multi-file imports are resolved - a missing import is caught", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "axis-check-test-"));
  try {
    const main = path.join(dir, "main.ax");
    writeFileSync(main, 'import thing from "./nope.ax"\nscene main { cube box { color: red } }');
    const result = checkFile(main);
    assert.equal(result.valid, false);
    assert.equal(result.diagnostics[0].code, "AXIS_MODULE_NOT_FOUND");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- CLI `axis check --json` contract ---------------------------------------

function axisCheckJson(args) {
  const result = spawnSync(process.execPath, [CLI, "check", ...args, "--json"], { encoding: "utf8", cwd: ROOT });
  return { ...result, json: JSON.parse(result.stdout) };
}

test("axis check --json: stdout is valid JSON and only JSON, for a valid file", () => {
  withTempFile("scene main { cube box { color: red } }", "main.ax", (file) => {
    const { status, json, stdout } = axisCheckJson([file]);
    assert.equal(status, 0);
    assert.equal(json.valid, true);
    assert.equal(json.version, 1);
    assert.deepEqual(json.diagnostics, []);
    // the ENTIRE stdout must parse - nothing before/after the JSON object
    assert.equal(stdout.trim().startsWith("{"), true);
    assert.equal(stdout.trim().endsWith("}"), true);
  });
});

test("axis check --json: stdout is pure JSON even for a program that calls print() at top level", () => {
  withTempFile(
    'let ignored = print("this must not leak into stdout")\nscene main { cube box { color: red } }',
    "main.ax",
    (file) => {
      const { status, json } = axisCheckJson([file]);
      assert.equal(status, 0);
      assert.equal(json.valid, true);
    }
  );
});

test("axis check --json: an invalid file reports a non-empty diagnostics array and exit code 1", () => {
  withTempFile("scene main { cube box { colr: red } }", "main.ax", (file) => {
    const { status, json } = axisCheckJson([file]);
    assert.equal(status, 1);
    assert.equal(json.valid, false);
    assert.equal(json.diagnostics.length, 1);
    const d = json.diagnostics[0];
    assert.equal(d.severity, "error");
    assert.equal(typeof d.code, "string");
    assert.equal(typeof d.message, "string");
    assert.equal(d.file, file);
  });
});

test("axis check --json: a syntax error's diagnostic includes line and column", () => {
  withTempFile("scene main { cube box { color red } }", "main.ax", (file) => {
    const { json } = axisCheckJson([file]);
    assert.equal(json.valid, false);
    const loc = json.diagnostics[0].location;
    assert.equal(typeof loc.start.line, "number");
    assert.equal(typeof loc.start.column, "number");
  });
});

test("axis check --json: a semantic error's diagnostic includes a suggestion when a close name exists", () => {
  withTempFile(
    "scene main { cube box { color: red } animate boxx { rotation.y -> 1deg duration: 1s } }",
    "main.ax",
    (file) => {
      const { json } = axisCheckJson([file]);
      assert.match(json.diagnostics[0].suggestion, /'box'/);
    }
  );
});

test("axis check without --json still exits 0/1 the same way as --json does", () => {
  withTempFile("scene main { cube box { color: red } }", "main.ax", (file) => {
    const result = spawnSync(process.execPath, [CLI, "check", file], { encoding: "utf8", cwd: ROOT });
    assert.equal(result.status, 0);
  });
  withTempFile("scene main { cube box { colr: red } }", "main.ax", (file) => {
    const result = spawnSync(process.execPath, [CLI, "check", file], { encoding: "utf8", cwd: ROOT });
    assert.equal(result.status, 1);
  });
});

test("axis check --json <file>: --json works regardless of flag/positional order", () => {
  withTempFile("scene main { cube box { color: red } }", "main.ax", (file) => {
    const beforePath = spawnSync(process.execPath, [CLI, "check", "--json", file], { encoding: "utf8", cwd: ROOT });
    const afterPath = spawnSync(process.execPath, [CLI, "check", file, "--json"], { encoding: "utf8", cwd: ROOT });
    assert.deepEqual(JSON.parse(beforePath.stdout), JSON.parse(afterPath.stdout));
  });
});

test("axis check with no path prints usage and exits 2 (a tool/usage error, distinct from an invalid program)", () => {
  const result = spawnSync(process.execPath, [CLI, "check"], { encoding: "utf8", cwd: ROOT });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /usage:/);
});
