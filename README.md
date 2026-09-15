# AXIS

**A**nimated e**X**ecution & **I**nteractive **S**patial

AXIS is a small programming language for building interactive things on the web - pages as easily as 3D scenes - without writing a pile of JavaScript/HTML/CSS/three.js glue every time. Source files end in `.ax`.

## Why?

Every time I start an interactive web project it's the same boilerplate, just a different flavor depending on what I'm building. For a 3D scene: set up a scene, a camera, some meshes, a render loop, hand-write tweening for anything that moves, hand-write raycasting for anything you want to click. For a page: some HTML, some CSS, a `<script>` tag wiring up `addEventListener` calls to mutate the DOM by hand. I wanted one small language where you say "this cube spins for 2 seconds, forever" or "when you click this button, do this" and mean it - regardless of which of those two things you're building.

That's the idea behind AXIS: a real small language (variables, functions, loops, if/else) with a declarative object-and-property grammar for describing *what exists* (shapes and lights in a scene; containers, text, buttons, links, and images on a page) plus the same `on click`/`hover`/`unhover` interaction model over both. AXIS isn't trying to replace three.js or the DOM - a scene actually renders through three.js, and a page renders to real, server-rendered HTML - AXIS is the layer on top that gives both a shared, small vocabulary instead of two unrelated toolchains.

## Two examples, one language

```ax
fn ringPosition(i, count, radius) {
    let angle = (i / count) * 360
    return (radius * cos(angle), 0, radius * sin(angle))
}

scene main {
    camera { position: (0, 6, 12) }
    ambientLight fill { intensity: 0.4 }

    for i in range(0, 6) {
        cube ("box" + i) {
            position: ringPosition(i, 6, 4)
            color: blue
        }
    }

    sphere core {
        position: (0, 0, 0)
        color: white
    }

    on core.click {
        core.color = red
    }

    animate core {
        rotation.y -> 360deg
        duration: 4s
        repeat: infinite
    }
}
```

That's a real program - loops, a function, trig, a click handler, and animation all in one file. Run it with `node bin/axis.js run` and it opens in your browser.

There's a bigger version of this idea in [`examples/showcase.ax`](examples/showcase.ax) - that's the one to run first.

The web side of AXIS uses the exact same language, just a different top-level keyword and a different (and by now bigger) set of object types - `page` instead of `scene`, `container`/`text`/`heading`/`paragraph`/`button`/`link`/`image`/`input`/`form`/`list` instead of `cube`/`sphere`/`group`. Here's the smallest version of the idea:

```ax
page "Portfolio" {
    let clicks = 0

    container hero {
        direction: "column"
        gap: 16

        text heading { content: "Hi, I'm Alex." color: white size: 32 }

        button contactBtn { label: "Say hi" color: white background: blue padding: 12 }

        text clickLabel { content: "Clicked 0 times" color: white }
    }

    on contactBtn.click {
        clicks = clicks + 1
        clickLabel.content = "Clicked " + clicks + " times"
    }
}
```

`axis run` on that renders real, server-rendered HTML (view-source shows an actual `<button>`, not a canvas) and hydrates it with the same evaluator that runs `on click` in a scene - the click handler above really does mutate the DOM live. See [`examples/portfolio.ax`](examples/portfolio.ax) for a fuller one, with a loop-generated list of project links.

## Install

```bash
npm install -g axis-lang   # for the `axis` CLI on your PATH
axis create my-app && cd my-app
axis run main.ax           # opens in your browser, live-reloads on save
```

Or as a project dependency (also gets you `npx axis ...` without a global install):

```bash
npm install axis-lang
npx axis create my-app
```

`axis build main.ax` writes a static, servable copy to `dist/`. Embedding
AXIS inside an existing React/HTML app instead of letting it own the whole
page: see "Embedding AXIS in an existing site," below. Full CLI reference
and language docs: [docs/language.md](docs/language.md).

The package version (currently `1.0.0`, see `package.json`) is
independent of the `vN` labels below - those are AXIS's own internal
feature-milestone history (chronological development markers going back
to the project's earliest slices), not the published npm version.

## Status

This is v3.7 - IDE-native tooling on top of v3.6's AI-native tooling: a real, AST-based `axis fmt` (deterministic, idempotent, precedence-aware, and comment-preserving - see [docs/ai/README.md](docs/ai/README.md)'s formatter notes), a symbol index (`axis inspect`), and a hand-rolled AXIS language server (`axis lsp` - diagnostics/formatting/hover/go-to-definition/document symbols over real LSP JSON-RPC, zero new dependencies, every capability backed by the exact same engine the CLI uses - no duplicated grammar or validation logic anywhere in the stack). v3.6 added `axis check --json` (a stable, versioned, machine-readable diagnostic contract) and the `docs/ai/` corpus aimed specifically at AI coding agents. See [docs/ai/QUICKSTART.md](docs/ai/QUICKSTART.md) for the recommended generate → format → validate → repair loop.

Since v3.5 (below): `async fn`/`await`, `try`/`catch`, `fetch`/`api.get`/`.post`/`.put`/`.delete`, and `null` (docs/architecture/async-await.md); and `route`/`redirect` - a real multi-page site, with `params`/`query`, `navigate()`, SPA-navigating `link`s, a `"*"` 404 catch-all, and a route-aware dev server/static build (docs/architecture/routing.md, examples/routing/site.ax).

This is v3.5 - a production-readiness pass on top of v3.1-3.4's feature work, driven by a full architectural audit plus an actual flagship site built end-to-end in AXIS ([`examples/nimbus-studio.ax`](examples/nimbus-studio.ax), see docs/architecture/flagship-site.md). The headline addition: AXIS finally has reactive *structure*, not just reactive *values* - a `for`/`if` inside a page body can add/remove real DOM elements live, not just re-check already-existing property bindings (docs/architecture/reactive-structure.md). Alongside that: a `responsive:` property compiling to real `@media` CSS, `scrollRoot` for scroll-linked timelines/state driven by a nested scrollable container instead of only the document, `pause`/`resume`/`reverse` timeline playback controls, and a handful of security/accessibility fixes (URL scheme validation on `href`/`src`, `<html lang>`, `prefers-reduced-motion` now covering load-time looping animation too, not just scroll-linked). AXIS scenes can also load a real external `.glb`/`.gltf` asset (`model earth { src: "./earth.glb" }`) instead of being limited to the built-in primitive shapes - the Blender → AXIS workflow the project's vision describes is real for geometry, materials, *and* animation clips (see docs/language.md's Models section for the precise, current boundary). AXIS also has a record/object literal type, so scenes and pages can be genuinely data-driven (an array of records plus a `for` loop, instead of hand-writing every object). The "web" side of AXIS grew from a first slice of `page` into an actual small set of primitives, a styling model with a real escape hatch, a reactive `state` construct, `animate` support for pages, and a native `component` abstraction plus a simple multi-file `import`/`export` module system. Here's honestly what's real and what isn't.

**Works everywhere (the shared language core):**
- A real language core: `let`/`const`, numbers/strings/booleans/`null`/arrays, arithmetic and comparison operators (plus `+=`/`-=`/`*=`/`/=`), `if`/`else`, `while`, `for..in`, `try`/`catch`, functions with `return`, and a small standard library (`sin`/`cos`/`range`/`len`/`keys`/`rgb`/`lerp`/`normalize`/... - see [docs/language.md](docs/language.md))
- `async fn`/`await`, scoped to runtime code (an `on` handler, or a function it calls) - `fetch(url)` close to the browser's own shape, plus a higher-level `api.get`/`.post`/`.put`/`.delete` that sends/parses JSON directly and throws a clear, `try`/`catch`-able error on failure. No build-time/server-rendered data fetching yet - `await` only works client-side. See [docs/architecture/async-await.md](docs/architecture/async-await.md) and [`examples/async-data.ax`](examples/async-data.ax)
- Spatial values as a first-class part of the language: `(x, y, z)` is a real vector you can do math on (`+`, `-`, scale by a number, `.x`/`.y`/`.z`)
- Records - `{ name: "Earth", radius: 1 }` - a named bag of fields, the same building block a scene/page's own object declarations use, now available as a plain value: build an array of them and a `for` loop turns it into a scene, a page's list, a set of components, whatever (see [`examples/planets.ax`](examples/planets.ax) and docs/language.md's Records section)
- The same declarative shape for both domains: named objects with properties, `on click`/`hover`/`unhover` handlers that run live in the browser (using the exact same evaluator that built the graph), and `for`/`if` that can generate objects procedurally instead of only declaring them statically
- `component` - a reusable, parameterized chunk of declarative content, usable inside either a `scene` or a `page`. Instantiating one is just ordinary object-declaration syntax; internally it expands transparently (no wrapper element) with every name it declares namespaced per instance, so the same component used twice on one page doesn't collide
- `export`/`import` - a simple multi-file module system (one name per `import`, no destructuring/aliasing) with transitive resolution, diamond-import dedup, and clear errors for a missing file/export or a circular import
- A CLI that actually does things: `axis create <name>` (scaffolds a starter project), `axis run` (renders in your browser and live-reloads on save), `axis build` (writes a static, servable copy to disk), `axis graph` (prints the interpreted graph as JSON, handy for debugging), `axis check [--json]` (real validation - lexing, parsing, the whole import graph, and semantics, not just syntax; `--json` emits a stable, versioned, machine-readable diagnostic for tooling/AI agents - see [docs/ai/VALIDATION.md](docs/ai/VALIDATION.md)), `axis fmt [--check]` (a real, AST-based formatter - idempotent, precedence-aware, comment-preserving), `axis inspect [--json]` (the scenes/pages/components/objects/timelines/routes a file declares), `axis lsp` (a real language server - diagnostics, formatting, hover, go-to-definition, document symbols, hand-rolled JSON-RPC over stdio with zero new dependencies), `axis version`
- `axis run` live-reloads: it watches the entry file (not its `import`s yet - a real limitation) and pushes the browser a reload the moment a save produces a working build. A save that doesn't compile prints the error to the terminal and keeps the last good build running - it never crashes the dev server or blanks the page
- Error messages with a line number, the offending source line, and a "did you mean" suggestion for typos in object/element types, colors, animate/interaction targets, record fields, and variable names - including, for a multi-file project, attributing a syntax error (or a runtime error inside an imported component) to the actual file it came from, not just the one you ran
- 752+ tests covering the lexer, parser, evaluator (including records), interpreter (both domains, plus components, models and their animation clips, viewports, camera controls/fov/target, timelines and their `complete` event/`loop`, reactive state, reactive *structure*, and responsive/scroll-root validation), module resolution, all three render-plan layers, the CLI as a real subprocess (including `create` and live reload), `axis check`'s diagnostic classification and `--json` contract, `axis fmt`'s idempotence/precedence/comment-preservation/semantic-equivalence guarantees, the symbol index and go-to-definition/hover, the language server as real framed JSON-RPC over stdio (not just its internal functions), every canonical example in `examples/` (re-validated on every test run, so docs can't silently rot), the actual ES module graph a browser resolves (not just individual route status codes), end-to-end server tests for a scene, a page, and page+scene fusion (including asset serving), and `tween.js`'s own playback state machine (pause/resume/reverse/completion/loop) directly

**Scenes (3D, via three.js):**
- Cameras, shapes (`cube`/`sphere`/`plane`/`cylinder`), `group`s that nest and carry their own transform, real lights (`ambientLight`/`directionalLight`/`pointLight`/`spotLight`/`hemisphereLight`), and `model` - a real `.glb`/`.gltf` asset, loaded with three.js's own `GLTFLoader` (fetched by the browser only when a scene actually uses one, so a scene without a model pays nothing for it)
- A camera's `fov`/`near`/`far`/`target` (what it looks at) are all authorable, `animate`/`timeline`-targetable, `on`-handler-mutable, and `state`-bindable - not just `position`. `camera { controls: "orbit" }` makes it a real, interactive one (drag to orbit around its own `target`, scroll/pinch to zoom), not just a fixed viewpoint - three.js's OrbitControls, fetched only when a scene actually turns it on. Rendered at up to 2x device pixel ratio, so 3D content isn't visibly blurrier than the DOM around it on a Retina/HiDPI display
- `on model.click`/`hover`/`unhover` actually fire now - raycasting reaches every mesh inside a loaded glTF file, tagged back to the model's own AXIS name, not just AXIS's built-in shapes
- Real animation playback in the browser: `duration`, `delay`, `repeat` (including `infinite`), and a small, coherent set of easing curves - `linear`; quadratic `easeIn`/`easeOut`/`easeInOut`; cubic `easeInCubic`/`easeOutCubic`/`easeInOutCubic`; overshooting `easeInBack`/`easeOutBack`/`easeInOutBack`; and `easeOutBounce` - either playing automatically on load, or triggered from an `on` handler (`on box.click { animate box { ... } }`), starting from wherever the object actually is at that moment, not a value baked in at build time
- `animate`/`on` targets can be computed (`animate ("box" + i) { ... }`), same as an object's own name can - a loop-generated set of objects can be wired up individually, not just as a group
- A `model`'s own `position`/`rotation`/`scale` is a real `LiveObject` now - `on`-handler-mutable and `state`-bindable exactly like a shape's, and a `model` can nest inside a `group` whose own transform is just as live (see [`examples/model.ax`](examples/model.ax)) - no second-class imported-asset architecture
- A small, real material system: `material.color`/`metalness`/`roughness`/`opacity`/`emissive`/`emissiveIntensity`/`map` (a real texture, lazily loaded and cached per scene) on every shape *and* a loaded `model` (overlaid on the file's own materials, not replacing them), `on`-handler-mutable and `state`-bindable like everything else here - plus real shadows (`castShadow`/`receiveShadow` per object, `shadows: true` on a `directionalLight`/`spotLight`, on only when a scene actually asks for it) and a new `spotLight` type. See [`examples/materials.ax`](examples/materials.ax). No point-light shadows
- `environment { background: ... fogColor: ... }` - a scene's own backdrop color and a real, simple linear fog, both opt-in (a scene with no `environment` block renders exactly as before). `background` is `animate`/`timeline`-targetable, `on`-handler-mutable, and `state`-bindable; fog is build-time only for now. See [`examples/showroom.ax`](examples/showroom.ax) for `environment`, an orbitable `camera`, `material.map`, and live material swapping together in one focused scene
- `clip: "Walk"` on a loaded `model` plays one of its own animation clips (skeletal or plain node-transform - Blender exports either the same way) automatically once it loads; `play CLIP on TARGET`/`stop TARGET` (from an `on` handler) select/restart/freeze one live, and a clip's own normalized `progress` joins the existing `animate`/`timeline` property vocabulary - so scrolling a page, an `at`-scheduled `timeline` step, or a plain `animate` block can all scrub a character's clip exactly the way they already move a shape or a camera, no second animation system. One clip plays per model at a time - no crossfade/blending yet. See [`examples/skeletal-animation.ax`](examples/skeletal-animation.ax) and [docs/architecture/skeletal-animation.md](docs/architecture/skeletal-animation.md)
- `timeline` - a named, ordered choreography of `animate` steps on one shared clock: `label`s (real variables bound to the timeline's own cursor time), `at` (a step's position, defaulting to right after the previous one), stagger (an ordinary `for` loop, no separate primitive), `loop: true` to repeat a `play`-driven run automatically, `play`/`pause`/`resume`/`reverse NAME` from an `on` handler (including reaching a `viewport`'s own embedded-scene timeline by name - `"stage.intro"` - directly from a page-level handler), and `on NAME.complete { ... }` to run code the instant a wall-clock-driven run finishes (never for a looping one - a lap isn't a completion). `camera` is a real, named `animate`/`timeline` target too (`position`/`fov`/`near`/`far`/`target`, all `on`-handler-mutable, animatable, and `state`-bindable), and a light's `color`/`intensity` are real live values the same way a shape's `color` already was - so one `timeline` can choreograph a model, a light, a shape's material, and the camera together. See [`examples/cinematic.ax`](examples/cinematic.ax) and docs/language.md's Timelines section

**Pages (web, real DOM):**
- Container-like elements that each pick a real semantic tag: `container` (`<div>`), `form` (`<form>`), `list`/`item` (`<ul>`/`<li>`) - all flexbox (`direction`/`align`/`justify`/`gap`)
- Leaf elements: `text`, `heading` (`<h1>`-`<h6>` via `level`), `paragraph`, `button`, `link`, `image`, `input`
- A shared styling model on every element (container or leaf): `background`/`padding`/`radius`/`width`/`height`/`border`/`shadow`/`opacity`/`cursor`/`position`+offsets/`z`, plus a `css` escape hatch (a raw string appended to the generated inline style) for anything not modeled
- `state` - a reactive variable; a property expression that reads one re-renders on its own after a handler changes it, no manual `.content = ...` needed. Works inside a `scene` too now, for a shape's `position`/`rotation`/`scale`/`color` (see docs/language.md - it's a genuinely small mechanism, not a framework, and it's honest about that)
- `animate` works inside a page too - `opacity`/`position.x`/`position.y`/`scale`/`rotation`/`color`/`background`, same `duration`/`delay`/`repeat`/`easing` model as scenes; position/scale/rotation combine into one CSS `transform`, `color`/`background` interpolate as a real color lerp - and, same as scenes, can either play on load or be triggered from an `on` handler
- `on input.change` / `on form.submit` (submit always calls `preventDefault` - there's no backend to submit to)
- Server-rendered HTML - a page's first paint doesn't need JavaScript at all; a small client then hydrates it for interaction
- No CSS grid layout; only the style properties listed in [docs/language.md](docs/language.md) are supported by name (the `css` escape hatch covers the rest, as raw text, not as modeled properties)
- `route`/`redirect` - a real multi-page site: static and `:dynamic` routes, `params`/`query`, `navigate()`, real `<a>` links that SPA-navigate without a full reload, a `"*"` 404 catch-all, and a dev server/static build that both understand the route table (`axis build` pre-renders one HTML file per static route). No route transitions, nested/layout routes, or per-request SSR of `params`/`query`-dependent content (corrected client-side instead, immediately on load) - see [docs/architecture/routing.md](docs/architecture/routing.md) and [`examples/routing/site.ax`](examples/routing/site.ax)

**Page + scene fusion:**
- A page can embed a `scene` with `viewport` - a real three.js canvas, sized and kept in sync with its own DOM box, living inside an otherwise ordinary page. See [docs/architecture/page-scene-fusion.md](docs/architecture/page-scene-fusion.md) and [`examples/landing.ax`](examples/landing.ax).
- A top-level `let`/`fn` is shared between a page and any scene it embeds; a scene's own objects/state aren't - each keeps its own `on` handlers and object names, same as a separate file would
- One shared `requestAnimationFrame` loop drives a page's own CSS animations and every embedded viewport's 3D animation together - not one loop per viewport. It's render-on-demand, not continuous: a scene renders when something actually changed (a running `animate`/`timeline`, a `state` write, camera-control damping, a live scroll gesture) and the loop stops scheduling itself the instant nothing is left to show - a static, unanimated viewport costs one frame at mount and nothing after. Scoped per scene, so one animating viewport never forces an idle sibling to render. See [docs/architecture/render-on-demand.md](docs/architecture/render-on-demand.md) and [`examples/render-on-demand.ax`](examples/render-on-demand.ax)
- `scrollTimeline: "name"` on any element turns ordinary page scroll into a deterministic driver for a `timeline` - the timeline stops auto-playing on load and its progress becomes a pure function of scroll position instead: scroll up and it runs backwards, jump with the scrollbar and it jumps straight there, no drift, no queued animation, no separate scroll-animation system (the exact same `timeline` engine, just a different clock). On a `viewport` it drives that embedded scene's own timeline; on any other element, a page-level one. No event listener at all - sampled once per frame in the existing shared render loop. Multiple scroll-linked elements on one page are fully independent. `prefers-reduced-motion` lands on the timeline's finished state instead of tying motion to scroll. See [`examples/scroll-story.ax`](examples/scroll-story.ax)/[`examples/unified-story.ax`](examples/unified-story.ax) and docs/language.md's Timelines section. Not yet supported: a `position: "sticky"` (pinned) element, or a scrollable container other than the document itself
- `scrollProgress: "name"` - the same scroll measurement as `scrollTimeline`, but driving *data*: writes an element's own scroll progress (0-1) into a `state`/`let`, through the ordinary reactive-state machinery (no separate scroll-to-value system) - so a page text binding and a 3D shape's own property can read the exact same live number a scroll position produces. Independent of `scrollTimeline` (set either, or both, on the same element - one shared per-frame measurement either way), and deliberately *not* frozen by `prefers-reduced-motion` (that only stops `scrollTimeline`'s animation - a progress readout is data, not motion). See [`examples/scroll-progress.ax`](examples/scroll-progress.ax) and docs/language.md's Timelines section
- `timeline` now works inside a `page` too, not just a `scene` - a step targets that page's own DOM elements (opacity/position.x/position.y/scale/rotation), *and* a step can cross-reference a `viewport`'s embedded 3D object (`animate ("stage.model") { ... }`) - so one timeline genuinely choreographs DOM and 3D together, not two timelines kept manually in sync. See [`examples/unified-story.ax`](examples/unified-story.ax) and docs/language.md's Timelines section
- A pinned/sticky scroll-linked `viewport` - the "tall wrapper, pinned inner element" scrollytelling pattern - now works, and needed zero new language surface: `scrollTimeline`/`scrollProgress` on a tall, ordinary wrapper `container` measure that wrapper's own continuously-moving scroll position, while a `viewport` nested inside it gets its own `position: "sticky"` (already just an ordinary CSS string) to stay visually pinned - two already-independent primitives composed, not a new one. See [docs/architecture/sticky-scroll-timeline.md](docs/architecture/sticky-scroll-timeline.md) and [`examples/sticky-scroll.ax`](examples/sticky-scroll.ax)
- A mounted `viewport` now has a real, correct lifecycle underneath it: an internal `unmountViewport` can dispose one completely - it stops rendering, is removed from the page's own render loop and scroll sampling, releases its renderer/GPU resources, removes its own canvas and event listeners, and can't be woken back up by a stray callback (an in-flight `model` fetch finishing late, a stale scroll sample, ...) - idempotent, and independent per viewport (disposing one never touches a sibling's). See [docs/architecture/viewport-lifecycle.md](docs/architecture/viewport-lifecycle.md) and [`examples/viewport-lifecycle.ax`](examples/viewport-lifecycle.ax)
- `visible: expr` on a `viewport` is the AXIS-language trigger for that lifecycle: a boolean (`state`-bindable, so `visible: showScene` reacts to a click the same way any other bound property does) that decides whether the viewport has a mounted three.js runtime at all, not just whether its canvas is painted. `true -> false` disposes it completely (see the lifecycle bullet above); `false -> true` mounts a genuinely fresh one - a disposed runtime is replaced, never resurrected; `true -> true`/`false -> false` (an unrelated `state` change re-rendering the page) is a no-op, never a needless dispose+remount. A viewport that starts `visible: false` never creates a renderer in the first place. `visible` also works on *any other* page element now - a plain, cheap `display: none` toggle with no lifecycle to manage, unlike a `viewport`'s. See [docs/architecture/conditional-viewport.md](docs/architecture/conditional-viewport.md) and [`examples/conditional-viewport.ax`](examples/conditional-viewport.ax)

**Reactive state, shared across the page/scene boundary:**
- A top-level `state` is a genuinely shared, mutable cell (not just a value baked in once) - a page's `on` handler can write it and a 3D shape's `color`/`position`/`rotation`/`scale` that reads it re-renders, and the reverse works too: a click on the 3D object can write it and a page's bound text updates. See [docs/architecture/reactive-state.md](docs/architecture/reactive-state.md) and [`examples/configurator.ax`](examples/configurator.ax) (browser- and static-build-verified, both directions).
- No dependency tracking (same honest trade-off `state` inside a page already had) and no named derived values yet - an inline expression combining several `state`s covers the common case.

**Reactive structure - `if`/`for` stay live after load (new in v3.5):**
- A `for`/non-literal `if` directly inside a page/container/component body now re-runs after any handler, anywhere on the page - a `state` array can add/remove real DOM elements, and a boolean `state` can show/hide a whole conditional section, all with the exact same `for`/`if` grammar every earlier example already used. Diffed by each element's own name (not array position), so adding or removing from the *middle* of a list only touches what actually changed. See [docs/architecture/reactive-structure.md](docs/architecture/reactive-structure.md), [`examples/reactive-list.ax`](examples/reactive-list.ax), and docs/language.md's Reactive structure section.
- Fixed alongside it: an `on` handler declared inside a `for` loop can now read that loop's own variable (captured by value, the same idea a `component`'s own params already use) - without this, a loop-generated interactive list had no way to act on *which* item was clicked.
- Scoped to DOM/`component` instances only - a `scene`'s own `if`/`for` still only ever builds once, and a `viewport` inside a reactive block needs the scene it embeds to already be reachable from the page's initial, non-reactive build.

**Responsive layout, nested scroll, and timeline playback (new in v3.5):**
- `responsive: { tablet: { ... } mobile: { ... } }` on any page element - two fixed breakpoints, compiling straight to real `@media` CSS (not JavaScript), so it's correct on the very first paint. See [docs/architecture/responsive-layout.md](docs/architecture/responsive-layout.md) and docs/language.md's Responsive layout section.
- `scrollRoot: "name"` - `scrollTimeline`/`scrollProgress` can now measure against a scrollable *container* instead of only the document, the other half of the "tall wrapper, pinned inner element" pattern. See [docs/architecture/nested-scroll.md](docs/architecture/nested-scroll.md).
- `pause NAME`/`resume NAME`/`reverse NAME` - playback controls for an already-declared `timeline`, alongside the existing `play NAME` restart. `pause` freezes it in place; `resume` continues from exactly there; `reverse` flips direction without losing position or restarting. See [docs/architecture/timeline-playback.md](docs/architecture/timeline-playback.md).
- The DOM and 3D runtimes' animation/timeline stepping math was unified into one shared `src/renderer/tween.js` (see [docs/architecture/tween-extraction.md](docs/architecture/tween-extraction.md)) - a pure refactor, no behavior change, closing a "two implementations to keep in sync" risk.
- Small security/accessibility fixes: `href`/`src` reject unsafe URL schemes (`javascript:`, etc.) at build time for a literal, sanitized live for a reactive one; `<html lang="en">`; `prefers-reduced-motion` now also settles a load-time, perpetually-looping `animate` to its finished state, not just a scroll-linked timeline. See [docs/architecture/accessibility-and-security.md](docs/architecture/accessibility-and-security.md).

**Doesn't exist yet anywhere (real limitations, not secrets):**
- `state`'s "reactive" re-render doesn't actually distinguish `state` from a plain `let` yet - see docs/language.md's State section for exactly what it does and doesn't do
- A component's parameters are resolved once, at the point of use - not a reactive channel back to whatever the caller passed in
- `import` is one name per line, no destructuring/aliasing/renaming
- A runtime error inside an imported plain function's body isn't attributed to its own file yet (an imported component's own body is; see docs/language.md's Modules section)
- Picking which one renders when a file has more than one scene, or more than one page, isn't built - `axis run` always uses the first of each kind and warns about the rest
- `on` handlers can read an *enclosing loop's* own variable now (see above), but still not a plain `let`/`const` local to a `group`/`container`/`if`/`while` - only the scene/page's own top-level names and whichever loop(s) they're nested in.
- A `viewport`'s embedded scene still has no DOM/3D coordinate projection. See docs/architecture/page-scene-fusion.md. Two-way `state` sharing itself is now built (see above) - only a scene's own *objects*/handlers stay domain-local.
- Reactive structure (see above) covers add/remove/conditional-mount for any page element now, not just `viewport` - but still no list reconciliation by data identity (only by an element's own name/position) and no routing. AXIS isn't trying to become a general virtual-DOM framework; there's still no dependency tracking, and a `scene`'s own objects still only ever build once.
- `responsive` overrides aren't reactive - evaluated once, like a literal, not re-checked after a `state` update.
- `play`/`pause`/`resume`/`reverse` don't resolve a component-namespaced or loop-captured target the way `animate`/`on` do - a pre-existing gap `play` already had, not introduced by the new playback controls.
- A rapid click during a `viewport`'s (async) mount window can be missed - it's live within well under a second, but not from the very first frame. See docs/architecture/reactive-state.md.
- A `model`'s `src` resolves relative to the `.ax` file you ran/built, not the file a component that declares it was itself defined in (unlike `import`) - a real, current limitation, not a design decision
- No morph targets or Draco/KTX2-compressed glTF on a `model` yet, and no blending/crossfade between two animation clips (one plays per model at a time) - see docs/language.md's Models section

If you're reading this to see how a small real language pipeline (lexer → parser → evaluator → interpreter → renderer) gets built, that part is real and you can read through `src/`. If you want the full language reference (not just this README), see [docs/language.md](docs/language.md).

## Running AXIS from a clone of this repo

For working on AXIS itself, or running its own example files directly
(to just use AXIS in your own project, see Install above):

```bash
git clone https://github.com/iamyathra/axis-lang.git && cd axis-lang
npm install       # pulls in three.js, the only dependency
npm test          # run the test suite

node bin/axis.js run examples/showcase.ax     # render a 3D scene in your browser
node bin/axis.js run examples/portfolio.ax    # a portfolio page - heading levels, absolute positioning, border/shadow
node bin/axis.js run examples/website.ax      # an ordinary marketing site - header, hero, features, a contact form
node bin/axis.js run examples/counter.ax      # state + animate - a reactive counter with a fade-in badge
node bin/axis.js run examples/app/main.ax     # components + modules - a multi-file project, a reusable Card used twice
node bin/axis.js run examples/planets.ax      # records - an array of planet data drives a whole orbiting scene
node bin/axis.js run examples/model.ax        # a real .glb asset, loaded and animated - the Blender-export workflow
node bin/axis.js run examples/skeletal-animation.ax  # a model's own animation clips - clip:, play/stop, and scroll-scrubbed progress
node bin/axis.js run examples/reactive-list.ax  # reactive structure - a state-driven for/if that adds/removes real DOM elements
node bin/axis.js run examples/nested-scroll.ax  # scrollRoot - scroll-linked timeline/state driven by a scrollable container, not the document
node bin/axis.js run examples/nimbus-studio.ax  # the flagship site - a full studio/portfolio page using everything above together
node bin/axis.js build examples/showcase.ax   # write a static, servable copy to dist/
node bin/axis.js graph examples/showcase.ax   # print the interpreted scene/page graph as JSON
node bin/axis.js check examples/showcase.ax   # just check for syntax errors
```

You can also `npm link` to get an `axis` command on your PATH.

## Embedding AXIS in an existing site

AXIS doesn't have to own the whole page. `mount()` drops one AXIS component into a host-supplied DOM element, coexisting with the rest of your (React or plain) application:

```js
import { mount } from "axis-lang";

const source = await (await fetch("./hero.ax")).text();
const instance = await mount(document.getElementById("hero"), source, { inputs: { title: "Hello" } });
instance.on("notify", (payload) => console.log(payload));
```

```jsx
import { Axis } from "axis-react";
import heroSource from "./hero.ax?raw";

<Axis source={heroSource} title="Hello" onNotify={(payload) => console.log(payload)} />
```

Real, runnable proof examples: `examples/embed-html/` (plain HTML/JS - `node examples/embed-html/serve.mjs` then open `/examples/embed-html/index.html`) and `examples/embed-react/` (a real Vite + React app - `cd examples/embed-react && npm install && npm run dev`). Full design and API details: [docs/language.md](docs/language.md#embedding) and [docs/architecture/embedding.md](docs/architecture/embedding.md).

## Project layout

```text
axis-lang/
├── src/
│   ├── lexer.js          turns .ax source into tokens
│   ├── parser.js         turns tokens into an AST (expressions, statements, scenes, pages)
│   ├── evaluator.js       tree-walking evaluator for expressions/statements - shared by the CLI and the browser
│   ├── globals.js         the standard library (math, vectors, colors, print, ...)
│   ├── suggest.js         "did you mean" typo suggestions for error messages
│   ├── assetPath.js       pure path helpers for a `model`'s `src` - shared by the interpreter, the server, and the browser client
│   ├── interpreter.js     turns the AST into a scene graph or a page graph, using the evaluator - also where `component` expansion lives
│   ├── modules.js         resolves `import`/`export` across files (and local packages under `axis_modules/`, resolved node_modules-style) into one flat program, before interpretation - the only file that touches the filesystem for source resolution
│   ├── run.js             wires the above together (single-file only - no module resolution)
│   ├── cli.js             the axis command
│   └── renderer/
│       ├── plan.js         scene graph -> 3D render plan (pure data, unit tested) - also collects which `model` assets a scene references
│       ├── html.js         wraps a 3D render plan in a minimal HTML page
│       ├── server.js       tiny static server (and static-build writer) for a scene, three.js, and any `model` assets it references
│       ├── client.js       browser-only: turns a 3D render plan into an actual three.js scene, runs `on` handlers live, loads any `model`s via GLTFLoader
│       ├── easing.js       the easing-curve table, shared by client.js and domClient.js
│       ├── domStyle.js     maps page-element properties to CSS - shared by domPlan.js and domClient.js
│       ├── domPlan.js      page graph -> DOM render plan (pure data, unit tested) - also builds a multi-page *router* plan when a file has `route`s
│       ├── domHtml.js      renders a DOM render plan to real, server-rendered HTML (a single page, or - routed - whichever page a request's URL matched)
│       ├── domServer.js    tiny static server (and static-build writer) for a page - or, routed, a real per-request route-matching dev server / one static file per static route
│       ├── router.js       pure route matching (pattern -> params, query string parsing) - no Node/DOM APIs, shared by the dev server and the browser
│       ├── pageRuntime.js  browser-only: the actual page runtime (hydrates/builds the DOM, runs `on` handlers live, re-renders `state`-bound properties, plays page `animate`) - a factory, `createPageRuntime(plan, options)`, shared by domClient.js (standalone), mount.js (embedded), and domRouter.js (routed)
│       ├── domClient.js    browser-only: the standalone-site bootstrap - calls createPageRuntime with `container: document`, or delegates to domRouter.js when the file has `route`s
│       └── domRouter.js    browser-only: the client-side router - matches the URL, mounts the right page, handles navigate()/link clicks/back-forward
├── mount.js             the embedding API - mount()/update()/destroy() an AXIS component into a host DOM element
├── bin/axis.js          CLI entry point
├── packages/axis-react/ the React adapter (a separate package - axis-lang itself never imports React)
├── examples/            .ax files that actually run (embed-html/ and embed-react/ are the embedding proof examples)
├── docs/language.md     the language reference
└── tests/               node's built-in test runner, no extra deps
```

`evaluator.js` and `globals.js` are the interesting bit architecturally: they have zero Node-specific code in them, so the exact same files get imported both by the CLI (to build the scene/page graph) and served straight to the browser (to run `on click` handlers live). One evaluator, two places it runs - that's what makes a click handler able to do real work (`if`, loops, math, mutating other objects) instead of being a fixed list of effects. `interpreter.js` follows the same idea one level up: `SceneBuilder` and `PageBuilder` share a small base class for the parts that don't care which domain they're in (the named-object registry, `on` handling, capturing variables for the browser, and now component expansion), and only differ in which object types exist and what their properties mean - and, since v3.5, `PageBuilder` itself is *also* environment-agnostic enough to be served straight to the browser, so a reactive `for`/`if`'s client-side rebuild reuses the exact same declaration/validation logic the CLI used to build the page the first time, rather than a second implementation of "what does an ObjectDecl mean" (see docs/architecture/reactive-structure.md). `modules.js` protects that same boundary from the other direction: it resolves every `import` into one flat program *before* `interpreter.js` ever runs, so the language core stays completely unaware that multiple files exist.

## Roadmap

As of 2026-09-12, AXIS's mission itself expanded - see [docs/VISION.md](docs/VISION.md) and [docs/architecture/2026-09-language-platform-audit.md](docs/architecture/2026-09-language-platform-audit.md) for the current strategic direction (a real, extensible, general-purpose language/platform, not just a web+3D DSL) and the phased plan driving what comes next. Roughly in order:

1. ~~A ternary/conditional expression~~ - done: `condition ? a : b`, plus anonymous `fn(x) { ... }` function expressions (needed to make the new stdlib's `map`/`filter`/`sortBy`/... actually usable) - see docs/language.md's Control flow/Functions sections and [`examples/stdlib.ax`](examples/stdlib.ax)
2. ~~A per-frame hook~~ - done: `on tick { ... }`, given real elapsed-time `dt` (seconds) each frame, works in a scene or a page - see docs/language.md's "Per-frame updates" section and [`examples/tick.ax`](examples/tick.ax). The actual prerequisite for any future physics/game-loop/ECS work, more fundamental than any of those individually.
3. ~~Replace the hardcoded object/property/*existence and construction* dispatch with a registry~~ - done for both domains (`interpreter.js`'s `DOM_LEAF_TYPES`/`LIGHT_TYPES`, `domHtml.js`/`pageRuntime.js`'s tag tables, `scene3d.js`'s `SHAPE_GEOMETRIES`/`LIGHT_BUILDERS`). **Not yet done, and it's the bigger piece**: the *property-application* vocabulary (`applyChange`/`currentLiveValue`/`LiveObject`, `applyElementProperty`/`LiveElement`) - on inspection this needs a real design pass, not a mechanical fix; see the platform audit's addenda.
4. ~~Data with behavior~~ - done: a record's function fields get `self` bound automatically, at access time (not call time - deliberately not JavaScript's own `this`), so a record can hold real methods with zero new syntax - see docs/language.md's "Data with behavior" section and [`examples/entities.ax`](examples/entities.ax)
5. ~~Local package resolution~~ - done: a bare `import Name from "some-package"` resolves against `axis_modules/some-package/index.ax`, walked up node_modules-style - no manifest/registry/lockfile yet, deliberately local-only for now. See docs/language.md's "Local packages" section and [`examples/app-with-package/`](examples/app-with-package/).
6. ~~A real third-party-package proof~~ - done: [`examples/physics-demo/`](examples/physics-demo/)'s `axis_modules/physics2d/` (gravity/bounce) built with zero changes to `src/`, composing only what already existed. Also surfaced a real gap this way (not a guess): keyboard input couldn't have passed the same test - fixed next.
7. ~~Keyboard + mouse input~~ - done: `on keydown`/`on keyup` (`key`) and `on mousemove`/`on mousedown`/`on mouseup` (`dx`/`dy`/`button`) - see docs/language.md's "Keyboard input"/"Mouse input" sections and [`examples/keyboard-input/`](examples/keyboard-input/) (a local package tracking held keys) / [`examples/mouse-input.ax`](examples/mouse-input.ax). Deliberately minimal - no pointer-lock/wheel/gamepad yet, and no mouse-look camera controller (real trigonometry with no way to visually verify it here - left for the actual game-dev-foundation phase, where it can be checked against a running scene).
8. ~~A real first-person camera controller~~ - done: mouse-look (yaw/pitch from `on mousemove`, aimed via `camera.target`) plus WASD/arrow movement relative to facing direction, built entirely from existing primitives - see docs/language.md's "A first-person camera controller" section and [`examples/fps-controls/`](examples/fps-controls/). Building it surfaced and fixed a real, previously-undiscovered interpreter bug: a literal vector property (`position: (0, 2, 8)`) wasn't recognized as literal, so it was spuriously treated as a reactive binding that got reset to its original value after every handler call - silently breaking *any* `on tick`-driven movement of a literally-positioned object, including the original `examples/tick.ax` bounce. Fixed (`isLiteralExpr` in `interpreter.js`); see the platform audit's addendum for the full account and what's still unaudited (pre-pivot examples for the same pattern).
9. A way for a page-level handler to `play`/`pause`/`reverse` a `viewport`'s embedded scene's own timeline by name, not just via `scrollTimeline`
10. Loop, completion callbacks, and a playback-speed multiplier for `timeline`s and a `model`'s own animation clips
11. CSS grid as a second layout mode alongside flexbox, if a real build ever actually needs it (flexbox + `responsive` has covered everything so far)
12. ~~An audit of pre-pivot examples for the same literal-vector-binding bug item 8 fixed~~ - done: every example under `examples/` (and `examples/*/`) was checked for the bug's actual precondition (a literal vector property mutated by a handler that reads its own current value, not just set to a fixed constant) - `examples/configurator.ax`/`interaction.ax`/`showcase.ax`'s hover/unhover handlers only ever set a fixed literal, so they can't exhibit the symptom either way; `examples/fps-controls/`, `examples/fps/`, and `examples/keyboard-input/` are post-pivot (written after the fix, and already covered by `tests/browser/fps-controls.test.js`/`fps.test.js`/`camera-controller.test.js`). `examples/tick.ax` - the one pre-pivot example that actually has the pattern, and the file the original bug report was about - had only a hand-copied mirror as regression coverage (`tests/browser/tick.test.js`), never the real file, and never run long enough to reach its own bounce boundary. `tests/browser/example-tick-bounce.test.js` closes both gaps: it loads the real file from disk (an exact-line match that fails loudly if the file's own accumulation line ever changes shape, rather than silently drifting) and samples long enough to prove the bounce itself - a genuine rise-then-fall, not just one-way accumulation.
13. Whatever breaks along the way that I didn't expect

## License

MIT, see [LICENSE](LICENSE).
