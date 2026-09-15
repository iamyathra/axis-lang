// The browser-side half of `badge` - loaded via a real <script type="module">
// tag (see docs/runtime-extensions.md's "How extensions load" section),
// registering the exact same tag/allowedProps shape build.js already
// registered in Node, so pageRuntime.js knows what real DOM tag to create
// and hydrate. Two separate registrations (this file and build.js), one per
// side of the Node/browser boundary AXIS's own architecture already keeps
// everywhere else (interpreter.js vs. scene3d.js/pageRuntime.js) - not a
// duplicated concept, the same split every built-in element type already has.
import { registerElementType } from "/extensionRegistry.js";

registerElementType("badge", {
  tag: "span",
  allowedProps: ["content"],
  defaults: { content: "" },
});
