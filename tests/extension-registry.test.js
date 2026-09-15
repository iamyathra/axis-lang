// Unit-level coverage for src/extensionRegistry.js's own validation - the
// public registration API a runtime extension's script calls into (see
// docs/runtime-extensions.md). Pure ES module, no DOM/three.js dependency,
// so this runs directly under Node like any other unit test - the real
// end-to-end "an extension's script actually runs in a browser and the
// property actually works" proof lives in
// tests/browser/runtime-extension.test.js instead; this file is just the
// registry's own input validation.
//
// Moved from src/renderer/ to src/ (2026-09-14, alongside
// registerElementType) - interpreter.js needs to import it too, and
// interpreter.js/domHtml.js/pageRuntime.js are all *also* served flat to
// the browser at root URLs (server.js/domServer.js's STATIC_FILES), so a
// relative import's on-disk correctness and its browser-resolved URL only
// agree for every dual Node+browser consumer at once when this file lives
// next to interpreter.js, not one directory down - see modules.js's own
// `buildExtension` comment for the fuller account.
import { test } from "node:test";
import assert from "node:assert/strict";
import { registerScalarProperty, registeredScalarProperties } from "../src/extensionRegistry.js";

test("a valid registration is recorded with the given get/set and defaults filled in", () => {
  const get = () => 1;
  const set = () => {};
  registerScalarProperty("testProp1", { get, set });
  const entry = registeredScalarProperties().get("testProp1");
  assert.equal(entry.get, get);
  assert.equal(entry.set, set);
  assert.equal(entry.animatable, false); // default
  assert.equal(entry.valueType, "number"); // default
});

test("animatable/valueType are respected when given explicitly", () => {
  registerScalarProperty("testProp2", { get: () => 1, set: () => {}, animatable: true, valueType: "color" });
  const entry = registeredScalarProperties().get("testProp2");
  assert.equal(entry.animatable, true);
  assert.equal(entry.valueType, "color");
});

test("registering the same name twice is a clear error, not a silent overwrite", () => {
  registerScalarProperty("testProp3", { get: () => 1, set: () => {} });
  assert.throws(() => registerScalarProperty("testProp3", { get: () => 2, set: () => {} }), /already registered/);
});

test("a missing 'get' or 'set' function is a clear error", () => {
  assert.throws(() => registerScalarProperty("testPropNoGet", { set: () => {} }), /needs 'get\(obj3d\)' and 'set\(obj3d, value\)'/);
  assert.throws(() => registerScalarProperty("testPropNoSet", { get: () => 1 }), /needs 'get\(obj3d\)' and 'set\(obj3d, value\)'/);
});

test("an empty or non-string name is a clear error", () => {
  assert.throws(() => registerScalarProperty("", { get: () => 1, set: () => {} }), /non-empty string/);
  assert.throws(() => registerScalarProperty(null, { get: () => 1, set: () => {} }), /non-empty string/);
});

test("an invalid valueType is a clear error, not silently accepted", () => {
  assert.throws(
    () => registerScalarProperty("testPropBadType", { get: () => 1, set: () => {}, valueType: "string" }),
    /valueType must be "number", "boolean", or "color"/
  );
});
