// Every canonical example must actually validate - this is the mechanism
// docs/ai/README.md promises ("documentation examples must not silently
// rot"): if a language change breaks one of these, this test goes red
// instead of the drift being discovered by an AI agent (or a human) copying
// a now-broken example. Uses checkFile() directly (the same engine
// `axis check` runs) rather than shelling out, so this stays fast.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkFile } from "../src/check.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const EXAMPLES_DIR = path.join(ROOT, "examples");

function axFilesIn(dir) {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".ax"))
    .map((entry) => path.join(dir, entry.name));
}

const files = [
  ...axFilesIn(EXAMPLES_DIR),
  ...axFilesIn(path.join(EXAMPLES_DIR, "routing")),
  ...axFilesIn(path.join(EXAMPLES_DIR, "embed-html")),
  path.join(EXAMPLES_DIR, "embed-react", "src", "hero.ax"),
  // Each of these two projects' own axis_modules/ package gets validated
  // transitively via the entry file's own import chain (checkFile ->
  // resolveModules) - no need to list the package's files separately.
  path.join(EXAMPLES_DIR, "app-with-package", "main.ax"),
  path.join(EXAMPLES_DIR, "physics-demo", "main.ax"),
  path.join(EXAMPLES_DIR, "keyboard-input", "main.ax"),
  path.join(EXAMPLES_DIR, "fps-controls", "main.ax"),
  path.join(EXAMPLES_DIR, "game-foundation", "main.ax"),
  path.join(EXAMPLES_DIR, "third-party-extension", "main.ax"),
  path.join(EXAMPLES_DIR, "runtime-extension-demo", "main.ax"),
  path.join(EXAMPLES_DIR, "fps", "main.ax"),
];

assert.ok(files.length >= 25, `expected to find AXIS's example corpus, only found ${files.length} files`);

for (const file of files) {
  test(`example checks out clean: ${path.relative(ROOT, file)}`, () => {
    const result = checkFile(file);
    const errors = result.diagnostics.filter((d) => d.severity === "error");
    assert.equal(
      result.valid,
      true,
      `${path.relative(ROOT, file)} is invalid:\n${errors.map((d) => `  ${d.code}: ${d.message}`).join("\n")}`
    );
  });
}
