import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { run } from "../src/run.js";
import { buildRenderPlan } from "../src/renderer/plan.js";
import { startServer } from "../src/renderer/server.js";

async function withServer(source, fn, options = {}) {
  const plan = buildRenderPlan(run(source));
  const server = await startServer(plan, options);
  const port = server.address().port;
  try {
    await fn(`http://localhost:${port}`, plan);
  } finally {
    server.close();
  }
}

test("serves a page that embeds the render plan", async () => {
  await withServer(`scene main { cube box { color: red } }`, async (base) => {
    const res = await fetch(`${base}/`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "text/html");
    const html = await res.text();
    assert.match(html, /__AXIS_PLAN__/);
    assert.match(html, /\/client\.js/);
    assert.match(html, /"box"/);
  });
});

test("serves the client runtime and every language file it needs", async () => {
  await withServer(`scene main { cube box { color: red } }`, async (base) => {
    for (const file of ["/client.js", "/evaluator.js", "/globals.js", "/suggest.js"]) {
      const res = await fetch(`${base}${file}`);
      assert.equal(res.status, 200, `${file} should be served`);
      assert.equal(res.headers.get("content-type"), "text/javascript");
    }
  });
});

test("serves three.js and its internal sibling import", async () => {
  await withServer(`scene main { cube box { color: red } }`, async (base) => {
    const entry = await fetch(`${base}/vendor/three.module.js`);
    assert.equal(entry.status, 200);
    const core = await fetch(`${base}/vendor/three.core.js`);
    assert.equal(core.status, 200);
  });
});

test("blocks path traversal through the /vendor/ route", async () => {
  await withServer(`scene main { cube box { color: red } }`, async (base) => {
    const res = await fetch(`${base}/vendor/../../../../etc/passwd`);
    assert.notEqual(res.status, 200);
  });
});

test("404s on an unknown path", async () => {
  await withServer(`scene main { cube box { color: red } }`, async (base) => {
    const res = await fetch(`${base}/nope`);
    assert.equal(res.status, 404);
  });
});

test("the embedded plan JSON round-trips repeat: infinite as a string", async () => {
  await withServer(
    `scene main { cube box { color: red } animate box { rotation.y -> 360deg duration: 1s repeat: infinite } }`,
    async (base) => {
      const html = await (await fetch(`${base}/`)).text();
      assert.match(html, /"repeat":"infinite"/);
    }
  );
});

// ---- model / asset serving ---------------------------------------------

async function withTempProject(files, fn) {
  const dir = mkdtempSync(path.join(tmpdir(), "axis-asset-test-"));
  try {
    for (const [rel, contents] of Object.entries(files)) writeFileSync(path.join(dir, rel), contents);
    await fn(dir); // must await - the callback does async fetches against `dir`, and cleanup can't run before those finish
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("a scene with no models doesn't get an import map or a /vendor/jsm/ route", async () => {
  await withServer(`scene main { cube box { color: red } }`, async (base) => {
    const html = await (await fetch(`${base}/`)).text();
    assert.doesNotMatch(html, /importmap/);
    const res = await fetch(`${base}/vendor/jsm/loaders/GLTFLoader.js`);
    assert.equal(res.status, 404);
  });
});

test("a scene with a model gets an import map for three's bare 'three' import, and serves GLTFLoader", async () => {
  await withServer(`scene main { model rock { src: "./rock.glb" } }`, async (base) => {
    const html = await (await fetch(`${base}/`)).text();
    assert.match(html, /importmap.*"three": "\/vendor\/three\.module\.js"/s);

    for (const file of ["/vendor/jsm/loaders/GLTFLoader.js", "/vendor/jsm/utils/BufferGeometryUtils.js", "/vendor/jsm/utils/SkeletonUtils.js"]) {
      const res = await fetch(`${base}${file}`);
      assert.equal(res.status, 200, `${file} should be served`);
      assert.equal(res.headers.get("content-type"), "text/javascript");
    }
  });
});

test("serves a model's actual asset bytes, with a gltf content-type, resolved against baseDir", async () => {
  const glbBytes = Buffer.from([0x67, 0x6c, 0x54, 0x46, 1, 2, 3, 4]); // doesn't need to be a real glTF - only proves byte-for-byte serving
  await withTempProject({ "rock.glb": glbBytes }, async (dir) => {
    await withServer(
      `scene main { model rock { src: "./rock.glb" } }`,
      async (base) => {
        const res = await fetch(`${base}/assets/rock.glb`);
        assert.equal(res.status, 200);
        assert.equal(res.headers.get("content-type"), "model/gltf-binary");
        const bytes = Buffer.from(await res.arrayBuffer());
        assert.ok(bytes.equals(glbBytes));
      },
      { baseDir: dir }
    );
  });
});

test("a model's asset route 404s cleanly if the file doesn't actually exist on disk", async () => {
  await withTempProject({}, async (dir) => {
    await withServer(
      `scene main { model rock { src: "./missing.glb" } }`,
      async (base) => {
        const res = await fetch(`${base}/assets/missing.glb`);
        assert.equal(res.status, 404);
      },
      { baseDir: dir }
    );
  });
});
