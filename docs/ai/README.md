# AXIS docs for AI coding agents

This directory exists because AXIS is a new language with no meaningful
presence in any model's training data - an agent generating AXIS is
extrapolating from `.ax`'s surface resemblance to JS/CSS/three.js, which
gets a lot of things wrong in predictable ways. These docs exist to close
that gap, and to make "generate, validate, repair" a reliable loop instead
of a guessing game.

This is not a second copy of the language reference - **the canonical,
complete syntax reference is [docs/language.md](../language.md)**. If
something here and `language.md` ever disagree, `language.md` is right
(and this directory has a bug - please fix it). What lives here instead is
what an AI agent specifically needs and `language.md` doesn't try to be:
an operational checklist, a list of mistakes actually reproduced against
the real parser/interpreter, and the machine-readable validation contract.

## Start here

1. **[QUICKSTART.md](QUICKSTART.md)** - the operational loop: what to do
   before writing AXIS, and after.
2. **[docs/language.md](../language.md)** - the actual syntax reference.
   Read the sections relevant to what you're building; don't assume, verify
   against it.
3. **[COMMON_MISTAKES.md](COMMON_MISTAKES.md)** - real, reproduced mistakes,
   with the exact error each one produces and the fix.
4. **[VALIDATION.md](VALIDATION.md)** - the `axis check --json` contract:
   exact schema, every field, exit codes.
5. **[ERROR_CODES.md](ERROR_CODES.md)** - every diagnostic code
   `axis check` can emit, generated from AXIS's own source
   (`scripts/gen-error-codes-doc.mjs` - regenerate it after changing
   `src/diagnostics.js`, don't hand-edit the doc).

## Canonical examples

Don't write AXIS from scratch when an existing example already demonstrates
the concept - adapt it. Every file under [`examples/`](../../examples/) is
checked by `tests/examples.test.js` on every test run (`npm test`), so
these are guaranteed to actually validate right now, not "as of whenever
someone last looked":

| Concept | Example |
| --- | --- |
| Smallest possible scene | `examples/hello.ax`, `examples/cube.ax` |
| Materials/lighting | `examples/materials.ax`, `examples/lights.ax` |
| Camera (`fov`/`target`/`orbit`), `environment` (background/fog), `material.map` texture, live material swapping | `examples/showroom.ax` |
| A loaded `.glb` model + animation clips | `examples/model.ax`, `examples/skeletal-animation.ax` |
| Interaction (`on click`/`hover`) | `examples/interaction.ax`, `examples/showroom.ax` |
| `animate`/timelines, `loop`, `on TIMELINE.complete` | `examples/animation.ax`, `examples/cinematic.ax`, `examples/showroom.ax` |
| A page (DOM), state, events | `examples/counter.ax`, `examples/portfolio.ax` |
| Array/string stdlib (`map`/`filter`/`sortBy`/...), first-class functions (named + inline `fn(...) { ... }`) | `examples/stdlib.ax` |
| Per-frame updates (`on tick { ... }`, `dt`) | `examples/tick.ax` |
| Data with behavior (`self`-bound record methods) | `examples/entities.ax` |
| Local packages (`import X from "name"` -> `axis_modules/name/index.ax`) | `examples/app-with-package/` |
| A package built from general primitives alone (2D gravity/bounce physics, no AXIS core changes) | `examples/physics-demo/` |
| Keyboard input (`on keydown`/`on keyup`, `key`) + a package built on it (held-key tracking) | `examples/keyboard-input/` |
| Mouse input (`on mousemove`/`on mousedown`/`on mouseup`, `dx`/`dy`/`button`) | `examples/mouse-input.ax` |
| A first-person camera controller (reusable `makeFpsCamera`/`makeInputState` packages, `camera.target`, `pointerLock`) | `examples/fps-controls/` |
| Entities/components/systems (self-bound records as components, `on tick` as the update clock, no dedicated syntax) | `examples/game-foundation/` |
| Package metadata (`axis.json`'s `main`) + two independently-authored, unrelated packages (`axis-tween`, `axis-inventory`) used together by one real app | `examples/third-party-extension/` |
| A genuinely new, live-settable 3D scalar property registered by an external package (`axis.json`'s `runtimeExtension`, `registerScalarProperty`) - not just composed from existing primitives | `examples/runtime-extension-demo/` |
| A real playable FPS (WASD/mouse-look/pointer lock, ECS-based targets, `raycast.fromCamera()` for shooting, an `axis-visibility` runtime extension for object-pooled "destruction", reset) built from reused packages plus one new general primitive | `examples/fps/` |
| Reactive `if`/`for` (add/remove real elements) | `examples/reactive-list.ax`, `examples/conditional-viewport.ax` |
| Scroll-driven animation/state | `examples/scroll-story.ax`, `examples/scroll-progress.ax`, `examples/sticky-scroll.ax` |
| A nested scrollable container | `examples/nested-scroll.ax` |
| Page embedding a 3D scene (`viewport`) | `examples/unified-story.ax`, `examples/website.ax` |
| Multi-page routing | `examples/routing/site.ax` |
| `async`/`await`, `fetch`/`api.*` | `examples/async-data.ax` |
| Render-on-demand (perf) | `examples/render-on-demand.ax` |
| A full, real site (the flagship demo) | `examples/nimbus-studio.ax` (see [../architecture/flagship-site.md](../architecture/flagship-site.md)) |
| Embedding in plain HTML | `examples/embed-html/` |
| Embedding in React | `examples/embed-react/` |

## The loop

```
read QUICKSTART.md + the relevant example(s) + language.md sections
        |
        v
generate/edit a .ax file
        |
        v
axis check <file.ax> --json
        |
   +----+----+
   |         |
 valid    invalid
   |         |
  done    read diagnostics[0].code, .message, .suggestion
             |
             v
           fix exactly that, re-run axis check
```

There is no AI generation *inside* AXIS - `axis check` is a deterministic
compiler/interpreter pipeline, not a model. See
[../architecture/2026-audit.md](../architecture/2026-audit.md) for the
architecture these docs describe.
