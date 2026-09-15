// threeVendor.js used to compute THREE_BUILD_DIR/THREE_JSM_DIR from a
// hardcoded "../../node_modules/three/..." path relative to this file's own
// location inside axis-lang's package directory. That only worked by
// accident in this repo (where axis-lang IS the node_modules root) - a real
// npm install hoists `three` to the installing project's own top-level
// node_modules instead, and the hardcoded path silently pointed at a
// directory that doesn't exist there, breaking `axis build`/`axis run` for
// every real npm-installed consumer. This can't be caught by asserting the
// paths merely exist in-repo (that was already true under the broken
// implementation too, since this repo's own layout happens to satisfy it) -
// see tests/packaging/npm-install-build.test.js for the real npm-install
// boundary test that actually exercises the hoisted-layout case.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { THREE_BUILD_DIR, THREE_JSM_DIR } from "../src/renderer/threeVendor.js";

test("THREE_BUILD_DIR resolves to three's real build directory, wherever npm actually placed it", () => {
  assert.ok(path.isAbsolute(THREE_BUILD_DIR));
  assert.ok(existsSync(path.join(THREE_BUILD_DIR, "three.module.js")));
});

test("THREE_JSM_DIR resolves to three's real examples/jsm directory", () => {
  assert.ok(path.isAbsolute(THREE_JSM_DIR));
  assert.ok(existsSync(path.join(THREE_JSM_DIR, "loaders", "GLTFLoader.js")));
  assert.ok(existsSync(path.join(THREE_JSM_DIR, "controls", "OrbitControls.js")));
});
