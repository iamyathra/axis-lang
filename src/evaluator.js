// A tree-walking evaluator for AXIS expressions and statements. This file
// has no Node.js-specific APIs in it on purpose: it's imported by the CLI
// (to build a scene graph) AND served straight to the browser (to run
// `on click { ... }` handlers live). One evaluator, two places it runs.
//
// Scene-only statements (object declarations, animate, on) aren't known
// here at all - the interpreter supplies a `hooks.onCustomStatement`
// callback for those, so this file stays about the general-purpose
// language, not the 3D-scene domain.

import { suggest } from "./suggest.js";

export class AxisRuntimeError extends Error {
  constructor(message, line) {
    super(line ? `${message} (line ${line})` : message);
    this.name = "AxisRuntimeError";
    this.line = line;
  }
}

export class ReturnSignal {
  constructor(value) {
    this.value = value;
  }
}

export class Environment {
  constructor(parent = null) {
    this.vars = new Map();
    this.consts = new Set();
    this.parent = parent;
  }

  child() {
    return new Environment(this);
  }

  define(name, value, constant = false) {
    if (this.vars.has(name)) {
      throw new AxisRuntimeError(`'${name}' is already defined in this scope`);
    }
    this.vars.set(name, value);
    if (constant) this.consts.add(name);
  }

  // Removes a binding declared directly on *this* env (not a parent's) -
  // the one place AXIS ever needs this is domClient.js's reactive-structure
  // reconciliation (a `for`/`if` in a page body that can now add/remove DOM
  // elements live): a dynamically-created element's `LiveElement` binding
  // has to be removable so the same computed name can be `define`d again
  // later (an item removed from a list, then re-added, reusing the same
  // name) without tripping `define`'s own "already defined" guard.
  // Nothing in the language itself, or in build-time interpretation, ever
  // calls this.
  undefine(name) {
    this.vars.delete(name);
    this.consts.delete(name);
  }

  names() {
    const all = [];
    for (let env = this; env; env = env.parent) all.push(...env.vars.keys());
    return all;
  }

  get(name) {
    for (let env = this; env; env = env.parent) {
      if (env.vars.has(name)) return env.vars.get(name);
    }
    throw new AxisRuntimeError(`undefined variable '${name}'${suggest(name, this.names())}`);
  }

  set(name, value) {
    for (let env = this; env; env = env.parent) {
      if (env.vars.has(name)) {
        if (env.consts.has(name)) throw new AxisRuntimeError(`can't assign to '${name}' - it's a const`);
        env.vars.set(name, value);
        return;
      }
    }
    throw new AxisRuntimeError(`undefined variable '${name}'${suggest(name, this.names())}`);
  }
}

// ---- values -------------------------------------------------------------

export function isVector(v) {
  return v !== null && typeof v === "object" && v.__axisType === "vector";
}

export function makeVector(components) {
  if (components.length < 2 || components.length > 4) {
    throw new AxisRuntimeError(`a vector needs 2 to 4 numbers, got ${components.length}`);
  }
  const [x, y, z, w] = components;
  const vec = { __axisType: "vector", dim: components.length, x, y };
  if (components.length >= 3) vec.z = z;
  if (components.length === 4) vec.w = w;
  return vec;
}

function vectorComponents(v) {
  return v.dim === 2 ? [v.x, v.y] : v.dim === 3 ? [v.x, v.y, v.z] : [v.x, v.y, v.z, v.w];
}

export function isCallable(v) {
  return typeof v === "function" || (v && v.__axisType === "function");
}

// A record literal - `{ name: "Earth", radius: 1 }` - is a plain, ordered
// bag of named fields. Tagged the same way a vector is (an `__axisType`
// marker on an otherwise ordinary JS object) so it's distinguishable from
// one at runtime without needing its own wrapper class.
export function isRecord(v) {
  return v !== null && typeof v === "object" && v.__axisType === "record";
}

export function recordFields(v) {
  return Object.keys(v).filter((k) => k !== "__axisType");
}

export function typeName(v) {
  if (v === null || v === undefined) return "null";
  if (isVector(v)) return `Vec${v.dim}`;
  if (isRecord(v)) return "record";
  if (Array.isArray(v)) return "array";
  if (isCallable(v)) return "function";
  return typeof v;
}

export function truthy(v) {
  return !(v === false || v === 0 || v === "" || v === null || v === undefined);
}

export function stringify(v) {
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (v === null || v === undefined) return "null";
  if (isVector(v)) return `(${vectorComponents(v).join(", ")})`;
  if (isRecord(v)) return `{${recordFields(v).map((k) => `${k}: ${stringify(v[k])}`).join(", ")}}`;
  if (Array.isArray(v)) return `[${v.map(stringify).join(", ")}]`;
  if (isCallable(v)) return "<function>";
  return String(v);
}

export function deepEqual(a, b) {
  if (isVector(a) && isVector(b)) {
    return a.dim === b.dim && vectorComponents(a).every((c, i) => c === vectorComponents(b)[i]);
  }
  if (isRecord(a) && isRecord(b)) {
    const keysA = recordFields(a);
    const keysB = recordFields(b);
    return keysA.length === keysB.length && keysA.every((k) => k in b && deepEqual(a[k], b[k]));
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  }
  return a === b;
}

// True if `value` is an AXIS function, or a record/array that contains one
// anywhere inside it (recursively) - the exact shape a "data with
// behavior" record (docs/language.md's "Data with behavior" section) has
// the moment it declares even one method. A function value's `.closure`
// is a real `Environment` class instance, not plain JSON-shaped data - it
// can't survive `JSON.stringify`/`JSON.parse` (the transport a scene/
// page's own top-level `let`/`state` values go through to reach the
// browser, see interpreter.js's `sharedVariables`/`captureVariables`):
// after that round trip, `.closure` degrades to a plain object with the
// same own properties but none of the Environment class's own methods
// (`.child()` included), so the very next access of that method - even
// just reading it, before ever calling it - throws. Interpreter.js uses
// this to detect exactly which top-level bindings need their *initializer
// re-evaluated fresh in the browser* instead of trusting the precomputed
// (and, for one of these, silently broken) value - see its own callers
// for the full account of the bug this exists to route around.
export function containsFunction(value) {
  if (value && value.__axisType === "function") return true;
  if (isRecord(value)) return recordFields(value).some((k) => containsFunction(value[k]));
  if (Array.isArray(value)) return value.some(containsFunction);
  return false;
}

// ---- expressions ----------------------------------------------------------

export function evaluate(node, env) {
  switch (node.kind) {
    case "Number":
      return node.value;
    case "String":
      return node.value;
    case "Boolean":
      return node.value;
    case "Null":
      return null;
    case "Identifier":
      return env.get(node.value);
    // Never produced by the parser - a purely internal node kind
    // interpreter.js substitutes in for a loop variable (or a component
    // param) reference inside a stored handler body, baking in the value
    // it had at the point the handler was declared (see interpreter.js's
    // captureLoopVariables). Evaluates to exactly that value, no env lookup
    // needed - the whole point is that the original binding (a `for`
    // loop's own child env) won't exist anymore by the time this runs.
    case "Captured":
      return node.value;
    // An anonymous function literal - `fn(x) { ... }` - evaluates to a real
    // closure over *this* env, the same value shape interpreter.js builds
    // for a named top-level `fn` (see its own `interpret()`), just captured
    // at the point the expression is evaluated rather than at program
    // start. `name` is only ever read for an error message
    // (callFunction's arity/async checks) - "<anonymous>" beats `null`
    // there.
    case "FnExpr":
      return { __axisType: "function", name: "<anonymous>", params: node.params, body: node.body, closure: env, isAsync: node.isAsync };
    case "Vector":
      return makeVector(
        node.items.map((item) => {
          const v = evaluate(item, env);
          if (typeof v !== "number") throw new AxisRuntimeError(`vector components must be numbers, got ${typeName(v)}`, node.line);
          return v;
        })
      );
    case "Array":
      return node.items.map((item) => evaluate(item, env));
    case "Record": {
      const record = { __axisType: "record" };
      for (const field of node.fields) record[field.key] = evaluate(field.value, env);
      return record;
    }
    case "Unary":
      return evaluateUnary(node, env);
    case "Binary":
      return evaluateBinary(node, env);
    // Only the taken branch is evaluated - same short-circuit rule && and
    // || already follow, and the reason a bare '(expensiveCall())' isn't
    // paid for on the untaken side.
    case "Ternary":
      return truthy(evaluate(node.condition, env)) ? evaluate(node.then, env) : evaluate(node.else, env);
    case "Member": {
      const obj = evaluate(node.object, env);
      return getMember(obj, node.property, node.line);
    }
    case "Index": {
      const obj = evaluate(node.object, env);
      const index = evaluate(node.index, env);
      return getIndex(obj, index, node.line);
    }
    case "Call": {
      const callee = evaluate(node.callee, env);
      const args = node.args.map((a) => evaluate(a, env));
      const result = callFunction(callee, args, node.line);
      // The only way a plain (synchronous) call can legally produce a
      // pending value is a native builtin like fetch/api.* - an AXIS
      // `async fn` is already refused by callFunction below before this
      // point is ever reached. Either way, seeing one here means it was
      // called without 'await' from somewhere that can't suspend (a
      // property binding, a non-async fn, ...) - a clear error beats a
      // Promise silently flowing into the scene/page graph as a value.
      if (result && typeof result.then === "function") {
        throw new AxisRuntimeError(
          "this call returns a pending value - use 'await', inside an 'on' handler or an 'async fn'",
          node.line
        );
      }
      return result;
    }
    default:
      throw new AxisRuntimeError(`don't know how to evaluate '${node.kind}'`, node.line);
  }
}

function evaluateUnary(node, env) {
  const value = evaluate(node.operand, env);
  if (node.op === "-") {
    if (typeof value === "number") return -value;
    if (isVector(value)) return makeVector(vectorComponents(value).map((c) => -c));
    throw new AxisRuntimeError(`can't negate a ${typeName(value)}`, node.line);
  }
  if (node.op === "!") return !truthy(value);
  throw new AxisRuntimeError(`unknown unary operator '${node.op}'`, node.line);
}

function evaluateBinary(node, env) {
  if (node.op === "&&") {
    const left = evaluate(node.left, env);
    return truthy(left) ? evaluate(node.right, env) : left;
  }
  if (node.op === "||") {
    const left = evaluate(node.left, env);
    return truthy(left) ? left : evaluate(node.right, env);
  }

  const left = evaluate(node.left, env);
  const right = evaluate(node.right, env);
  const line = node.line;

  switch (node.op) {
    case "+":
      if (typeof left === "string" || typeof right === "string") return stringify(left) + stringify(right);
      if (isVector(left) && isVector(right)) return vectorZip(left, right, (a, b) => a + b, line);
      if (Array.isArray(left) && Array.isArray(right)) return [...left, ...right];
      if (typeof left === "number" && typeof right === "number") return left + right;
      throw new AxisRuntimeError(`can't add a ${typeName(left)} and a ${typeName(right)}`, line);
    case "-":
      if (isVector(left) && isVector(right)) return vectorZip(left, right, (a, b) => a - b, line);
      if (typeof left === "number" && typeof right === "number") return left - right;
      throw new AxisRuntimeError(`can't subtract a ${typeName(right)} from a ${typeName(left)}`, line);
    case "*":
      if (typeof left === "number" && typeof right === "number") return left * right;
      if (isVector(left) && typeof right === "number") return makeVector(vectorComponents(left).map((c) => c * right));
      if (typeof left === "number" && isVector(right)) return makeVector(vectorComponents(right).map((c) => c * left));
      throw new AxisRuntimeError(`can't multiply a ${typeName(left)} and a ${typeName(right)}`, line);
    case "/":
      if (typeof left === "number" && typeof right === "number") return left / right;
      if (isVector(left) && typeof right === "number") return makeVector(vectorComponents(left).map((c) => c / right));
      throw new AxisRuntimeError(`can't divide a ${typeName(left)} by a ${typeName(right)}`, line);
    case "%":
      if (typeof left === "number" && typeof right === "number") return left % right;
      throw new AxisRuntimeError(`'%' needs two numbers, got a ${typeName(left)} and a ${typeName(right)}`, line);
    case "==":
      return deepEqual(left, right);
    case "!=":
      return !deepEqual(left, right);
    case "<":
    case "<=":
    case ">":
    case ">=":
      if (typeof left !== "number" || typeof right !== "number") {
        throw new AxisRuntimeError(`'${node.op}' needs two numbers, got a ${typeName(left)} and a ${typeName(right)}`, line);
      }
      if (node.op === "<") return left < right;
      if (node.op === "<=") return left <= right;
      if (node.op === ">") return left > right;
      return left >= right;
    default:
      throw new AxisRuntimeError(`unknown operator '${node.op}'`, line);
  }
}

function vectorZip(a, b, fn, line) {
  if (a.dim !== b.dim) throw new AxisRuntimeError(`can't combine a Vec${a.dim} and a Vec${b.dim}`, line);
  return makeVector(vectorComponents(a).map((v, i) => fn(v, vectorComponents(b)[i])));
}

function getMember(obj, prop, line) {
  if (obj === null || typeof obj !== "object") {
    throw new AxisRuntimeError(`can't read '.${prop}' on a ${typeName(obj)}`, line);
  }
  if (isVector(obj) && !(prop in obj)) {
    throw new AxisRuntimeError(`Vec${obj.dim} doesn't have a '.${prop}' component`, line);
  }
  if (isRecord(obj) && !(prop in obj)) {
    throw new AxisRuntimeError(`record doesn't have a '.${prop}' field${suggest(prop, recordFields(obj))}`, line);
  }
  if (!(prop in obj)) {
    throw new AxisRuntimeError(`no property '${prop}' on this value`, line);
  }
  const value = obj[prop];
  // A function stored in a record field, read off that record - bind
  // 'self' to the record right here, at access time, not at call time.
  // That's what lets a detached reference (`let f = thing.method; f()`)
  // keep working correctly, the way JavaScript's own `this` famously
  // doesn't: `self` is baked into a fresh child of the function's own
  // closure the moment `.method` is read, not resolved dynamically from
  // wherever the call happens to come from later. Re-binds on every read
  // (cheap - one child Environment), so `merge(a, b).method()` correctly
  // sees the merged record as `self`, not whichever record originally
  // defined the field. Only AXIS-defined functions have a `.closure` to
  // extend this way - a native builtin (e.g. a record like `api`'s own
  // `get`/`post`) is returned as-is, unaffected. See docs/language.md's
  // "Data with behavior" section.
  if (isRecord(obj) && value && value.__axisType === "function") {
    const boundEnv = value.closure.child();
    boundEnv.define("self", obj, true);
    return { ...value, closure: boundEnv };
  }
  return value;
}

function getIndex(obj, index, line) {
  if (Array.isArray(obj)) {
    if (typeof index !== "number" || !Number.isInteger(index)) {
      throw new AxisRuntimeError(`array indices must be whole numbers, got ${typeName(index)}`, line);
    }
    if (index < 0 || index >= obj.length) {
      throw new AxisRuntimeError(`index ${index} is out of range for an array of length ${obj.length}`, line);
    }
    return obj[index];
  }
  if (typeof obj === "string") return obj[index];
  throw new AxisRuntimeError(`can't index into a ${typeName(obj)}`, line);
}

function setMember(obj, prop, value, line) {
  if (obj === null || typeof obj !== "object") {
    throw new AxisRuntimeError(`can't set '.${prop}' on a ${typeName(obj)}`, line);
  }
  obj[prop] = value;
}

function setIndex(obj, index, value, line) {
  if (!Array.isArray(obj)) throw new AxisRuntimeError(`can't index-assign into a ${typeName(obj)}`, line);
  obj[index] = value;
}

export function callFunction(fn, args, line) {
  if (typeof fn === "function") return fn(args, line);

  if (fn && fn.__axisType === "function") {
    // An `async fn`'s body may contain `await`, which the synchronous
    // executor below has no case for - rather than let that fail deep
    // inside the call with a confusing "don't know how to evaluate
    // 'Await'", refuse the call itself, right here, with a message that
    // says what to do instead. Calling it correctly (callFunctionAsync,
    // reached via an `Await` node) never hits this branch.
    if (fn.isAsync) {
      throw new AxisRuntimeError(
        `'${fn.name}' is an async function - call it with 'await', inside an 'on' handler or another async function`,
        line
      );
    }
    if (args.length !== fn.params.length) {
      throw new AxisRuntimeError(
        `'${fn.name}' expects ${fn.params.length} argument(s), got ${args.length}`,
        line
      );
    }
    const localEnv = fn.closure.child();
    fn.params.forEach((param, i) => localEnv.define(param, args[i]));
    try {
      executeBlock(fn.body, localEnv);
      return null;
    } catch (e) {
      if (e instanceof ReturnSignal) return e.value;
      throw e;
    }
  }

  throw new AxisRuntimeError(`a ${typeName(fn)} isn't callable`, line);
}

// ---- animate blocks ---------------------------------------------------
// `animate target { ... }` shows up in two different contexts (a top-level
// scene/page declaration that plays on load, baked into a render plan by
// interpreter.js; or a statement inside an `on` handler that plays the
// moment it runs, interpreted live by client.js/domClient.js) but the
// `duration`/`delay`/`repeat`/`easing` entries mean exactly the same thing
// either way. `literalUnit` and `parseAnimateTiming` live here, rather than
// in the (Node-only) interpreter or the (browser-only) renderer clients, so
// both the build-time and the live-trigger path read that shared grammar
// with a single implementation.

export function literalUnit(exprNode) {
  return exprNode.kind === "Number" ? exprNode.unit : null;
}

// A triggered `animate (expr) { ... }`'s computed target (parser.js's
// parseTarget) is resolved live here, against the handler's own
// environment - mirrors interpreter.js's DeclarativeBuilder.resolveTarget,
// which does the same thing for the build-time (plays-on-load) path.
export function resolveAnimateTarget(decl, env) {
  if (!decl.targetIsExpr) return decl.target;
  const value = evaluate(decl.target, env);
  if (typeof value !== "string") {
    throw new AxisRuntimeError(`a computed 'animate' target must evaluate to a string, got a ${typeName(value)}`, decl.line);
  }
  return value;
}

// Kept in sync with globals.js's own EASING_NAMES by hand, not by import -
// globals.js depends on this file (Environment/AxisRuntimeError/etc., see
// its own header comment), so importing back here would be circular. See
// the note on globals.js's EASING_NAMES for the full picture (and
// src/renderer/easing.js for where the actual curve math lives).
const EASING_NAMES = new Set([
  "linear", "easeIn", "easeOut", "easeInOut",
  "easeInCubic", "easeOutCubic", "easeInOutCubic",
  "easeInBack", "easeOutBack", "easeInOutBack",
  "easeOutBounce",
]);

// Pulls the timing entries (duration/delay/repeat/easing) out of an
// AnimateDecl's `entries` list and evaluates them, leaving every other
// entry - the actual property changes, e.g. `scale.x -> 1.5` - untouched in
// `rest` for the caller to interpret (a scene's position/rotation/scale
// axes and a page's opacity/position.x/position.y/scale/rotation aren't the
// same vocabulary, so that part isn't shared).
export function parseAnimateTiming(decl, env) {
  const timing = { duration: null, delay: 0, repeat: 1, easing: "linear" };
  const rest = [];

  for (const entry of decl.entries) {
    if (entry.kind === "AnimateTarget") {
      rest.push(entry);
      continue;
    }
    const key = entry.path.join(".");
    if (key === "duration" || key === "delay") {
      const value = evaluate(entry.value, env);
      if (typeof value !== "number") throw new AxisRuntimeError(`'${key}' needs a number`, entry.value.line);
      const ms = literalUnit(entry.value) === "s" ? value * 1000 : value;
      // NaN/Infinity would poison the tween runtime (tween.js does pure
      // arithmetic on these, no other validation layer) - a permanently
      // "in progress" or NaN-progress animation, or a render loop that
      // never settles. A negative value has no sensible meaning for either
      // (unlike a timeline step's own 'at', which legitimately overlaps
      // backward - see tween-extraction.md) so both are rejected the same
      // way, at the one place both the build-time and live-trigger paths
      // already funnel through.
      if (!Number.isFinite(ms) || ms < 0) {
        throw new AxisRuntimeError(`'${key}' must be a finite, non-negative number, got ${value}`, entry.value.line);
      }
      timing[key] = ms;
    } else if (key === "repeat") {
      const value = evaluate(entry.value, env);
      if (value === Infinity) {
        timing.repeat = Infinity;
      } else if (typeof value === "number" && Number.isInteger(value) && value > 0) {
        timing.repeat = value;
      } else {
        throw new AxisRuntimeError("'repeat' must be a positive whole number or 'infinite'", entry.value.line);
      }
    } else if (key === "easing") {
      const value = evaluate(entry.value, env);
      if (!EASING_NAMES.has(value)) {
        throw new AxisRuntimeError(
          `unknown easing '${value}'${suggest(value, [...EASING_NAMES])} - try linear, easeInOut, easeInOutCubic, easeOutBack, or easeOutBounce`,
          entry.value.line
        );
      }
      timing.easing = value;
    } else {
      rest.push(entry); // not a timing key - the caller decides if it's a valid property path or an error
    }
  }

  if (timing.duration === null) {
    throw new AxisRuntimeError(`animate block for '${decl.target}' is missing 'duration'`, decl.line);
  }
  return { ...timing, rest };
}

// ---- statements -----------------------------------------------------------

export function execute(stmt, env, hooks = {}) {
  switch (stmt.kind) {
    case "LetDecl": {
      const value = evaluate(stmt.value, env);
      env.define(stmt.name, value, stmt.constant);
      return;
    }
    case "Assignment": {
      const value = evaluate(stmt.value, env);
      assignTo(stmt.target, value, env, stmt.line);
      return;
    }
    case "IfStmt": {
      if (truthy(evaluate(stmt.condition, env))) {
        executeBlock(stmt.then, env.child(), hooks);
      } else if (stmt.else) {
        executeBlock(stmt.else, env.child(), hooks);
      }
      return;
    }
    case "WhileStmt": {
      let iterations = 0;
      while (truthy(evaluate(stmt.condition, env))) {
        executeBlock(stmt.body, env.child(), hooks);
        if (++iterations > 1_000_000) {
          throw new AxisRuntimeError("a 'while' loop ran for over a million iterations - probably infinite", stmt.line);
        }
      }
      return;
    }
    case "ForStmt": {
      const iterable = evaluate(stmt.iterable, env);
      if (!Array.isArray(iterable)) {
        throw new AxisRuntimeError(`'for..in' needs an array, got a ${typeName(iterable)} (try 'range(a, b)')`, stmt.line);
      }
      for (const item of iterable) {
        const childEnv = env.child();
        childEnv.define(stmt.varName, item);
        // Optional, narrow bookkeeping hooks - interpreter.js uses these to
        // know which name/value is the *current* loop variable while an
        // `on` handler is being declared inside this iteration, so that
        // handler's body can capture it (see interpreter.js's
        // captureLoopVariables) the same way a component's own params
        // already get captured by value. Nothing about plain execution
        // changes when these are absent - a no-op for every other caller.
        hooks.onLoopVarEnter?.(stmt.varName, item);
        executeBlock(stmt.body, childEnv, hooks);
        hooks.onLoopVarExit?.(stmt.varName);
      }
      return;
    }
    case "ReturnStmt":
      throw new ReturnSignal(stmt.value ? evaluate(stmt.value, env) : null);
    case "ExprStmt":
      evaluate(stmt.expr, env);
      return;
    case "TryStmt": {
      try {
        executeBlock(stmt.tryBlock, env.child(), hooks);
      } catch (e) {
        if (e instanceof ReturnSignal) throw e;
        const catchEnv = env.child();
        catchEnv.define(stmt.errName, e instanceof AxisRuntimeError ? e.message : String(e?.message ?? e));
        executeBlock(stmt.catchBlock, catchEnv, hooks);
      }
      return;
    }
    default:
      if (hooks.onCustomStatement) {
        hooks.onCustomStatement(stmt, env);
        return;
      }
      if (stmt.kind === "AnimateDecl") {
        throw new AxisRuntimeError(
          `'animate' only works at the top level of a scene/page (or inside a group/container), or as a trigger inside an 'on' handler - not here`,
          stmt.line
        );
      }
      throw new AxisRuntimeError(`'${stmt.kind}' can't be used here`, stmt.line);
  }
}

export function executeBlock(statements, env, hooks = {}) {
  for (const stmt of statements) execute(stmt, env, hooks);
}

function assignTo(target, value, env, line) {
  if (target.kind === "Identifier") {
    env.set(target.value, value);
    return;
  }
  if (target.kind === "Member") {
    const obj = evaluate(target.object, env);
    setMember(obj, target.property, value, line);
    return;
  }
  if (target.kind === "Index") {
    const obj = evaluate(target.object, env);
    const index = evaluate(target.index, env);
    setIndex(obj, index, value, line);
    return;
  }
  throw new AxisRuntimeError("invalid assignment target", line);
}

// ---- async execution ------------------------------------------------------
// A parallel, `await`-aware mirror of evaluate/execute/executeBlock/
// callFunction, above. Deliberately a *separate* set of functions rather
// than one evaluator that's always async: the synchronous one keeps running
// everywhere it already did (build-time scene/page graph construction in
// interpreter.js, and every live property-binding re-check in
// domClient.js/pageRuntime.js/scene3d.js's reRender()) with zero behavior
// change and zero new cost - none of that ever needs to suspend, and making
// it all async would mean threading `await` through the entire build
// pipeline (and every one of the 481 tests that call it) for a capability
// only two call sites actually need. This mirror is reached from exactly
// two places: pageRuntime.js/scene3d.js's runHandler (an `on` handler is
// itself always async-capable) and, transitively, callFunctionAsync's own
// call into an `async fn`'s body. The parser (`inAsyncContext`) is what
// keeps an `Await` node from ever reaching the synchronous evaluator in the
// first place. See docs/architecture/async-await.md.

export async function evaluateAsync(node, env) {
  switch (node.kind) {
    case "Number":
    case "String":
    case "Boolean":
    case "Null":
    case "Captured":
    case "Identifier":
    case "FnExpr":
      return evaluate(node, env); // leaf nodes - no sub-expression to await
    case "Vector": {
      const items = [];
      for (const item of node.items) {
        const v = await evaluateAsync(item, env);
        if (typeof v !== "number") throw new AxisRuntimeError(`vector components must be numbers, got ${typeName(v)}`, node.line);
        items.push(v);
      }
      return makeVector(items);
    }
    case "Array": {
      const items = [];
      for (const item of node.items) items.push(await evaluateAsync(item, env));
      return items;
    }
    case "Record": {
      const record = { __axisType: "record" };
      for (const field of node.fields) record[field.key] = await evaluateAsync(field.value, env);
      return record;
    }
    case "Unary": {
      const value = await evaluateAsync(node.operand, env);
      if (node.op === "-") {
        if (typeof value === "number") return -value;
        if (isVector(value)) return makeVector(vectorComponents(value).map((c) => -c));
        throw new AxisRuntimeError(`can't negate a ${typeName(value)}`, node.line);
      }
      if (node.op === "!") return !truthy(value);
      throw new AxisRuntimeError(`unknown unary operator '${node.op}'`, node.line);
    }
    case "Ternary": {
      const condition = await evaluateAsync(node.condition, env);
      return truthy(condition) ? await evaluateAsync(node.then, env) : await evaluateAsync(node.else, env);
    }
    case "Binary": {
      if (node.op === "&&") {
        const left = await evaluateAsync(node.left, env);
        return truthy(left) ? await evaluateAsync(node.right, env) : left;
      }
      if (node.op === "||") {
        const left = await evaluateAsync(node.left, env);
        return truthy(left) ? left : await evaluateAsync(node.right, env);
      }
      const left = await evaluateAsync(node.left, env);
      const right = await evaluateAsync(node.right, env);
      // Reuses the synchronous evaluator's own binary-op arithmetic by
      // replaying it against already-resolved operands (evaluateBinary
      // itself re-evaluates node.left/node.right, so it can't be called
      // directly here) - a synthetic node built from Captured leaves,
      // rather than a second copy of the +/-/*/.../== switch.
      return evaluateBinary(
        { ...node, left: { kind: "Captured", value: left }, right: { kind: "Captured", value: right } },
        env
      );
    }
    case "Member": {
      const obj = await evaluateAsync(node.object, env);
      return getMember(obj, node.property, node.line);
    }
    case "Index": {
      const obj = await evaluateAsync(node.object, env);
      const index = await evaluateAsync(node.index, env);
      return getIndex(obj, index, node.line);
    }
    case "Call": {
      const callee = await evaluateAsync(node.callee, env);
      const args = [];
      for (const a of node.args) args.push(await evaluateAsync(a, env));
      return callFunctionAsync(callee, args, node.line);
    }
    case "Await":
      return evaluateAsync(node.operand, env);
    default:
      throw new AxisRuntimeError(`don't know how to evaluate '${node.kind}'`, node.line);
  }
}

export async function callFunctionAsync(fn, args, line) {
  if (typeof fn === "function") return fn(args, line);

  if (fn && fn.__axisType === "function") {
    if (args.length !== fn.params.length) {
      throw new AxisRuntimeError(`'${fn.name}' expects ${fn.params.length} argument(s), got ${args.length}`, line);
    }
    const localEnv = fn.closure.child();
    fn.params.forEach((param, i) => localEnv.define(param, args[i]));
    try {
      await executeBlockAsync(fn.body, localEnv);
      return null;
    } catch (e) {
      if (e instanceof ReturnSignal) return e.value;
      throw e;
    }
  }

  throw new AxisRuntimeError(`a ${typeName(fn)} isn't callable`, line);
}

export async function executeAsync(stmt, env, hooks = {}) {
  switch (stmt.kind) {
    case "LetDecl": {
      const value = await evaluateAsync(stmt.value, env);
      env.define(stmt.name, value, stmt.constant);
      return;
    }
    case "Assignment": {
      const value = await evaluateAsync(stmt.value, env);
      await assignToAsync(stmt.target, value, env, stmt.line);
      return;
    }
    case "IfStmt": {
      if (truthy(await evaluateAsync(stmt.condition, env))) {
        await executeBlockAsync(stmt.then, env.child(), hooks);
      } else if (stmt.else) {
        await executeBlockAsync(stmt.else, env.child(), hooks);
      }
      return;
    }
    case "WhileStmt": {
      let iterations = 0;
      while (truthy(await evaluateAsync(stmt.condition, env))) {
        await executeBlockAsync(stmt.body, env.child(), hooks);
        if (++iterations > 1_000_000) {
          throw new AxisRuntimeError("a 'while' loop ran for over a million iterations - probably infinite", stmt.line);
        }
      }
      return;
    }
    case "ForStmt": {
      const iterable = await evaluateAsync(stmt.iterable, env);
      if (!Array.isArray(iterable)) {
        throw new AxisRuntimeError(`'for..in' needs an array, got a ${typeName(iterable)} (try 'range(a, b)')`, stmt.line);
      }
      for (const item of iterable) {
        const childEnv = env.child();
        childEnv.define(stmt.varName, item);
        hooks.onLoopVarEnter?.(stmt.varName, item);
        await executeBlockAsync(stmt.body, childEnv, hooks);
        hooks.onLoopVarExit?.(stmt.varName);
      }
      return;
    }
    case "ReturnStmt":
      throw new ReturnSignal(stmt.value ? await evaluateAsync(stmt.value, env) : null);
    case "ExprStmt":
      await evaluateAsync(stmt.expr, env);
      return;
    case "TryStmt": {
      try {
        await executeBlockAsync(stmt.tryBlock, env.child(), hooks);
      } catch (e) {
        if (e instanceof ReturnSignal) throw e;
        const catchEnv = env.child();
        catchEnv.define(stmt.errName, e instanceof AxisRuntimeError ? e.message : String(e?.message ?? e));
        await executeBlockAsync(stmt.catchBlock, catchEnv, hooks);
      }
      return;
    }
    default:
      if (hooks.onCustomStatement) {
        hooks.onCustomStatement(stmt, env);
        return;
      }
      if (stmt.kind === "AnimateDecl") {
        throw new AxisRuntimeError(
          `'animate' only works at the top level of a scene/page (or inside a group/container), or as a trigger inside an 'on' handler - not here`,
          stmt.line
        );
      }
      throw new AxisRuntimeError(`'${stmt.kind}' can't be used here`, stmt.line);
  }
}

export async function executeBlockAsync(statements, env, hooks = {}) {
  for (const stmt of statements) await executeAsync(stmt, env, hooks);
}

async function assignToAsync(target, value, env, line) {
  if (target.kind === "Identifier") {
    env.set(target.value, value);
    return;
  }
  if (target.kind === "Member") {
    const obj = await evaluateAsync(target.object, env);
    setMember(obj, target.property, value, line);
    return;
  }
  if (target.kind === "Index") {
    const obj = await evaluateAsync(target.object, env);
    const index = await evaluateAsync(target.index, env);
    setIndex(obj, index, value, line);
    return;
  }
  throw new AxisRuntimeError("invalid assignment target", line);
}
