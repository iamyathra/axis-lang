// A real (if trivial) buildExtension - actually executed by resolveModules,
// synchronously, in Node, via `vm` (see modules.js's own runBuildExtension)
// - unlike with-extension/extension.js's fixture sibling, which is never
// loaded by anything in tests/modules.test.js.
axis.registerElementType("fixtureWidget", {
  tag: "b",
  allowedProps: ["content"],
});
