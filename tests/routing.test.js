import { test } from "node:test";
import assert from "node:assert/strict";
import { tokenize } from "../src/lexer.js";
import { parse } from "../src/parser.js";
import { AxisSyntaxError } from "../src/lexer.js";
import { run } from "../src/run.js";
import { AxisRuntimeError } from "../src/evaluator.js";
import { matchRoute, parseQuery, isStaticPattern, isDynamicPattern } from "../src/renderer/router.js";
import { buildDomRouterPlan, resolvedPagePlan } from "../src/renderer/domPlan.js";
import { startDomRouterServer } from "../src/renderer/domServer.js";

function parseProgram(src) {
  return parse(tokenize(src));
}

// ---- parser ------------------------------------------------------------

test("'route' parses a pattern and a page name", () => {
  const program = parseProgram(`route "/about" About`);
  assert.equal(program.items[0].kind, "RouteDecl");
  assert.equal(program.items[0].pattern, "/about");
  assert.equal(program.items[0].pageName, "About");
});

test("'redirect' parses a source and target pattern", () => {
  const program = parseProgram(`redirect "/old" "/new"`);
  assert.equal(program.items[0].kind, "RedirectDecl");
  assert.equal(program.items[0].from, "/old");
  assert.equal(program.items[0].to, "/new");
});

test("a route's page name must be an identifier, not a string", () => {
  assert.throws(() => parseProgram(`route "/about" "About"`), AxisSyntaxError);
});

// ---- router.js: pure matching --------------------------------------------

test("matchRoute: an exact static route", () => {
  const routes = [{ pattern: "/about", pageName: "About" }];
  const result = matchRoute(routes, "/about");
  assert.equal(result.route.pageName, "About");
  assert.deepEqual(result.params, {});
});

test("matchRoute: '/' matches the root pattern", () => {
  const routes = [{ pattern: "/", pageName: "Home" }];
  assert.equal(matchRoute(routes, "/").route.pageName, "Home");
});

test("matchRoute: a dynamic segment is captured and URL-decoded", () => {
  const routes = [{ pattern: "/projects/:id", pageName: "Project" }];
  const result = matchRoute(routes, "/projects/hello%20world");
  assert.equal(result.route.pageName, "Project");
  assert.deepEqual(result.params, { id: "hello world" });
});

test("matchRoute: a static route wins over a dynamic one when both could match", () => {
  const routes = [
    { pattern: "/projects/new", pageName: "NewProject" },
    { pattern: "/projects/:id", pageName: "Project" },
  ];
  assert.equal(matchRoute(routes, "/projects/new").route.pageName, "NewProject");
  assert.equal(matchRoute(routes, "/projects/42").route.pageName, "Project");
});

test("matchRoute: segment count must match - no partial/prefix matches", () => {
  const routes = [{ pattern: "/projects/:id", pageName: "Project" }];
  assert.equal(matchRoute(routes, "/projects"), null);
  assert.equal(matchRoute(routes, "/projects/1/extra"), null);
});

test("matchRoute: '*' is always tried last, regardless of declaration order", () => {
  const routes = [
    { pattern: "*", pageName: "NotFound" },
    { pattern: "/about", pageName: "About" },
  ];
  assert.equal(matchRoute(routes, "/about").route.pageName, "About");
  assert.equal(matchRoute(routes, "/nope").route.pageName, "NotFound");
});

test("matchRoute: no match and no '*' returns null", () => {
  const routes = [{ pattern: "/about", pageName: "About" }];
  assert.equal(matchRoute(routes, "/nope"), null);
});

test("parseQuery: single vs. repeated keys", () => {
  assert.deepEqual(parseQuery("?id=42&tag=a&tag=b"), { id: "42", tag: ["a", "b"] });
  assert.deepEqual(parseQuery(""), {});
});

test("isStaticPattern / isDynamicPattern", () => {
  assert.equal(isStaticPattern("/about"), true);
  assert.equal(isStaticPattern("/projects/:id"), false);
  assert.equal(isStaticPattern("*"), false);
  assert.equal(isDynamicPattern("/projects/:id"), true);
  assert.equal(isDynamicPattern("/about"), false);
});

// ---- interpreter: route/redirect collection + validation ------------------

test("interpret() collects routes/redirects and validates page references", () => {
  const result = run(`
    route "/" Home
    route "/about" About
    redirect "/old" "/about"

    page Home { text t { content: "home" } }
    page About { text t { content: "about" } }
  `);
  assert.deepEqual(result.routes, [
    { pattern: "/", pageName: "Home" },
    { pattern: "/about", pageName: "About" },
  ]);
  assert.deepEqual(result.redirects, [{ from: "/old", to: "/about" }]);
});

test("a route referencing an undeclared page is a clear error, with a suggestion", () => {
  assert.throws(
    () => run(`route "/about" Abuot\npage Home { text t { content: "x" } }`),
    (e) => e instanceof AxisRuntimeError && /Abuot/.test(e.message) && /no such page/.test(e.message)
  );
});

test("declaring the same route pattern twice is an error", () => {
  assert.throws(
    () =>
      run(`
        route "/about" About
        route "/about" About
        page About { text t { content: "x" } }
      `),
    (e) => e instanceof AxisRuntimeError && /more than once/.test(e.message)
  );
});

test("a program with no 'route' declarations has no 'params'/'query' - referencing them is an ordinary undefined-variable error", () => {
  assert.throws(
    () => run(`page Home { text t { content: params.id } }`),
    (e) => e instanceof AxisRuntimeError && /undefined variable 'params'/.test(e.message)
  );
});

test("'params' is pre-seeded with every dynamic segment name across every route, defaulting to \"\"", () => {
  const result = run(`
    route "/projects/:id" Project
    route "/users/:userId/posts/:postId" Post
    page Project { text t { content: params.id } }
    page Post { text t { content: params.userId + params.postId } }
  `);
  assert.equal(result.sharedVariables.params.value.id, "");
  assert.equal(result.sharedVariables.params.value.userId, "");
  assert.equal(result.sharedVariables.params.value.postId, "");
});

test("'query' starts as an empty record - reading an unknown key directly is a build-time error, use get(query, key, fallback)", () => {
  assert.throws(
    () => run(`route "/" Home\npage Home { text t { content: query.q } }`),
    (e) => e instanceof AxisRuntimeError && /doesn't have a '.q' field/.test(e.message)
  );
  // the documented escape hatch works and doesn't throw
  assert.doesNotThrow(() => run(`route "/" Home\npage Home { text t { content: get(query, "q", "none") } }`));
});

// ---- domPlan.js: router plan shape -----------------------------------------

test("buildDomRouterPlan only builds pages something routes to", () => {
  const result = run(`
    route "/" Home
    page Home { text t { content: "home" } }
    page Orphan { text t { content: "never routed" } }
  `);
  const plan = buildDomRouterPlan(result);
  assert.deepEqual(Object.keys(plan.pages), ["Home"]);
});

test("resolvedPagePlan merges the router plan's hoisted functions/sharedVariables onto one page", () => {
  const result = run(`
    fn shout(x) { return x + "!" }
    route "/" Home
    page Home { text t { content: shout("hi") } }
  `);
  const routerPlan = buildDomRouterPlan(result);
  const page = resolvedPagePlan(routerPlan, "Home");
  assert.equal(page.functions.length, 1);
  assert.ok("params" in page.sharedVariables);
});

test("two routes pointing at the same page only build it once", () => {
  const result = run(`
    route "/" Home
    route "/home" Home
    page Home { text t { content: "home" } }
  `);
  const plan = buildDomRouterPlan(result);
  assert.deepEqual(Object.keys(plan.pages), ["Home"]);
});

// ---- end to end: a real router dev server ---------------------------------

async function withRouterServer(source, fn) {
  const plan = buildDomRouterPlan(run(source));
  const server = await startDomRouterServer(plan);
  const port = server.address().port;
  try {
    await fn(`http://localhost:${port}`, plan);
  } finally {
    server.close();
  }
}

const SITE = `
  route "/" Home
  route "/about" About
  route "/projects/:id" Project
  route "*" NotFound
  redirect "/old-about" "/about"

  page Home { text t { content: "home page" } }
  page About { text t { content: "about page" } }
  page Project { text t { content: "project " + params.id } }
  page NotFound { text t { content: "not found" } }
`;

test("router server: serves the matched page's own server-rendered HTML per request", async () => {
  await withRouterServer(SITE, async (base) => {
    const home = await (await fetch(`${base}/`)).text();
    assert.match(home, /home page/);
    assert.match(home, /<title>Home<\/title>/);

    const about = await (await fetch(`${base}/about`)).text();
    assert.match(about, /about page/);
    assert.match(about, /<title>About<\/title>/);
  });
});

test("router server: embeds the whole router plan plus which route matched, for the client", async () => {
  await withRouterServer(SITE, async (base) => {
    const html = await (await fetch(`${base}/about`)).text();
    assert.match(html, /__AXIS_ROUTER_PLAN__/);
    assert.match(html, /__AXIS_INITIAL_ROUTE__/);
    assert.match(html, /"pageName":"About"/);
  });
});

test("router server: an unmatched path renders the '*' catch-all page, status 200", async () => {
  await withRouterServer(SITE, async (base) => {
    const res = await fetch(`${base}/nope/at/all`);
    assert.equal(res.status, 200);
    assert.match(await res.text(), /not found/);
  });
});

test("router server: a redirect responds 302 with a Location header, before ever matching/rendering a route", async () => {
  await withRouterServer(SITE, async (base) => {
    const res = await fetch(`${base}/old-about`, { redirect: "manual" });
    assert.equal(res.status, 302);
    assert.equal(res.headers.get("location"), "/about");
  });
});

test("router server: serves domRouter.js and router.js alongside the rest of the runtime", async () => {
  await withRouterServer(SITE, async (base) => {
    const router = await fetch(`${base}/router.js`);
    assert.equal(router.status, 200);
    const domRouter = await fetch(`${base}/domRouter.js`);
    assert.equal(domRouter.status, 200);
  });
});
