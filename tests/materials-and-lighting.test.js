// Covers AXIS's material/lighting/shadow vocabulary: `material.color` /
// `material.metalness` / `material.roughness` / `material.opacity` /
// `material.emissive` / `material.emissiveIntensity` on a shape or a
// `model` (a dotted property - already ordinary AXIS grammar, see
// parser.js's parsePath - not new syntax), `castShadow`/`receiveShadow` per
// object, `shadows: true` on a `directionalLight`/`spotLight`, and the new
// `spotLight` type. What's build-time-checkable (parsing, validation, what
// a render plan actually ships, reactive bindings) is covered here; the
// actual three.js material mutation/shadow rendering is client-side
// behavior with no Node-testable surface - see docs/language.md's Materials
// section and session notes on real browser verification for that half.

import { test } from "node:test";
import assert from "node:assert/strict";
import { run } from "../src/run.js";
import { AxisRuntimeError } from "../src/interpreter.js";
import { buildRenderPlan } from "../src/renderer/plan.js";

test("a shape accepts material.metalness/roughness/opacity/emissive/emissiveIntensity", () => {
  const result = run(`
    scene main {
      cube box {
        color: "#d4a574"
        material.metalness: 0.8
        material.roughness: 0.25
        material.opacity: 0.5
        material.emissive: "#ff0000"
        material.emissiveIntensity: 2
      }
    }
  `);
  const box = result.scenes[0].objects[0];
  assert.deepEqual(box.material, { metalness: 0.8, roughness: 0.25, opacity: 0.5, emissive: "#ff0000", emissiveIntensity: 2 });
});

test("material.color overlays a shape's plain 'color'", () => {
  const result = run(`scene main { cube box { color: red material.color: "#00ff00" } }`);
  assert.equal(result.scenes[0].objects[0].material.color, "#00ff00");
});

test("a 'model' also accepts material.* properties, overlaid on the loaded file's own materials", () => {
  const result = run(`scene main { model rock { src: "./rock.glb" material.metalness: 1 } }`);
  assert.deepEqual(result.scenes[0].objects[0].material, { metalness: 1 });
});

test("an unknown material field is a clear error with a suggestion", () => {
  assert.throws(
    () => run(`scene main { cube box { material.metalnes: 0.5 } }`),
    (err) => err instanceof AxisRuntimeError && /'material\.metalnes'/.test(err.message) && /did you mean 'material\.metalness'/.test(err.message)
  );
});

test("material.metalness needs a number, not a string", () => {
  assert.throws(
    () => run(`scene main { cube box { material.metalness: "high" } }`),
    (err) => err instanceof AxisRuntimeError && /'material.metalness' needs a number/.test(err.message)
  );
});

test("material.color needs a color string, not a number", () => {
  assert.throws(
    () => run(`scene main { cube box { material.color: 5 } }`),
    (err) => err instanceof AxisRuntimeError && /'material.color' needs a color name/.test(err.message)
  );
});

test("a shape accepts material.map (a texture file), validated like model.src but for image extensions", () => {
  const result = run(`scene main { cube box { color: red material.map: "./wood.jpg" } }`);
  assert.equal(result.scenes[0].objects[0].material.map, "./wood.jpg");
});

test("material.map rejects a .glb - it needs an image extension, not a model one", () => {
  assert.throws(
    () => run(`scene main { cube box { material.map: "./rock.glb" } }`),
    (err) => err instanceof AxisRuntimeError && /'material\.map' must point at a/.test(err.message) && /'\.jpg'/.test(err.message)
  );
});

test("material.map rejects a non-string value", () => {
  assert.throws(
    () => run(`scene main { cube box { material.map: 5 } }`),
    (err) => err instanceof AxisRuntimeError && /'material\.map' needs a string/.test(err.message)
  );
});

test("material.map rejects an absolute path, same as model.src does", () => {
  assert.throws(
    () => run(`scene main { cube box { material.map: "/etc/wood.jpg" } }`),
    (err) => err instanceof AxisRuntimeError && /'material\.map' must be a relative path/.test(err.message)
  );
});

test("material.map can't be animated - a texture doesn't interpolate", () => {
  assert.throws(
    () => run(`scene main { cube box { color: red material.map: "./wood.jpg" } animate box { material.map -> "./tile.jpg" duration: 1s } }`),
    (err) => err instanceof AxisRuntimeError && /'material\.map' can't be animated/.test(err.message)
  );
});

test("a 'model' also accepts material.map, overlaid the same way other material.* fields already are", () => {
  const result = run(`scene main { model rock { src: "./rock.glb" material.map: "./rock-albedo.png" } }`);
  assert.equal(result.scenes[0].objects[0].material.map, "./rock-albedo.png");
});

test("every distinct material.map texture is collected into the render plan's own 'textures' list, separate from 'assets'", () => {
  const result = run(`
    scene main {
      cube a { material.map: "./wood.jpg" }
      sphere b { material.map: "./wood.jpg" }
      model rock { src: "./rock.glb" material.map: "./rock-albedo.png" }
    }
  `);
  const plan = buildRenderPlan(result);
  assert.deepEqual(plan.textures, ["./wood.jpg", "./rock-albedo.png"]); // deduped, first-seen order
  assert.deepEqual(plan.assets, ["./rock.glb"]);
});

test("a scene with only a texture (no model) doesn't need the GLTFLoader addon", () => {
  const result = run(`scene main { cube box { material.map: "./wood.jpg" } }`);
  const plan = buildRenderPlan(result);
  assert.deepEqual(plan.assets, []);
  assert.deepEqual(plan.textures, ["./wood.jpg"]);
});

test("a non-literal material.map becomes a reactive binding, same as other material.* properties", () => {
  const result = run(`
    scene main {
      state tex = "./wood.jpg"
      cube box { material.map: tex }
    }
  `);
  assert.ok(result.scenes[0].objects[0].bindings["material.map"]);
});

test("a 'group' doesn't accept material.* - it has no single material of its own", () => {
  assert.throws(
    () => run(`scene main { group rig { material.metalness: 0.5 } }`),
    (err) => err instanceof AxisRuntimeError && /'group' doesn't have a 'material\.metalness' property/.test(err.message)
  );
});

test("castShadow/receiveShadow are booleans on a shape and a model", () => {
  const result = run(`
    scene main {
      cube box { castShadow: true receiveShadow: false }
      model rock { src: "./rock.glb" castShadow: false }
    }
  `);
  const [box, rock] = result.scenes[0].objects;
  assert.equal(box.castShadow, true);
  assert.equal(box.receiveShadow, false);
  assert.equal(rock.castShadow, false);
});

test("castShadow needs a boolean, not a string", () => {
  assert.throws(
    () => run(`scene main { cube box { castShadow: "yes" } }`),
    (err) => err instanceof AxisRuntimeError && /'castShadow' needs true or false/.test(err.message)
  );
});

test("a directionalLight defaults to shadows: false and accepts shadows: true", () => {
  const result = run(`
    scene main {
      directionalLight sun { direction: (-1, -1, 0) }
      directionalLight moon { direction: (0, -1, 0) shadows: true }
    }
  `);
  const [sun, moon] = result.scenes[0].objects;
  assert.equal(sun.shadows, false);
  assert.equal(moon.shadows, true);
});

test("a pointLight doesn't accept 'shadows' - not supported yet, a real limitation not a design decision", () => {
  assert.throws(
    () => run(`scene main { pointLight bulb { shadows: true } }`),
    (err) => err instanceof AxisRuntimeError && /'pointLight' doesn't have a 'shadows' property/.test(err.message)
  );
});

test("spotLight gets sensible defaults and accepts its own properties", () => {
  const result = run(`
    scene main {
      spotLight flash { position: (0, 5, 0) target: (1, 0, 0) angle: 30 penumbra: 0.5 shadows: true }
    }
  `);
  const [flash] = result.scenes[0].objects;
  assert.deepEqual(flash.position, [0, 5, 0]);
  assert.deepEqual(flash.target, [1, 0, 0]);
  assert.equal(flash.angle, 30);
  assert.equal(flash.penumbra, 0.5);
  assert.equal(flash.shadows, true);
});

test("a bare spotLight (no properties) still gets usable defaults", () => {
  const result = run(`scene main { spotLight flash {} }`);
  const [flash] = result.scenes[0].objects;
  assert.deepEqual(flash.position, [0, 0, 0]);
  assert.deepEqual(flash.target, [0, 0, 0]);
  assert.equal(flash.angle, 45);
  assert.equal(flash.penumbra, 0.2);
  assert.equal(flash.shadows, false);
});

test("hemisphereLight gets sensible defaults matching the old hardcoded fallback fill light", () => {
  const result = run(`scene main { hemisphereLight sky {} }`);
  const [sky] = result.scenes[0].objects;
  assert.equal(sky.color, "white");
  assert.equal(sky.groundColor, "#222233");
  assert.equal(sky.intensity, 0.6);
});

test("hemisphereLight accepts its own color/groundColor/intensity, nothing else", () => {
  const result = run(`scene main { hemisphereLight sky { color: "#ffddaa" groundColor: "#112233" intensity: 0.9 } }`);
  const [sky] = result.scenes[0].objects;
  assert.equal(sky.color, "#ffddaa");
  assert.equal(sky.groundColor, "#112233");
  assert.equal(sky.intensity, 0.9);
});

test("hemisphereLight doesn't accept 'position' - it's a directionless ambient gradient", () => {
  assert.throws(
    () => run(`scene main { hemisphereLight sky { position: (0, 1, 0) } }`),
    (err) => err instanceof AxisRuntimeError && /'hemisphereLight' doesn't have a 'position' property/.test(err.message)
  );
});

test("hemisphereLight's groundColor needs a color string, not a number", () => {
  assert.throws(
    () => run(`scene main { hemisphereLight sky { groundColor: 5 } }`),
    (err) => err instanceof AxisRuntimeError && /'groundColor' needs a color name or a string/.test(err.message)
  );
});

test("hemisphereLight's groundColor carries through the render plan, and is animatable like color", () => {
  const result = run(`
    scene main {
      hemisphereLight sky { groundColor: "#112233" }
      animate sky { groundColor -> "#445566" duration: 1s }
    }
  `);
  const plan = buildRenderPlan(result);
  const sky = plan.nodes.find((n) => n.name === "sky");
  assert.equal(sky.groundColor, "#112233");
  assert.deepEqual(plan.animations[0].changes[0], { path: ["groundColor"], from: "#112233", to: "#445566", color: true });
});

// ---- render plan ------------------------------------------------------

test("a shape's material carries through the render plan", () => {
  const sceneGraph = run(`scene main { cube box { color: red material.roughness: 0.1 } }`);
  const plan = buildRenderPlan(sceneGraph);
  assert.deepEqual(plan.nodes[0].material, { roughness: 0.1 });
});

test("a shape with no material.* properties still carries an empty material object through", () => {
  const sceneGraph = run(`scene main { cube box { color: red } }`);
  const plan = buildRenderPlan(sceneGraph);
  assert.deepEqual(plan.nodes[0].material, {});
});

test("castShadow/receiveShadow carry through the render plan", () => {
  const sceneGraph = run(`scene main { cube box { color: red castShadow: false } }`);
  const plan = buildRenderPlan(sceneGraph);
  assert.equal(plan.nodes[0].castShadow, false);
  assert.equal(plan.nodes[0].receiveShadow, undefined);
});

test("a directionalLight's 'shadows' carries through the render plan", () => {
  const sceneGraph = run(`scene main { directionalLight sun { direction: (-1, -1, 0) shadows: true } }`);
  const plan = buildRenderPlan(sceneGraph);
  assert.equal(plan.nodes[0].shadows, true);
});

test("a spotLight's angle converts from degrees to radians in the render plan, like rotation does", () => {
  const sceneGraph = run(`scene main { spotLight flash { angle: 90 } }`);
  const plan = buildRenderPlan(sceneGraph);
  assert.ok(Math.abs(plan.nodes[0].angle - Math.PI / 2) < 1e-9);
});

test("a spotLight's target and penumbra carry through the render plan unconverted", () => {
  const sceneGraph = run(`scene main { spotLight flash { target: (2, 0, 0) penumbra: 0.6 } }`);
  const plan = buildRenderPlan(sceneGraph);
  assert.deepEqual(plan.nodes[0].target, [2, 0, 0]);
  assert.equal(plan.nodes[0].penumbra, 0.6);
});

test("a non-literal material.* property becomes a reactive binding, same as position/color already do", () => {
  const sceneGraph = run(`
    scene main {
      state shine = 0.2
      cube box { color: red material.metalness: shine }
    }
  `);
  const plan = buildRenderPlan(sceneGraph);
  assert.ok(plan.nodes[0].bindings["material.metalness"]);
});

// ---- environment (scene background/fog) --------------------------------

test("a scene with no 'environment' block gets the same default background every scene always rendered against", () => {
  const result = run(`scene main { cube box { color: red } }`);
  const plan = buildRenderPlan(result);
  assert.equal(plan.environment.background, "#111111");
  assert.equal(plan.environment.fogColor, null);
});

test("'environment' declares background/fogColor/fogNear/fogFar", () => {
  const result = run(`scene main { environment { background: "#222233" fogColor: "#888888" fogNear: 5 fogFar: 40 } cube box {} }`);
  const env = result.scenes[0].environment;
  assert.equal(env.background, "#222233");
  assert.equal(env.fogColor, "#888888");
  assert.equal(env.fogNear, 5);
  assert.equal(env.fogFar, 40);
});

test("'environment' carries through the render plan with sensible fog defaults when only fogColor is set", () => {
  const result = run(`scene main { environment { fogColor: "#888888" } cube box {} }`);
  const plan = buildRenderPlan(result);
  assert.equal(plan.environment.fogColor, "#888888");
  assert.equal(plan.environment.fogNear, 10);
  assert.equal(plan.environment.fogFar, 50);
});

test("a second 'environment' block in the same scene is a clear error", () => {
  assert.throws(
    () => run(`scene main { environment { background: "#000" } environment { background: "#fff" } cube box {} }`),
    (err) => err instanceof AxisRuntimeError && /scene 'main' already has an environment/.test(err.message)
  );
});

test("'environment' doesn't take a name and can't be nested inside a group", () => {
  assert.throws(
    () => run(`scene main { environment thing { background: "#000" } cube box {} }`),
    (err) => err instanceof AxisRuntimeError && /'environment' doesn't take a name/.test(err.message)
  );
  assert.throws(
    () => run(`scene main { group rig { environment { background: "#000" } } }`),
    (err) => err instanceof AxisRuntimeError && /'environment' can't be nested inside a group/.test(err.message)
  );
});

test("environment.background needs a color string, not a number", () => {
  assert.throws(
    () => run(`scene main { environment { background: 5 } cube box {} }`),
    (err) => err instanceof AxisRuntimeError && /'background' needs a color name/.test(err.message)
  );
});

test("environment.fogNear needs a number, not a string", () => {
  assert.throws(
    () => run(`scene main { environment { fogColor: "#888" fogNear: "close" } cube box {} }`),
    (err) => err instanceof AxisRuntimeError && /'fogNear' needs a number/.test(err.message)
  );
});

test("'environment' is a real animate target for 'background', but not for fog (a clear error, not silently ignored)", () => {
  const result = run(`
    scene main {
      environment { background: "#111111" }
      cube box {}
      animate environment { background -> "#ffffff" duration: 1s }
    }
  `);
  const plan = buildRenderPlan(result);
  assert.deepEqual(plan.animations[0].changes[0], { path: ["background"], from: "#111111", to: "#ffffff", color: true });

  assert.throws(
    () => run(`scene main { environment { fogColor: "#888" } cube box {} animate environment { fogColor -> "#fff" duration: 1s } }`),
    (err) => err instanceof AxisRuntimeError && /'fogColor' can't be animated yet/.test(err.message)
  );
});

test("a shape literally named 'environment' collides with the scene's own environment - a clear error", () => {
  assert.throws(
    () => run(`scene main { environment { background: "#000" } cube environment { color: red } }`),
    (err) => err instanceof AxisRuntimeError && /'environment' is already defined/.test(err.message)
  );
});

test("a non-literal environment.background becomes a reactive binding; fog properties deliberately do not (build-time only for now)", () => {
  const result = run(`
    scene main {
      state bg = "#222222"
      environment { background: bg fogColor: "#888888" }
      cube box {}
    }
  `);
  const env = result.scenes[0].environment;
  assert.ok(env.bindings.background);
  assert.equal(env.bindings.fogColor, undefined);
  assert.equal(env.bindings.fogNear, undefined);
});
