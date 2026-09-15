// AXIS's small standard library. Shared between Node (building the scene
// graph) and the browser (running `on` handlers) - same reason evaluator.js
// is shared: no environment-specific APIs allowed in here.

import { Environment, AxisRuntimeError, isVector, isRecord, makeVector, recordFields, stringify, isCallable, callFunction, typeName, deepEqual, truthy } from "./evaluator.js";

export const NAMED_COLORS = [
  "red", "green", "blue", "yellow", "orange", "purple",
  "white", "black", "gray", "grey", "pink", "brown", "cyan", "magenta",
];

// Kept in sync with src/renderer/easing.js's own EASINGS map (the actual
// curve implementations) - this is the name-only copy every domain that
// needs to validate/bind an easing identifier without needing the curve
// math itself can use: interpreter.js imports this one directly (safe -
// this file has no dependency on interpreter.js); evaluator.js keeps its
// own separate copy instead of importing this one, since globals.js itself
// depends on evaluator.js and importing back would be circular.
export const EASING_NAMES = [
  "linear", "easeIn", "easeOut", "easeInOut",
  "easeInCubic", "easeOutCubic", "easeInOutCubic",
  "easeInBack", "easeOutBack", "easeInOutBack",
  "easeOutBounce",
];

function checkArity(name, args, count, line) {
  if (args.length !== count) {
    throw new AxisRuntimeError(`'${name}' expects ${count} argument(s), got ${args.length}`, line);
  }
}

function checkNumber(name, value, line) {
  if (typeof value !== "number") throw new AxisRuntimeError(`'${name}' expects a number`, line);
  return value;
}

function checkArray(name, value, line) {
  if (!Array.isArray(value)) throw new AxisRuntimeError(`'${name}' expects an array, got a ${typeName(value)}`, line);
  return value;
}

function checkString(name, value, line) {
  if (typeof value !== "string") throw new AxisRuntimeError(`'${name}' expects a string, got a ${typeName(value)}`, line);
  return value;
}

function checkCallableArg(name, value, line) {
  if (!isCallable(value)) throw new AxisRuntimeError(`'${name}' expects a function, got a ${typeName(value)}`, line);
  return value;
}

// Ascending, natural ordering for 'sort'/'sortBy' - numbers by value, strings
// lexicographically. Deliberately narrow (no mixed-type arrays, no custom
// comparator) rather than exposing a JS-style three-way comparator function:
// AXIS's own philosophy (see globals.js's module header, and the "don't
// blindly copy JavaScript semantics" framing in docs/VISION.md) is to cover
// the common case plainly and let 'sortBy' (a key-extractor, not a full
// comparator) cover everything else.
function naturalCompare(name, a, b, line) {
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "string" && typeof b === "string") return a < b ? -1 : a > b ? 1 : 0;
  throw new AxisRuntimeError(`'${name}' needs every element to be a number, or every element to be a string - got a ${typeName(a)} and a ${typeName(b)}`, line);
}

function componentsOf(v) {
  return v.dim === 2 ? [v.x, v.y] : v.dim === 3 ? [v.x, v.y, v.z] : [v.x, v.y, v.z, v.w];
}

function toHex2(n) {
  return Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
}

// Turns a parsed JSON value (plain JS objects/arrays/primitives, straight
// out of JSON.parse/Response.json()) into AXIS's own value shapes - the
// only real gap is that a JS plain object needs the `__axisType: "record"`
// tag AXIS's own record literals carry (see evaluator.js's isRecord), so
// `keys(...)`, `stringify(...)`, and the "did you mean" suggestion on a
// missing field all work on fetched data exactly like they do on a literal
// `{ ... }` written in source. Everything else - strings, numbers,
// booleans, null, arrays (recursed into) - is already a value AXIS's
// evaluator handles natively, with no conversion needed.
function jsonToAxisValue(v) {
  if (Array.isArray(v)) return v.map(jsonToAxisValue);
  if (v !== null && typeof v === "object") {
    const record = { __axisType: "record" };
    for (const key of Object.keys(v)) record[key] = jsonToAxisValue(v[key]);
    return record;
  }
  return v;
}

// The inverse - strips AXIS's own tags back down to a plain JSON-safe
// value, for sending a record/array (e.g. a fetch/api.* request body) out
// as a real HTTP request.
function axisValueToJson(v) {
  if (Array.isArray(v)) return v.map(axisValueToJson);
  if (isVector(v)) return componentsOf(v);
  if (isRecord(v)) {
    const out = {};
    for (const key of recordFields(v)) out[key] = axisValueToJson(v[key]);
    return out;
  }
  return v;
}

export function createGlobalEnv() {
  const env = new Environment();

  env.define("PI", Math.PI, true);
  for (const name of NAMED_COLORS) env.define(name, name, true);
  for (const name of EASING_NAMES) env.define(name, name, true);
  env.define("infinite", Infinity, true);

  env.define("rgb", (args, line) => {
    checkArity("rgb", args, 3, line);
    const [r, g, b] = args.map((a) => checkNumber("rgb", a, line));
    return `#${toHex2(r)}${toHex2(g)}${toHex2(b)}`;
  });

  env.define("abs", (args, line) => {
    checkArity("abs", args, 1, line);
    return Math.abs(checkNumber("abs", args[0], line));
  });
  env.define("min", (args, line) => {
    if (args.length === 0) throw new AxisRuntimeError("'min' needs at least one argument", line);
    return Math.min(...args.map((a) => checkNumber("min", a, line)));
  });
  env.define("max", (args, line) => {
    if (args.length === 0) throw new AxisRuntimeError("'max' needs at least one argument", line);
    return Math.max(...args.map((a) => checkNumber("max", a, line)));
  });
  env.define("floor", (args, line) => Math.floor(checkNumber("floor", args[0], line)));
  env.define("ceil", (args, line) => Math.ceil(checkNumber("ceil", args[0], line)));
  env.define("round", (args, line) => Math.round(checkNumber("round", args[0], line)));
  env.define("sqrt", (args, line) => Math.sqrt(checkNumber("sqrt", args[0], line)));
  // degrees in, matching AXIS's degree-first angles (rotation.y -> 360deg)
  env.define("sin", (args, line) => Math.sin((checkNumber("sin", args[0], line) * Math.PI) / 180));
  env.define("cos", (args, line) => Math.cos((checkNumber("cos", args[0], line) * Math.PI) / 180));

  env.define("random", (args, line) => {
    if (args.length === 0) return Math.random();
    checkArity("random", args, 2, line);
    const [a, b] = args.map((x) => checkNumber("random", x, line));
    return a + Math.random() * (b - a);
  });

  env.define("range", (args, line) => {
    checkArity("range", args, 2, line);
    const [from, to] = args.map((a) => checkNumber("range", a, line));
    const out = [];
    for (let i = from; i < to; i++) out.push(i);
    return out;
  });

  env.define("len", (args, line) => {
    checkArity("len", args, 1, line);
    const [v] = args;
    if (Array.isArray(v) || typeof v === "string") return v.length;
    throw new AxisRuntimeError("'len' expects an array or a string", line);
  });

  // ---- arrays -------------------------------------------------------------
  // 'map'/'filter'/'find'/'some'/'every'/'reduce' all call the given
  // function with exactly the arguments documented here - AXIS functions
  // have fixed arity (callFunction throws on a mismatch), so unlike
  // JavaScript's optional index/array callback arguments, a callback passed
  // to one of these must declare exactly that many parameters, no fewer, no
  // more. Only 'reduce' passes two.

  env.define("push", (args, line) => {
    checkArity("push", args, 2, line);
    const [arr, item] = args;
    checkArray("push", arr, line);
    arr.push(item);
    return arr.length;
  });

  env.define("pop", (args, line) => {
    checkArity("pop", args, 1, line);
    const [arr] = args;
    checkArray("pop", arr, line);
    if (arr.length === 0) throw new AxisRuntimeError("can't 'pop' an empty array", line);
    return arr.pop();
  });

  env.define("shift", (args, line) => {
    checkArity("shift", args, 1, line);
    const [arr] = args;
    checkArray("shift", arr, line);
    if (arr.length === 0) throw new AxisRuntimeError("can't 'shift' an empty array", line);
    return arr.shift();
  });

  env.define("unshift", (args, line) => {
    checkArity("unshift", args, 2, line);
    const [arr, item] = args;
    checkArray("unshift", arr, line);
    arr.unshift(item);
    return arr.length;
  });

  env.define("map", (args, line) => {
    checkArity("map", args, 2, line);
    const [arr, fn] = args;
    checkArray("map", arr, line);
    checkCallableArg("map", fn, line);
    return arr.map((item) => callFunction(fn, [item], line));
  });

  env.define("filter", (args, line) => {
    checkArity("filter", args, 2, line);
    const [arr, fn] = args;
    checkArray("filter", arr, line);
    checkCallableArg("filter", fn, line);
    return arr.filter((item) => truthy(callFunction(fn, [item], line)));
  });

  env.define("find", (args, line) => {
    checkArity("find", args, 2, line);
    const [arr, fn] = args;
    checkArray("find", arr, line);
    checkCallableArg("find", fn, line);
    const found = arr.find((item) => truthy(callFunction(fn, [item], line)));
    return found === undefined ? null : found;
  });

  env.define("some", (args, line) => {
    checkArity("some", args, 2, line);
    const [arr, fn] = args;
    checkArray("some", arr, line);
    checkCallableArg("some", fn, line);
    return arr.some((item) => truthy(callFunction(fn, [item], line)));
  });

  env.define("every", (args, line) => {
    checkArity("every", args, 2, line);
    const [arr, fn] = args;
    checkArray("every", arr, line);
    checkCallableArg("every", fn, line);
    return arr.every((item) => truthy(callFunction(fn, [item], line)));
  });

  env.define("reduce", (args, line) => {
    checkArity("reduce", args, 3, line);
    const [arr, fn, initial] = args;
    checkArray("reduce", arr, line);
    checkCallableArg("reduce", fn, line);
    return arr.reduce((acc, item) => callFunction(fn, [acc, item], line), initial);
  });

  env.define("reverse", (args, line) => {
    checkArity("reverse", args, 1, line);
    return [...checkArray("reverse", args[0], line)].reverse();
  });

  env.define("sort", (args, line) => {
    checkArity("sort", args, 1, line);
    return [...checkArray("sort", args[0], line)].sort((a, b) => naturalCompare("sort", a, b, line));
  });

  env.define("sortBy", (args, line) => {
    checkArity("sortBy", args, 2, line);
    const [arr, fn] = args;
    checkArray("sortBy", arr, line);
    checkCallableArg("sortBy", fn, line);
    return arr
      .map((item) => [callFunction(fn, [item], line), item])
      .sort((a, b) => naturalCompare("sortBy", a[0], b[0], line))
      .map(([, item]) => item);
  });

  env.define("join", (args, line) => {
    checkArity("join", args, 2, line);
    const [arr, sep] = args;
    checkArray("join", arr, line);
    checkString("join", sep, line);
    return arr.map(stringify).join(sep);
  });

  // Works on an array or a string, same "one function covers both
  // collection kinds" pattern 'len' already uses.
  env.define("slice", (args, line) => {
    if (args.length < 2 || args.length > 3) throw new AxisRuntimeError("'slice' expects a collection, a start index, and an optional end index", line);
    const [coll, start, end] = args;
    if (!Array.isArray(coll) && typeof coll !== "string") throw new AxisRuntimeError(`'slice' expects an array or a string, got a ${typeName(coll)}`, line);
    checkNumber("slice", start, line);
    if (end !== undefined) checkNumber("slice", end, line);
    return coll.slice(start, end);
  });

  env.define("indexOf", (args, line) => {
    checkArity("indexOf", args, 2, line);
    const [coll, value] = args;
    if (Array.isArray(coll)) return coll.findIndex((item) => deepEqual(item, value));
    if (typeof coll === "string") return coll.indexOf(checkString("indexOf", value, line));
    throw new AxisRuntimeError(`'indexOf' expects an array or a string, got a ${typeName(coll)}`, line);
  });

  env.define("includes", (args, line) => {
    checkArity("includes", args, 2, line);
    const [coll, value] = args;
    if (Array.isArray(coll)) return coll.some((item) => deepEqual(item, value));
    if (typeof coll === "string") return coll.includes(checkString("includes", value, line));
    throw new AxisRuntimeError(`'includes' expects an array or a string, got a ${typeName(coll)}`, line);
  });

  // ---- strings --------------------------------------------------------

  env.define("split", (args, line) => {
    checkArity("split", args, 2, line);
    const [str, sep] = args;
    return checkString("split", str, line).split(checkString("split", sep, line));
  });

  env.define("trim", (args, line) => {
    checkArity("trim", args, 1, line);
    return checkString("trim", args[0], line).trim();
  });

  // Replaces every occurrence, not just the first - a deliberate departure
  // from JavaScript's plain (non-regex) '.replace', which only replaces the
  // first. AXIS has no regex, so "replace all" is what most callers actually
  // want, and it's the one behavior a caller can't already get another way.
  env.define("replace", (args, line) => {
    checkArity("replace", args, 3, line);
    const [str, search, replacement] = args;
    checkString("replace", str, line);
    checkString("replace", search, line);
    checkString("replace", replacement, line);
    if (search === "") throw new AxisRuntimeError("'replace' can't search for an empty string", line);
    return str.split(search).join(replacement);
  });

  env.define("upper", (args, line) => {
    checkArity("upper", args, 1, line);
    return checkString("upper", args[0], line).toUpperCase();
  });

  env.define("lower", (args, line) => {
    checkArity("lower", args, 1, line);
    return checkString("lower", args[0], line).toLowerCase();
  });

  env.define("startsWith", (args, line) => {
    checkArity("startsWith", args, 2, line);
    const [str, prefix] = args;
    return checkString("startsWith", str, line).startsWith(checkString("startsWith", prefix, line));
  });

  env.define("endsWith", (args, line) => {
    checkArity("endsWith", args, 2, line);
    const [str, suffix] = args;
    return checkString("endsWith", str, line).endsWith(checkString("endsWith", suffix, line));
  });

  // A record field that might not be there - a query-string parameter no
  // route pattern declares (unlike a route's own `:id`-style params, a
  // query string's keys are never statically known - see interpreter.js's
  // `params`/`query` seeding), or any other record whose exact shape isn't
  // guaranteed (an API response). `.field` access stays strict everywhere
  // else in AXIS (a typo'd field is a real bug worth a clear "did you
  // mean" error, not a silent `null`) - `get` is the one deliberate escape
  // hatch for "this key might genuinely not be there," used explicitly.
  env.define("get", (args, line) => {
    checkArity("get", args, 3, line);
    const [record, key, fallback] = args;
    if (!isRecord(record)) throw new AxisRuntimeError("'get' expects a record", line);
    if (typeof key !== "string") throw new AxisRuntimeError("'get' expects a string field name", line);
    return key in record ? record[key] : fallback;
  });

  env.define("keys", (args, line) => {
    checkArity("keys", args, 1, line);
    const [v] = args;
    if (!isRecord(v)) throw new AxisRuntimeError("'keys' expects a record", line);
    return recordFields(v);
  });

  env.define("values", (args, line) => {
    checkArity("values", args, 1, line);
    const [v] = args;
    if (!isRecord(v)) throw new AxisRuntimeError("'values' expects a record", line);
    return recordFields(v).map((k) => v[k]);
  });

  // A record - `{key: ..., value: ...}` per field - rather than a
  // JavaScript-style [key, value] pair: AXIS already has a real record
  // type for exactly this "named bag of fields" shape, so reusing it here
  // (instead of introducing 2-element arrays as an implicit tuple
  // convention) keeps one way to name a related pair of values, not two.
  env.define("entries", (args, line) => {
    checkArity("entries", args, 1, line);
    const [v] = args;
    if (!isRecord(v)) throw new AxisRuntimeError("'entries' expects a record", line);
    return recordFields(v).map((k) => ({ __axisType: "record", key: k, value: v[k] }));
  });

  env.define("has", (args, line) => {
    checkArity("has", args, 2, line);
    const [v, key] = args;
    if (!isRecord(v)) throw new AxisRuntimeError("'has' expects a record", line);
    checkString("has", key, line);
    return recordFields(v).includes(key);
  });

  // Fields from `b` win over `a` - the same "later wins" rule a plain
  // reassignment would give you. Pure - returns a new record, leaves both
  // inputs untouched, same convention 'map'/'filter'/'reverse' use for
  // arrays (mutation stays an explicit, separate operation - '.field ='
  // assignment already covers that for records).
  env.define("merge", (args, line) => {
    checkArity("merge", args, 2, line);
    const [a, b] = args;
    if (!isRecord(a) || !isRecord(b)) throw new AxisRuntimeError("'merge' expects two records", line);
    return { __axisType: "record", ...a, ...b };
  });

  env.define("str", (args, line) => {
    checkArity("str", args, 1, line);
    return stringify(args[0]);
  });

  env.define("print", (args) => {
    console.log("[axis]", ...args.map(stringify));
    return null;
  });

  env.define("now", () => (typeof performance !== "undefined" ? performance.now() : Date.now()));

  env.define("mag", (args, line) => {
    checkArity("mag", args, 1, line);
    const v = args[0];
    if (!isVector(v)) throw new AxisRuntimeError("'mag' expects a vector", line);
    return Math.sqrt(componentsOf(v).reduce((sum, c) => sum + c * c, 0));
  });

  env.define("normalize", (args, line) => {
    checkArity("normalize", args, 1, line);
    const v = args[0];
    if (!isVector(v)) throw new AxisRuntimeError("'normalize' expects a vector", line);
    const length = Math.sqrt(componentsOf(v).reduce((sum, c) => sum + c * c, 0));
    if (length === 0) throw new AxisRuntimeError("can't normalize a zero-length vector", line);
    return makeVector(componentsOf(v).map((c) => c / length));
  });

  env.define("dot", (args, line) => {
    checkArity("dot", args, 2, line);
    const [a, b] = args;
    if (!isVector(a) || !isVector(b) || a.dim !== b.dim) {
      throw new AxisRuntimeError("'dot' expects two vectors of the same size", line);
    }
    return componentsOf(a).reduce((sum, c, i) => sum + c * componentsOf(b)[i], 0);
  });

  env.define("lerp", (args, line) => {
    checkArity("lerp", args, 3, line);
    const [a, b, t] = args;
    if (typeof a === "number" && typeof b === "number" && typeof t === "number") return a + (b - a) * t;
    if (isVector(a) && isVector(b) && a.dim === b.dim && typeof t === "number") {
      return makeVector(componentsOf(a).map((c, i) => c + (componentsOf(b)[i] - c) * t));
    }
    throw new AxisRuntimeError("'lerp' expects two numbers or two same-size vectors, and a number for t", line);
  });

  // ---- async/network -----------------------------------------------------
  // `fetch`/`api.*` are the only builtins in this file that return a
  // pending value - only reachable from an `await`, inside an `on` handler
  // or an `async fn` (evaluator.js's async execution path); calling either
  // without 'await' is a clear runtime error (evaluate()'s own "returns a
  // pending value" check), not a silently-wrong Promise flowing into the
  // scene/page graph. See docs/architecture/async-await.md.
  env.define("fetch", async (args, line) => {
    if (args.length < 1 || args.length > 2) throw new AxisRuntimeError("'fetch' expects a url and an optional options record", line);
    const [url, options] = args;
    if (typeof url !== "string") throw new AxisRuntimeError("'fetch' expects a string url", line);
    if (typeof globalThis.fetch !== "function") throw new AxisRuntimeError("'fetch' isn't available in this environment", line);
    let init;
    if (options !== undefined) {
      if (!isRecord(options)) throw new AxisRuntimeError("'fetch's second argument must be a record", line);
      init = {};
      if ("method" in options) init.method = options.method;
      if ("headers" in options) init.headers = axisValueToJson(options.headers);
      if ("body" in options) {
        init.body = typeof options.body === "string" ? options.body : JSON.stringify(axisValueToJson(options.body));
      }
    }
    let res;
    try {
      res = await globalThis.fetch(url, init);
    } catch (err) {
      throw new AxisRuntimeError(`'fetch' failed for '${url}': ${err.message ?? err}`, line);
    }
    return {
      __axisType: "record",
      ok: res.ok,
      status: res.status,
      statusText: res.statusText,
      json: async () => jsonToAxisValue(await res.json()),
      text: async () => await res.text(),
    };
  });

  async function apiRequest(method, args, line) {
    if (args.length < 1 || args.length > 2) throw new AxisRuntimeError(`'api.${method.toLowerCase()}' expects a url and an optional body`, line);
    const [url, body] = args;
    if (typeof url !== "string") throw new AxisRuntimeError(`'api.${method.toLowerCase()}' expects a string url`, line);
    if (typeof globalThis.fetch !== "function") throw new AxisRuntimeError("'api' isn't available in this environment", line);
    let res;
    try {
      res = await globalThis.fetch(url, {
        method,
        headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
        body: body !== undefined ? JSON.stringify(axisValueToJson(body)) : undefined,
      });
    } catch (err) {
      throw new AxisRuntimeError(`'api.${method.toLowerCase()}' failed for '${url}': ${err.message ?? err}`, line);
    }
    const text = await res.text();
    if (!res.ok) {
      const detail = text ? ` - ${text.slice(0, 200)}` : "";
      throw new AxisRuntimeError(`'api.${method.toLowerCase()}' got ${res.status} ${res.statusText} from '${url}'${detail}`, line);
    }
    if (!text) return null;
    try {
      return jsonToAxisValue(JSON.parse(text));
    } catch {
      throw new AxisRuntimeError(`'api.${method.toLowerCase()}' got a non-JSON response from '${url}'`, line);
    }
  }

  env.define(
    "api",
    {
      __axisType: "record",
      get: (args, line) => apiRequest("GET", args, line),
      post: (args, line) => apiRequest("POST", args, line),
      put: (args, line) => apiRequest("PUT", args, line),
      delete: (args, line) => apiRequest("DELETE", args, line),
    },
    true
  );

  return env;
}
