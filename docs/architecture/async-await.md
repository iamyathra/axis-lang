# Async/await, try/catch, and fetch/api: AXIS talks to a backend

Status: **implemented**, scoped to runtime (client-side) code only - see
"What this deliberately doesn't do," below, before reaching for it at build
time.

## The shape of the problem

Every existing AXIS execution path - `interpreter.js` building the static
scene/page graph, `domClient.js`/`pageRuntime.js`'s `reRender()` re-checking
a property binding, `scene3d.js`'s own `reRender()` - is a synchronous
tree-walking evaluator (`evaluate`/`execute`/`executeBlock`, evaluator.js).
That's correct for all of them: none of that work can legitimately suspend
(a property binding has to resolve *now*, in the same tick a handler just
ran in, or the whole "re-check every binding, patch what changed" reactivity
model - see reactive-state.md/reactive-structure.md - doesn't hold).

An `on` handler is different. `on button.click { let data = await
api.get("/projects") }` genuinely needs to pause mid-handler for a real
network round trip, then resume and finish mutating `state` once the
response arrives. There's no way to make a JS function "block" for that -
the function has to become `async` and the call has to `await` it, which
means whatever runs an AXIS `on` handler's body needs its own async-capable
execution path.

## The design: two evaluators, not one

Rather than make `evaluate`/`execute` themselves `async function`s (which
would mean every call site - `interpreter.js`'s entire build pipeline, every
`reRender()`, and all 481 tests that call them expecting a plain synchronous
return) has to thread `await` through code that never needs to suspend,
evaluator.js has a second, parallel set of functions: `evaluateAsync`/
`executeAsync`/`executeBlockAsync`/`callFunctionAsync`. They mirror the
synchronous ones statement-for-statement and expression-for-expression, plus
one new case each has that the other doesn't:

- `evaluateAsync` has an `Await` node case (`return evaluateAsync(node.operand, env)` -
  returning a promise from inside an `async function` auto-flattens through
  it, transitively, so this alone is enough to unwrap a native `fetch`'s
  Promise *and* a call into another AXIS `async fn`, with no extra
  bookkeeping).
- The synchronous `evaluate`'s `Call` case has a check the async one
  doesn't need: if a call's result is a thenable, it throws `"this call
  returns a pending value - use 'await'"` rather than letting a `Promise`
  object silently flow into a property value or the scene/page graph.

Two genuinely separate implementations, not one evaluator with an `async`
flag threaded through - deliberately. See evaluator.js's own comment on
`evaluateAsync` for the full reasoning; the short version is that the
synchronous path is unconditionally correct as-is and this keeps it that
way, at the cost of one file having two parallel evaluators to keep in sync
if the core expression grammar ever grows again (worth revisiting if that
becomes a real maintenance burden - it hasn't yet, the sync/async split is
almost entirely mechanical).

**Exactly two call sites reach the async path**: `pageRuntime.js`'s and
`scene3d.js`'s own `runHandler` (an `on` handler is always async-capable,
the same way a DOM event listener can just be `async (e) => {}` with no
special declaration) now `await executeBlockAsync(...)` instead of calling
`executeBlock(...)`. Everything else - build-time graph construction,
every `reRender()`, `animate` block triggering - is completely unchanged
and still 100% synchronous.

## The language surface

```ax
async fn loadProjects() {
    let response = await api.get("/api/projects")
    return response
}

page ProjectBrowser {
    state loading = false
    state error = null
    state projects = []

    on reload.click {
        loading = true
        error = null
        try {
            projects = await loadProjects()
        } catch (err) {
            error = err
        }
        loading = false
    }
}
```

- **`async fn`** - a top-level `fn` with `async` in front. The only thing
  it changes: `await` is legal inside its body, and calling it
  *synchronously* (no `await`, from a non-async context) is a clear
  `AxisRuntimeError` rather than a `Promise` silently becoming a value.
- **`await expr`** - legal inside an `async fn`'s body or (with no `async`
  keyword needed) any `on` handler's body, including a nested `if`/`while`/
  `for` inside either. The parser (`Parser.inAsyncContext`, parser.js)
  enforces this with a clear syntax error anywhere else - including inside
  an `animate { ... }` block written inside an otherwise-async `on`
  handler, since `animate`'s own property values are *always* evaluated by
  the synchronous path (`triggerAnimation`), never the async one, no matter
  what encloses them.
- **`try { ... } catch (err) { ... }`** - general-purpose, not async-only
  (a plain out-of-range array index is just as catchable). `err` is bound,
  inside the `catch` block only, to the failing error's message as a plain
  string. Works in both the synchronous and async executors; doesn't
  swallow a `return` from inside the `try` block.
- **`fetch(url)` / `fetch(url, options)`** - close to the web-standard
  shape: resolves to a record with `ok`/`status`/`statusText` plus two
  native async methods, `json()` and `text()`. `options.method`/`.headers`/
  `.body` (a record auto-JSON-encoded, unless already a string) are
  supported; nothing else (no streaming body, no `AbortController` yet).
- **`api.get(url)` / `.post(url, body)` / `.put(url, body)` / `.delete(url)`** -
  the higher-level convenience the language examples lean on: sends/parses
  JSON directly, throws a clear `AxisRuntimeError` (catchable with
  `try`/`catch`) on a non-2xx response or a body that isn't valid JSON, and
  returns `null` for an empty (e.g. 204) response body.
- **`null`** - added alongside this (see below), because a loading/error
  `state` needs an explicit "nothing yet" sentinel and AXIS had no literal
  for one at all before this.

A fetched/parsed JSON value is converted to AXIS's own value shapes on the
way in (`globals.js`'s `jsonToAxisValue`) - a JSON object becomes a real
AXIS record (`keys(...)`, `.field` access, "did you mean" all work on it
exactly like a literal `{ ... }`), a JSON array stays a plain array. Sending
a record/array back out (`api.post`'s body, `fetch`'s `options.body`) goes
through the inverse (`axisValueToJson`), stripping AXIS's own `__axisType`
tag back out to plain JSON.

## `null`, added as a dependency of this feature

AXIS's runtime already used JS `null` internally in several places (a `fn`
with no `return` evaluates to it, `print(...)` returns it, ...), but there
was no way to *write* one in AXIS source, or compare against one - `state
error = null` and `error != null` both failed with "undefined variable
'null'" before this change, since `null` was just an ordinary, undefined
identifier. Fixed as a small, minimal addition (`Null` AST node, one
`parsePrimary` case alongside `true`/`false`, one `evaluate`/`evaluateAsync`
case returning it) rather than as part of a larger "nullability" feature -
it's exactly the sentinel a loading/error `state` needs and nothing more
(no optional chaining, no null-coalescing operator; add those separately,
on demonstrated need, per the project's own "don't overengineer" rule).

## What this deliberately doesn't do

- **No build-time (SSR) data fetching.** `await` is only legal inside an
  `on` handler or `async fn` body - never at the top level of a `scene`/
  `page`'s own declarative body, which is what `interpreter.js` walks
  synchronously to build the static graph at `axis build`/`axis run` time.
  A page can't `await fetch(...)` once, at build time, to pre-render a list
  server-side; it has to fetch after load, client-side, same as any other
  `on`-handler-driven interaction. This is a real, deliberate scope
  boundary for this milestone, not an oversight - see section 39's "server/
  static rendering" boundary in the milestone brief. Revisit if a
  real page actually needs it.
- **No `AbortController`/cancellation**, no request timeout, no retry, no
  request de-duplication. A component that fires a new fetch on every
  keystroke (a search box) will happily let old and new requests race with
  no built-in "cancel the stale one" - the developer has to guard for that
  themselves (a `state requestId` bumped per request, checked before
  applying the result, is the usual manual pattern) until/unless AXIS grows
  its own primitive for it.
- **No streaming** (`ReadableStream` bodies, Server-Sent Events, WebSockets).
  `fetch`'s `.text()`/`.json()` both buffer the whole response.
- **`err` in a `catch` is always a string** (the failing error's `.message`),
  never a structured value with a `.status`/`.code` a caller could branch
  on. `api.get`'s own error message embeds the status/text
  (`"'api.get' got 404 Not Found from '/x'"`), so it's inspectable, just not
  structured. A `record`-shaped error (matching how `fetch`'s response
  itself is a record) is the natural next step if a real app needs to
  branch on status rather than just display the message.
