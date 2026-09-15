# Embedding: `mount()`, host inputs/events, and the React adapter

Status: **implemented**. AXIS can now build a cinematic, interactive
experience and drop it into an existing HTML page or React application
without adopting AXIS for the whole site - see README.md's quickstart and
docs/language.md's Embedding section for the user-facing API. This doc is
the ownership/design record: what changed, why, and exactly what
`destroy()` guarantees - the same role viewport-lifecycle.md and
reactive-structure.md already play for their own milestones.

## The one fact everything else follows from

`src/renderer/domClient.js` used to be a **module-level imperative
script**: it read `window.__AXIS_PAGE_PLAN__` at import time and queried
`document.querySelectorAll("[data-axis-name]")` - i.e. it assumed it owned
the whole document and ran exactly once per page load. Every mutable piece
of state (`viewportRuntimes`, `elementsByName`, `runningAnimations`, ...)
lived at module scope, which meant there could only ever be one of these
running per page. `scene3d.js`, by contrast, was already a clean factory
(`createSceneRuntime(plan, options)`) - that's the shape the whole
embedding story is built on, not a new one.

**The fix wasn't a new "embedded" runtime - it was finishing the refactor
scene3d.js already modeled.** `domClient.js`'s entire body moved into
`src/renderer/pageRuntime.js`, wrapped in `export async function
createPageRuntime(plan, options)`; every module-level `const`/`let`
became a variable closed over inside that function instead. `domClient.js`
itself is now a 10-line bootstrap:

```js
import { createPageRuntime } from "./pageRuntime.js";
await createPageRuntime(window.__AXIS_PAGE_PLAN__, { container: document });
```

`mount()` (`src/mount.js`, the new public embedding entry point) calls the
exact same `createPageRuntime`, just with a host-supplied `container`
instead of `document`, and `render: true` (see below) since there's no
server-rendered markup to hydrate. **One runtime, two callers** - Rule 3 of
the milestone this shipped under ("there must not become a normal AXIS
runtime and an embedded AXIS runtime with diverging behavior").

## `mount()`: the framework-independent core

```js
import { mount } from "axis-lang";

const instance = await mount(target, source, options);
// instance: { update(inputs), on(name, cb), off(name, cb), destroy() }
```

- **`target`** must be a real, already-in-the-document `Element` - no
  selector strings, no implicit `document.body` fallback (Rule 4: no
  global DOM assumptions). The host resolves its own
  `document.querySelector`.
- **`source`** is **raw `.ax` source text**, not a URL or file path.
  `mount()` does no fetching of its own - the host gets the text however
  its own tooling already does (a bundler's raw-text import, e.g. Vite's
  `?raw` or webpack's `asset/source`; a plain `fetch()`; a Node
  `readFileSync` for a build step). This is the realistic, no-custom-plugin
  path Phase 6 of the milestone asked for: direct `import Hero from
  "./hero.ax"` is **not** implemented, because Node/most bundlers can't do
  that without a real AXIS-specific loader plugin, and faking it would
  violate "don't pretend all React environments can magically import `.ax`
  files." A loader plugin is real, scoped follow-up work - see "Known
  limitations," below.
- The pipeline is `lexer.js -> parser.js -> interpreter.js#interpret() ->
  domPlan.js#buildDomPlan()` - the **exact same** pipeline `axis
  run`/`axis build` (`src/cli.js`) already uses, just invoked later and
  client-side. None of those four files has ever had a Node- or
  browser-specific import (interpreter.js's own module comment says so
  directly), which is what makes running them in a host's browser tab, at
  `mount()` time, correct rather than a second implementation of "what does
  an `.ax` file mean."
- **Exactly one `page`** per source file is the embeddable unit
  (`buildDomPlan` already only ever builds `pages[0]` - a multi-page file
  was never a "build every page" operation even for `axis build`). Zero or
  more than one throws a clear error listing what was actually found.

## Host inputs: reused, not reinvented

**No new grammar.** A `.ax` file's top-level `state`/`let` (the one place
a scene and a page already share a live value - see reactive-state.md) IS
the prop contract:

```ax
state title = "Hello"
state intensity = 0.5

page Hero { ... }
```

```js
await mount(el, source, { inputs: { title: "Embedded!", intensity: 0.8 } });
instance.update({ intensity: 0.2 }); // later, live
```

`createPageRuntime` seeds `options.inputs` onto `scriptEnv` at the exact
point each top-level `state`/`let` is defined, so a host-seeded value is
completely indistinguishable from whatever the source's own build-time
initializer would have been - one reactive system, not two, exactly as the
milestone's "Do not create two competing state systems" rule asked. An
`inputs` key that doesn't match a declared top-level name throws
immediately, with the same allow-list-plus-suggestion shape
`interpreter.js`'s own component-param validation already uses (`'x' isn't
an input this component accepts - try: title, intensity`). `update()`
re-seeds matching names via `Environment.set` - the *exact* assignment
path an ordinary `on` handler's own mutation already goes through - then
calls `reRenderAll()`, so a host-driven update is reactively
indistinguishable from an internal one. This was the deliberate design
choice over adding real `input`/`component` grammar (the milestone brief's
own illustrative syntax) - see the session's plan file for the tradeoff;
the win is zero new parser/interpreter surface for a real, working prop
model.

## Output events: `emit`, a native function value - not new grammar either

`evaluator.js#callFunction` already accepts a plain JS function as a
callable AXIS value (`typeof fn === "function"` - see `globals.js`'s own
`rgb`/`abs`/etc.). `createPageRuntime` defines one such function, `emit`,
on each instance's own `scriptEnv`, scoped to that instance's own
`listeners` registry (a `Map<name, Set<callback>>`) - not a global event
bus:

```ax
on cta.click {
    emit("notify", title)
}
```

```js
instance.on("notify", (payload) => console.log(payload));
```

Defined before the source's own `plan.functions`/`plan.sharedVariables`
are, so a source that tries to name something `emit` itself collides with
it via the same, well-established "already defined" guard redefining any
other `globals.js` builtin already trips - not a new category of
restriction.

## Multi-instance isolation

Every module-level mutable variable `domClient.js` used to have is now
inside `createPageRuntime`'s own closure - two `mount()` calls produce two
completely independent closures, sharing nothing but the pure, stateless
language modules (`evaluator.js`, `globals.js`, ...) both happen to import.
Verified directly (see "Browser verification," below): two instances with
different inputs, independent click handlers/animations, and destroying
one leaves the other's DOM, state, and interactivity completely untouched.

## CSS isolation

**Per-instance class prefix, not Shadow DOM** - Shadow DOM was explicitly
considered and rejected: it would break `scrollRoot`/sticky measurement
against a host ancestor (Phase 7/8's own reasoning) and complicate the
"coexist with the host page" goal for no real gain over a class scope here.

`mount()` generates a short, unique-per-mount class (`axis-<n>-<random>`)
and:

1. Adds it directly to `target` (`container.classList.add(scopeClass)`).
2. Passes it through to `domHtml.js#renderPageFragment`, which prefixes
   every selector in both the responsive `<style>` block
   (`buildResponsiveStyleBlock`'s new `scopePrefix` parameter) and a small
   scoped reset (`scopedResetStyle`: `button`/`a`/`img`/`canvas`, mirroring
   `renderPageHtml`'s own standalone-page reset) with `.axis-<id> `.

This closes a real, concrete bug that would otherwise exist: a plain
`[data-axis-name="title"] { ... }` CSS rule (from a responsive breakpoint)
applies **document-wide**, regardless of where in the DOM the `<style>` tag
is inserted (unlike Shadow DOM, position doesn't scope a `<style>` element)
- so two mounted instances of the same component, both legitimately naming
an element `title`, would otherwise have their responsive rules collide.
Deliberately **not** applied to per-element inline `style="..."`
attributes (the vast majority of AXIS's generated CSS) - those are already
scoped by construction, attached directly to one specific DOM node.
Deliberately **never** touches `html`/`body`/global `*` - `renderPageFragment`
omits `renderPageHtml`'s own `html, body { margin: 0; ... }` rule entirely;
an embedded component has no business setting the host's own body margin.

## Lifecycle: `update` / `on` / `off` / `destroy`

The one contract every caller shares - a plain HTML host, `axis-react`,
and any future framework adapter built on the same boundary.

`destroy()` reuses **existing, already-correct** disposal primitives
rather than inventing a second one:

1. `unmountViewport(name)` for every still-mounted viewport - the exact
   same idempotent, resurrection-proof disposal path
   viewport-lifecycle.md already documents and guarantees (GPU resource
   disposal, listener `AbortController`, `disposed`-flag guards against a
   late-resolving async model load).
2. Aborts this instance's own scroll-listener `AbortController` (new -
   the standalone script used to attach `window`/`scrollRoot` listeners
   unconditionally, for the lifetime of the page; an embedded instance
   needs to be able to remove exactly its own).
3. Sets an instance-level `disposed` flag, checked by `wake()`'s RAF
   callback - a frame already scheduled when `destroy()` runs does nothing
   when it fires, and no further frame is ever requested. Mirrors
   `scene3d.js`'s own single-`disposed`-flag model (viewport-lifecycle.md's
   "one disposed flag, checked at every entry point" - the same minimal,
   two-state design, at one level up).
4. `container.replaceChildren()` (only when this instance built its own
   DOM, i.e. `mount()`'s embedded case - never the standalone bootstrap,
   which hydrates server-rendered content it doesn't unilaterally own) and
   removes the scope class. An event listener attached directly to a
   removed element is not explicitly unhooked - the same reasoning
   `removeReactiveNode` already documented: it becomes unreachable, and its
   listeners with it, the instant nothing references it anymore.

`update(inputs)` and `on`/`off` are described above (Host inputs / Output
events).

## The React adapter (`packages/axis-react`)

A separate package - `axis-lang` (the core) never imports React; `Axis.js`
is the **only** file in this whole story that does (Rule 2/3). It's a thin
lifecycle wrapper, not a second implementation of anything:

```jsx
import { Axis } from "axis-react";
<Axis source={heroSource} title="Hello" intensity={0.8} onNotify={cb} />
```

- Mounts once per distinct `source` **identity** (a `useEffect` keyed on
  `[source]`) - not on every render, and not on every input/handler
  change. Only a genuinely different `source` string tears down and
  rebuilds the underlying AXIS instance.
- Every other prop splits, by a plain adapter-local naming convention
  (never touching the AXIS language itself): `onXxx` (a function) becomes
  an `instance.on("xxx", ...)` subscription; anything else becomes an
  `inputs` key, diffed (`Object.is`, the same check React's own reconciler
  uses) against the previous render and sent through `instance.update()`
  only when something actually changed - "avoid unnecessary AXIS
  remounting on ordinary prop updates."
- Event-handler props are wired once per name, at mount, via a stable
  trampoline that reads the *current* handler through a ref on every call
  - so a new inline arrow function every render is still honored, without
  re-subscribing `instance.on()` on every render. A handler prop name that
  didn't exist at mount time being added later isn't picked up - a
  documented v1 boundary, not silently broken.
- Unmounting the React element (conditionally, or via a parent unmount)
  calls `instance.destroy()` from the effect's own cleanup - verified
  directly (see below).

## Browser verification

No committed Node-level test exercises any of this directly, for the same
reason every other browser-only mechanism in this repository doesn't (see
viewport-lifecycle.md's and accessibility.md's own headers): `mount()`
needs a real `Element`/`document`, and `createPageRuntime` needs
`requestAnimationFrame`/real listeners - there's no Node-testable
equivalent, and this repo deliberately hasn't added a jsdom dependency to
fake one. What Node-level tests *do* cover: `parseAnimateTiming`/timing
validation, the `load`/`error` event grammar, and every other build-time
contract - see `tests/timing-validation.test.js`, `tests/asset-lifecycle.test.js`,
and the existing suite.

Verified instead with a real, locally-launched Chromium (via
`puppeteer-core`, pointed at the system browser - not added as a
dependency of this package, the same "no browser-test infra added to the
repo" boundary the rest of this project already keeps):

- **Standalone regression** (`examples/viewport-lifecycle.ax`, after the
  `domClient.js` -> `pageRuntime.js` extraction): all 3 viewports render,
  raycasting click handling still fires (`B clicks: 0 -> 1`), scrolling
  works, zero console errors.
- **Examples A-D** (`examples/embed-html/`): one component embedded in a
  plain host page; two fully independent instances (destroying one leaves
  the other's state, animation, and click handling untouched); host JS
  driving `instance.update()` live via a text input and a range slider;
  AXIS calling `emit()` and the host receiving it via `instance.on()`.
  Every `mount()` error path (non-Element target, zero-page source,
  multi-page source, unknown input name) verified to throw the intended,
  specific message. Zero page errors across all four.
- **Stress test**: 40 sequential mount/destroy cycles into one container
  (each cycle also clicked the button and called `update()` before
  destroying) - container empty after every single cycle, zero errors. 5
  concurrent instances, destroyed in a scrambled order (not mount order) -
  every container ends up empty, survivors stay interactive between each
  destroy, zero cross-instance contamination. One final `mount()` after
  all 45 prior cycles still works correctly - no accumulated global-state
  corruption. Zero leaked `<canvas>` or `[data-axis-name]` elements
  anywhere in the document afterward.
- **React adapter** (`examples/embed-react/`, a real Vite + React app):
  changing React state flows into AXIS's own reactive bindings (a text
  input driving the embedded heading); AXIS's `emit()` reaches a normal
  React `onNotify` callback and updates React state; unchecking a
  checkbox conditionally unmounts `<Axis/>` and every `[data-axis-name]`
  element is gone; re-checking it cleanly remounts. Zero page errors.

## Known limitations

- **Direct `.ax` bundler imports aren't implemented.** `source` must be
  raw text the host already has (a `?raw`/`asset/source` import, a
  `fetch()`, ...) - see `mount()`'s own note, above. A real Vite/webpack
  loader plugin is scoped, real follow-up work, deliberately not built in
  this pass (Phase 6's own instruction: don't fake what a plugin would
  actually need to do).
- **A `viewport`/3D component's embedding story wasn't hardened for
  arbitrary third-party bundlers in this pass.** `scene3d.js` still imports
  three.js via an absolute `/vendor/three.module.js` path (correct and
  unchanged for AXIS's own dev server / build output, where that path is
  always served) rather than the bare `"three"` specifier a bundler could
  resolve from its own `node_modules`. A `viewport`-bearing `.ax` file
  embedded through `mount()` inside an app *not* using AXIS's own dev
  server additionally needs that host to alias/import-map
  `/vendor/three.module.js` itself today. Fixing this cleanly (switching
  scene3d.js to a bare `"three"` import, and broadening
  `domHtml.js#needsImportMap` to cover any viewport, not just one needing
  an addon) is a well-scoped, real follow-up - not attempted here to avoid
  regression risk to the already-verified standalone 3D path without a
  compensating, fully-verified benefit in the time available. DOM-only
  embedding (the examples above) has no such dependency and is fully
  verified.
- **No reordering, no dependency tracking, no keyed reconciliation** - all
  pre-existing, documented boundaries of reactive-structure.md, unchanged
  by this milestone.
- **`on`/`off` are per-instance, in-memory only** - no persistence, no
  cross-tab bridging; a page reload always starts a fresh instance.
