# Extending AXIS with packages

This document is the extension contract: what a package is, what it can
and can't do, and exactly where the boundary between "compose existing
primitives" and "needs a core AXIS change" currently sits. It's written to
be honest, not aspirational - if something isn't possible today, it says
so, rather than papering over it with a special case.

The core question this document answers, precisely: **can a developer who
did not write AXIS build meaningful new functionality using AXIS, without
modifying AXIS's own source (`src/`)?** See
[docs/architecture/2026-09-language-platform-audit.md](architecture/2026-09-language-platform-audit.md)'s
Phase F/G/H and game-foundation addenda for the full audit trail this
document summarizes the conclusions of.

## What counts as a public AXIS extension?

A package: an ordinary directory of `.ax` source files under some
project's `axis_modules/<name>/`, imported by a bare specifier
(`import Foo from "<name>"`) instead of a relative path. Nothing marks a
package as special to AXIS beyond where it sits on disk - it's built from
exactly the same language every ordinary `.ax` file uses (`export`/
`import`, functions, records, `on tick`, the standard library). AXIS core
does not know any given package's name; `src/modules.js` resolves a bare
specifier to a directory the same generic way regardless of what's in it.

## How do I create a package?

1. Create `axis_modules/<name>/` somewhere at or above the project's entry
   file (resolution walks upward from the importing file, the same way
   Node walks `node_modules`, so a project has exactly one `axis_modules/`
   at its root regardless of how deeply nested the file importing from it
   is).
2. Write ordinary `.ax` source inside it. `export` whatever functions,
   components, or `let`/`const` values you want consumers to be able to
   import.
3. The entry point is `axis_modules/<name>/index.ax` by default. To use a
   different entry file (e.g. `src/index.ax`), add
   `axis_modules/<name>/axis.json`:

   ```json
   { "name": "<name>", "version": "0.1.0", "main": "src/index.ax" }
   ```

   `axis.json` is entirely optional - a package with none resolves exactly
   as if it had `{ "main": "index.ax" }`. `name`/`version` are accepted as
   a place for a package to state its own identity (for a human reader, or
   a future registry) but nothing in AXIS core cross-checks them against
   anything yet - `main` is the only field resolution actually reads.
4. A package's own internal files import each other with ordinary relative
   paths (`import helper from "./helper.ax"`), exactly like any other
   multi-file AXIS project - a consumer importing the package's public
   name never needs to know its internal file layout.

See [docs/language.md](language.md)'s "Local packages" section for the
full `import`/`axis.json` reference, and any of
`examples/physics-demo/axis_modules/physics2d/`,
`examples/game-foundation/axis_modules/ecs/`,
`examples/fps-controls/axis_modules/{camera,input}/`, or
`examples/third-party-extension/axis_modules/{axis-tween,axis-inventory}/`
for real, working packages.

## How do I expose functions/modules?

`export` on a top-level `fn`, `component`, `let`, or `const`. That's the
entire public-surface mechanism - there's no separate manifest of exports,
no `index` re-export file convention beyond "the entry file's own
top-level `export`s are the package's public API." Keep internal helpers
un-exported; a consumer can only ever `import` a name the package actually
exported.

## How does package resolution work?

Entirely inside `src/modules.js`, before the interpreter ever runs -
`interpreter.js`/`evaluator.js` have no idea packages (or files, or
imports) exist; by the time they run, everything reachable via `import`
has already been flattened into one ordinary program. A bare specifier is
looked up as `axis_modules/<name>/` (or wherever its `axis.json`'s `main`
points), walking upward from the importing file's directory to the
filesystem root; a specifier starting with `./` or `../` is always a
relative file path instead. Nothing about this resolution branches on a
package's name - it's the same generic directory/manifest lookup for
every package, including AXIS's own examples.

Failure modes are deliberately explicit, not silent: a missing package
lists every path it tried; an import naming something the target doesn't
export lists what it *does* export; a circular import is reported
directly rather than recursing forever; a malformed `axis.json` or a
`main` that tries to escape its own package directory (`../../etc/...`)
is a clear `AxisModuleError`, not a crash or a silent fallback. See
`tests/modules.test.js` for the full matrix.

## What can packages access?

Everything an ordinary `.ax` file can: the standard library
(`docs/language.md`'s Standard library section), records and self-bound
"data with behavior" methods, arrays/functions/closures, `on tick`'s `dt`,
and (from `.ax` code running inside a scene/page, not a bare package
file) scene/page-level primitives like `pointerLock`, `on keydown`/
`on mousemove`, `camera`, etc. A package is not a different execution
context - it's ordinary AXIS source that happens to live under
`axis_modules/` and get imported by name.

## What can packages NOT access?

**Anything outside the AXIS language itself.** A package cannot:

- `import` a JavaScript module, or reach into any file under `src/`
  (`src/interpreter.js`, `src/renderer/scene3d.js`,
  `src/renderer/pageRuntime.js`, etc.) - there is no mechanism for `.ax`
  source to run JavaScript or touch AXIS's own implementation, by design.
  Everything a package does, it does by composing the same public
  language surface any `.ax` file has.
- Register a new built-in object/element type, a new live-settable scene
  property, or a new `on` event - these are dispatch tables that live
  inside AXIS's own runtime source (see "What still requires core
  changes," below) and have no package-facing extension point today.
- Read or write another package's private (non-`export`ed) state directly
  - the only channel between packages, or between a package and its
    consumer, is whatever values flow through ordinary `export`/`import`
    and function calls.

## Can packages create new 3D properties?

**Partially yes, as of the Runtime Extension Architecture milestone** -
see [docs/runtime-extensions.md](runtime-extensions.md) for the full,
honest contract. A package whose `axis.json` declares its own
`runtimeExtension` (a JS file, loaded into the browser alongside the
`.ax` package it belongs to) can call a public API,
`registerScalarProperty`, to make a genuinely new scalar 3D property
live-settable - reachable from `.ax` source via a direct `on`-handler
assignment (`box.glow = 0.8`) or an `on`-handler-triggered `animate`.

This is narrower than it might first sound, and `docs/runtime-extensions.md`
states the actual boundary precisely rather than overclaiming it: it does
NOT yet cover an object's own literal declaration (`cube box { glow: 0.5
}` still fails - that path is validated build-time, in Node, against a
separate, still-hardcoded allowlist in `interpreter.js` this mechanism
doesn't reach) or a top-level unconditional `animate` block, and it only
covers *scalar properties* - not new light types, new geometry
primitives, new `on` events, or new browser-native handles (see
`docs/runtime-extensions.md`'s own "Level 1 vs Level 2" and "What still
requires core changes" sections for exactly what's still core-only). It
also requires the package to ship real JavaScript, not pure `.ax` source
- a genuine, documented trust-model shift from every other package this
document describes, spelled out in `docs/runtime-extensions.md`'s Trust
Model section.

## Can packages create browser-native handles?

**No, not generically.** `pointerLock` (a real `PointerLockHandle`
exposed as a scene-level value) is the one case AXIS added specifically
because no package could build a real OS pointer lock on top of existing
primitives (only the browser's own Pointer Lock API can do that) - and
that required a genuine `src/renderer/scene3d.js` change, landed once,
as a core primitive every scene can now use. A package cannot mint its
own new "native handle" the way `pointerLock`/`camera`/`environment` are
built - those are all defined inside AXIS's own runtime, not something
`.ax` source has a mechanism to add to.

## What requires core/runtime changes?

Concretely, everything below has needed (and, where marked, has already
received) a change inside `src/` rather than a package:

- A new global `on` event (`tick`, `keydown`, `mousemove`, ... -
  `GLOBAL_ON_EVENTS` in `src/parser.js`, plus matching wiring in both
  `scene3d.js` and `pageRuntime.js`). **Landed** for the events AXIS
  currently supports; a genuinely new one (mouse wheel, gamepad) would
  need the same treatment.
- A new live-settable 3D scalar property (`SCALAR_PROPERTIES` in
  `scene3d.js`). **Partially landed as a registry** (one core-team edit
  per new property, not four scattered ones) - still not package-facing.
- A new browser-native handle (`pointerLock`, `camera`, `environment`).
  **Landed** for the ones that exist; a new one needs the same kind of
  core addition.
- Anything requiring a new AST node / grammar construct at all (a new
  keyword, a new expression form) - always a `src/parser.js`/
  `evaluator.js` change; no package mechanism substitutes for new syntax,
  nor should one - keep the core language small.

## How should packages manage state?

The same way any AXIS "data with behavior" does: a plain record whose
fields include functions that read/mutate `self` (see
[docs/language.md](language.md)'s "Data with behavior" section). A
package typically exposes a `createX()`/`makeX()` constructor function
returning such a record, so a consumer holds the state (usually in a
scene/page's own top-level `let`/`state`) and calls methods on it -
the package itself holds no hidden global state of its own. This matters
specifically because a scene/page's top-level `let`/`state` value is the
one thing that crosses the server→browser JSON-plan-transport boundary
(see the language-platform-audit's "data with behavior" addendum for the
real bug this exposed, and its fix) - any package whose returned value
holds a function needs at least one real browser test
(`tests/browser/*.test.js`, using `harness.js`'s `withPageFile`) proving
it survives that transport, not just a unit test that calls the evaluator
directly.

## How should packages integrate with systems?

A "system," in the entities/components/systems sense
([docs/language.md](language.md)'s "Entities, components, systems"
section) is just an ordinary function `fn(world, dt)`, called once per
`on tick`. A package built as a system needs nothing beyond that -
no registration mechanism, no lifecycle hook AXIS core has to know about.
Multiple packages' systems compose by being called in the same `on tick`
handler, in whatever order the consuming scene/page's own code lists
them - ordering is explicit argument order, not implicit priority.

## Level 1 vs. Level 2 extensibility

- **Level 1 - language/package extensibility** (a third party builds a
  reusable system - physics, an inventory, a tween/animation helper, an
  ECS - out of existing primitives): **proven**. See "The proof," below.
- **Level 2 - runtime/core extensibility** (a third party adds a genuinely
  new *runtime* capability - a new 3D property, a new renderer feature, a
  new browser-API integration - without touching `src/`): **partially
  supported**, as of the Runtime Extension Architecture milestone - one
  capability category (a new, live-settable 3D scalar property) is now a
  real, generic, package-registerable extension point; every other kind
  (a new `on` event, a new renderer feature, a new browser-native handle)
  is not. See [docs/runtime-extensions.md](runtime-extensions.md) for the
  full, precise contract - this is a genuinely narrower claim than "Level
  2 is solved," and that document is explicit about exactly where the
  remaining boundary sits.

## The proof

Every package under `examples/*/axis_modules/` was built, verified, and
tested with **zero changes to `src/`** after whatever core primitive it
depends on already existed (`on tick`'s `dt`, self-bound records, keyboard/
mouse events, `pointerLock`) - `git diff -- src/` across each package's own
commit is empty. None of `src/modules.js`, `src/interpreter.js`, or
`src/evaluator.js` contains any package name, and none needs to: resolving
`axis_modules/axis-tween/` works through exactly the same generic code path
as resolving `axis_modules/physics2d/` or any future third package.
`examples/third-party-extension/` demonstrates two independently-authored
packages (`axis-tween`, a generic value-interpolation/easing utility with
no relation to physics or games at all, and `axis-inventory`, a stack-based
item tracker) used together by one real application, proving the
architecture generalizes rather than happening to work for one convenient
example.

## Limitations, stated plainly

- No registry, no lockfile, no `axis add` - packages are resolved purely
  from the local filesystem. `axis.json`'s `name`/`version` fields exist
  for a package to state its own identity, but nothing today resolves a
  version constraint or fetches a package from anywhere.
- No way for a package to register a new built-in type, live property, or
  `on` event (Level 2, above) - genuinely new runtime capability still
  requires a core AXIS change and release.
- Records have no dynamic/computed field access (`record[key]` isn't
  expressible) - a package needing a string-keyed map is built on an
  array of `{key, value}` records instead (see
  `examples/keyboard-input/axis_modules/input/`'s held-key tracker for the
  pattern), not a JS-style object map.
- Identity across records is structural, not reference-based (`==`
  compares fields, not identity) - a package needing real object identity
  (an ECS entity id, say) mints an explicit id itself rather than relying
  on reference equality.
