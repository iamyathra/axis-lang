# AXIS vision / roadmap notes

*(Supersedes the earlier "Native 3D Vision" framing — as of 2026-09-12 AXIS's
mission is no longer scoped to 3D-native web experiences only.)*

These are my own working notes on where I want AXIS to go, kept here so I
stay consistent about it across sessions. It's not a polished pitch - it's
closer to a personal design doc I keep adding to.

## Mission

I don't want AXIS to stay a 3D DSL, an animation system, or a game-scripting
experiment. I want it to become a real, general-purpose programming language
and development platform - something you can build ambitious software in,
not just neat demos.

The short version of where I'm aiming:

> AXIS is a programming language for building ambitious interactive
> software on the web, with 3D, graphics, animation, games, UI, and
> real-time interaction as first-class capabilities.

Some properties I care about, roughly in the order I think about them:

* genuinely programmable, not just a config format with a scene keyword
* extensible without me having to add a new builtin every time someone
  wants something new
* expressive and reasonably fast
* something I could actually ship real things with (my own included)
* pleasant to write by hand, and to generate/repair with AI tooling
* able to support things I never specifically planned for

I don't want AXIS to be a fixed list of predetermined features. I want
people (including future me) to be able to build their own abstractions on
top of the primitives it gives them.

---

# 1. Start with the existing codebase

Before I add anything new, I need to actually understand what's already
there:

* lexer
* parser
* AST
* interpreter
* planner
* runtime
* state system
* events
* components
* modules
* scene system
* DOM runtime
* 3D runtime
* animation
* timelines
* cameras
* lighting
* materials
* assets
* models
* viewport
* routing
* CLI
* tests
* Playwright/browser tests
* examples
* build configuration
* package configuration

AXIS already has a decent amount of working functionality by v3.8, including
the 3D/animation stack. I'm not going to rewrite something that already
works just because I'd have written it differently today - I read it first,
figure out what's solid and what's actually broken or limiting, and go from
there. Concretely, before a milestone I try to note:

* strong foundations
* architectural debt
* missing primitives
* duplicated concepts
* accidental limitations
* APIs that need stabilizing
* systems that should become extensible

Then implement incrementally, not all at once.

---

# 2. AXIS should be a real programming language

This is the top-level thing everything else serves. I don't want AXIS to be
"a nicer syntax bolted onto a fixed engine" - I want people to be able to
write general programs in it.

Fundamentals I want covered, where it actually makes sense for AXIS:

* variables
* constants
* expressions
* operators
* functions
* closures
* higher-order functions
* conditionals
* loops
* iteration
* collections
* arrays
* maps/dictionaries
* records/objects
* user-defined types
* modules
* imports
* exports
* namespaces
* destructuring
* pattern matching
* errors
* asynchronous programming
* promises/futures
* callbacks
* timers
* events
* generics or some equivalent abstraction mechanism

I'd rather design these around what actually fits AXIS than blindly copy
another language's syntax. Readability matters more to me than cleverness
here.

---

# 3. Extreme customizability

This is probably the single principle I care about most: AXIS should give
people general primitives, not a hardcoded feature for every use case I can
think of.

What I want to avoid:

```text
fpsEnemy
fpsWeapon
fpsDoor
fpsHealth
racingCar
platformerPlayer
quest
inventory
```

What I want instead:

```text
entity
component
system
event
input
physics
animation
state
resource
```

People should be able to build the higher-level concepts themselves -
their own components, types, systems, libraries, gameplay mechanics,
rendering systems, UI systems, whatever - without touching the AXIS
compiler.

---

# 4. User-defined abstractions

AXIS needs a real mechanism for building abstractions. Conceptually,
something like:

```axis
component Health {
    value: 100

    damage(amount) {
        value -= amount

        if value <= 0 {
            emit "death"
        }
    }
}
```

composed like:

```axis
entity Enemy {
    Health
}
```

I'm not locking in that exact syntax - it should come out of the existing
language architecture, not be forced in from outside. The requirement that
actually matters: people should be able to build systems I never imagined
when I designed AXIS.

---

# 5. Type system

I want a type system serious enough for real applications, covering:

* type inference
* explicit types
* primitive types
* collections
* function types
* object/record types
* user-defined types
* nullable/optional values
* unions where appropriate
* generics or an equivalent mechanism
* compile-time checking

Explicit when you want it:

```axis
let health: number = 100
let name: string = "Player"
let alive: bool = true
```

Inferred when you don't:

```axis
let health = 100
let name = "Player"
```

The compiler should catch obviously invalid operations, but I don't want to
trade away quick iteration for type ceremony nobody asked for.

---

# 6. First-class functions

Functions should be real values, not second-class citizens:

```axis
fn add(a, b) {
    return a + b
}
```

```axis
let operation = add
```

plus higher-order functions where they make sense. This matters for
gameplay code, UI, callbacks, data processing, events, async code,
libraries, and functional-style patterns generally.

---

# 7. Asynchronous programming

AXIS needs to handle real workloads - asset loading, network requests,
timers, concurrent tasks - without making people fight the runtime just to
load a model, a texture, some audio, or a network resource. I want coherent
primitives for async operations and promises/futures, not a pile of
callback soup.

---

# 8. Modules and packages

AXIS should scale from a single `hello.ax` up to a real multi-file project:

```text
src/
    main.ax
    player.ax
    weapons.ax
    enemies.ax
    ui.ax

levels/
    level1.ax
    level2.ax

assets/
```

That means real imports, exports, module boundaries, reusable libraries,
package dependencies, and versioning - all without anyone having to reach
into compiler internals to make it work.

---

# 9. Standard library

AXIS needs an actual standard library, thought through rather than bolted
on piece by piece. Rough areas I want covered:

### Core

* strings
* arrays
* maps
* sets
* math
* dates/time
* random
* serialization

### IO

* files where supported
* streams where appropriate

### Web

* URL
* HTTP
* fetch/networking
* browser APIs through safe abstractions

### Async

* promises
* timers
* scheduling

### Data

* JSON
* structured serialization

### Math

* vectors
* matrices
* quaternions
* interpolation
* geometry

I want to keep pushing capability into the standard library instead of the
language core - the language itself should stay small (see section 38).

---

# 10. 3D stays first-class

I'm not regressing the existing 3D work. By v3.8 AXIS already has a decent
foundation: scenes, cameras, lights, materials, textures, models,
environment, animation, timelines, viewports, state binding, and real
browser testing. I want to keep improving that, not sideline it.

But: 3D is a first-class subsystem of AXIS, not the entire definition of
AXIS.

---

# 11. Real game development

I want AXIS capable of building actual browser games, via general
primitives:

* game loops
* entities
* components
* systems
* input
* physics
* collisions
* raycasting
* animation
* audio
* UI
* scenes
* state
* AI
* networking
* assets

The goal is that people can build FPS games, platformers, third-person
games, racing games, strategy games, simulations, puzzle games, sandbox
games, or multiplayer prototypes, without the language itself being
hardcoded around any one genre.

---

# 12. FPS as a proof, not a language feature

I want a complete, playable FPS example - first-person controller, mouse
look, pointer lock, movement, jumping, collision, weapons, shooting,
raycasting, damage, health, enemies, AI, pickups, ammo, reload, level
state, HUD, objectives, win/lose, restart - all of it.

But I'm not adding an `fps` primitive to make that example easier to build.
The FPS has to come out of AXIS's general systems. That's the actual proof
the architecture works, not the example itself.

---

# 13. Physics

I want a serious, browser-compatible physics integration behind an AXIS
abstraction: rigid/static/dynamic bodies, colliders, gravity, velocity,
impulses, collision events, triggers, raycasts, collision layers/masks,
and character controllers where it makes sense. Physics should stay
modular - the underlying engine shouldn't leak into every corner of user
code.

---

# 14. Entity / component / system model

I want a flexible entity architecture: identity, hierarchy, transforms,
components, tags, layers, lifecycle, events, enabled/disabled state.
Components composable, systems operating over entities/components. Not
every mechanic should be a built-in component - people should be able to
build their own.

---

# 15. Game loop

A solid runtime loop: update, fixed update, render, late update where
useful, delta time, fixed timestep, pause, resume, time scaling. Behavior
shouldn't depend on frame rate, and this needs real regression tests.

---

# 16. Input system

One unified input abstraction: keyboard, mouse, pointer, touch, gamepad,
buttons, axes, key state, mouse movement, pointer lock, configurable
bindings. Genre-independent - it shouldn't assume you're building an FPS or
a platformer.

---

# 17. Audio

A first-class audio API: sound effects, music, looping, volume, playback,
pause, stop, positional audio, listener, spatial attenuation, and
audio channels/buses where practical. Same asset lifecycle as everything
else, not a separate system.

---

# 18. UI

First-class UI for real applications and games: text, images, panels,
buttons, lists, layouts, inputs, progress bars, menus, overlays, HUD,
responsive behavior. People shouldn't have to hand-roll raw DOM
manipulation for ordinary AXIS UI - but the lower-level web APIs should
still be reachable when someone actually needs them.

---

# 19. Rendering extensibility

I don't want to trap advanced users inside a fixed rendering abstraction.
Escape hatches matter: custom shaders, custom materials, custom render
passes where practical, custom post-processing, GPU-oriented APIs, lower
-level rendering access. Simple by default, no artificial ceiling for
experts.

---

# 20. Web development

AXIS should stay capable of building ordinary web applications, not just
3D scenes - HTML, UI, routing, forms, data, networking, state,
accessibility, responsive layouts. It shouldn't become "3D-only."

---

# 21. HTML interoperability

AXIS needs to slot into ordinary web projects - using AXIS from an existing
HTML/JavaScript codebase without rewriting the whole thing in AXIS.

---

# 22. React interoperability

I want AXIS to integrate cleanly with React: embedding AXIS scenes,
components, animations, and interactive 3D experiences inside a React app,
and the reverse - embedding ordinary web content inside AXIS - without
hacks. This is what `packages/axis-react` is for.

---

# 23. Escape hatches

This matters a lot to me for AXIS to be taken seriously: it should never
have to say "you can't do that because AXIS doesn't have a feature for it."
Controlled lower-level access where appropriate - browser APIs, JavaScript
interop, Web APIs, GPU APIs, external libraries, platform functionality.
Opinionated at the high level, but never boxing in an expert user.

---

# 24. Production readiness

A separate goal from "the language works": I want AXIS to actually be
trustworthy to build real things with, not just fun to prototype in.
Things I think that requires:

### Stability

* semantic versioning
* stable release channels
* compatibility policy
* deprecation policy
* migration tooling
* predictable releases

### Reliability

* comprehensive testing
* regression suite
* browser testing
* memory/disposal tests
* performance benchmarks

### Tooling

* formatter
* linter
* language server
* autocomplete
* diagnostics
* debugger
* profiler
* test runner

### Build

* development builds
* production builds
* optimization
* asset bundling
* reproducible builds
* source maps where appropriate

### Security

* dependency auditing
* package integrity
* permission model
* safe execution
* supply-chain considerations

I'd rather under-claim this than over-claim it - "production-ready" only
means something once it's actually demonstrated, not just designed for.

---

# 25. CLI

I want the CLI to feel like a real developer tool over time:

```text
axis init
axis dev
axis run
axis check
axis build
axis test
axis format
axis lint
axis add
axis remove
axis update
axis package
```

Only add a command if it earns its place architecturally - every command
should give useful errors and predictable behavior.

---

# 26. Package manager

Eventually, a real dependency ecosystem - installing third-party AXIS
libraries:

```text
axis add physics
axis add networking
axis add audio
axis add ui
```

```axis
import physics
import networking
```

The exact package syntax/registry design isn't settled - it needs version
resolution, lockfiles, dependency graphs, reproducible installs, integrity
checks, and real package metadata, thought through carefully rather than
copied wholesale from npm.

---

# 27. Language server / IDE support

This matters a lot for anyone actually adopting AXIS: autocomplete,
diagnostics, go-to-definition, symbol search, hover info, rename,
formatting, syntax highlighting, code actions. VS Code first, since that's
the practical path - but nobody should need a custom editor just to get a
decent AXIS experience.

---

# 28. Debugger

A real debugging story eventually: inspecting variables, call stacks,
state, entities, components, events, scene hierarchy, and runtime errors.
Game developers in particular need to be able to pause and inspect what's
actually happening.

---

# 29. Profiler

Production-oriented profiling: frame time, update time, rendering,
physics, memory, asset loading, entity counts, draw calls where available,
event activity. I don't want to claim a performance improvement I haven't
actually measured.

---

# 30. Performance

A real benchmark suite, tracked over time: parser performance,
compilation/planning, startup, scene creation, entity creation, update
loop, rendering, physics, raycasting, animation, asset loading, memory,
disposal. Regressions should be visible, not discovered by accident.

---

# 31. Memory and resource safety

The runtime needs solid lifecycle semantics - event listeners, timers,
textures, materials, models, scenes, physics bodies, audio, GPU resources,
DOM nodes, all properly disposed. Automated leak/disposal tests, not just
"it seemed fine in manual testing." AXIS needs to be safe for long-running
applications, not just quick demos.

---

# 32. Error system

I want AXIS errors to actually help, not just technically report a
problem. Not:

```text
Unexpected token
```

when there's useful context to give instead. What a diagnostic should
include: error type, location, source excerpt, explanation, expected
syntax, a possible correction, related errors. Something like:

```text
AXIS Error

Unknown property 'damge' on Weapon.

Did you mean 'damage'?

  18 | damage: 25
  19 | damge: 10
             ^

Available properties:
  damage
  fireRate
  range
  magazine
```

That means real diagnostics infrastructure in the compiler, not string
concatenation at the point of failure.

---

# 33. AI-friendly, not AI-dependent

I want AXIS to be genuinely easy for AI coding tools to generate and
understand correctly - predictable grammar, clear semantics, consistent
APIs, useful diagnostics, machine-readable errors, structured project
metadata, deterministic formatting. That's why `docs/ai/` and
`axis check --json` exist.

But AXIS still needs to be fully usable by a human with no AI involved at
all. AI is a force multiplier here, not the foundation the language
depends on.

---

# 34. Documentation

I want documentation that actually teaches, progressively:

```text
AXIS
 ↓
Language basics
 ↓
Functions
 ↓
Types
 ↓
Modules
 ↓
State
 ↓
Events
 ↓
Web
 ↓
3D
 ↓
Animation
 ↓
Games
 ↓
Physics
 ↓
Networking
 ↓
Packages
 ↓
Production
```

With real examples throughout - not documentation that just restates
implementation details back at the reader.

---

# 35. Real example projects

Examples big enough to actually stress-test the language, not just show a
syntax snippet:

### Example 1 — FPS

A playable FPS.

### Example 2 — Platformer

A real playable platformer.

### Example 3 — Third-person game

Character + camera + combat.

### Example 4 — Racing

Vehicle + physics + track + checkpoints.

### Example 5 — Interactive 3D website

Demonstrate AXIS outside games.

### Example 6 — Business-style web application

Demonstrate that AXIS can build ordinary software, not just games/demos.

### Example 7 — Creative experiment

Something visually interesting that shows off AXIS's flexibility.

These should double as regression tests for the platform, not just
one-off demos that bit-rot.

---

# 36. AXIS Studio

Once the underlying architecture is stable, I want to build toward an AXIS
Studio: project explorer, scene tree, entity inspector, asset browser,
game preview, console, debugger, state inspector, timeline tools,
profiler, diagnostics. Not a separate engine - it should consume the exact
same compiler/runtime APIs the CLI does, nothing duplicated.

---

# 37. Extensibility

The property I think matters most long-term: AXIS should be extensible
without me personally having to implement every new idea. Third parties
should eventually be able to build physics libraries, networking
libraries, UI frameworks, AI libraries, game frameworks, database clients,
visualization tools, creative-coding libraries, business-application
libraries - all without modifying the language itself.

---

# 38. Don't turn AXIS into a monster

No endless new syntax. Keep the language core small, and put capability
into the standard library, runtime, modules, packages, and APIs instead.
The core language's job is to compose well, not to grow forever.

---

# 39. Don't copy other languages blindly

Worth studying: Python, JavaScript/TypeScript, Rust, Go, C#, Lua, Swift,
Kotlin - their syntax, tooling, package management, type systems, error
messages, ecosystem design, backwards-compatibility approach, developer
experience. Worth learning from, not worth copying wholesale. AXIS should
end up with its own identity, not be a patchwork of borrowed syntax.

---

# 40. Built for real projects, not just hobby scripts

Thinking beyond quick demos - a real project eventually needs:

```text
Developer
    ↓
AXIS project
    ↓
Git
    ↓
Dependencies
    ↓
Tests
    ↓
CI
    ↓
Production build
    ↓
Deployment
    ↓
Monitoring
```

AXIS should fit into that workflow naturally - standard Git workflows,
CI/CD, code review, testing, package management, deployment, observability
- instead of fighting it.

---

# 41. Backwards compatibility

AXIS already has real examples and real code depending on current
behavior. I don't want to casually break the language. Before breaking any
syntax: identify affected examples, figure out a migration path, provide
compatibility where practical, update documentation, add migration notes,
bump versions appropriately. Evolution over unnecessary rewrites.

---

# 42. Testing standard

Every major capability needs real tests, not just "it ran once":

### Language

* lexer
* parser
* AST
* type system
* diagnostics
* modules

### Runtime

* state
* events
* lifecycle
* async
* game loop

### 3D

* scene
* camera
* materials
* textures
* models
* lighting
* environment
* animation

### Games

* input
* physics
* collision
* controllers
* weapons
* AI

### Browser

Real Playwright tests.

### Performance

Automated benchmarks where practical.

### Memory

Disposal/leak regression tests.

I never want to weaken an existing test just to make a new feature pass -
that standard became a lot more concrete after two real bugs slipped past
a weaker version of it.

---

# 43. What success actually looks like

I don't want to judge AXIS by feature count. The real question is whether
someone can have an idea and then actually build it in AXIS, without
discovering the language only supports the exact things I happened to
predict.

The test that matters: can people build things I never imagined when I
designed this? If yes, the architecture is working.

---

# 44. How I want to position this

I don't want AXIS's identity to end up as "a JavaScript alternative for
games," "a Three.js wrapper," "an FPS scripting language," or "an
AI-generated coding language." What I'm actually aiming for:

> AXIS is a programming language for building ambitious interactive
> software on the web, with 3D, graphics, animation, interaction, and games
> as first-class capabilities.

That's a much bigger ceiling than any of those narrower framings.

---

# 45. Questions I check decisions against

Before committing to an implementation choice, I try to ask:

1. Does this make AXIS more programmable?
2. Does it give users more freedom?
3. Does it make the language easier to learn?
4. Does it make serious applications easier to build?
5. Can third parties extend it?
6. Would I actually trust it for something real?
7. Does it preserve AXIS's existing strengths?
8. Does it avoid unnecessary complexity?

If the honest answer to most of these is no, I reconsider the
implementation.

---

# 46. Work in phases

I'm not doing this as one uncontrolled rewrite. Every milestone should go
through:

1. audit the existing architecture
2. define the design
3. implement the smallest coherent foundation
4. add tests
5. add browser tests where relevant
6. update examples
7. update documentation
8. run the complete test suite
9. run browser tests
10. run benchmarks where relevant
11. inspect regressions
12. continue only once the foundation is actually stable

No claiming something's done before it's done.

---

# 47. Final audit checklist

At the end of a transformation like this, I want an honest report covering:

* current architecture
* language capabilities
* type system
* standard library
* runtime
* 2D capabilities
* 3D capabilities
* game capabilities
* web capabilities
* interoperability
* package system
* CLI
* tooling
* language server
* debugger
* profiler
* testing
* browser compatibility
* performance benchmarks
* memory/resource safety
* production readiness
* security considerations
* example applications
* breaking changes
* migration path
* documentation
* remaining limitations
* roadmap

Honestly, not optimistically. Code existing isn't the bar - the bar is
implemented + integrated + tested + documented.

---

# Why I'm actually doing this

I'm not building AXIS just so I can make cool things with it myself. I want
other people to want to use it for their own stuff. The real success
condition, to me, looks like: someone finds AXIS, installs it, understands
the language, builds something they're proud of, shares it, and picks AXIS
again for their next project.

Not because it has the most features, not because it has the coolest
syntax, and not because an AI can generate it - because people who try it
actually prefer building with it.
