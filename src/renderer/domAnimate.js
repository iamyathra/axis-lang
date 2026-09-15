// The `animate` path names a page element actually supports (`opacity`,
// `position.x`, ...) mapped to the flat, JS-friendly change property both
// halves of DOM animation apply to the real page: domPlan.js (baking a
// load-time animation into the render plan, on the Node side) and
// domClient.js (running one live the moment an `on` handler triggers it, in
// the browser). A page element doesn't have a real position/rotation/scale
// field the way a 3D object does, so this is the one place that
// vocabulary is defined - both call sites import it rather than keeping
// their own copy.
export const PATH_TO_PROPERTY = {
  opacity: "opacity",
  "position.x": "positionX",
  "position.y": "positionY",
  scale: "scale",
  rotation: "rotation",
  color: "color",
  background: "background",
};

// The subset of PATH_TO_PROPERTY's values whose animated value is a CSS
// color string, lerped component-wise (see colorLerp.js), not a number -
// shared by domPlan.js (deciding each change's `color` flag at build time)
// and pageRuntime.js (deciding whether to run a change through the color
// lerp path at all, live and inside a timeline step).
export const COLOR_PROPERTIES = new Set(["color", "background"]);
