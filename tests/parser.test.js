import { test } from "node:test";
import assert from "node:assert/strict";
import { tokenize } from "../src/lexer.js";
import { parse } from "../src/parser.js";
import { AxisSyntaxError } from "../src/lexer.js";

function parseSource(src) {
  return parse(tokenize(src));
}

function onlyScene(src) {
  const program = parseSource(src);
  return program.items.find((i) => i.kind === "SceneDecl");
}

function onlyPage(src) {
  const program = parseSource(src);
  return program.items.find((i) => i.kind === "PageDecl");
}

test("parses an empty scene", () => {
  const program = parseSource("scene main { }");
  assert.equal(program.items.length, 1);
  assert.equal(program.items[0].kind, "SceneDecl");
  assert.equal(program.items[0].name, "main");
  assert.equal(program.items[0].body.length, 0);
});

test("parses an object declaration with properties", () => {
  const scene = onlyScene(`
    scene main {
      cube box {
        position: (0, 0, 0)
        color: red
      }
    }
  `);
  const [obj] = scene.body;
  assert.equal(obj.kind, "ObjectDecl");
  assert.equal(obj.objectType, "cube");
  assert.equal(obj.name, "box");
  assert.equal(obj.properties.length, 2);
  assert.deepEqual(obj.properties[0].path, ["position"]);
  assert.equal(obj.properties[0].value.kind, "Vector");
});

test("parses a camera with no name", () => {
  const scene = onlyScene("scene main { camera { position: (0, 2, 6) } }");
  const [camera] = scene.body;
  assert.equal(camera.objectType, "camera");
  assert.equal(camera.name, null);
});

test("parses an object with a computed name", () => {
  const scene = onlyScene(`scene main { cube ("box" + i) { color: red } }`);
  const [obj] = scene.body;
  assert.equal(obj.nameIsExpr, true);
  assert.equal(obj.name.kind, "Binary");
});

test("parses an animate block with a target and properties", () => {
  const scene = onlyScene(`
    scene main {
      animate box {
        rotation.y -> 360deg
        duration: 2s
        repeat: infinite
      }
    }
  `);
  const [animate] = scene.body;
  assert.equal(animate.kind, "AnimateDecl");
  assert.equal(animate.target, "box");
  assert.equal(animate.entries.length, 3);
  assert.equal(animate.entries[0].kind, "AnimateTarget");
  assert.deepEqual(animate.entries[0].path, ["rotation", "y"]);
  assert.equal(animate.entries[1].kind, "Property");
});

test("an animate target can be a computed expression, not just a bare name", () => {
  const scene = onlyScene(`
    scene main {
      animate ("box" + i) {
        rotation.y -> 360deg
        duration: 2s
      }
    }
  `);
  const [animate] = scene.body;
  assert.equal(animate.targetIsExpr, true);
  assert.equal(animate.target.kind, "Binary");
});

test("parses an on-interaction block with statements", () => {
  const scene = onlyScene(`
    scene main {
      on box.click {
        let n = 1
        box.color = red
      }
    }
  `);
  const [on] = scene.body;
  assert.equal(on.kind, "OnDecl");
  assert.equal(on.target, "box");
  assert.equal(on.event, "click");
  assert.equal(on.body.length, 2);
  assert.equal(on.body[0].kind, "LetDecl");
  assert.equal(on.body[1].kind, "Assignment");
});

test("an 'on' target can be a computed expression, not just a bare name", () => {
  const scene = onlyScene(`
    scene main {
      on (boxes[i]).click {
        print(1)
      }
    }
  `);
  const [on] = scene.body;
  assert.equal(on.targetIsExpr, true);
  assert.equal(on.target.kind, "Index");
  assert.equal(on.event, "click");
});

test("an 'on' handler body can trigger an animate block, not just declare one", () => {
  const scene = onlyScene(`
    scene main {
      on box.click {
        animate box {
          scale.x -> 1.5
          duration: 0.3s
        }
      }
    }
  `);
  const [on] = scene.body;
  assert.equal(on.body.length, 1);
  const [animate] = on.body;
  assert.equal(animate.kind, "AnimateDecl");
  assert.equal(animate.target, "box");
  assert.deepEqual(animate.entries[0].path, ["scale", "x"]);
});

test("parses a state declaration", () => {
  const page = onlyPage(`page Home { state count = 0 }`);
  const [state] = page.body;
  assert.equal(state.kind, "StateDecl");
  assert.equal(state.name, "count");
  assert.equal(state.value.kind, "Number");
});

test("'null' parses as its own literal kind, not an Identifier", () => {
  const page = onlyPage(`page Home { state current = null }`);
  const [state] = page.body;
  assert.equal(state.value.kind, "Null");
});

test("compound assignment desugars into an Assignment over a Binary", () => {
  const scene = onlyScene(`
    scene main {
      on box.click {
        count += 1
      }
    }
  `);
  const [onDecl] = scene.body;
  const [stmt] = onDecl.body;
  assert.equal(stmt.kind, "Assignment");
  assert.equal(stmt.target.kind, "Identifier");
  assert.equal(stmt.target.value, "count");
  assert.equal(stmt.value.kind, "Binary");
  assert.equal(stmt.value.op, "+");
  assert.equal(stmt.value.left.value, "count");
  assert.equal(stmt.value.right.value, 1);
});

test("parses nested groups", () => {
  const scene = onlyScene(`
    scene main {
      group rig {
        cube arm { color: red }
      }
    }
  `);
  const [group] = scene.body;
  assert.equal(group.objectType, "group");
  assert.equal(group.children.length, 1);
  assert.equal(group.children[0].objectType, "cube");
});

test("parses if/else if/else inside a scene", () => {
  const scene = onlyScene(`
    scene main {
      if (x > 0) {
        cube a { color: red }
      } else if (x < 0) {
        cube b { color: blue }
      } else {
        cube c { color: green }
      }
    }
  `);
  const [ifStmt] = scene.body;
  assert.equal(ifStmt.kind, "IfStmt");
  assert.equal(ifStmt.then[0].objectType, "cube");
  assert.equal(ifStmt.else[0].kind, "IfStmt");
  assert.equal(ifStmt.else[0].else[0].objectType, "cube");
});

test("parses a for-in loop inside a scene", () => {
  const scene = onlyScene(`
    scene main {
      for i in range(0, 3) {
        cube ("box" + i) { color: red }
      }
    }
  `);
  const [forStmt] = scene.body;
  assert.equal(forStmt.kind, "ForStmt");
  assert.equal(forStmt.varName, "i");
  assert.equal(forStmt.iterable.kind, "Call");
  assert.equal(forStmt.body[0].kind, "ObjectDecl");
});

test("parses top-level fn declarations", () => {
  const program = parseSource(`
    fn add(a, b) {
      return a + b
    }
  `);
  const [fn] = program.items;
  assert.equal(fn.kind, "FnDecl");
  assert.equal(fn.name, "add");
  assert.deepEqual(fn.params, ["a", "b"]);
  assert.equal(fn.body[0].kind, "ReturnStmt");
  assert.equal(fn.body[0].value.kind, "Binary");
});

test("parses top-level let/const", () => {
  const program = parseSource("let x = 1\nconst y = 2");
  assert.equal(program.items[0].kind, "LetDecl");
  assert.equal(program.items[0].constant, false);
  assert.equal(program.items[1].constant, true);
});

test("expression precedence: * before +", () => {
  const program = parseSource("let x = 1 + 2 * 3");
  const expr = program.items[0].value;
  assert.equal(expr.kind, "Binary");
  assert.equal(expr.op, "+");
  assert.equal(expr.right.kind, "Binary");
  assert.equal(expr.right.op, "*");
});

test("parses member access, indexing, and calls", () => {
  const program = parseSource("let x = box.position.x\nlet y = arr[0]\nlet z = f(1, 2)");
  assert.equal(program.items[0].value.kind, "Member");
  assert.equal(program.items[0].value.object.kind, "Member");
  assert.equal(program.items[1].value.kind, "Index");
  assert.equal(program.items[2].value.kind, "Call");
  assert.equal(program.items[2].value.args.length, 2);
});

test("parses array literals", () => {
  const program = parseSource("let x = [1, 2, 3]");
  assert.equal(program.items[0].value.kind, "Array");
  assert.equal(program.items[0].value.items.length, 3);
});

test("a single parenthesized expression is grouping, not a vector", () => {
  const program = parseSource("let x = (1 + 2)");
  assert.equal(program.items[0].value.kind, "Binary");
});

test("a function can't be used as a statement inside another function's if-body with object syntax", () => {
  // sanity check that plain (non-scene) blocks reject scene-only syntax
  assert.throws(() => parseSource("fn f() { cube box { color: red } }"), AxisSyntaxError);
});

test("throws a syntax error on a missing brace", () => {
  assert.throws(() => parseSource("scene main { cube box { }"), AxisSyntaxError);
});

test("throws a syntax error on a missing colon", () => {
  assert.throws(() => parseSource("scene main { cube box { color red } }"), AxisSyntaxError);
});

test("throws when assigning to something that isn't assignable", () => {
  assert.throws(() => parseSource("fn f() { 1 + 2 = 3 }"), AxisSyntaxError);
});

test("parses an empty page with an identifier title", () => {
  const program = parseSource("page Home { }");
  assert.equal(program.items.length, 1);
  assert.equal(program.items[0].kind, "PageDecl");
  assert.equal(program.items[0].title, "Home");
  assert.equal(program.items[0].body.length, 0);
});

test("parses a page with a string title", () => {
  const page = onlyPage(`page "My Portfolio" { }`);
  assert.equal(page.title, "My Portfolio");
});

test("a page body reuses the same declarative grammar as a scene body", () => {
  const page = onlyPage(`
    page Home {
      container hero {
        text title { content: "Hi" }
      }
      on title.click { print(1) }
    }
  `);
  const [container, on] = page.body;
  assert.equal(container.kind, "ObjectDecl");
  assert.equal(container.objectType, "container");
  assert.equal(container.children[0].objectType, "text");
  assert.equal(on.kind, "OnDecl");
  assert.equal(on.target, "title");
  assert.equal(on.event, "click");
});

// ---- components and modules ---------------------------------------------

test("parses a component declaration - params, and a body that reuses scene-entry grammar", () => {
  const program = parseSource(`
    component Card(title, description) {
      heading h { content: title }
      state likes = 0
      on h.click { likes += 1 }
    }
  `);
  const [component] = program.items;
  assert.equal(component.kind, "ComponentDecl");
  assert.equal(component.name, "Card");
  assert.deepEqual(component.params, ["title", "description"]);
  assert.equal(component.body[0].kind, "ObjectDecl");
  assert.equal(component.body[1].kind, "StateDecl");
  assert.equal(component.body[2].kind, "OnDecl");
});

test("parses a component with no params", () => {
  const program = parseSource(`component Empty() { }`);
  assert.deepEqual(program.items[0].params, []);
});

test("using a component is just ordinary object-declaration syntax", () => {
  const page = onlyPage(`
    page Home {
      Card projectA { title: "AXIS" description: "..." }
    }
  `);
  const [card] = page.body;
  assert.equal(card.kind, "ObjectDecl");
  assert.equal(card.objectType, "Card");
  assert.equal(card.name, "projectA");
  assert.equal(card.properties[0].path[0], "title");
});

test("'export' tags fn/component/let/const declarations", () => {
  const program = parseSource(`
    export fn shout(x) { return x }
    export component Card(title) { }
    export let a = 1
    export const b = 2
  `);
  assert.equal(program.items[0].exported, true);
  assert.equal(program.items[0].kind, "FnDecl");
  assert.equal(program.items[1].exported, true);
  assert.equal(program.items[1].kind, "ComponentDecl");
  assert.equal(program.items[2].exported, true);
  assert.equal(program.items[3].exported, true);
});

test("'export' rejects a scene or page", () => {
  assert.throws(() => parseSource(`export scene main { }`), AxisSyntaxError);
  assert.throws(() => parseSource(`export page Home { }`), AxisSyntaxError);
});

test("parses an import declaration", () => {
  const program = parseSource(`import Card from "./components/card.ax"`);
  const [imp] = program.items;
  assert.equal(imp.kind, "ImportDecl");
  assert.equal(imp.name, "Card");
  assert.equal(imp.path, "./components/card.ax");
});

test("parses a record literal as a let value", () => {
  const program = parseSource(`let planet = { name: "Earth" radius: 1 }`);
  const record = program.items[0].value;
  assert.equal(record.kind, "Record");
  assert.deepEqual(record.fields.map((f) => f.key), ["name", "radius"]);
  assert.equal(record.fields[0].value.kind, "String");
  assert.equal(record.fields[1].value.kind, "Number");
});

test("record literal fields don't require commas, but tolerate them", () => {
  const noCommas = parseSource(`let a = { x: 1 y: 2 }`).items[0].value;
  const withCommas = parseSource(`let b = { x: 1, y: 2, }`).items[0].value;
  assert.deepEqual(noCommas.fields.map((f) => f.key), ["x", "y"]);
  assert.deepEqual(withCommas.fields.map((f) => f.key), ["x", "y"]);
});

test("parses an empty record literal", () => {
  const record = parseSource(`let a = { }`).items[0].value;
  assert.equal(record.kind, "Record");
  assert.deepEqual(record.fields, []);
});

test("a record literal can nest vectors, arrays, and other records", () => {
  const record = parseSource(`let a = { pos: (0, 1, 0) tags: ["x", "y"] meta: { ok: true } }`).items[0].value;
  assert.equal(record.fields[0].value.kind, "Vector");
  assert.equal(record.fields[1].value.kind, "Array");
  assert.equal(record.fields[2].value.kind, "Record");
});

test("a duplicate field in a record literal is a syntax error", () => {
  assert.throws(() => parseSource(`let a = { x: 1 x: 2 }`), AxisSyntaxError);
});

test("a bare record literal can't be used as a statement by itself", () => {
  assert.throws(() => parseSource(`fn f() { { x: 1 } }`), AxisSyntaxError);
});
