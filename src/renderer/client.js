// Runs in the browser, not in Node. Boots the shared 3D runtime
// (scene3d.js) for a whole-page `scene` file, mounted into <body> and sized
// to the window. All the actual three.js knowledge - building meshes,
// loading a `model`, tweening `animate`, raycasting for `on click`/`hover`
// - lives in scene3d.js now, shared with a `viewport` embedded inside a
// `page` (domClient.js), so there's exactly one 3D runtime rather than two
// copies of it. See docs/architecture/page-scene-fusion.md.

import { createGlobalEnv } from "/globals.js";
import { createSceneRuntime } from "/scene3d.js";

const plan = window.__AXIS_PLAN__;

const scriptEnv = createGlobalEnv();
for (const fn of plan.functions) {
  scriptEnv.define(fn.name, { __axisType: "function", name: fn.name, params: fn.params, body: fn.body, closure: scriptEnv, isAsync: fn.isAsync });
}
// Top-level `let`/`state` - see docs/architecture/reactive-state.md. A
// whole-page scene file has no page to share it with, but defining it here
// (rather than only inside the scene's own env) keeps this file's env
// setup identical to domClient.js's, which does matter when it's shared.
for (const [name, { value, constant }] of Object.entries(plan.sharedVariables ?? {})) {
  scriptEnv.define(name, value, constant);
}

// Render-on-demand: the loop below only keeps calling itself for as long as
// something actually needs a frame - an active `animate`/`timeline`, orbit
// controls still moving, or anything that just called `invalidate()` (an
// `on` handler's mutation, a model finishing its async load, ...). `wake()`
// is `onInvalidate` - the one thing scene3d.js's own runtime uses to say
// "schedule me again" when it changed something *outside* of tick() (so
// there's no already-running loop to naturally pick it up). See
// scene3d.js's own note on `invalidate`/`onInvalidate` for the full picture.
let scheduled = false;
function wake() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame((now) => {
    scheduled = false;
    if (runtime.tick(now)) wake();
  });
}

const runtime = await createSceneRuntime(plan, { container: document.body, scriptEnv, fitToContainer: false, onInvalidate: wake });
wake(); // the initial mount always needs its first frame
