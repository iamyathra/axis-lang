// Render-on-demand (scene3d.js/client.js/domClient.js) replaced the old
// unconditional per-frame render loop with an invalidate()-driven one - see
// docs/architecture/render-on-demand.md. That behavior itself - does an idle
// scene actually stop calling requestAnimationFrame, does an animation's
// completion actually stop it again, does one viewport's activity actually
// leave a sibling viewport idle - only exists once a real WebGL canvas and
// a real animation-frame clock are running, which Node has neither of; it's
// covered by the browser verification in the render-on-demand session notes
// instead, the same way this repo already treats every other three.js-only
// behavior (see camera-controls-and-model-interaction.test.js's header).
//
// What Node *can* genuinely guard: these three browser-only runtime files
// stay syntactically valid modules (nothing here was exercised by any other
// test - a broken one would otherwise only surface as a blank page in a
// browser), and the server contract they're built on top of - the plan a
// scene/page with `animate`/`timeline`/multiple viewports serves - didn't
// shift underneath this purely-internal scheduling change.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { run } from "../src/run.js";
import { buildRenderPlan } from "../src/renderer/plan.js";
import { buildDomPlan } from "../src/renderer/domPlan.js";
import { startServer } from "../src/renderer/server.js";
import { startDomServer } from "../src/renderer/domServer.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const RUNTIME_FILES = ["scene3d.js", "client.js", "domClient.js"];

for (const file of RUNTIME_FILES) {
  test(`${file} is a syntactically valid module (the render-on-demand rewrite touched every one of these)`, () => {
    const abs = path.join(__dirname, "../src/renderer", file);
    assert.doesNotThrow(() => execFileSync(process.execPath, ["--check", abs], { stdio: "pipe" }));
  });
}

async function withServer(source, fn) {
  const plan = buildRenderPlan(run(source));
  const server = await startServer(plan);
  const port = server.address().port;
  try {
    await fn(`http://localhost:${port}`, plan);
  } finally {
    server.close();
  }
}

async function withDomServer(source, fn) {
  const plan = buildDomPlan(run(source));
  const server = await startDomServer(plan);
  const port = server.address().port;
  try {
    await fn(`http://localhost:${port}`, plan);
  } finally {
    server.close();
  }
}

test("a standalone scene with a finite animate still serves client.js and its plan untouched by the scheduling rewrite", async () => {
  await withServer(
    `scene main {
      camera { position: (0, 2, 6) }
      cube box { color: red }
      animate box { rotation.y -> 360deg duration: 800 }
    }`,
    async (base, plan) => {
      const html = await (await fetch(`${base}/`)).text();
      assert.match(html, /\/client\.js/);
      assert.match(html, /__AXIS_PLAN__/);
      assert.equal(plan.animations.length, 1);
      const clientRes = await fetch(`${base}/client.js`);
      assert.equal(clientRes.status, 200);
    }
  );
});

test("a page with multiple viewports - one idle, one with a timeline - still serves domClient.js and every viewport's scene plan", async () => {
  await withDomServer(
    `scene idleScene { cube a { color: blue } }
     scene animatedScene {
       cube b { color: orange }
       timeline spin { animate b { rotation.y -> 360deg duration: 500 } }
     }
     page Home {
       viewport idle { scene: "idleScene" }
       viewport moving { scene: "animatedScene" }
     }`,
    async (base, plan) => {
      const html = await (await fetch(`${base}/`)).text();
      assert.match(html, /\/domClient\.js/);
      const viewportNodes = plan.nodes.filter((n) => n.type === "viewport");
      assert.equal(viewportNodes.length, 2);
      assert.equal(viewportNodes.find((n) => n.name === "idle").scene.animations.length, 0);
      assert.equal(viewportNodes.find((n) => n.name === "moving").scene.timelines.length, 1);
      const domClientRes = await fetch(`${base}/domClient.js`);
      assert.equal(domClientRes.status, 200);
    }
  );
});

test("scrollProgress and scrollTimeline still reach the served page plan for a viewport (the scroll wake-signal reads these same plan flags)", async () => {
  await withDomServer(
    `state p = 0
     scene stage { cube box { color: green } timeline grow { animate box { scale.x -> 1 duration: 400 } } }
     page Home {
       container hero {
         scrollProgress: "p"
         viewport stage { scene: "stage" scrollTimeline: "grow" }
       }
     }`,
    async (base, plan) => {
      const viewportNode = plan.nodes.flatMap((n) => (n.children ?? [n])).find((n) => n.type === "viewport");
      assert.equal(viewportNode.scrollTimeline, "grow");
      const heroNode = plan.nodes.find((n) => n.name === "hero");
      assert.equal(heroNode.scrollProgress, "p");
    }
  );
});
