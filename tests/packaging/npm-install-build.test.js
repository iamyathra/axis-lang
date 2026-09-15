// Opt-in, like tests/browser/*.test.js - not part of `npm test`, run via
// `npm run test:packaging`. Exercises the one boundary no in-process unit
// test can see by construction: what actually happens after a stranger
// runs `npm install axis-lang` for real. This is exactly the boundary that
// hid a real bug - src/renderer/threeVendor.js used to compute
// THREE_BUILD_DIR/THREE_JSM_DIR from a path hardcoded relative to its own
// location inside axis-lang's package directory, which only worked by
// accident in this repo (where axis-lang IS the node_modules root). A real
// npm install hoists the shared `three` dependency up to the installing
// project's own top-level node_modules instead, and `axis build` crashed
// with ENOENT for every real npm-installed consumer - found by actually
// running `npm pack` + `npm install` + `axis build` in a scratch directory,
// not by reasoning about the code. This test reproduces that exact
// sequence so a regression fails loudly instead of only being noticed the
// next time someone tries to actually use the package.
//
// Needs network/npm-cache access to install `three` as a transitive
// dependency into the scratch project - same category of "opt-in because
// it needs something beyond plain Node" as test:browser needing a real
// Chromium.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

test("a real npm install (three hoisted to the top level, not nested under axis-lang) can axis build", () => {
  const packDir = mkdtempSync(path.join(tmpdir(), "axis-pack-"));
  const projectDir = mkdtempSync(path.join(tmpdir(), "axis-consumer-"));
  try {
    const packResult = spawnSync("npm", ["pack", "--pack-destination", packDir], { cwd: ROOT, encoding: "utf8" });
    assert.equal(packResult.status, 0, packResult.stderr || packResult.error?.message);
    const tarballName = packResult.stdout.trim().split("\n").pop();
    const tarballPath = path.join(packDir, tarballName);
    assert.ok(existsSync(tarballPath), `expected ${tarballPath} to exist`);

    const init = spawnSync("npm", ["init", "-y"], { cwd: projectDir, encoding: "utf8" });
    assert.equal(init.status, 0, init.stderr);

    const install = spawnSync("npm", ["install", tarballPath], { cwd: projectDir, encoding: "utf8", timeout: 120_000 });
    assert.equal(install.status, 0, install.stderr);

    // Confirm this actually is the hoisted layout the bug needed - if npm
    // ever changes its own hoisting behavior and nests `three` after all,
    // this assertion (not the build below) is what should fail first.
    assert.ok(
      !existsSync(path.join(projectDir, "node_modules", "axis-lang", "node_modules", "three")),
      "expected `three` to be hoisted to the top level, not nested under axis-lang - if this fails, npm's hoisting behavior changed and this test no longer exercises the bug it was written for"
    );

    const axisBin = path.join(projectDir, "node_modules", ".bin", "axis");
    const create = spawnSync(axisBin, ["create", "myapp"], { cwd: projectDir, encoding: "utf8" });
    assert.equal(create.status, 0, create.stderr);

    const appDir = path.join(projectDir, "myapp");
    const build = spawnSync(axisBin, ["build", "main.ax"], { cwd: appDir, encoding: "utf8" });
    assert.equal(build.status, 0, build.stderr);
    assert.ok(existsSync(path.join(appDir, "dist", "vendor", "three.module.js")));
  } finally {
    rmSync(packDir, { recursive: true, force: true });
    rmSync(projectDir, { recursive: true, force: true });
  }
});
