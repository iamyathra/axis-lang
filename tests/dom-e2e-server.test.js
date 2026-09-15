import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { run } from "../src/run.js";
import { buildDomPlan } from "../src/renderer/domPlan.js";
import { startDomServer } from "../src/renderer/domServer.js";

async function withServer(source, fn) {
  const plan = buildDomPlan(run(source));
  const server = await startDomServer(plan);
  const port = server.address().port;
  try {
    await fn(`http://localhost:${port}`, plan);
  } finally {
    server.close();
  }
}

test("serves server-rendered HTML with the embedded plan", async () => {
  await withServer(`page Home { button go { label: "Go" } }`, async (base) => {
    const res = await fetch(`${base}/`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "text/html");
    const html = await res.text();
    assert.match(html, /__AXIS_PAGE_PLAN__/);
    assert.match(html, /\/domClient\.js/);
    assert.match(html, /<button data-axis-name="go"[^>]*>Go<\/button>/);
  });
});

test("nests container children in real markup, in declaration order", async () => {
  await withServer(
    `page Home {
      container hero {
        text a { content: "first" }
        text b { content: "second" }
      }
    }`,
    async (base) => {
      const html = await (await fetch(`${base}/`)).text();
      const heroStart = html.indexOf('data-axis-name="hero"');
      const aIdx = html.indexOf('data-axis-name="a"');
      const bIdx = html.indexOf('data-axis-name="b"');
      assert.ok(heroStart < aIdx && aIdx < bIdx);
    }
  );
});

test("escapes text content so it can't break out of its element", async () => {
  await withServer(`page Home { text a { content: "<script>alert(1)</script>" } }`, async (base) => {
    const html = await (await fetch(`${base}/`)).text();
    assert.doesNotMatch(html, /<script>alert/);
    assert.match(html, /&lt;script&gt;/);
  });
});

test("serves the DOM client runtime and every language file it needs", async () => {
  await withServer(`page Home { button go { label: "Go" } }`, async (base) => {
    for (const file of ["/domClient.js", "/pageRuntime.js", "/domHtml.js", "/domStyle.js", "/domAnimate.js", "/colorLerp.js", "/evaluator.js", "/globals.js", "/suggest.js"]) {
      const res = await fetch(`${base}${file}`);
      assert.equal(res.status, 200, `${file} should be served`);
      assert.equal(res.headers.get("content-type"), "text/javascript");
    }
  });
});

// A real, live regression this exact list format missed once already:
// pageRuntime.js gained a new `import ... from "./colorLerp.js"` (the DOM
// color/background animation lerp helper) without that file being added to
// domServer.js's own STATIC_FILES table - every unit test still passed
// (nothing here actually fetches pageRuntime.js as a real ES module the way
// a browser does), but the browser's own module resolution 404'd on it at
// runtime. Rather than trust the explicit file list above to be exhaustive
// by hand again, this parses pageRuntime.js's own relative imports and
// confirms every one of them is actually servable.
test("every relative import pageRuntime.js itself declares is actually servable", async () => {
  const source = await readFile(new URL("../src/renderer/pageRuntime.js", import.meta.url), "utf8");
  const relativeImports = [...source.matchAll(/from\s+"(\.\/[^"]+)"/g)].map((m) => "/" + m[1].slice(2));
  assert.ok(relativeImports.length > 0, "expected pageRuntime.js to have at least one relative import to check");
  await withServer(`page Home { button go { label: "Go" } }`, async (base) => {
    for (const file of relativeImports) {
      const res = await fetch(`${base}${file}`);
      assert.equal(res.status, 200, `${file} (imported by pageRuntime.js) should be served`);
    }
  });
});

test("renders the new element types to their real semantic tags", async () => {
  await withServer(
    `page Home {
      heading h { content: "Hi" level: 2 }
      paragraph p { content: "Some text" }
      form f {
        input name { placeholder: "Your name" }
      }
      list l {
        item i { }
      }
    }`,
    async (base) => {
      const html = await (await fetch(`${base}/`)).text();
      assert.match(html, /<h2 [^>]*>Hi<\/h2>/);
      assert.match(html, /<p [^>]*>Some text<\/p>/);
      assert.match(html, /<form [^>]*>.*<\/form>/s);
      assert.match(html, /<input [^>]*placeholder="Your name"[^>]*>/);
      assert.match(html, /<ul [^>]*><li [^>]*><\/li><\/ul>/);
    }
  );
});

test("serves the shared easing module alongside the rest of the runtime", async () => {
  await withServer(`page Home { button go { label: "Go" } }`, async (base) => {
    const res = await fetch(`${base}/easing.js`);
    assert.equal(res.status, 200);
  });
});

test("404s on an unknown path", async () => {
  await withServer(`page Home { button go { label: "Go" } }`, async (base) => {
    const res = await fetch(`${base}/nope`);
    assert.equal(res.status, 404);
  });
});
