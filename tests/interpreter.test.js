import { test } from "node:test";
import assert from "node:assert/strict";
import { run } from "../src/run.js";
import { AxisRuntimeError } from "../src/interpreter.js";

test("builds a scene graph with a camera and an object", () => {
  const result = run(`
    scene main {
      camera { position: (0, 2, 6) }
      cube box { position: (1, 0, 0) color: red }
    }
  `);
  const scene = result.scenes[0];
  assert.equal(scene.name, "main");
  assert.deepEqual(scene.camera.position, [0, 2, 6]);
  assert.equal(scene.objects.length, 1);
  assert.equal(scene.objects[0].name, "box");
  assert.equal(scene.objects[0].color, "red");
  assert.equal(scene.objects[0].parent, null);
});

test("defaults an object's position to the origin", () => {
  const result = run("scene main { cube box { color: blue } }");
  assert.deepEqual(result.scenes[0].objects[0].position, [0, 0, 0]);
});

test("builds an animation referencing an existing object", () => {
  const result = run(`
    scene main {
      cube box { color: orange }
      animate box {
        rotation.y -> 360deg
        duration: 2s
        repeat: infinite
      }
    }
  `);
  const [animation] = result.scenes[0].animations;
  assert.equal(animation.target, "box");
  assert.equal(animation.duration, 2000);
  assert.equal(animation.repeat, Infinity);
  assert.equal(animation.changes[0].path, "rotation.y");
  assert.equal(animation.changes[0].toValue, 360);
});

test("converts duration in seconds to milliseconds", () => {
  const result = run(`
    scene main {
      cube box { color: red }
      animate box { rotation.y -> 90deg duration: 500ms }
    }
  `);
  assert.equal(result.scenes[0].animations[0].duration, 500);
});

test("animate supports delay and easing", () => {
  const result = run(`
    scene main {
      cube box { color: red }
      animate box { rotation.y -> 90deg duration: 1s delay: 200ms easing: easeInOut }
    }
  `);
  const [anim] = result.scenes[0].animations;
  assert.equal(anim.delay, 200);
  assert.equal(anim.easing, "easeInOut");
});

test("rejects an unknown easing name", () => {
  assert.throws(
    () => run(`scene main { cube box { color: red } animate box { rotation.y -> 90deg duration: 1s easing: "bounce" } }`),
    /unknown easing 'bounce'/
  );
});

test("the cubic/back/bounce easing families are all real, valid easing names", () => {
  for (const easing of ["easeInCubic", "easeOutCubic", "easeInOutCubic", "easeInBack", "easeOutBack", "easeInOutBack", "easeOutBounce"]) {
    const result = run(`scene main { cube box { color: red } animate box { rotation.y -> 90deg duration: 1s easing: ${easing} } }`);
    assert.equal(result.scenes[0].animations[0].easing, easing);
  }
});

test("rejects animating an object that doesn't exist, with a suggestion", () => {
  assert.throws(
    () => run(`scene main { cube box { color: red } animate boxx { rotation.y -> 90deg duration: 1s } }`),
    /can't animate 'boxx'.*did you mean 'box'/
  );
});

test("rejects an unknown color name", () => {
  assert.throws(() => run("scene main { cube box { color: taupe } }"), AxisRuntimeError);
});

test("accepts a hex color string and rgb()", () => {
  const result = run('scene main { cube a { color: "#ff6600" } cube b { color: rgb(0, 255, 0) } }');
  assert.equal(result.scenes[0].objects[0].color, "#ff6600");
  assert.equal(result.scenes[0].objects[1].color, "#00ff00");
});

test("rejects an object declared without a name", () => {
  assert.throws(() => run("scene main { cube { color: red } }"), AxisRuntimeError);
});

test("rejects a duplicate object name in the same scene", () => {
  assert.throws(
    () => run("scene main { cube box { color: red } cube box { color: blue } }"),
    AxisRuntimeError
  );
});

test("rejects an animate block missing duration", () => {
  assert.throws(
    () => run("scene main { cube box { color: red } animate box { rotation.y -> 90deg } }"),
    AxisRuntimeError
  );
});

test("rejects an unknown property with a suggestion", () => {
  assert.throws(() => run("scene main { cube box { colr: red } }"), /doesn't have a 'colr' property.*color/);
});

test("parses multiple scenes independently", () => {
  const result = run(`
    scene intro { plane ground { color: gray } }
    scene level1 { cube box { color: green } }
  `);
  assert.equal(result.scenes.length, 2);
  assert.equal(result.scenes[0].objects[0].type, "plane");
  assert.equal(result.scenes[1].objects[0].type, "cube");
});

test("builds a nested group with children carrying a parent pointer", () => {
  const result = run(`
    scene main {
      group rig {
        position: (1, 0, 0)
        cube arm { color: red }
      }
    }
  `);
  const objects = result.scenes[0].objects;
  const rig = objects.find((o) => o.name === "rig");
  const arm = objects.find((o) => o.name === "arm");
  assert.equal(rig.type, "group");
  assert.equal(rig.parent, null);
  assert.equal(arm.parent, "rig");
});

test("lights get sensible defaults and accept their own properties", () => {
  const result = run(`
    scene main {
      ambientLight sun { intensity: 0.4 }
      directionalLight lamp { direction: (0, -1, 0) color: white }
      pointLight bulb { position: (1, 2, 3) intensity: 2 }
    }
  `);
  const [sun, lamp, bulb] = result.scenes[0].objects;
  assert.equal(sun.intensity, 0.4);
  assert.deepEqual(lamp.direction, [0, -1, 0]);
  assert.deepEqual(bulb.position, [1, 2, 3]);
});

test("a shape can't contain nested declarations", () => {
  assert.throws(
    () => run("scene main { cube box { color: red\ncube inner { color: blue } } }"),
    /can't contain other declarations/
  );
});

test("variables, functions, and for-loops can build a scene procedurally", () => {
  const result = run(`
    fn spacingOf(i) { return i * 2 }
    scene main {
      for i in range(0, 3) {
        cube ("box" + i) { position: (spacingOf(i), 0, 0) color: red }
      }
    }
  `);
  const names = result.scenes[0].objects.map((o) => o.name);
  assert.deepEqual(names, ["box0", "box1", "box2"]);
  assert.deepEqual(result.scenes[0].objects[2].position, [4, 0, 0]);
});

test("a loop-generated object can be wired up individually with a computed 'on' target", () => {
  const result = run(`
    scene main {
      for i in range(0, 3) {
        cube ("box" + i) { color: red }
        on ("box" + i).click {
          print(i)
        }
      }
    }
  `);
  const handlers = result.scenes[0].handlers;
  assert.deepEqual(handlers.map((h) => h.target), ["box0", "box1", "box2"]);
});

test("a loop-generated object can be animated individually with a computed 'animate' target", () => {
  const result = run(`
    scene main {
      for i in range(0, 2) {
        cube ("box" + i) { color: red }
        animate ("box" + i) { position.x -> i duration: 1s }
      }
    }
  `);
  const animations = result.scenes[0].animations;
  assert.deepEqual(animations.map((a) => a.target), ["box0", "box1"]);
});

test("a computed 'animate'/'on' target that doesn't evaluate to a string is a clear error", () => {
  assert.throws(
    () => run(`scene main { cube box { color: red } animate (42) { position.x -> 1 duration: 1s } }`),
    /a computed 'animate' target must evaluate to a string, got a number/
  );
});

test("a computed target that evaluates to an unknown name still gets a 'did you mean' suggestion", () => {
  assert.throws(
    () => run(`scene main { cube box { color: red } on ("bo" + "xx").click { print(1) } }`),
    /can't add an interaction to 'boxx' - no object or timeline with that name in scene 'main' - did you mean 'box'\?/
  );
});

test("a computed target evaluates against the loop's own env, so 'i' is really in scope", () => {
  const result = run(`
    scene main {
      cube box1 { color: red }
      let i = 1
      on ("box" + i).click { print(i) }
    }
  `);
  assert.equal(result.scenes[0].handlers[0].target, "box1");
});

test("if/else inside a scene controls which objects get created", () => {
  const withHigh = run("let n = 5\nscene main { if (n > 3) { cube big { color: red } } else { cube small { color: blue } } }");
  assert.equal(withHigh.scenes[0].objects[0].name, "big");
});

test("registers an on-click interaction handler with its statement body", () => {
  const result = run(`
    scene main {
      cube box { color: red }
      on box.click { box.color = green }
    }
  `);
  const [handler] = result.scenes[0].handlers;
  assert.equal(handler.target, "box");
  assert.equal(handler.event, "click");
  assert.equal(handler.body[0].kind, "Assignment");
});

test("rejects an interaction on an unknown event name, with a suggestion", () => {
  assert.throws(
    () => run("scene main { cube box { color: red } on box.klick { print(1) } }"),
    /unknown event 'klick'.*did you mean 'click'/
  );
});

test("scene-level let/const are captured for later use by handlers, with mutability preserved", () => {
  const result = run(`
    scene main {
      let spacing = 2
      const factor = 3
      cube box { color: red }
    }
  `);
  assert.deepEqual(result.scenes[0].variables.spacing, { value: 2, constant: false, reactive: false });
  assert.deepEqual(result.scenes[0].variables.factor, { value: 3, constant: true, reactive: false });
});

test("top-level functions are collected onto the program result", () => {
  const result = run(`
    fn double(x) { return x * 2 }
    scene main { cube box { color: red } }
  `);
  assert.equal(result.functions.length, 1);
  assert.equal(result.functions[0].name, "double");
});

// ---- pages (web domain) -------------------------------------------------

test("builds a page graph with nested container/text/button elements", () => {
  const result = run(`
    page Home {
      container hero {
        direction: "column"
        text title { content: "Hi" color: white }
        button go { label: "Go" }
      }
    }
  `);
  const page = result.pages[0];
  assert.equal(page.title, "Home");
  const hero = page.nodes.find((n) => n.name === "hero");
  const title = page.nodes.find((n) => n.name === "title");
  const go = page.nodes.find((n) => n.name === "go");
  assert.equal(hero.type, "container");
  assert.equal(hero.parent, null);
  assert.equal(hero.direction, "column");
  assert.equal(title.parent, "hero");
  assert.equal(title.content, "Hi");
  assert.equal(go.parent, "hero");
  assert.equal(go.label, "Go");
});

test("rejects an unknown element type in a page, with a suggestion", () => {
  assert.throws(() => run(`page Home { contaner box { } }`), /unknown element type 'contaner'.*did you mean 'container'/);
});

test("rejects a leaf element containing nested declarations", () => {
  assert.throws(
    () => run(`page Home { text a { content: "x" text b { content: "y" } } }`),
    /'text' can't contain other declarations/
  );
});

test("rejects a duplicate element name in the same page", () => {
  assert.throws(
    () => run(`page Home { text a { content: "x" } text a { content: "y" } }`),
    /object 'a' is already defined in page 'Home'/
  );
});

test("rejects an unknown property on a page element, with a suggestion", () => {
  assert.throws(() => run(`page Home { text a { contnt: "x" } }`), /doesn't have a 'contnt' property.*content/);
});

test("rejects 'direction' values other than row/column", () => {
  assert.throws(() => run(`page Home { container a { direction: "diagonal" } }`), /'direction' must be "row" or "column"/);
});

test("registers an on-click handler for a page element", () => {
  const result = run(`
    page Home {
      button go { label: "Go" }
      on go.click { print(1) }
    }
  `);
  const [handler] = result.pages[0].handlers;
  assert.equal(handler.target, "go");
  assert.equal(handler.event, "click");
});

test("builds an opacity fade animation for a page element", () => {
  const result = run(`
    page Home {
      text a { content: "hi" }
      animate a { opacity -> 1 duration: 0.5s }
    }
  `);
  const [animation] = result.pages[0].animations;
  assert.equal(animation.target, "a");
  assert.equal(animation.duration, 500);
  assert.deepEqual(animation.changes, [{ path: "opacity", toValue: 1, unit: null }]);
});

test("an 'on' handler body can contain an 'animate' trigger - passed through raw, not built into the auto-play plan", () => {
  const result = run(`
    scene main {
      cube box { color: red }
      on box.click {
        animate box { scale.x -> 1.5 duration: 0.3s }
      }
    }
  `);
  const scene = result.scenes[0];
  assert.equal(scene.animations.length, 0); // not an auto-play animation
  const [handler] = scene.handlers;
  assert.equal(handler.body.length, 1);
  assert.equal(handler.body[0].kind, "AnimateDecl");
  assert.equal(handler.body[0].target, "box");
});

test("a triggered 'animate' inside a component's handler is namespaced to the instance, same as a declared one", () => {
  const result = run(`
    component Card() {
      container box { }
      button grow { label: "Grow" }
      on grow.click {
        animate box { scale.x -> 1.5 duration: 0.3s }
      }
    }

    page Home {
      Card a { }
    }
  `);
  const handler = result.pages[0].handlers.find((h) => h.target === "a.grow");
  assert.ok(handler, "expected a handler for 'a.grow'");
  assert.equal(handler.body[0].kind, "AnimateDecl");
  assert.equal(handler.body[0].target, "a.box");
});

test("rejects an unsupported animate path on a page element, with a suggestion", () => {
  assert.throws(
    () => run(`page Home { text a { content: "hi" } animate a { blur -> 4 duration: 1s } }`),
    /can't animate 'blur' on a page element/
  );
});

test("a page element's 'color'/'background' can be animated with a color string", () => {
  const result = run(`page Home { text a { content: "hi" } animate a { color -> white duration: 1s } }`);
  const animation = result.pages[0].animations[0];
  assert.deepEqual(animation.changes, [{ path: "color", toValue: "white", unit: null }]);
});

test("'state' declares a mutable, reactive scene variable, just like inside a page", () => {
  const result = run(`scene main { state count = 0 cube box { color: red } }`);
  assert.deepEqual(result.scenes[0].variables.count, { value: 0, constant: false, reactive: true });
});

test("page-level let/const are captured for later use by handlers", () => {
  const result = run(`
    page Home {
      let clicks = 0
      button go { label: "Go" }
    }
  `);
  assert.deepEqual(result.pages[0].variables.clicks, { value: 0, constant: false, reactive: false });
});

test("'state' declares a mutable, reactive page variable", () => {
  const result = run(`
    page Home {
      state count = 0
      button go { label: "Go" }
      on go.click { count = count + 1 }
    }
  `);
  assert.deepEqual(result.pages[0].variables.count, { value: 0, constant: false, reactive: true });
});

test("rejects a page defined more than once with the same title", () => {
  assert.throws(() => run(`page Home { } page Home { }`), /page 'Home' is defined more than once/);
});

// ---- components ---------------------------------------------------------

test("a component expands transparently - no wrapper element, direct child of the call site's parent", () => {
  const result = run(`
    component Card(title) {
      heading cardTitle { content: title level: 3 }
    }

    page Home {
      container hero {
        Card projectA { title: "AXIS" }
      }
    }
  `);
  const page = result.pages[0];
  assert.equal(page.nodes.length, 2); // hero + the component's one inner element - no synthetic wrapper for "projectA"
  const title = page.nodes.find((n) => n.name === "projectA.cardTitle");
  assert.ok(title, "expected a namespaced 'projectA.cardTitle' element");
  assert.equal(title.parent, "hero"); // spliced directly under the call site's own parent
  assert.equal(title.content, "AXIS");
});

test("two instances of the same component don't collide", () => {
  const result = run(`
    component Card(title) {
      heading cardTitle { content: title level: 3 }
    }

    page Home {
      Card projectA { title: "AXIS" }
      Card projectB { title: "Nimbus" }
    }
  `);
  const page = result.pages[0];
  const a = page.nodes.find((n) => n.name === "projectA.cardTitle");
  const b = page.nodes.find((n) => n.name === "projectB.cardTitle");
  assert.equal(a.content, "AXIS");
  assert.equal(b.content, "Nimbus");
});

test("a missing required component property is a clear error", () => {
  assert.throws(
    () => run(`
      component Card(title) { heading h { content: title } }
      page Home { Card projectA { } }
    `),
    /component 'Card' is missing 'title'/
  );
});

test("an unknown component property is a clear error, with a suggestion", () => {
  assert.throws(
    () => run(`
      component Card(title) { heading h { content: title } }
      page Home { Card projectA { title: "AXIS" tile: "oops" } }
    `),
    /component 'Card' doesn't take a 'tile' property.*did you mean 'title'/
  );
});

test("a component's own state and on-handler are namespaced per instance", () => {
  const result = run(`
    component Counter() {
      state count = 0
      text label { content: "Count: " + count }
      button inc { label: "+1" }
      on inc.click { count += 1 }
    }

    page Home {
      Counter a { }
      Counter b { }
    }
  `);
  const page = result.pages[0];
  assert.deepEqual(page.variables["a.count"], { value: 0, constant: false, reactive: true });
  assert.deepEqual(page.variables["b.count"], { value: 0, constant: false, reactive: true });

  const handlerA = page.handlers.find((h) => h.target === "a.inc");
  assert.ok(handlerA, "expected a handler for 'a.inc'");
  // the handler body's reference to the bare "count" was rewritten to the
  // instance's namespaced variable, since there's no per-instance scope
  // once this runs in the browser
  assert.equal(handlerA.body[0].target.value, "a.count");

  const labelA = page.nodes.find((n) => n.name === "a.label");
  assert.equal(labelA.bindings.content.right.value, "a.count");
});

test("nested component instantiation", () => {
  const result = run(`
    component Badge(text) {
      text label { content: text }
    }
    component Card(title) {
      heading h { content: title }
      Badge b { text: "new" }
    }
    page Home {
      Card projectA { title: "AXIS" }
    }
  `);
  const page = result.pages[0];
  const badgeLabel = page.nodes.find((n) => n.name === "projectA.b.label");
  assert.ok(badgeLabel, "expected the nested component's element to be double-namespaced");
  assert.equal(badgeLabel.content, "new");
});

test("rejects giving a component instance its own children", () => {
  assert.throws(
    () => run(`
      component Card(title) { heading h { content: title } }
      page Home { Card projectA { title: "AXIS" text extra { content: "no" } } }
    `),
    /'Card' is a component - its own body decides what it contains/
  );
});

test("a component can be used inside a scene too - the mechanism is domain-agnostic", () => {
  const result = run(`
    component Marker(label) {
      cube box { color: label }
    }
    scene main {
      Marker m { label: "red" }
    }
  `);
  const scene = result.scenes[0];
  const box = scene.objects.find((o) => o.name === "m.box");
  assert.equal(box.color, "red");
});

test("rejects a component defined more than once", () => {
  assert.throws(
    () => run(`
      component Card(title) { heading h { content: title } }
      component Card(title) { heading h { content: title } }
      page Home { }
    `),
    /component 'Card' is already defined/
  );
});

test("builds a 'model' object with position/rotation/scale defaults and a src", () => {
  const result = run(`scene main { model rock { src: "./rock.glb" } }`);
  const model = result.scenes[0].objects[0];
  assert.equal(model.type, "model");
  assert.equal(model.src, "./rock.glb");
  assert.deepEqual(model.position, [0, 0, 0]);
  assert.deepEqual(model.rotation, [0, 0, 0]);
  assert.deepEqual(model.scale, [1, 1, 1]);
});

test("a 'model' accepts position/rotation/scale like any other spatial object", () => {
  const result = run(`scene main { model rock { src: "./rock.glb" position: (1, 2, 3) rotation: (0, 90, 0) scale: (2, 2, 2) } }`);
  const model = result.scenes[0].objects[0];
  assert.deepEqual(model.position, [1, 2, 3]);
  assert.deepEqual(model.rotation, [0, 90, 0]);
  assert.deepEqual(model.scale, [2, 2, 2]);
});

test("a 'model' without 'src' is a clear error", () => {
  assert.throws(() => run(`scene main { model rock { } }`), /'model' needs a 'src' property/);
});

test("a 'model' can't contain other declarations", () => {
  assert.throws(
    () => run(`scene main { model rock { src: "./rock.glb" cube inner { color: red } } }`),
    /'model' can't contain other declarations/
  );
});

test("a 'model' doesn't take a 'color' property", () => {
  assert.throws(() => run(`scene main { model rock { src: "./rock.glb" color: red } }`), /'model' doesn't have a 'color' property/);
});

for (const [src, reason] of [
  ["", "needs a file path string"],
  ["/etc/rock.glb", "must be a relative path"],
  ["../rock.glb", "can't contain '..'"],
  ["models/../../rock.glb", "can't contain '..'"],
  ["rock.png", "must point at a '.glb' or '.gltf' file"],
]) {
  test(`rejects an unsafe/invalid model src: ${JSON.stringify(src)}`, () => {
    assert.throws(() => run(`scene main { model rock { src: "${src}" } } `), new RegExp(reason.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  });
}

test("accepts a '.gltf' src too, not just '.glb'", () => {
  const result = run(`scene main { model rock { src: "./rock.gltf" } }`);
  assert.equal(result.scenes[0].objects[0].src, "./rock.gltf");
});

test("'model' shows up in the 'did you mean' suggestions for an unknown object type", () => {
  assert.throws(() => run(`scene main { mode rock { src: "./rock.glb" } }`), /did you mean 'model'/);
});
