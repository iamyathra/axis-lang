# Reactive structure: `if`/`for` stay live after load, not just their values

Status: **implemented**, for pages (DOM) only. AXIS has had reactive
*values* since early on - a bound property expression gets re-checked and
patched after any handler runs (see [reactive-state.md](reactive-state.md)).
It never had reactive *structure*: the actual set of elements an `if`/`for`
produces was fixed the instant the page was built, in Node, before the
browser ever saw it. This milestone closes that gap - a `state` array
change can now add/remove real DOM elements, and a boolean `state` can now
show/hide a whole conditional section - using the exact same `if`/`for`
grammar every existing example already writes, no new syntax.

```ax
state todos = [{ id: 1, label: "Write the audit" }]

page Home {
    container list {
        for t in todos {
            container ("row" + t.id) {
                text ("label" + t.id) { content: t.label }
                button ("remove" + t.id) { label: "Remove" }
            }
            on ("remove" + t.id).click {
                let target = t.id
                // ...filter todos, reassign it - the list re-renders on its own
            }
        }
    }
}
```

## The gap this closes

Every scene/page graph AXIS builds is interpreted exactly once, in Node, by
`interpreter.js` - `axis run`/`axis build` time. What ships to the browser
(`renderer/domPlan.js`'s output, embedded as `window.__AXIS_PAGE_PLAN__`) is
an already-shaped tree plus a table of `bindings`: non-literal property
expressions `domClient.js#reRender` re-evaluates and patches after any
handler runs. That's genuinely reactive, but only for *values* already
sitting on an already-existing node - an `if`/`for`'s own expansion never
re-ran, so a `state` array could never add or remove elements, and there
was no way to conditionally mount/unmount an arbitrary section (only
`viewport.visible` had a bespoke, narrow escape hatch - see
[conditional-viewport.md](conditional-viewport.md)).

## The design: re-run the same interpreter, not a second one

`interpreter.js` has zero Node-specific code in it (see its own module
comment) - `PageBuilder` can run in the browser exactly as it runs in the
CLI. That's the whole mechanism:

1. **Build time** (`PageBuilder.registerReactiveBlocks`, called from
   `runStatements` for every statement list it processes): every `for`
   loop, and every `if` whose condition isn't a bare literal, gets recorded
   - in document order, as the *statement itself*, verbatim, plus which
   element it's nested inside (`parentName`) - into `reactiveBlocks`. Every
   `for` is flagged, unconditionally, the same "full but cheap re-check, no
   dependency tracking" call the rest of AXIS's reactivity already makes -
   re-running a handful of loop iterations costs nothing, and it means the
   mechanism never has to guess whether something *could* change. An
   `if (true)` is skipped, the same reasoning `isLiteralExpr` already uses
   for property bindings. **Not** registered at all while already inside an
   enclosing `for` loop's own iteration (`this.loopVarStack` non-empty, the
   same stack `captureLoopVariables` reads) - a `for f in faqs { container
   (f.id + "Row") { if (faqOpen == f.id) { ... } } }`'s nested `if`
   references `f`, the *outer* loop's own variable, which only exists
   while that outer iteration is actually running. Registering the nested
   `if` as its own independent block would make the browser try to
   re-evaluate `faqOpen == f.id` against the flat page environment alone,
   where `f` doesn't exist, failing every rebuild pass. It doesn't need
   independent registration anyway: the outer `for` is always registered,
   and its own rebuild already re-derives the nested `if`'s current state
   correctly (with `f` properly bound) as part of the same pass - reconciled
   by node name, not by which block "owns" it, so nothing is lost by not
   tracking it twice. A nested `if`/`for` inside a plain `if` (no enclosing
   loop variable) has no such hazard and is still registered on its own.
2. **domPlan.js** carries `reactiveBlocks` through into the page plan, and
   ships the program's `components` table (name/params/body) alongside it
   - gated to only when a page actually has a reactive block, so a plain
   page pays nothing extra.
3. **domClient.js**, on every `reRender()` pass (i.e. after *any* handler
   runs, anywhere): for each reactive block, builds a throwaway
   `PageBuilder` ("scratch") and re-runs that block's own statement against
   the live `pageEnv` - `interpreter.js` itself is dynamically imported
   only when `plan.reactiveBlocks` is non-empty, mirroring exactly how
   `scene3d.js` is only imported when a page has a `viewport`. This
   produces the same raw interpreter-graph objects build time always
   produces, run through the same `domPlan.js#buildNode` build time uses.

## The diff: by name, not by position

A reactive block's fresh output is matched onto whatever's already
mounted **by each object's own name**, not by array index. AXIS's existing
computed-name convention (`("row" + t.id)`) already makes a node's name a
stable function of the data it came from, so `elementsByName.has(name)`
alone answers "does this already exist" - a name found is patched in
place (adopted, on the very first pass, from whatever the server actually
rendered - no needless recreation of the initial SSR content); a name not
found is created fresh and inserted, then wired for events; a name that
existed last pass but isn't produced this pass is torn down. `blockInstanceNames`
(a `Map<block id, Set<name>>`) is the one piece of state this needs to know
what to remove - a flat name-set diff, deliberately, rather than comparing
per-instance arrays: removing (or inserting) in the *middle* of a `for`
only touches the instance that actually appeared or disappeared, wherever
in the list it is, not everything after that point.

What this doesn't do: **reorder** already-mounted elements to match a
change in the underlying array's own order alone. Sorting a list without
adding or removing anything won't visually re-sort it - a real, current
boundary, not silently broken.

## The other bug this surfaced: handlers couldn't read their own loop variable

Building `examples/reactive-list.ax` immediately hit a second, *pre-existing*
gap this milestone didn't create but did make impossible to ignore: an `on`
handler declared inside a `for` loop couldn't reference that loop's own
variable at all (`undefined variable 't'`) - already documented in the
README ("`on` handlers see the scene/page's top-level variables, not
variables local to a loop"). Without a fix, a loop-generated interactive
list - the entire point of reactive structure - couldn't have a working
per-row "remove this one" button, which makes the feature much less useful.

Fixed with the same idea a `component`'s own params already use: resolved
once, at the point of use, not a live channel. `evaluator.js#execute`'s
`ForStmt` case gained two narrow, optional hooks (`onLoopVarEnter`/
`onLoopVarExit`) so `DeclarativeBuilder` can track exactly which loop
variable(s) are active right now (`this.loopVarStack`); `interpretOnDecl`
uses that stack to run the handler's stored body through
`captureLoopVariables` (a structural mirror of the existing
`renameIdentifiers`, used for component-param renaming) - every reference
to a currently-active loop variable is replaced with a new, internal
`Captured` AST node holding its *value* at that point, which
`evaluator.js#evaluate` simply returns directly. A handler declared outside
any loop is completely unaffected (`loopVarStack` is empty, nothing walks
the body at all). This is a `DeclarativeBuilder`-level fix, not a
reactive-structure-only one - it applies equally to a *non-reactive* loop
(a scene's own `for`, or a page's over a literal array) and to a reactive
block's client-side rebuild alike, both going through the exact same
`interpretOnDecl`.

One consequence worth stating plainly: a captured value is a frozen
snapshot, the same "not a live, reactive channel back to the caller"
tradeoff a component's own params already have. Mutating a captured
record's own field client-side (`t.id = 5`, inside a handler) changes only
that disconnected snapshot, never the original `state` array it came from -
reassign the array itself (`todos = ...`) to actually change anything, the
same pattern every existing reactive-list handler already has to use for
values it does want to write back.

## v1 scope, stated plainly

- **DOM elements and `component` instances only.** A `scene`'s own
  `if`/`for` still only ever builds once - v1 doesn't touch `SceneBuilder`
  at all.
- **A `viewport` inside a reactive block fails that block's rebuild with a
  clear, deduplicated console error**, leaving the DOM exactly as it was
  rather than partially rendering. The client-side scratch `PageBuilder` is
  given no scene declarations - embedding a scene dynamically would need
  shipping scene ASTs and asset info to the browser too, which the
  asset-serving layer doesn't support yet. Declare the `viewport` statically
  and toggle its own `visible` instead.
- **No list reordering** (see above).
- **No dependency tracking**, same as everywhere else in AXIS - every
  reactive block re-runs on every `reRenderAll()`, regardless of whether
  its own governing expression could plausibly have changed.

## What this deliberately does NOT do

- **No virtual DOM.** There's no tree-wide diff, no fiber/reconciler
  abstraction, no keys concept beyond AXIS's own existing unique-name
  requirement. One small, purpose-built reconciliation function, not a
  framework.
- **No new syntax, no new property.** `if`/`for` mean exactly what they
  already meant - this only changes when the browser is allowed to re-run
  them.
- **`visible` was generalized from `viewport`-only to any element** in the
  same milestone (a plain `display: none` toggle - no lifecycle to manage,
  unlike a `viewport`'s), but that's a separate, much smaller addition
  riding alongside this one, not a byproduct of the reconciliation engine
  itself.

## Verification

`tests/reactive-structure.test.js` and `tests/loop-variable-capture.test.js`
cover the build-time contract (which statements get flagged reactive, the
shape shipped through `domPlan.js`, `PageBuilder`'s exported, standalone
behavior, and the `Captured`-node substitution) at the Node level - the
actual DOM add/remove/patch behavior has no Node-testable equivalent (no
`document`, same reasoning every three.js-only behavior in this repo is
browser-verified instead - see viewport-lifecycle.md's header).
`examples/reactive-list.ax` (a todo list: add, remove any item by its own
button, filter by a `state` boolean, and an empty-state `if`) was exercised
end-to-end - served by a real `axis run` dev server, driven through a
from-scratch, hand-rolled DOM shim (no jsdom dependency added) that
actually executes `domClient.js` unmodified and dispatches real click
events - covering: initial hydration adopts the server-rendered content
without recreating it; toggling a filter reveals a previously build-time-only
todo with the correct text; adding an item creates a brand-new, fully
interactive row (its own "remove" button works immediately, proving the
loop-variable capture fix applies to dynamically-created instances too, not
just the initial build); removing an item from the *middle* of the list
removes exactly that row and leaves the others both present and correctly
patched; and clearing every item transitions into (and back out of) the
`if`-guarded empty state correctly.
