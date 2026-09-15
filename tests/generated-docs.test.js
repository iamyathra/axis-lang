// Guards against docs/ai/ERROR_CODES.md and docs/ai/schema.json drifting
// out of sync with the source they're generated from - if this fails, run
// `node scripts/gen-error-codes-doc.mjs` / `node scripts/gen-language-schema.mjs`
// and commit the result.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

function currentAndGenerated(script, outFile) {
  const before = readFileSync(path.join(ROOT, outFile), "utf8");
  execFileSync(process.execPath, [path.join(ROOT, "scripts", script)], { cwd: ROOT });
  const after = readFileSync(path.join(ROOT, outFile), "utf8");
  return { before, after };
}

test("docs/ai/ERROR_CODES.md is up to date with src/diagnostics.js's CODE_CATALOG", () => {
  const { before, after } = currentAndGenerated("gen-error-codes-doc.mjs", "docs/ai/ERROR_CODES.md");
  assert.equal(before, after, "docs/ai/ERROR_CODES.md is stale - run: node scripts/gen-error-codes-doc.mjs");
});

test("docs/ai/schema.json is up to date with its source constants", () => {
  const { before, after } = currentAndGenerated("gen-language-schema.mjs", "docs/ai/schema.json");
  assert.equal(before, after, "docs/ai/schema.json is stale - run: node scripts/gen-language-schema.mjs");
});
