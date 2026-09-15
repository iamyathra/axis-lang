// Runs in Node, synchronously, the moment a `.ax` file imports this
// package (see modules.js's own `buildExtension` note for exactly why this
// is a plain script with an injected `axis` object rather than an ordinary
// `import`). This is what makes `badge` a real, recognized element type at
// `axis check`/`axis build`/`axis run` time - without it, interpreter.js
// would reject `badge ... { ... }` as an unknown element type before a
// browser ever exists to render one.
axis.registerElementType("badge", {
  tag: "span",
  allowedProps: ["content", "color"],
  defaults: { content: "" },
});
