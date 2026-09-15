// src/format.js is a real, AST-based formatter (see its own header comment
// for the honest limitations) - these tests check three separate things:
// idempotence (format(format(x)) === format(x)), semantic preservation
// (the formatted program means exactly what the original did - checked by
// comparing the full interpreted graph, not just "it still parses"), and
// the specific round-trip-fidelity features (compoundOp, titleIsString,
// comment placement, precedence) that make those first two true.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { formatSource, AxisFormatError } from "../src/format.js";
import { tokenize } from "../src/lexer.js";
import { parse } from "../src/parser.js";
import { interpret } from "../src/interpreter.js";
import { AxisSyntaxError } from "../src/lexer.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

function interpretedGraph(source) {
  // Strips every field the formatter is explicitly allowed to change the
  // *value* of while preserving meaning (source locations, and the two
  // purely-informational round-trip-fidelity fields) so this comparison
  // catches a real semantic drift, not an expected, harmless difference.
  function strip(obj) {
    if (Array.isArray(obj)) return obj.map(strip);
    if (obj && typeof obj === "object") {
      const out = {};
      for (const key of Object.keys(obj)) {
        if (["line", "col", "column", "closeLine", "bodyCloseLine", "titleIsString", "compoundOp"].includes(key)) continue;
        out[key] = strip(obj[key]);
      }
      return out;
    }
    return obj;
  }
  return JSON.stringify(strip(interpret(parse(tokenize(source)))), (_k, v) => (v === Infinity ? "Infinity" : v));
}

function assertSameMeaning(source) {
  const formatted = formatSource(source);
  assert.equal(interpretedGraph(formatted), interpretedGraph(source), "formatting changed the interpreted graph");
  return formatted;
}

function assertIdempotent(source) {
  const once = formatSource(source);
  const twice = formatSource(once);
  assert.equal(twice, once, "format(format(source)) !== format(source)");
  return once;
}

// ---- every canonical example: idempotent + semantically identical ------

function axFilesIn(dir) {
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".ax"))
    .map((e) => path.join(dir, e.name));
}

const EXAMPLES_DIR = path.join(ROOT, "examples");
const exampleFiles = [
  ...axFilesIn(EXAMPLES_DIR),
  ...axFilesIn(path.join(EXAMPLES_DIR, "routing")),
  ...axFilesIn(path.join(EXAMPLES_DIR, "embed-html")),
  path.join(EXAMPLES_DIR, "embed-react", "src", "hero.ax"),
];
assert.ok(exampleFiles.length >= 25, `expected to find AXIS's example corpus, only found ${exampleFiles.length} files`);

for (const file of exampleFiles) {
  test(`formats idempotently and preserves meaning: ${path.relative(ROOT, file)}`, () => {
    const source = readFileSync(file, "utf8");
    assertIdempotent(source);
    assertSameMeaning(source);
  });
}

// ---- targeted construct coverage ----------------------------------------

test("already-formatted source round-trips byte-for-byte", () => {
  const source = "scene main {\n    cube box {\n        color: red\n    }\n}\n";
  assert.equal(formatSource(source), source);
});

test("poorly formatted (compact, inconsistent indent) source reformats to the canonical style", () => {
  const messy = `scene main{cube box{color:red position:(0,0,0)}}`;
  const formatted = formatSource(messy);
  assert.equal(
    formatted,
    ["scene main {", "    cube box {", "        color: red", "        position: (0, 0, 0)", "    }", "}", ""].join("\n")
  );
  assertIdempotent(messy);
});

test("nested groups/objects format with consistent 4-space indent per level", () => {
  const source = `scene main {
  group outer {
    group inner {
      cube box { color: red }
    }
  }
}`;
  const out = assertIdempotent(source);
  assert.match(out, /^scene main \{\n {4}group outer \{\n {8}group inner \{\n {12}cube box \{\n {16}color: red\n {12}\}\n {8}\}\n {4}\}\n\}\n$/);
});

test("a component with params formats and stays semantically identical", () => {
  const source = `component Card(title,description){container root{direction:"column"heading t{content:title}}}
page Home { Card c1 { title: "Hi" description: "there" } }`;
  assertSameMeaning(source);
  assertIdempotent(source);
});

test("state, conditionals, and loops format correctly and preserve meaning", () => {
  const source = `page Home {
state count=0
if(count>0){text t{content:"positive"}}else if(count<0){text t{content:"negative"}}else{text t{content:"zero"}}
container list{for i in range(0,3){text (\"item\"+i){content:\"item \"+i}}}
}`;
  assertSameMeaning(source);
  assertIdempotent(source);
});

test("animate/timeline blocks format one entry per line and preserve meaning", () => {
  const source = `scene main{cube box{color:red}
timeline intro{label start
animate box{rotation.y->360deg duration:2s at:start}
}
}`;
  assertSameMeaning(source);
  assertIdempotent(source);
});

test("a timeline's own 'loop: true' property formats and preserves meaning", () => {
  const source = `scene main{cube box{color:red}
timeline spin{loop:true
animate box{rotation.y->360deg duration:1s}
}
}`;
  assertSameMeaning(source);
  assertIdempotent(source);
});

test("routing (route/redirect) formats and preserves meaning", () => {
  const source = readFileSync(path.join(EXAMPLES_DIR, "routing", "site.ax"), "utf8");
  assertSameMeaning(source);
});

test("async fn / await formats and preserves meaning", () => {
  const source = readFileSync(path.join(EXAMPLES_DIR, "async-data.ax"), "utf8");
  assertSameMeaning(source);
});

// ---- round-trip fidelity: things the AST would otherwise lose ----------

test("compound assignment (+=) round-trips as += , not as an expanded x = x + 1", () => {
  const source = `page Home {
state count = 0
on go.click { count += 1 }
}`;
  const out = formatSource(source);
  assert.match(out, /count \+= 1/);
  assert.doesNotMatch(out, /count = count \+ 1/);
});

test("every compound operator (+= -= *= /=) round-trips", () => {
  const source = `fn f() {
let x = 1
x += 1
x -= 1
x *= 2
x /= 2
}
scene main { cube box { color: red } }`;
  const out = formatSource(source);
  assert.match(out, /x \+= 1/);
  assert.match(out, /x -= 1/);
  assert.match(out, /x \*= 2/);
  assert.match(out, /x \/= 2/);
});

test("a quoted page title round-trips quoted; a bare identifier title round-trips bare", () => {
  const quoted = formatSource(`page "My Site" { button go { label: "Go" } }`);
  assert.match(quoted, /^page "My Site" \{/);
  const bare = formatSource(`page Home { button go { label: "Go" } }`);
  assert.match(bare, /^page Home \{/);
  // "Home" is also a syntactically valid bare identifier - quoting it is
  // still preserved (parser.js's titleIsString), not silently collapsed.
  const quotedButIdentifierShaped = formatSource(`page "Home" { button go { label: "Go" } }`);
  assert.match(quotedButIdentifierShaped, /^page "Home" \{/);
});

// ---- operator precedence: parens preserved exactly where reparsing needs them ----

test("(1 + 2) * 3 keeps its parens - without them it would reparse as 1 + 2 * 3", () => {
  const source = `let x = (1 + 2) * 3\nscene main { cube box { color: red } }`;
  const out = formatSource(source);
  assert.match(out, /\(1 \+ 2\) \* 3/);
  assertSameMeaning(source);
});

test("1 + 2 * 3 (no original parens) stays unparenthesized - multiplication already binds tighter", () => {
  const out = formatSource(`let x = 1 + 2 * 3\nscene main { cube box { color: red } }`);
  assert.match(out, /1 \+ 2 \* 3/);
  assert.doesNotMatch(out, /\(/);
});

test("a - (b - c) keeps its parens - left-associative subtraction needs them to mean the same thing", () => {
  const source = `let a = 5\nlet b = 3\nlet c = 1\nlet x = a - (b - c)\nscene main { cube box { color: red } }`;
  const out = formatSource(source);
  assert.match(out, /a - \(b - c\)/);
  assertSameMeaning(source);
});

test("a - b - c (naturally left-associative) stays unparenthesized", () => {
  const out = formatSource(`let a = 5\nlet b = 3\nlet c = 1\nlet x = a - b - c\nscene main { cube box { color: red } }`);
  assert.match(out, /a - b - c/);
  assert.doesNotMatch(out, /\(/);
});

test("-(a + b) (explicit unary-minus over a parenthesized sum) keeps its parens", () => {
  const source = `let a = 1\nlet b = 2\nlet x = -(a + b)\nscene main { cube box { color: red } }`;
  const out = formatSource(source);
  assert.match(out, /-\(a \+ b\)/);
  assertSameMeaning(source);
});

test("&& binds tighter than || - a || b && c stays unparenthesized, (a || b) && c keeps parens", () => {
  const noParens = formatSource(`let x = true || false && false\nscene main { cube box { color: red } }`);
  assert.doesNotMatch(noParens, /\(/);
  const source = `let x = (true || false) && false\nscene main { cube box { color: red } }`;
  const out = formatSource(source);
  assert.match(out, /\(true \|\| false\) && false/);
  assertSameMeaning(source);
});

// ---- comments -------------------------------------------------------------

test("a file-header comment is preserved at the top", () => {
  const source = `// hello\nscene main { cube box { color: red } }`;
  const out = formatSource(source);
  assert.match(out, /^\/\/ hello\n/);
});

test("a comment inside a nested body is preserved near the construct it preceded, not hoisted elsewhere", () => {
  const source = `scene main {
    cube a { color: red }

    // this explains b
    cube b { color: blue }
}`;
  const out = formatSource(source);
  const lines = out.split("\n");
  const commentIdx = lines.findIndex((l) => l.includes("this explains b"));
  const bIdx = lines.findIndex((l) => l.includes("cube b"));
  assert.ok(commentIdx >= 0 && bIdx === commentIdx + 1, "comment should sit immediately before 'cube b'");
  assert.doesNotMatch(lines.slice(0, commentIdx).join("\n"), /this explains b/);
});

test("a same-line trailing comment on a simple property stays on that line", () => {
  const source = `scene main {
    cube box {
        color: red // the main color
    }
}`;
  const out = formatSource(source);
  assert.match(out, /color: red \/\/ the main color/);
});

test("comments round-trip idempotently even with several of them", () => {
  const source = readFileSync(path.join(EXAMPLES_DIR, "materials.ax"), "utf8");
  assertIdempotent(source);
  assertSameMeaning(source);
});

// ---- safety: refuse rather than corrupt --------------------------------

test("an invalid (unparseable) file throws AxisSyntaxError, not a silent bad reformat", () => {
  assert.throws(() => formatSource("scene main { cube box { color red } }"), AxisSyntaxError);
});

test("AxisFormatError is exported for callers that build/transform an AST rather than reformat source text", () => {
  // format.js's own string-printing guard (see its header comment) can
  // only ever fire for a String node whose `.value` ends in a literal
  // backslash - AXIS's own lexer can't produce that from real source (the
  // trailing backslash would already have combined with the closing quote
  // as an escape while lexing), so there's no valid .ax fixture that
  // reaches it through the public formatSource(source) API. It still needs
  // to be a real, exported error class for any future caller that
  // constructs or edits an AST programmatically (a refactor/codegen tool)
  // rather than only ever reformatting source text.
  assert.equal(typeof AxisFormatError, "function");
  assert.ok(new AxisFormatError("x") instanceof Error);
});
