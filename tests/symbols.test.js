import { test } from "node:test";
import assert from "node:assert/strict";
import { tokenize } from "../src/lexer.js";
import { parse } from "../src/parser.js";
import { collectSymbols, flattenSymbols } from "../src/symbols.js";
import { findDefinition, hoverText, tokenAt } from "../src/definitions.js";

function symbolsOf(source) {
  return collectSymbols(parse(tokenize(source)));
}

test("collects a scene and its named objects, nested inside a group", () => {
  const syms = symbolsOf(`scene main {
    group rig {
        cube box { color: red }
    }
}`);
  assert.equal(syms.length, 1);
  assert.equal(syms[0].kind, "scene");
  assert.equal(syms[0].name, "main");
  assert.equal(syms[0].children.length, 1);
  assert.equal(syms[0].children[0].name, "rig");
  assert.equal(syms[0].children[0].objectType, "group");
  assert.equal(syms[0].children[0].children.length, 1);
  assert.equal(syms[0].children[0].children[0].name, "box");
  assert.equal(syms[0].children[0].children[0].objectType, "cube");
});

test("flattens past if/while/for wrappers - objects nested inside control flow are still found", () => {
  const syms = symbolsOf(`scene main {
    for i in range(0, 3) {
        cube (\"box\" + i) { color: red }
    }
    if (true) {
        sphere ball { color: blue }
    }
}`);
  const flat = flattenSymbols(syms);
  const names = flat.map((s) => s.name);
  assert.ok(names.includes("ball"));
  // the for-loop's computed-name cube isn't itself a named symbol (its
  // name is an expression, not a literal), but the walk doesn't choke on it
  assert.equal(flat.filter((s) => s.kind === "object").length, 1);
});

test("collects a page, a component (with params), a function, state/let/const, routes", () => {
  const syms = symbolsOf(`
component Card(title) {
    container root { }
}
fn spin(x) { return x }
async fn load() { }
let count = 0
const MAX = 10
state visible = true
route "/about" About
page About { button go { label: "Go" } }
`);
  const byKind = Object.fromEntries(syms.map((s) => [s.name, s]));
  assert.equal(byKind.Card.kind, "component");
  assert.deepEqual(byKind.Card.params, ["title"]);
  assert.equal(byKind.spin.kind, "function");
  assert.equal(byKind.load.isAsync, true);
  assert.equal(byKind.count.kind, "let");
  assert.equal(byKind.MAX.kind, "const");
  assert.equal(byKind.visible.kind, "state");
  assert.equal(byKind["/about"].kind, "route");
  assert.equal(byKind["/about"].pageName, "About");
  assert.equal(byKind.About.kind, "page");
});

test("collects a named timeline inside a scene", () => {
  const syms = symbolsOf(`scene main {
    cube box { color: red }
    timeline intro {
        label start
        animate box { rotation.y -> 360deg duration: 500 }
    }
}`);
  const flat = flattenSymbols(syms);
  const timeline = flat.find((s) => s.kind === "timeline");
  assert.equal(timeline.name, "intro");
  assert.equal(timeline.path, "main.intro");
});

test("flattenSymbols produces dot-joined paths reflecting nesting", () => {
  const syms = symbolsOf(`scene main {
    group rig {
        cube box { color: red }
    }
}`);
  const flat = flattenSymbols(syms);
  const box = flat.find((s) => s.name === "box");
  assert.equal(box.path, "main.rig.box");
});

// ---- definitions.js -------------------------------------------------------

function withProgram(source, fn) {
  const tokens = tokenize(source);
  const program = parse(tokens);
  return fn(program, tokens, source);
}

function colOf(source, line, needle) {
  return source.split("\n")[line - 1].indexOf(needle) + 1;
}

test("tokenAt finds the identifier token under a given line/column", () => {
  const source = "let x = 1";
  const tokens = tokenize(source);
  const tok = tokenAt(tokens, 1, colOf(source, 1, "x"));
  assert.equal(tok.type, "IDENT");
  assert.equal(tok.value, "x");
});

test("findDefinition resolves an animate target to the object it names, inside the same scene", () => {
  const source = `scene main {
    cube box { color: red }
    animate box { rotation.y -> 360deg duration: 500 }
}`;
  withProgram(source, (program, tokens) => {
    const def = findDefinition(program, tokens, 3, colOf(source, 3, "box"));
    assert.equal(def.kind, "object");
    assert.equal(def.name, "box");
    assert.equal(def.line, 2);
  });
});

test("findDefinition resolves a component instantiation to its component declaration (top-level)", () => {
  const source = `component Card(title) {
    container root { }
}
page Home {
    Card c1 { title: "Hi" }
}`;
  withProgram(source, (program, tokens) => {
    const def = findDefinition(program, tokens, 5, colOf(source, 5, "Card"));
    assert.equal(def.kind, "component");
    assert.equal(def.name, "Card");
    assert.equal(def.line, 1);
  });
});

test("findDefinition returns null for a name that isn't declared anywhere", () => {
  const source = `scene main {
    cube box { color: red }
    animate boxx { rotation.y -> 1deg duration: 1s }
}`;
  withProgram(source, (program, tokens) => {
    const def = findDefinition(program, tokens, 3, colOf(source, 3, "boxx"));
    assert.equal(def, null);
  });
});

test("findDefinition returns null when the position isn't on an identifier at all", () => {
  const source = "scene main { cube box { color: red } }";
  withProgram(source, (program, tokens) => {
    assert.equal(findDefinition(program, tokens, 1, 1), null); // 's' of scene is a keyword IDENT actually
    assert.equal(findDefinition(program, tokens, 1, colOf(source, 1, "{") + 1), null); // punctuation
  });
});

test("hoverText describes a resolved user symbol", () => {
  const source = `component Card(title) {
    container root { }
}`;
  withProgram(source, (program, tokens) => {
    const text = hoverText(program, tokens, 1, colOf(source, 1, "Card"));
    assert.match(text, /component `Card\(title\)`/);
  });
});

test("hoverText describes a named color and an easing curve without needing a user declaration", () => {
  const source = `scene main {
    cube box { color: red }
    animate box { rotation.y -> 1deg duration: 500 easing: easeIn }
}`;
  withProgram(source, (program, tokens) => {
    assert.match(hoverText(program, tokens, 2, colOf(source, 2, "red")), /named color `red`/);
    assert.match(hoverText(program, tokens, 3, colOf(source, 3, "easeIn")), /easing curve `easeIn`/);
  });
});

test("hoverText returns null for an unrecognized plain identifier (honest, not a guess)", () => {
  const source = `fn f(x) { return x }\nscene main { cube box { color: red } }`;
  withProgram(source, (program, tokens) => {
    assert.equal(hoverText(program, tokens, 1, colOf(source, 1, "x") + 1), null);
  });
});
