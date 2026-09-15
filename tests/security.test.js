// `href`/`src` are the one place a value can end up as something the
// browser actually navigates to - see src/urlSafety.js. A literal, bad
// scheme is a build-time error (the same "clear error, right where the
// author wrote it" standard every other AXIS mistake gets); a reactive one
// (a `state` that could later hold something dangerous) can't be caught at
// build time and is sanitized live instead - see domClient.js's
// applyElementProperty.

import { test } from "node:test";
import assert from "node:assert/strict";
import { run } from "../src/run.js";
import { isSafeUrl } from "../src/urlSafety.js";

test("isSafeUrl allows http/https/mailto/tel and relative paths/anchors", () => {
  assert.equal(isSafeUrl("https://example.com"), true);
  assert.equal(isSafeUrl("http://example.com"), true);
  assert.equal(isSafeUrl("mailto:hi@example.com"), true);
  assert.equal(isSafeUrl("tel:+15555550100"), true);
  assert.equal(isSafeUrl("/about"), true);
  assert.equal(isSafeUrl("#section"), true);
  assert.equal(isSafeUrl("about.html"), true);
  assert.equal(isSafeUrl(""), true);
});

test("isSafeUrl rejects javascript:, data:, vbscript:, and anything else not on the allowlist", () => {
  assert.equal(isSafeUrl("javascript:alert(1)"), false);
  assert.equal(isSafeUrl("JAVASCRIPT:alert(1)"), false); // case-insensitive scheme
  assert.equal(isSafeUrl("data:text/html,<script>alert(1)</script>"), false);
  assert.equal(isSafeUrl("vbscript:msgbox(1)"), false);
  assert.equal(isSafeUrl("file:///etc/passwd"), false);
});

test("isSafeUrl rejects non-strings outright", () => {
  assert.equal(isSafeUrl(5), false);
  assert.equal(isSafeUrl(null), false);
});

test("a literal 'javascript:' href is a clear build-time error", () => {
  assert.throws(
    () => run(`page Home { link go { label: "click" href: "javascript:alert(1)" } }`),
    /'href' can't use a "javascript:" URL/
  );
});

test("a literal bad 'src' on an image is rejected the same way", () => {
  assert.throws(
    () => run(`page Home { image pic { src: "javascript:alert(1)" alt: "x" } }`),
    /'src' can't use a "javascript:" URL/
  );
});

test("an ordinary relative/absolute href and a mailto: link both build fine", () => {
  const result = run(`
    page Home {
      link a { label: "a" href: "/about" }
      link b { label: "b" href: "mailto:hi@example.com" }
    }
  `);
  assert.equal(result.pages[0].nodes[0].href, "/about");
  assert.equal(result.pages[0].nodes[1].href, "mailto:hi@example.com");
});

test("a reactive href whose INITIAL value happens to be unsafe is still caught at build time, not silently shipped", () => {
  assert.throws(
    () => run(`
      state target = "javascript:alert(1)"
      page Home { link go { label: "go" href: target } }
    `),
    /'href' can't use a "javascript:" URL/
  );
});
