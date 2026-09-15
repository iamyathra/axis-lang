import { test } from "node:test";
import assert from "node:assert/strict";
import { tokenize } from "../src/lexer.js";
import { parse } from "../src/parser.js";
import { AxisSyntaxError } from "../src/lexer.js";
import {
  evaluate,
  evaluateAsync,
  executeBlockAsync,
  callFunctionAsync,
  callFunction,
  execute,
  AxisRuntimeError,
} from "../src/evaluator.js";
import { createGlobalEnv } from "../src/globals.js";

function parseProgram(src) {
  return parse(tokenize(src));
}

// Runs an `async fn __main() { ... }`'s body through the async executor,
// against a fresh global env (so fetch/api/etc. are available), and returns
// that env for assertions. The body is expected to set variables rather
// than `return` (a bare `return` would throw ReturnSignal straight out of
// executeBlockAsync, which is only meant to be caught by a real function
// call - see callFunctionAsync's own tests, below, for that case).
async function runAsync(src, env = createGlobalEnv().child()) {
  const program = parseProgram(`async fn __main() {\n${src}\n}`);
  await executeBlockAsync(program.items[0].body, env);
  return env;
}

function withFetch(handler, fn) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = handler;
  return fn().finally(() => {
    globalThis.fetch = originalFetch;
  });
}

// ---- parser ----------------------------------------------------------------

test("'async fn' parses and is tagged isAsync", () => {
  const program = parseProgram(`async fn loadData() { return 1 }`);
  assert.equal(program.items[0].kind, "FnDecl");
  assert.equal(program.items[0].isAsync, true);
});

test("a plain 'fn' is not isAsync", () => {
  const program = parseProgram(`fn plain() { return 1 }`);
  assert.equal(program.items[0].isAsync, false);
});

test("'await' inside a plain (non-async) fn is a syntax error", () => {
  assert.throws(() => parseProgram(`fn plain() { let x = await foo() }`), AxisSyntaxError);
});

test("'await' at the top level of a scene/page body is a syntax error", () => {
  assert.throws(() => parseProgram(`scene main { let x = await foo() }`), AxisSyntaxError);
});

test("'await' works inside an 'async fn' body", () => {
  const program = parseProgram(`async fn loadData() { let x = await foo() return x }`);
  assert.equal(program.items[0].body[0].value.kind, "Await");
});

test("'await' works inside an 'on' handler with no 'async' keyword needed", () => {
  const program = parseProgram(`
    page Home {
      button b { content: "go" }
      on b.click {
        let x = await foo()
      }
    }
  `);
  const onDecl = program.items[0].body.find((n) => n.kind === "OnDecl");
  assert.equal(onDecl.body[0].value.kind, "Await");
});

test("'await' inside an 'animate' block is rejected even inside an async context", () => {
  assert.throws(
    () =>
      parseProgram(`
        page Home {
          box b { opacity: 1 }
          on b.click {
            animate b {
              opacity: await foo()
              duration: 300ms
            }
          }
        }
      `),
    AxisSyntaxError
  );
});

test("'try'/'catch' parses inside a plain function", () => {
  const program = parseProgram(`
    fn safe() {
      try {
        let x = 1
      } catch (err) {
        print(err)
      }
    }
  `);
  const tryStmt = program.items[0].body[0];
  assert.equal(tryStmt.kind, "TryStmt");
  assert.equal(tryStmt.errName, "err");
});

// ---- async evaluation --------------------------------------------------------

test("evaluateAsync resolves a plain expression with no await, same as evaluate", async () => {
  const env = createGlobalEnv().child();
  const expr = parseProgram(`fn __x() { return 1 + 2 * 3 }`).items[0].body[0].value;
  assert.equal(await evaluateAsync(expr, env), 7);
});

test("callFunctionAsync unwraps 'await' on a resolved native promise", async () => {
  const env = createGlobalEnv().child();
  env.define("delayed", async () => 42);
  const program = parseProgram(`async fn f() { return await delayed() }`);
  const fn = { __axisType: "function", name: "f", params: [], body: program.items[0].body, closure: env, isAsync: true };
  assert.equal(await callFunctionAsync(fn, [], 1), 42);
});

test("an async fn can call another async fn with await, and the result flows through arithmetic", async () => {
  const env = createGlobalEnv().child();
  env.define("one", async () => 1);
  const program = parseProgram(`
    async fn addOne(x) {
      let y = await one()
      return x + y
    }
  `);
  const fn = { __axisType: "function", name: "addOne", params: ["x"], body: program.items[0].body, closure: env, isAsync: true };
  assert.equal(await callFunctionAsync(fn, [10], 1), 11);
});

test("calling an async AXIS fn synchronously (no await) is a clear error, not a silent Promise", () => {
  const env = createGlobalEnv().child();
  const asyncFn = { __axisType: "function", name: "loadData", params: [], body: [], closure: env, isAsync: true };
  assert.throws(() => callFunction(asyncFn, [], 1), (e) => e instanceof AxisRuntimeError && /await/.test(e.message));
});

test("calling a native async builtin (fetch) without 'await' throws 'use await', not a Promise value", () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, status: 200, statusText: "OK", text: async () => "{}" });
  try {
    const env = createGlobalEnv().child();
    const call = parseProgram(`fn f() { return fetch("http://example.test") }`).items[0].body[0].value;
    assert.throws(() => evaluate(call, env), (e) => e instanceof AxisRuntimeError && e.message.includes("pending value"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("try/catch (sync) catches a runtime error and binds its message", () => {
  const env = createGlobalEnv().child();
  env.define("caught", null);
  const program = parseProgram(`
    fn f() {
      try {
        let x = [1, 2][10]
      } catch (err) {
        caught = err
      }
    }
  `);
  execute(program.items[0].body[0], env);
  assert.match(env.get("caught"), /out of range/);
});

test("try/catch (async) catches a rejected 'await' and binds its message", async () => {
  const env = createGlobalEnv().child();
  env.define("caught", null);
  env.define("boom", async () => {
    throw new AxisRuntimeError("network is down");
  });
  await runAsync(
    `
      try {
        let x = await boom()
      } catch (err) {
        caught = err
      }
    `,
    env
  );
  assert.equal(env.get("caught"), "network is down");
});

test("try/catch does not swallow a 'return' from inside the try block", async () => {
  const env = createGlobalEnv().child();
  const program = parseProgram(`
    async fn f() {
      try {
        return "done"
      } catch (err) {
        return "never"
      }
    }
  `);
  const fn = { __axisType: "function", name: "f", params: [], body: program.items[0].body, closure: env, isAsync: true };
  assert.equal(await callFunctionAsync(fn, [], 1), "done");
});

// ---- fetch/api globals -------------------------------------------------------

test("api.get returns parsed JSON converted to AXIS records/arrays", async () => {
  await withFetch(
    async (url) => {
      assert.equal(url, "/projects");
      return { ok: true, status: 200, statusText: "OK", text: async () => JSON.stringify([{ name: "Nimbus", tags: ["studio"] }]) };
    },
    async () => {
      const env = createGlobalEnv().child();
      env.define("data", null);
      await runAsync(`data = await api.get("/projects")`, env);
      const data = env.get("data");
      assert.equal(data.length, 1);
      assert.equal(data[0].__axisType, "record");
      assert.equal(data[0].name, "Nimbus");
      assert.deepEqual(data[0].tags, ["studio"]);
    }
  );
});

test("api.get throws a clear AxisRuntimeError on a non-2xx response, catchable with try/catch", async () => {
  await withFetch(
    async () => ({ ok: false, status: 404, statusText: "Not Found", text: async () => "" }),
    async () => {
      const env = createGlobalEnv().child();
      env.define("data", null);
      env.define("error", null);
      await runAsync(
        `
          try {
            data = await api.get("/missing")
          } catch (err) {
            error = err
          }
        `,
        env
      );
      assert.match(env.get("error"), /404/);
    }
  );
});

test("fetch(url).json() round-trips through await twice", async () => {
  await withFetch(
    async () => ({ ok: true, status: 200, statusText: "OK", json: async () => ({ hello: "world" }) }),
    async () => {
      const env = createGlobalEnv().child();
      env.define("data", null);
      await runAsync(
        `
          let response = await fetch("/x")
          data = await response.json()
        `,
        env
      );
      const data = env.get("data");
      assert.equal(data.__axisType, "record");
      assert.equal(data.hello, "world");
    }
  );
});

test("api.post sends a JSON body built from an AXIS record", async () => {
  let sentBody = null;
  await withFetch(
    async (url, init) => {
      sentBody = JSON.parse(init.body);
      return { ok: true, status: 200, statusText: "OK", text: async () => JSON.stringify({ id: 1 }) };
    },
    async () => {
      const env = createGlobalEnv().child();
      env.define("result", null);
      await runAsync(`result = await api.post("/projects", { name: "Nimbus", count: 3 })`, env);
      assert.deepEqual(sentBody, { name: "Nimbus", count: 3 });
      assert.equal(env.get("result").id, 1);
    }
  );
});
