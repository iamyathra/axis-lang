// Covers the page+scene fusion milestone - a page's `viewport` embedding a
// `scene` - across the pipeline: interpreter.js (building the embedded
// scene graph), domPlan.js (nesting it into the DOM plan), and the dev
// server (serving three.js/assets only when actually needed). See
// docs/architecture/page-scene-fusion.md.

import { test } from "node:test";
import assert from "node:assert/strict";
import { run } from "../src/run.js";
import { AxisRuntimeError } from "../src/interpreter.js";
import { buildDomPlan } from "../src/renderer/domPlan.js";
import { startDomServer } from "../src/renderer/domServer.js";

test("a 'viewport' embeds the scene it references, building a full scene graph", () => {
  const result = run(`
    scene Earth {
      camera { position: (0, 0, 3) }
      cube box { color: blue }
    }
    page Home {
      viewport hero { scene: "Earth" }
    }
  `);
  const page = result.pages[0];
  const viewport = page.nodes.find((n) => n.name === "hero");
  assert.equal(viewport.type, "viewport");
  assert.equal(viewport.scene, "Earth");
  assert.ok(viewport.sceneGraph);
  assert.equal(viewport.sceneGraph.objects[0].name, "box");
  assert.deepEqual(viewport.sceneGraph.camera.position, [0, 0, 3]);
});

test("a 'viewport' can reference a scene declared later in the same file", () => {
  const result = run(`
    page Home {
      viewport hero { scene: "Earth" }
    }
    scene Earth {
      cube box { color: red }
    }
  `);
  const viewport = result.pages[0].nodes.find((n) => n.name === "hero");
  assert.equal(viewport.sceneGraph.objects[0].name, "box");
});

test("a 'viewport' defaults to a real size so it isn't invisible, but an explicit size wins", () => {
  const result = run(`
    scene Earth { cube box { color: red } }
    page Home {
      viewport hero { scene: "Earth" }
      viewport sized { scene: "Earth" width: 800 height: 600 }
    }
  `);
  const [hero, sized] = result.pages[0].nodes;
  assert.equal(hero.width, "100%");
  assert.equal(hero.height, 400);
  assert.equal(sized.width, 800);
  assert.equal(sized.height, 600);
});

test("top-level let is visible to an embedded scene, same as a standalone one", () => {
  const result = run(`
    let earthColor = "#4a90e2"
    scene Earth { cube box { color: earthColor } }
    page Home { viewport hero { scene: "Earth" } }
  `);
  const viewport = result.pages[0].nodes.find((n) => n.name === "hero");
  assert.equal(viewport.sceneGraph.objects[0].color, "#4a90e2");
});

test("a 'viewport' without 'scene' is a clear error", () => {
  assert.throws(
    () => run(`page Home { viewport hero { } }`),
    (err) => err instanceof AxisRuntimeError && /needs a 'scene' property/.test(err.message)
  );
});

test("a 'viewport' referencing an unknown scene is a clear error with a suggestion", () => {
  assert.throws(
    () => run(`scene Earth { } page Home { viewport hero { scene: "Eath" } } `),
    (err) => err instanceof AxisRuntimeError && /no scene with that name/.test(err.message) && /did you mean 'Earth'/.test(err.message)
  );
});

test("a 'viewport' can't contain other declarations", () => {
  assert.throws(
    () => run(`scene Earth { } page Home { viewport hero { scene: "Earth" cube nope { } } }`),
    (err) => err instanceof AxisRuntimeError && /can't contain other declarations/.test(err.message)
  );
});

test("axis no longer rejects a file that has both a scene and a page", () => {
  const result = run(`
    scene Earth { cube box { color: blue } }
    page Home { viewport hero { scene: "Earth" } }
  `);
  assert.equal(result.scenes.length, 1);
  assert.equal(result.pages.length, 1);
});

test("domPlan nests a full 3D plan (nodes/camera/animations/assets) under a viewport node", () => {
  const result = run(`
    scene Earth {
      camera { position: (0, 1, 4) }
      cube box { color: blue }
      animate box { rotation.y -> 360deg duration: 2s repeat: infinite }
    }
    page Home { viewport hero { scene: "Earth" } }
  `);
  const plan = buildDomPlan(result);
  const viewport = plan.nodes.find((n) => n.name === "hero");
  assert.equal(viewport.type, "viewport");
  assert.equal(viewport.sceneName, "Earth");
  assert.deepEqual(viewport.scene.camera.position, [0, 1, 4]);
  assert.equal(viewport.scene.nodes[0].name, "box");
  assert.equal(viewport.scene.animations.length, 1);
  assert.deepEqual(viewport.scene.assets, []);
  assert.equal(plan.warnings.length, 0);
});

test("domPlan warns about a scene the page never embeds, but still builds the rest", () => {
  const result = run(`
    scene Unused { cube box { color: red } }
    page Home { button go { label: "Go" } }
  `);
  const plan = buildDomPlan(result);
  assert.match(plan.warnings.join("\n"), /scene 'Unused' is declared but no 'viewport' embeds it/);
  assert.equal(plan.nodes.length, 1);
});

test("domPlan collects a model 'src' from an embedded scene into that viewport's own scene.assets", () => {
  const result = run(`
    scene Earth { model globe { src: "./earth.glb" } }
    page Home { viewport hero { scene: "Earth" } }
  `);
  const plan = buildDomPlan(result);
  const viewport = plan.nodes.find((n) => n.name === "hero");
  assert.deepEqual(viewport.scene.assets, ["./earth.glb"]);
});

// ---- dev server: three.js is only served when a page actually needs it ---

async function withDomServer(source, fn, options = {}) {
  const plan = buildDomPlan(run(source));
  const server = await startDomServer(plan, options);
  const port = server.address().port;
  try {
    await fn(`http://localhost:${port}`, plan);
  } finally {
    server.close();
  }
}

test("a page with a viewport serves scene3d.js and three.js's vendor bundle", async () => {
  await withDomServer(
    `scene Earth { cube box { color: blue } } page Home { viewport hero { scene: "Earth" } }`,
    async (base) => {
      for (const file of ["/scene3d.js", "/vendor/three.module.js"]) {
        const res = await fetch(`${base}${file}`);
        assert.equal(res.status, 200, `${file} should be served`);
      }
    }
  );
});

test("a viewport server-renders as a correctly-sized, empty container - the canvas is mounted client-side", async () => {
  await withDomServer(
    `scene Earth { cube box { color: blue } } page Home { viewport hero { scene: "Earth" width: 500 height: 300 } }`,
    async (base) => {
      const html = await (await fetch(`${base}/`)).text();
      assert.match(html, /<div data-axis-name="hero" style="[^"]*width: 500px[^"]*height: 300px[^"]*"><\/div>/);
    }
  );
});

test("a page with no viewport doesn't expose three.js's vendor routes at all", async () => {
  await withDomServer(`page Home { button go { label: "Go" } }`, async (base) => {
    const res = await fetch(`${base}/vendor/three.module.js`);
    assert.equal(res.status, 404);
  });
});

test("a page whose viewport has no model doesn't expose the GLTFLoader route", async () => {
  await withDomServer(
    `scene Earth { cube box { color: blue } } page Home { viewport hero { scene: "Earth" } }`,
    async (base) => {
      const res = await fetch(`${base}/vendor/jsm/loaders/GLTFLoader.js`);
      assert.equal(res.status, 404);
    }
  );
});
