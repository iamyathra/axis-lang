// Shared "real server + real headless browser" harness for the 3D lifecycle
// tests in this directory (dispose/raycast/tick) - the one thing every other
// test file in this project deliberately avoids (see e.g.
// tests/dom-e2e-server.test.js's own header comment: "actual three.js
// mutation... is client-side behavior with no Node-testable surface"). These
// tests close that gap for real, by actually running the browser runtime in
// a browser - not by asserting on the build-time plan and trusting the rest.
//
// Deliberately a SEPARATE, opt-in suite (tests/browser/*.test.js), not
// folded into tests/*.test.js - package.json's own "test" script glob
// (`node --test tests/*.test.js`) doesn't recurse into subdirectories, so
// this never runs as part of the default `npm test` and never requires
// anyone running the ordinary suite to have a ~300MB Chromium binary
// downloaded. Run this suite explicitly with `npm run test:browser` (which
// itself assumes `npx playwright install chromium` has already been run
// once - not automated here, the same way no other one-time environment
// setup in this project is).

import { chromium } from "playwright";
import { run } from "../../src/run.js";
import { resolveModules } from "../../src/modules.js";
import { interpret } from "../../src/interpreter.js";
import { buildDomPlan } from "../../src/renderer/domPlan.js";
import { startDomServer } from "../../src/renderer/domServer.js";
import { buildRenderPlan } from "../../src/renderer/plan.js";
import { startServer } from "../../src/renderer/server.js";

// swiftshader - software WebGL rendering, so this doesn't depend on an
// actual GPU being available (or accessible to a headless process) wherever
// `npm run test:browser` happens to run, dev machine or CI alike.
const LAUNCH_ARGS = ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"];

let sharedBrowser = null;
async function getBrowser() {
  sharedBrowser ??= await chromium.launch({ args: LAUNCH_ARGS });
  return sharedBrowser;
}

// Call once, after every test in a file has run (e.g. from a `test.after`
// or the last test itself) - closes the one browser process every test in
// this suite shares, rather than paying Chromium's own several-hundred-ms
// startup cost per test.
export async function closeSharedBrowser() {
  if (sharedBrowser) {
    await sharedBrowser.close();
    sharedBrowser = null;
  }
}

// Builds and serves one AXIS `source` (a real HTTP server, on a random free
// port, exactly like `axis run` would), opens it in a real page in the
// shared headless browser, and hands both to `fn` - `page` (Playwright's own
// Page, for `.click()`/`.textContent()`/`.evaluate()`/... ) and
// `consoleErrors` (every `console.error`/uncaught page error seen so far,
// live-updated - check its `.length` after an interaction that shouldn't
// have caused one). Always tears down the page and the server, even if
// `fn` throws - the shared browser process itself is left running for the
// next test in the file.
export async function withPage(source, fn) {
  const plan = buildDomPlan(run(source));
  const server = await startDomServer(plan);
  await withServedPage(server, fn);
}

// Same as withPage, but resolves a REAL entry file from disk - including
// its own `import ... from "name"` (axis_modules/) - through the real
// module resolver, exactly like `axis run <file>` does. withPage's own
// inline-source-only limitation (see its call sites' own comments, e.g.
// tests/browser/fps-controls.test.js's header) means a package-based
// example's own real package has, historically, never actually been
// proven end to end in a real browser by anything in this suite - only
// by a same-process unit test that (see
// docs/architecture/2026-09-language-platform-audit.md's game-foundation
// addendum) can miss an entire class of bug the real browser transport
// exposes. Use this whenever what's under test IS the real package a real
// example imports, not a hand-inlined stand-in for it.
export async function withPageFile(entryPath, fn) {
  const program = resolveModules(entryPath);
  const interpretResult = interpret(program);
  const hasPages = interpretResult.pages.length > 0;
  const server = hasPages ? await startDomServer(buildDomPlan(interpretResult)) : await startServer(buildRenderPlan(interpretResult));
  await withServedPage(server, fn);
}

async function withServedPage(server, fn) {
  const port = server.address().port;
  const browser = await getBrowser();
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(String(err?.stack ?? err)));
  try {
    await page.goto(`http://localhost:${port}/`);
    await fn(page, consoleErrors);
  } finally {
    await page.close();
    server.close();
  }
}
