import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const CLI = path.join(ROOT, "bin", "axis.js");

function axis(args) {
  return spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", cwd: ROOT });
}

function tempAxFile(contents, filename = "scene.ax") {
  const dir = mkdtempSync(path.join(tmpdir(), "axis-cli-test-"));
  const file = path.join(dir, filename);
  writeFileSync(file, contents);
  return { dir, file };
}

test("axis version prints a version string", () => {
  const result = axis(["version"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /^axis \d+\.\d+\.\d+/);
});

test("axis help / no args prints usage", () => {
  const withNoArgs = axis([]);
  const withHelp = axis(["--help"]);
  assert.equal(withNoArgs.status, 0);
  assert.match(withNoArgs.stdout, /usage:/);
  assert.equal(withHelp.status, 0);
  assert.match(withHelp.stdout, /usage:/);
});

test("axis check reports valid for a valid file", () => {
  const { file, dir } = tempAxFile("scene main { cube box { color: red } }");
  try {
    const result = axis(["check", file]);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /is valid/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("axis check reports a syntax error with a source snippet", () => {
  const { file, dir } = tempAxFile("scene main { cube box { color red } }");
  try {
    const result = axis(["check", file]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /is invalid/);
    assert.match(result.stderr, /AXIS_PARSE_/);
    assert.match(result.stderr, /cube box \{ color red \}/); // the offending line, printed for context
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("axis graph reports a runtime error with a 'did you mean'", () => {
  const { file, dir } = tempAxFile("scene main { cube box { color: red } animate boxx { rotation.y -> 1deg duration: 1s } }");
  try {
    const result = axis(["graph", file]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /did you mean 'box'/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("axis graph prints the interpreted scene graph as JSON", () => {
  const { file, dir } = tempAxFile("scene main { cube box { color: red } }");
  try {
    const result = axis(["graph", file]);
    assert.equal(result.status, 0);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.scenes[0].objects[0].name, "box");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("axis build writes a static, self-contained site to disk", () => {
  const { file, dir } = tempAxFile("scene main { cube box { color: red } }");
  const outDir = path.join(dir, "out");
  try {
    const result = axis(["build", file, "--out", outDir]);
    assert.equal(result.status, 0);
    for (const expected of ["index.html", "client.js", "evaluator.js", "globals.js", "suggest.js", "vendor/three.module.js"]) {
      assert.ok(existsSync(path.join(outDir, expected)), `expected ${expected} to exist`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("axis build writes a static, self-contained page site to disk", () => {
  const { file, dir } = tempAxFile(`page Home { button go { label: "Go" } }`, "page.ax");
  const outDir = path.join(dir, "out");
  try {
    const result = axis(["build", file, "--out", outDir]);
    assert.equal(result.status, 0);
    for (const expected of ["index.html", "domClient.js", "domStyle.js", "evaluator.js", "globals.js", "suggest.js"]) {
      assert.ok(existsSync(path.join(outDir, expected)), `expected ${expected} to exist`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("axis build copies a model's asset file into dist/, resolved relative to the .ax file", () => {
  const { file, dir } = tempAxFile(`scene main { model rock { src: "./rock.glb" } }`);
  writeFileSync(path.join(dir, "rock.glb"), Buffer.from([0x67, 0x6c, 0x54, 0x46, 1, 2, 3, 4]));
  const outDir = path.join(dir, "out");
  try {
    const result = axis(["build", file, "--out", outDir]);
    assert.equal(result.status, 0);
    for (const expected of ["assets/rock.glb", "vendor/jsm/loaders/GLTFLoader.js", "assetPath.js"]) {
      assert.ok(existsSync(path.join(outDir, expected)), `expected ${expected} to exist`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("axis graph prints a page graph as JSON", () => {
  const { file, dir } = tempAxFile(`page Home { button go { label: "Go" } }`, "page.ax");
  try {
    const result = axis(["graph", file]);
    assert.equal(result.status, 0);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.pages[0].nodes[0].name, "go");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("axis rejects a file with no scene or page", () => {
  const { file, dir } = tempAxFile("let x = 1", "empty.ax");
  try {
    const result = axis(["build", file]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /no 'scene' or 'page' found/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("axis builds a page that embeds a scene via a 'viewport', vendoring three.js alongside the DOM runtime", () => {
  const { file, dir } = tempAxFile(
    `scene Earth { camera { position: (0, 0, 3) } cube box { color: blue } }
     page Home { button go { label: "Go" } viewport hero { scene: "Earth" } }`,
    "fused.ax"
  );
  const outDir = path.join(dir, "out");
  try {
    const result = axis(["build", file, "--out", outDir]);
    assert.equal(result.status, 0);
    for (const expected of ["index.html", "domClient.js", "scene3d.js", "vendor/three.module.js"]) {
      assert.ok(existsSync(path.join(outDir, expected)), `expected ${expected} to exist`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("axis warns about a scene a page never embeds, but still builds", () => {
  const { file, dir } = tempAxFile(
    `scene Unused { cube box { color: red } } page Home { button go { label: "Go" } }`,
    "unused-scene.ax"
  );
  const outDir = path.join(dir, "out");
  try {
    const result = axis(["build", file, "--out", outDir]);
    assert.equal(result.status, 0);
    assert.match(result.stderr, /scene 'Unused' is declared but no 'viewport' embeds it/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("axis rejects a non-.ax file", () => {
  const { file, dir } = tempAxFile("not axis");
  const wrongExt = file.replace(".ax", ".txt");
  try {
    writeFileSync(wrongExt, "scene main { }");
    const result = axis(["check", wrongExt]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /expected a \.ax file/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function axisIn(cwd, args) {
  return spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", cwd });
}

test("axis fmt --check reports 1 and leaves the file untouched when formatting is needed", () => {
  const contents = "scene main{cube box{color:red}}";
  const { file, dir } = tempAxFile(contents);
  try {
    const result = axis(["fmt", file, "--check"]);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /needs formatting/);
    assert.equal(readFileSync(file, "utf8"), contents, "--check must not modify the file");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("axis fmt --check reports 0 for an already-formatted file", () => {
  const { file, dir } = tempAxFile("scene main {\n    cube box {\n        color: red\n    }\n}\n");
  try {
    const result = axis(["fmt", file, "--check"]);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /already formatted/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("axis fmt rewrites the file in place", () => {
  const { file, dir } = tempAxFile("scene main{cube box{color:red}}");
  try {
    const result = axis(["fmt", file]);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /formatted/);
    const rewritten = readFileSync(file, "utf8");
    assert.equal(rewritten, "scene main {\n    cube box {\n        color: red\n    }\n}\n");
    // running it again is a no-op (idempotent) and reports as such
    const second = axis(["fmt", file]);
    assert.equal(second.status, 0);
    assert.match(second.stdout, /already formatted/);
    assert.equal(readFileSync(file, "utf8"), rewritten);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("axis fmt on a file with a syntax error exits 2 and doesn't touch the file", () => {
  const contents = "scene main { cube box { color red } }";
  const { file, dir } = tempAxFile(contents);
  try {
    const result = axis(["fmt", file]);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /syntax error/);
    assert.equal(readFileSync(file, "utf8"), contents);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("axis fmt with no path prints usage and exits 2", () => {
  const result = axis(["fmt"]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /usage:/);
});

test("axis inspect prints a human-readable symbol tree", () => {
  const { file, dir } = tempAxFile("scene main { cube box { color: red } }");
  try {
    const result = axis(["inspect", file]);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /main \(scene\)/);
    assert.match(result.stdout, /box \(cube\)/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("axis inspect --json prints a versioned, flattened symbol list with dot-joined paths", () => {
  const { file, dir } = tempAxFile("scene main { cube box { color: red } }");
  try {
    const result = axis(["inspect", file, "--json"]);
    assert.equal(result.status, 0);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.version, 1);
    const box = parsed.symbols.find((s) => s.name === "box");
    assert.equal(box.kind, "object");
    assert.equal(box.path, "main.box");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("axis inspect doesn't require semantic validity, only syntactic - an unknown property still inspects fine", () => {
  const { file, dir } = tempAxFile("scene main { cube box { colr: red } }");
  try {
    const result = axis(["inspect", file, "--json"]);
    assert.equal(result.status, 0);
    const parsed = JSON.parse(result.stdout);
    assert.ok(parsed.symbols.some((s) => s.name === "box"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("axis lsp actually speaks LSP as a real subprocess - initialize gets a well-formed response over stdio", () => {
  const proc = spawnSync(process.execPath, [CLI, "lsp"], {
    encoding: "utf8",
    input: (() => {
      const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
      return `Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`;
    })(),
    timeout: 3000,
  });
  // the server only exits on the protocol's own 'exit' notification (see
  // lsp.js) - spawnSync's stdin EOF (from `input` being a plain string)
  // ends the process from the OS side once it's written its response, so
  // asserting on stdout content (not the exit code, which is
  // platform-dependent for a signal-killed process) is what actually
  // matters here.
  const stdout = proc.stdout ?? "";
  const match = /Content-Length: (\d+)\r\n\r\n/.exec(stdout);
  assert.ok(match, `expected a framed LSP response, got: ${JSON.stringify(stdout)}`);
  const body = stdout.slice(match.index + match[0].length, match.index + match[0].length + Number(match[1]));
  const parsed = JSON.parse(body);
  assert.equal(parsed.id, 1);
  assert.equal(parsed.result.capabilities.documentFormattingProvider, true);
});

test("axis inspect on a syntax error reports it and exits 1", () => {
  const { file, dir } = tempAxFile("scene main { cube box { color red } }");
  try {
    const result = axis(["inspect", file]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /syntax error/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("axis create scaffolds a starter project that itself checks out clean", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "axis-create-test-"));
  try {
    const result = axisIn(dir, ["create", "my-app"]);
    assert.equal(result.status, 0);
    assert.ok(existsSync(path.join(dir, "my-app", "main.ax")));
    const checked = axisIn(dir, ["check", path.join("my-app", "main.ax")]);
    assert.equal(checked.status, 0, checked.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("axis create refuses to overwrite an existing directory", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "axis-create-test-"));
  try {
    mkdirSync(path.join(dir, "my-app"));
    const result = axisIn(dir, ["create", "my-app"]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /already exists/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
