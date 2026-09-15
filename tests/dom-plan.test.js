import { test } from "node:test";
import assert from "node:assert/strict";
import { run } from "../src/run.js";
import { buildDomPlan } from "../src/renderer/domPlan.js";

test("builds a page plan with nested nodes and CSS-ready styles", () => {
  const result = run(`
    page Home {
      container hero {
        direction: "column"
        align: "center"
        gap: 8
        background: "#111111"
        text title { content: "Hi" color: white size: 24 }
      }
    }
  `);
  const plan = buildDomPlan(result);
  assert.equal(plan.title, "Home");
  const hero = plan.nodes.find((n) => n.name === "hero");
  const title = plan.nodes.find((n) => n.name === "title");
  assert.deepEqual(hero.style, {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "8px",
    background: "#111111",
  });
  assert.equal(title.parent, "hero");
  assert.equal(title.content, "Hi");
  assert.deepEqual(title.style, { color: "white", fontSize: "24px" });
});

test("maps 'align' to text-align on text but align-items elsewhere", () => {
  const result = run(`
    page Home {
      container box { align: "center" }
      text label { content: "hi" align: "center" }
    }
  `);
  const plan = buildDomPlan(result);
  const box = plan.nodes.find((n) => n.name === "box");
  const label = plan.nodes.find((n) => n.name === "label");
  assert.deepEqual(box.style, { alignItems: "center" });
  assert.deepEqual(label.style, { textAlign: "center" });
});

test("keeps a raw CSS string size value as-is instead of appending px", () => {
  const result = run(`page Home { container box { width: "50%" } }`);
  const plan = buildDomPlan(result);
  assert.equal(plan.nodes[0].style.width, "50%");
});

test("carries label/href through for buttons and links", () => {
  const result = run(`
    page Home {
      button go { label: "Go" }
      link home { label: "Home" href: "/" }
    }
  `);
  const plan = buildDomPlan(result);
  const go = plan.nodes.find((n) => n.name === "go");
  const home = plan.nodes.find((n) => n.name === "home");
  assert.equal(go.label, "Go");
  assert.equal(home.label, "Home");
  assert.equal(home.href, "/");
});

test("carries src/alt through for images", () => {
  const result = run(`page Home { image logo { src: "/logo.png" alt: "Logo" } }`);
  const plan = buildDomPlan(result);
  assert.equal(plan.nodes[0].src, "/logo.png");
  assert.equal(plan.nodes[0].alt, "Logo");
});

test("carries functions, variables, and handlers through for the browser runtime", () => {
  const result = run(`
    fn shout(x) { return x + "!" }
    page Home {
      let clicks = 0
      button go { label: "Go" }
      on go.click { clicks = clicks + 1 }
    }
  `);
  const plan = buildDomPlan(result);
  assert.equal(plan.functions[0].name, "shout");
  assert.deepEqual(plan.variables.clicks, { value: 0, constant: false, reactive: false });
  assert.equal(plan.handlers[0].target, "go");
  assert.equal(plan.handlers[0].event, "click");
});

test("warns and skips when a file has more than one page", () => {
  const result = run(`
    page a { text x { content: "a" } }
    page b { text y { content: "b" } }
  `);
  const plan = buildDomPlan(result);
  assert.equal(plan.nodes.length, 1);
  assert.equal(plan.nodes[0].name, "x");
  assert.ok(plan.warnings.some((w) => w.includes("2 pages")));
});

test("returns an empty plan for a file with no pages", () => {
  const plan = buildDomPlan({ pages: [], functions: [] });
  assert.deepEqual(plan.nodes, []);
  assert.equal(plan.title, "");
});

test("builds real semantic tags for heading/paragraph/input/form/list/item", () => {
  const result = run(`
    page Home {
      heading h { content: "Hi" level: 2 }
      paragraph p { content: "Some text" }
      form f {
        input name { placeholder: "Your name" kind: "email" }
      }
      list l {
        item i { }
      }
    }
  `);
  const plan = buildDomPlan(result);
  const heading = plan.nodes.find((n) => n.name === "h");
  const input = plan.nodes.find((n) => n.name === "name");
  assert.equal(heading.type, "heading");
  assert.equal(heading.level, 2);
  assert.equal(heading.content, "Hi");
  assert.equal(input.type, "input");
  assert.equal(input.placeholder, "Your name");
  assert.equal(input.kind, "email");
  assert.equal(plan.nodes.find((n) => n.name === "f").type, "form");
  assert.equal(plan.nodes.find((n) => n.name === "l").type, "list");
  assert.equal(plan.nodes.find((n) => n.name === "i").type, "item");
});

test("heading defaults to level 1 when not given", () => {
  const result = run(`page Home { heading h { content: "Hi" } }`);
  assert.equal(buildDomPlan(result).nodes[0].level, 1);
});

test("maps absolute positioning and universal styling props to CSS", () => {
  const result = run(`
    page Home {
      container badge {
        position: "absolute"
        top: 10
        left: "50%"
        z: 5
        opacity: 0.9
        border: "1px solid red"
        shadow: "0 4px 12px rgba(0,0,0,0.3)"
        cursor: "pointer"
      }
    }
  `);
  const style = buildDomPlan(result).nodes[0].style;
  assert.deepEqual(style, {
    position: "absolute",
    top: "10px",
    left: "50%",
    zIndex: 5,
    opacity: 0.9,
    border: "1px solid red",
    boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
    cursor: "pointer",
  });
});

test("the 'css' escape hatch is appended raw, after the generated style", () => {
  const result = run(`page Home { container box { background: "white" css: "transform: scale(1.05)" } }`);
  const node = buildDomPlan(result).nodes[0];
  assert.equal(node.style.background, "white");
  assert.equal(node.style.__raw, "transform: scale(1.05)");
});

test("records a binding for a non-literal property expression, but not for a bare literal", () => {
  const result = run(`
    page Home {
      state count = 0
      text label { content: "Count: " + count }
      text plain { content: "static" }
    }
  `);
  const plan = buildDomPlan(result);
  const label = plan.nodes.find((n) => n.name === "label");
  const plain = plan.nodes.find((n) => n.name === "plain");
  assert.equal(label.bindings.content.kind, "Binary");
  assert.deepEqual(plain.bindings, {});
});

test("builds a page opacity animation with from/to and passes duration/easing through", () => {
  const result = run(`
    page Home {
      text hero { content: "Hi" opacity: 0.2 }
      animate hero {
        opacity -> 1
        duration: 0.8s
        easing: easeOut
      }
    }
  `);
  const [animation] = buildDomPlan(result).animations;
  assert.equal(animation.target, "hero");
  assert.equal(animation.duration, 800);
  assert.equal(animation.easing, "easeOut");
  assert.deepEqual(animation.changes, [{ property: "opacity", from: 0.2, to: 1 }]);
});

test("a page position/scale/rotation animation is an offset from 0/1/0, not an absolute value", () => {
  const result = run(`
    page Home {
      container box { }
      animate box {
        position.x -> 100
        scale -> 1.5
        rotation -> 45
        duration: 1s
      }
    }
  `);
  const [animation] = buildDomPlan(result).animations;
  assert.deepEqual(animation.changes, [
    { property: "positionX", from: 0, to: 100 },
    { property: "scale", from: 1, to: 1.5 },
    { property: "rotation", from: 0, to: 45 },
  ]);
});

test("a page color/background animation starts from the element's own declared color, flagged for color lerp", () => {
  const result = run(`
    page Home {
      text hero { content: "Hi" color: "#112233" }
      animate hero { color -> "#ffffff" duration: 1s }
    }
  `);
  const [animation] = buildDomPlan(result).animations;
  assert.deepEqual(animation.changes, [{ property: "color", from: "#112233", to: "#ffffff", color: true }]);
});

test("a page color/background animation with no declared starting color defaults to black text on white background", () => {
  const result = run(`
    page Home {
      container box { }
      animate box {
        color -> "#ffffff"
        background -> "#000000"
        duration: 1s
      }
    }
  `);
  const [animation] = buildDomPlan(result).animations;
  assert.deepEqual(animation.changes, [
    { property: "color", from: "#000000", to: "#ffffff", color: true },
    { property: "background", from: "#ffffff", to: "#000000", color: true },
  ]);
});
