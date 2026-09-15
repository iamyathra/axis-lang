# AXIS runtime extensions

This document is the contract for AXIS's **runtime extension** mechanism -
how a third-party package can register a genuinely new *runtime*
capability (not just compose existing `.ax` primitives - see
[docs/extensions.md](extensions.md) for that, ordinary "Level 1" package
extensibility) without a change to AXIS's own source. It's the honest,
precise answer to the milestone that built it: **can AXIS expose a
generic, controlled extension boundary so new runtime capabilities can be
added without package-specific modifications to AXIS's compiler,
interpreter, or runtime?**

The short answer: **yes, for exactly one capability category** - a new,
live-settable 3D scalar property. Every other kind of runtime capability
(a new `on` event, a new renderer feature, a new browser-native handle) is
still core-only. This document says so plainly, in "What still requires
core changes," below - it does not overclaim.

See [docs/architecture/2026-09-language-platform-audit.md](architecture/2026-09-language-platform-audit.md)'s
Runtime Extension Architecture addendum for the full method (the audit
performed before writing anything, the core-freeze checkpoint, and the
proof that followed it).

## What a runtime extension is

An ordinary AXIS package (see [docs/extensions.md](extensions.md)) whose
`axis_modules/<name>/axis.json` also declares a `runtimeExtension` field:

```json
{
  "name": "axis-wireframe",
  "version": "0.1.0",
  "main": "index.ax",
  "runtimeExtension": "extension.js"
}
```

`runtimeExtension` names a JavaScript file, relative to the package's own
directory (same validation as `main`: must stay inside the package
directory, no `../` or absolute-path escape). Unlike `main`, Node itself
never reads or executes this file - `src/modules.js` only records where it
is; the browser is the only thing that ever runs it. A package with no
`runtimeExtension` is an ordinary, pure-`.ax` package, exactly as before
this field existed - this is purely additive.

## How extensions load

1. Some `.ax` file `import`s a name from the extension-carrying package,
   exactly like any other package (see "A package only activates if
   `.ax` source imports it," below - there is no side-channel "just
   install this" mechanism).
2. `resolveModules` (`src/modules.js`) records the package's own
   `runtimeExtension` path (deduplicated by package directory) onto the
   resolved `Program`, as `.extensions` - `[{name, jsFile}]`.
3. `interpret()` passes it through to its own result; `buildRenderPlan`/
   `buildDomPlan`/`buildDomRouterPlan` (`src/renderer/plan.js`/
   `domPlan.js`) pass it through again, onto the render plan.
4. `html.js`/`domHtml.js` emit one `<script type="module"
   src="/extensions/<name>.js"></script>` tag per extension, **before**
   the client bootstrap script (`/client.js` or `/domClient.js`).
5. `server.js`/`domServer.js` serve that URL from the extension's real
   file on disk (dev server), or `writeStaticSite`/`writeDomStaticSite`
   copy it to the same relative path (`axis build`).
6. The extension's own script imports `registerScalarProperty` from
   `/extensionRegistry.js` (also served unconditionally, since
   `scene3d.js` always imports it) and calls it at its own top level.

**Why the script tag ordering matters, concretely**: non-`async` `<script
type="module">` elements execute in document order. Placing every
extension's tag before the client bootstrap script is what actually
guarantees an extension's own top-level `registerScalarProperty(...)` call
has already run by the time `scene3d.js` needs to know about it - not an
implementation detail, the one thing this ordering exists to guarantee.
`scene3d.js` itself defers building `LiveObject`'s per-property
getters/setters from this module-top-level evaluation (too early - it can
race an extension's own script, if `scene3d.js`'s own module happened to
be evaluated as part of an *earlier* script's dependency graph) to a
guarded, idempotent call inside `createSceneRuntime` - the async function
client.js/domClient.js call, always after every earlier sibling script has
finished.

## Registration API

The entire public surface, `src/renderer/extensionRegistry.js`:

```js
import { registerScalarProperty } from "/extensionRegistry.js";

registerScalarProperty("wireframe", {
  valueType: "boolean",   // "number" (default), "boolean", or "color"
  animatable: false,      // default false
  get(obj3d) {
    // obj3d: the real three.js Object3D/Mesh this property applies to.
    // Return `undefined` if it doesn't apply to this particular object -
    // the same convention every built-in scalar property already follows.
  },
  set(obj3d, value) {
    // Mutate the real three.js object.
  },
});
```

That's the whole API - no `registerEvent`, `registerHandle`, or
`registerSystem` exists (see "What still requires core changes," below).
A registered property is looked up through **exactly the same** dispatch
every built-in scalar property (`color`, `intensity`, `castShadow`, ...)
already shares - `LiveObject`'s own accessors, `applyChange`,
`currentLiveValue`, `triggerAnimation` - not a second, parallel path. This
matters for the milestone's own thesis: a registered property isn't a
special case bolted on beside the real mechanism, it *is* the real
mechanism, extended.

`obj3d` is deliberately the only thing an extension's `get`/`set`
receives - not the scene, the renderer, or the interpreter. See "What
extensions can access," below, for exactly what that does and doesn't
give an extension access to.

### Registration errors

- An empty/non-string name, a missing `get`/`set`, or an invalid
  `valueType` throws immediately, synchronously, at the call site - a
  typo in an extension's own script fails loudly during page load, not
  silently or deep inside a later `on` handler.
- Registering the same name twice (two extensions, or the same one twice)
  throws `registerScalarProperty('name'): already registered` - no
  silent last-write-wins.

## Where a registered property can actually be used

This is the most important precise boundary this document states.
**Currently supported** (both purely client-side, going through the
registry above):

- A direct `on`-handler assignment: `on box.click { box.wireframe = true }`.
- An `on`-handler-triggered `animate` (arrow syntax, matching every other
  triggered `animate`'s own grammar - see
  [docs/language.md](language.md)'s Animation section):
  `on box.click { animate box { wireframeLinewidth -> 6  duration: 0.3 } }`.

**Not yet supported**, and precisely why:

- **An object's own literal declaration** - `cube box { wireframe: true
  }` still fails with an "unknown property" error. This path is validated
  build-time, in Node, against `SCENE_ALLOWED_PROPS` -
  `src/interpreter.js`'s own separate, still-hardcoded per-object-type
  allowlist. Nothing in this milestone touches it (a deliberate scope
  decision, not an oversight - see "Why this scope, specifically," below).
- **A top-level, unconditional `animate` block** (one that plays on scene
  load, not triggered from an `on` handler) - also validated build-time,
  in Node, via `src/renderer/plan.js`'s `buildChange`, a third,
  independent hardcoded path this milestone also does not touch.

Both of these are Node-side, build-time validation paths with no way to
consult a browser-only JavaScript registry (there is nothing to consult -
the extension's own script hasn't run yet; it doesn't exist until a real
browser loads it). Making either of these extension-aware would need
Node-side package metadata declaring the property's *name* and which
object types accept it (parseable from `axis.json` without ever running
the extension's own JS) - a real, larger piece of infrastructure, not
attempted here. Reported honestly as a scope boundary, not silently
worked around.

## What extensions can access

Whatever `get(obj3d)`/`set(obj3d, value)` are handed: the specific,
real three.js `Object3D`/`Mesh` instance a property was invoked on -
nothing else. This is deliberately narrow (see the milestone's own "give
extensions capabilities, not the whole engine" instruction): an extension
cannot reach the scene graph, the renderer, other objects, or AXIS's own
interpreter/evaluator internals through this API. Anything an extension
wants to do with `obj3d` it does through three.js's own *public* API
(`obj3d.material`, `obj3d.position`, ...) - the same API any three.js
application would use, not an AXIS-specific one.

## Private API firewall

A runtime extension's own script must not import anything from AXIS's own
private implementation (`/scene3d.js`, `/evaluator.js`'s internals beyond
what a `.ax` package already uses, etc.) beyond the one public module this
whole mechanism is built on, `/extensionRegistry.js`. Concretely: neither
of this milestone's two example extensions
(`examples/runtime-extension-demo/axis_modules/{axis-wireframe,axis-line-width}/extension.js`)
imports anything but `/extensionRegistry.js` - each writes its own small
`materialsOf(obj3d)` helper (three.js's own `.material` can be a single
`Material` or an array, for multi-material geometry) rather than reusing
`scene3d.js`'s private `collectMaterials`, which it has no way to import
anyway. This is a real, deliberate illustration of the boundary, not an
accident: an extension that *needed* something private would be a sign
the public API is missing something, not a reason to reach around it.

## Trust model

**Be explicit about this: a runtime extension's JavaScript executes with
full browser privileges** - the same origin as the AXIS application
itself, arbitrary DOM/network/three.js access, no sandboxing whatsoever.
This is a genuine, one-way trust-model shift from every other kind of AXIS
package: pure `.ax` source (see [docs/extensions.md](extensions.md)) runs
entirely inside AXIS's own interpreter, with no way to touch the DOM,
network, or browser APIs except through AXIS's own, deliberately narrow
language surface. A runtime extension's JS has none of those limits.
**Do not treat "it's just an AXIS package" as a safety property once a
package declares a `runtimeExtension`** - installing one is equivalent to
adding an arbitrary third-party `<script>` tag to the page, because that
is, mechanically, exactly what it is.

## Lifecycle

Scalar properties, specifically, need none: `get`/`set` are pure
functions operating on a three.js object AXIS's own existing scene
lifecycle already owns and disposes (`scene3d.js`'s `dispose()`) - an
extension holds no resource of its own that could leak. This is a real
finding, not an assumption: a *different* capability category (say, a
browser-native handle, like `pointerLock`) would need real lifecycle
(acquire on mount, release on scene disposal) the way `pointerLock` itself
does - but that category isn't part of what this milestone's API
supports at all (see "What still requires core changes," below), so no
lifecycle hook exists here to get wrong.

Registration itself happens once per page load (an extension's top-level
script code, run once when its module first evaluates) - a live-reload
(`axis run`) does a full `location.reload()`, resetting the entire module
graph, so there's no cross-reload duplicate-registration risk either.

## Error boundaries

- A missing or malformed `runtimeExtension` in `axis.json` (wrong type,
  wrong extension, tries to escape the package directory) is a clear
  `AxisModuleError` at resolution time, in Node, before a dev server even
  starts - not a confusing browser-side 404.
- Two extensions (or the same one, twice) registering the same property
  name is a clear, synchronous JS error at registration time (see
  "Registration errors," above).
- Referencing an unregistered property name from `on box.click { box.foo
  = 1 }` is simply a plain, untyped own-property write to the `LiveObject`
  instance - a silent no-op as far as anything three.js-visible goes (no
  crash, but no effect either), since there's no accessor installed for
  it. Referencing one from a triggered `animate`, though, IS a clear,
  immediate `AxisRuntimeError`: `can't animate 'foo' - try position.x/y/z,
  rotation.x/y/z, scale.x/y/z, material.*, color, intensity, or progress`
  - `triggerAnimation`'s own `isKnownPath` check, which a registered
  extension property flows through exactly like a built-in one. See
  `tests/browser/runtime-extension.test.js` for both proven directly, in
  a real browser.

## Package distribution / version compatibility

No change to package distribution beyond `axis.json`'s new field (see
[docs/extensions.md](extensions.md) for the rest of the package contract
- name/version resolution, local-only `axis_modules/`, no registry). No
version-compatibility mechanism exists between an extension's own code
and AXIS's runtime API (`registerScalarProperty`'s own shape) - a
deliberately minimal choice for this milestone (per its own "don't build
a versioning system prematurely" instruction), not an oversight to be
silently worked around later without noticing. If `extensionRegistry.js`'s
own API shape ever needs to change incompatibly, that's a real,
user-visible breaking change to every published runtime extension - worth
a real design pass when (if) it's ever actually needed, not before.

## Level 1 vs. Level 2, precisely

- **Level 1** (a package composing existing `.ax` primitives into a
  reusable system): see [docs/extensions.md](extensions.md) - proven,
  unaffected by anything in this document.
- **Level 2** (a package registering a genuinely new *runtime*
  capability): proven for two capability categories now - a new,
  live-settable 3D scalar property (this document's original scope), and
  (2026-09-14) a genuinely new *DOM/page element type*, via
  `registerElementType` - see "Build-time element types," below.

## Build-time element types (`registerElementType`)

Added 2026-09-14, closing the specific gap
[docs/architecture/2026-09-language-platform-audit.md](architecture/2026-09-language-platform-audit.md)
called out as the single biggest one this document's original scope left
untouched: "a new object/element type... still a hardcoded dispatch table."
A page-side element type - not a 3D shape/light (see "What still requires
core changes," below - that half of the gap is still open).

Unlike a scalar property (settable only from client-side imperative code -
see "Where a registered property can actually be used"), an element *type*
is checked at **build time**, in Node, before a browser exists at all -
`axis check`/`axis build`/`axis run` all reject an unknown type before
`interpreter.js` finishes building the graph. That's a fundamentally
different problem than the scalar-property registry solves, and it's why
this needed a second, distinct mechanism rather than reusing the first:

- `axis.json` gets a second, sibling field to `runtimeExtension`:
  **`buildExtension`** - a `.js` file `modules.js` actually executes
  (`runtimeExtension` never is; it's Node-side metadata only, forwarded to
  the browser as a `<script>` tag). It can't be an ordinary ESM `import()`
  the way loading a `.ax` file's own imports works - dynamic `import()` is
  inherently asynchronous, and making `resolveModules` (and its ~15 call
  sites, several under a synchronous `assert.throws` in the existing test
  suite) async to accommodate one narrow capability would be a
  disproportionate, cascading change for what it buys. Instead it runs
  synchronously via Node's built-in `vm` module (zero new dependency,
  same "hand-rolled" choice `lsp.js` already made) as a plain script - no
  `import`/`export` of its own - with a small `axis` object already in
  scope: `axis.registerElementType(name, { tag, allowedProps, defaults })`.
- The *browser* half still uses the existing `runtimeExtension` mechanism,
  calling the exact same `registerElementType` (now exported from
  `src/extensionRegistry.js` alongside `registerScalarProperty` - one
  registry file, two independent registration surfaces, not a second
  architecture) so `pageRuntime.js` knows what real DOM tag to mount/
  hydrate live.
- `interpreter.js`, `src/renderer/domHtml.js` (server-render), and
  `src/renderer/domPlan.js` (render-plan construction - the one additional
  hardcoded dispatch point this milestone found beyond the three already
  known about) each fall back to the registry only when a type isn't one
  of their own built-ins - never baked into their static tables, since
  registration happens per-file, dynamically.
- Deliberately narrow, same spirit as the scalar-property registry: a
  registered element type is always a **generic leaf** - one tag, an
  optional text `content`, plus whatever of AXIS's own universal style
  properties (`background`/`padding`/`color`/...) already apply to
  everything (this part needed zero changes at all - `domStyle.js`'s
  `cssForProperty` was already keyed by property name, not type). No
  container types, no custom attributes beyond a plain string `content`,
  no special rendering logic the way a built-in `link`'s `href` or
  `input`'s `value`/`placeholder` have.
- `runBuildExtension`'s sandbox gets `axis.registerElementType` and
  nothing else - no `require`, no `process`, no filesystem access - same
  "explicit, static ownership, not a magic ambient value" principle as
  the browser-side registry.
- A package's `buildExtension` runs at most once per process, ever (a
  module-level `Set` in `modules.js`, not local to one `resolveModules()`
  call) - `axis lsp` calls `resolveModules()` fresh on every file check,
  and without this a second check of the same file would re-run its
  buildExtension and collide with `registerElementType`'s own
  already-registered guard, turning an ordinary edit-and-recheck into a
  spurious failure.

## What still requires core changes

Everything below still needs a real `src/` change and a new AXIS release
- this milestone does not claim otherwise for any of these:

- **A new `on` event** (a new kind of user input, a new lifecycle
  hook) - `GLOBAL_ON_EVENTS`/per-object-event vocabulary lives in
  `src/parser.js`, with matching wiring in `scene3d.js`/`pageRuntime.js`.
  No extension mechanism reaches this.
- **A new browser-native handle** (like `pointerLock`) - these are
  defined directly inside `scene3d.js`, with real lifecycle
  (acquire/release) tied to scene disposal. No generic "register a
  handle" API exists.
- **A new 3D object type** (a new kind of light, a new geometry primitive)
  - still a hardcoded dispatch table inside `interpreter.js`/`scene3d.js`.
  A new **DOM/page** leaf element type is no longer in this list - see
  "Build-time element types," above; that half of this bullet is closed.
- **An object's own literal-declaration property, or a top-level
  unconditional `animate`, for an otherwise-registered scalar property** -
  see "Where a registered property can actually be used," above; this is
  the one gap specific to the mechanism this document itself describes,
  not a wholly different capability category.
- **Any new AST node or grammar construct** - always a
  `src/parser.js`/`evaluator.js` change; this milestone adds no new
  syntax at all (see "Why this scope, specifically," below).

## Why this scope, specifically

The milestone that built this deliberately chose ONE capability category
(a new 3D scalar property) rather than attempting every core-only
capability at once, per its own explicit "do not attempt to make every
internal subsystem dynamically extensible" instruction. Scalar properties
were the natural first target: `scene3d.js` already had a real, internal
registry for them (`SCALAR_PROPERTIES` - see the property-vocabulary-
registry addendum in
[docs/architecture/2026-09-language-platform-audit.md](architecture/2026-09-language-platform-audit.md)),
so extending that one existing mechanism to also accept an externally-
registered entry was the smallest coherent step - not a second, parallel
architecture invented from scratch. A future milestone extending this to
events or native handles would need its own, separate design pass (a
handle, in particular, needs real lifecycle this API doesn't have), not
an assumption that the scalar-property mechanism generalizes for free.

## A bug this milestone found, and deliberately did not fix

While building `examples/runtime-extension-demo/`'s own browser proof, a
real, pre-existing bug surfaced: an `on`-handler-triggered `animate`
using **colon syntax** for a property change (`animate box { intensity: 3
duration: 0.3 }`, instead of the correct arrow syntax, `intensity -> 3`)
crashes with a confusing `TypeError: Cannot read properties of undefined
(reading 'kind')` in `scene3d.js`'s `triggerAnimation`, instead of either
working or failing with a clear error. Confirmed this reproduces
identically for a **built-in** property (`intensity`), not anything
specific to a registered extension - `src/evaluator.js`'s
`parseAnimateTiming` gives a colon-syntax property entry a `{kind:
"Property", path, value}` shape, but `triggerAnimation` unconditionally
reads `entry.to` (the field only an arrow-syntax `{kind: "AnimateTarget",
path, to}` entry actually has). A real, separate, pre-existing defect -
found honestly, left unfixed on purpose: fixing it would mean touching
`scene3d.js` after this milestone's own core-freeze checkpoint, which
would break the very source-independence proof this document exists to
make. Worth a real, dedicated fix in a future milestone, not folded in
here where it can't be verified against a clean freeze.

## Examples

`examples/runtime-extension-demo/`: two independently-authored extensions,
`axis-wireframe` (boolean, non-animatable) and `axis-line-width` (number,
animatable) - proving the API generalizes across both `valueType`/
`animatable` combinations, not just one convenient case. One real page+
scene imports and uses both together; `tests/browser/runtime-extension.test.js`
proves the whole chain end to end, in a real headless browser: a real
click toggling a real material property (and back, on a second click -
not just once), a real triggered `animate` advancing a real numeric
material property over real time (sampled at several checkpoints), and a
real, clean `AxisRuntimeError` for an unregistered property name.

`examples/element-extension-demo/`: `axis-badge`, a third-party package
registering a genuinely new DOM element type (`badge`) via `buildExtension`
+ `runtimeExtension` together - not a keyword anywhere in AXIS's own
source (`grep -rn badge src/` finds it only inside comments).
`tests/browser/element-type-extension.test.js` proves it end to end in a
real browser: a real server-rendered `<span>` (not the generic `<div>`
fallback), real computed CSS from AXIS's ordinary style pipeline, and a
real click-driven reactive re-render of its `content` binding.
