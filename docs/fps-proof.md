# AXIS FPS Flagship Proof — Final Report

The central question this milestone answers: **can AXIS build a real
interactive 3D game using its own language, public APIs, packages, ECS,
runtime extensions, and general-purpose runtime primitives — without
hardcoding FPS-specific behavior into AXIS core?** See
[`examples/fps/`](../examples/fps/) for the actual application and its own
README; this document is the architectural report.

## 1. Baseline

Audited before writing anything: 923 unit tests, 39 browser tests, clean
tree at the previous milestone's own final commit (`a649a33`). Read
`docs/VISION.md`, `docs/extensions.md`,
`docs/runtime-extensions.md`, the language-platform audit's game-
foundation addenda, `examples/game-foundation/`, `examples/fps-controls/`,
and `docs/language.md`'s Interaction/Animation/Modules sections before
designing anything.

## 2. Game scope

A small, real, playable vertical slice, deliberately not a feature-
complete game (per the milestone's own "do not attempt a complete
commercial game" instruction): a first-person arena with four fixed
targets. The player looks around (mouse), moves (WASD), shoots (click,
via a real camera-centered raycast), does real damage that accumulates
over multiple hits, destroys a target once its health reaches zero,
tracks score in a HUD, and can reset the round (R) to play again.

**Deliberately out of scope, documented rather than silently skipped**
(classification E from the milestone's own capability matrix, §8):

- **No player health / no enemy attacks.** Targets are static, not AI
  agents - they don't move, patrol, or damage the player. Item 13 of the
  milestone's own instructions explicitly permits "a target may: stand
  still" as the baseline, and item 29 explicitly forbids scope-padding
  ("do not add features just for the FPS"). Adding enemy AI would roughly
  double this slice's real complexity for a capability this report's own
  central question doesn't depend on proving.
- **No audio.** Audited (§17 below) - AXIS has no audio primitive at all
  today; out of scope rather than silently expanding this milestone into
  also being the audio milestone.
- **No projectiles** (hitscan only, via `raycast.fromCamera()`) - a
  simpler, equally real "shooting" model; a travelling-projectile variant
  would reuse the exact same `visible`-toggling object-pooling pattern
  this slice's targets already prove, not a new capability.

## 3. Capability audit

| Required capability | Already existed? | Classification | Resolution |
|---|---|---|---|
| Keyboard movement (WASD) | Yes (`examples/fps-controls/axis_modules/input`, `camera`) | A | Reused unchanged |
| Mouse-look | Yes (same packages) | A | Reused unchanged |
| Pointer lock | Yes (`pointerLock`, a core scene handle) | A | Reused unchanged |
| Vector/trig math | Yes (stdlib) | A | Reused unchanged |
| Entities/components/systems | Yes (`examples/game-foundation/axis_modules/ecs`) | A | Reused unchanged |
| "What's under the crosshair" (aiming/shooting) | **No** - existing click/hover raycasting is mouse-position-driven and only considers handler-carrying objects; nothing answers "what's dead center" | B (general primitive) | Added `raycast.fromCamera()` - see §4 |
| Removing/"destroying" a live 3D object | **No** - a scene's own objects are not reactive (`docs/language.md`'s Reactive structure section - `if`/`for` inside a `scene` only ever build once) | C (external package) | `axis-visibility` runtime extension (`visible` scalar property) + object-pooling - see §4/§6 |
| Health/damage | No dedicated primitive, but directly expressible as "data with behavior" (`docs/language.md`'s own Health example) | D (application logic) | `makeHealth` in `main.ax`, an ECS `Health` component |
| Weapon (damage/cooldown/range) | N/A | D | A plain data record in `main.ax` - a different weapon is a different record, nothing hardcoded |
| HUD | Yes (ordinary DOM page primitives) | A | `text`/`container` elements bound to shared `state` |
| Reset | N/A | D | An `on keydown` branch (see §9) |
| Collision (player vs. walls) | No | E | Out of scope - the arena is open enough that this slice doesn't need it; a real collision primitive is a substantial, separate design question this milestone doesn't force |
| Audio | No | E | Out of scope - documented in §17 |

## 4. Generic primitive added: `raycast.fromCamera()`

The only change to `src/` this entire milestone made (see §11's full
audit). Added to `scene3d.js` as a second always-available scene handle
(no import needed, same shape as `pointerLock`):
`raycast.fromCamera(maxDistance?)` casts a ray from the viewport's own
center and returns `null` or `{name, distance}` for the nearest real hit,
by the object's own AXIS name. Justified the same way `pointerLock` was:
no `.ax` package could build this (it needs three.js's own `Raycaster`
and a live camera transform), and it's genuinely useful outside a
shooter - object selection, an aiming reticle in any genre, a line-of-
sight check in a non-game 3D app. See
[docs/language.md](../docs/language.md)'s Raycasting section for the
full language-facing contract and
[tests/browser/raycast-from-camera.test.js](../tests/browser/raycast-from-camera.test.js)
(4 tests) for its own isolated proof - a centered hit resolves correctly,
the nearest of two objects along one ray wins, a real hit beyond
`maxDistance` is treated as no hit, and the reported distance is real,
correct three.js math.

**Core freeze checkpoint: `45ea137`.** Everything from here down was
built with `git diff -- src/` verified empty.

## 5. FPS application architecture

`examples/fps/main.ax`, one file, composing:

- **`makeHealth(maxValue)`** - a top-level `fn`, the same "data with
  behavior" shape `docs/language.md`'s own Health example uses (`damage`,
  `isDead`), added as a `Health`-typed ECS component to each target
  entity.
- **`freshWorld()`** - builds a `makeWorld()` with four `makeEntity(name)`
  entities (`target0`..`target3`), each carrying one `Health(3)`
  component. Called both at scene load and on reset, so there's exactly
  one definition of "what a fresh round looks like."
- **`weapon`** - a plain record (`damage`, `cooldown`, `range`) - a
  different weapon is a different record; nothing about "the weapon" is
  hardcoded into any function signature.
- **Targets are pre-declared, pooled 3D objects** (`sphere target0`..
  `target3`), not spawned/destroyed at runtime - a scene's own objects
  build once, at load (see `docs/language.md`'s Reactive structure
  section); "destroying" one sets its `visible` property (the
  `axis-visibility` runtime extension) to `false` instead.
- **`on mousedown`** is the entire combat loop: gated on
  `pointerLock.isLocked` and the weapon's own cooldown, it calls
  `raycast.fromCamera(weapon.range)`, resolves the hit's name against the
  ECS world's own entities (`find(world.entities, ...)`), and applies
  damage to the matching `Health` component if one exists and isn't
  already dead.
- **`on tick`** drives input→camera→movement, in that fixed order (see
  §9), reusing `examples/fps-controls/main.ax`'s own established pattern
  verbatim.

No new record "type," no privileged runtime object - every piece here is
exactly as ordinary as any other AXIS record/function a developer could
have written unprompted.

## 6. External packages used

| Package | Source | Provides |
|---|---|---|
| `input` | Copied unchanged from `examples/fps-controls/axis_modules/input` | Normalized keyboard/mouse state (`isKeyDown`, `mouseDX`/`mouseDY`, `endFrame`) |
| `camera` | Copied unchanged from `examples/fps-controls/axis_modules/camera` | `makeFpsCamera` - yaw/pitch look, facing-relative movement |
| `ecs` | Copied unchanged from `examples/game-foundation/axis_modules/ecs` | `makeWorld`/`makeEntity`/`runSystems` |
| `axis-visibility` | New (this milestone) | `registerScalarProperty("visible", ...)` - a third, independently-authored runtime extension (see `docs/runtime-extensions.md`), unrelated to `axis-wireframe`/`axis-line-width` from the previous milestone, reusing the exact same public API |

Each package lives under `examples/fps/axis_modules/` (package resolution
is per-project, so a fresh copy is required - see
[docs/extensions.md](../docs/extensions.md) for why there's no cross-
project package sharing yet). Copying `input`/`camera`/`ecs` verbatim,
unmodified, is itself part of the proof: the exact same reusable systems
that powered `examples/fps-controls/`/`examples/game-foundation/` work,
with zero changes, for a genre neither of those examples was written for.

## 7. Browser proof

`tests/browser/fps.test.js` (6 tests), via `harness.js`'s `withPageFile` -
the real `main.ax`, with its real package imports, served and driven end
to end:

1. The page loads and the arena actually renders.
2. Clicking the arena acquires a real pointer lock.
3. WASD strafing survives real held time (not an instant tap).
4. **Shooting a target across three separately-timed real shots** reduces
   its health each time, survives the first two (3 HP, 1 damage/shot),
   and is destroyed - with the score updating - only on the third.
5. Shooting real, non-target scene geometry (the arena's own back wall)
   reports a clean "Miss," not a silent no-op.
6. **Pressing R resets the round** - score returns to 0, and the reset
   target is provably alive again (hittable) afterward, not just the
   score counter reset independently of real game state.

All six pass; verified stable across 3 consecutive standalone runs and,
more importantly, 3 consecutive **full** `npm run test:browser` runs
(49/49, every time) after the complete set of fixes in §8 - the load-
induced case that actually mattered, since this file's own aim-drift
flake only ever surfaced under full-suite concurrency, not in isolation.

## 8. Two real bugs this milestone's own testing found (and fixed, honestly)

Both are worth recording in full - this is exactly the kind of thing
this project's testing philosophy exists to catch, and neither was assumed
away to make the report look cleaner.

**A real gameplay-logic bug**: the first draft of `on mousedown` only set
`statusText = "Miss"` when `raycast.fromCamera()` returned `null` -
forgetting that `raycast.fromCamera()` deliberately considers *every*
named object in the scene (see `docs/runtime-extensions.md`), including
the arena's own walls/floor. Aiming dead ahead (the default spawn
orientation) genuinely hits the back wall, not empty space - `hit` was
non-null, but no target entity matched it, and the code silently did
nothing, leaving stale status text. Found via this milestone's own
browser testing (not a code read), root-caused by adding temporary
`statusText` debug breadcrumbs at each step and observing exactly where
execution stalled. Fixed by treating "hit resolves to no live target
entity" and "no hit at all" identically as a miss - see `main.ax`'s own
comment on the fix for the three cases it now collapses into one.

**A real, confirmed browser-automation limitation** (not a product bug):
Playwright's `page.mouse.click()`/`down()`/`up()` while the pointer is
locked injects spurious, non-zero `movementX`/`movementY` into the
*click itself*, not just deliberate mouse-move calls - confirmed directly
by instrumenting a raw `mousemove` listener during a locked click and
observing real (if noisy, largely self-cancelling) deltas. Since `on
tick` applies any accumulated `mouseDX`/`mouseDY` to yaw whenever locked
(correctly - that's what a real click-to-shoot game should do), this
measurably, unpredictably rotated the camera between shots in the
original test, making an otherwise-deterministic three-shot sequence
fail intermittently (confirmed by re-running it repeatedly and watching
the failure rate). Fixed in the *test*, not the game: firing shots via
`window.dispatchEvent(new MouseEvent("mousedown", {button: 0}))` instead
of Playwright's mouse API - a real DOM event, exactly what `on mousedown`
listens for, with no synthesized pointer-position side effect riding
along. Verified stable across 4 consecutive standalone runs after the
fix (0 failures), versus roughly half of a similar batch failing before
it - but a subsequent full `npm run test:browser` run (all 49 tests
concurrently, not this file alone) kept intermittently failing the same
tests anyway, which turned out to be a *second*, deeper instance of the
identical root cause: the one click that genuinely still has to go
through Playwright's mouse API - acquiring pointer lock itself needs a
trusted gesture, which `dispatchEvent` isn't - injects the exact same
kind of one-time `movementX`/`movementY` burst, confirmed the same way,
and `on tick` correctly folds it into yaw the instant lock completes,
before any deliberate strafing even starts. A fixed-duration "strafe
right N ms" assumption bakes in `yaw = 0`, which this made false in an
unpredictable, per-run way. Fixed with two changes, not a bigger
timeout: `lockAndZeroAim()` presses `R` immediately after lock (main.ax's
own reset already zeroes `fps.yaw`/`pitch` - harmless this early, since
nothing has been shot yet) to guarantee a known, real starting
orientation regardless of the lock click's own jitter; `strafeUntilFirstHit()`
replaces the one remaining fixed-duration strafe with a bounded search in
small increments, confirmed by the game's own real "Hit"/"Miss" feedback
at each step - self-correcting under any load condition (dt-based
movement still integrates the correct *total* distance through a stretch
of sparse frames under heavy load, but a fixed real-time key hold has no
way to know that happened before releasing the key), and still 100% real
gameplay, no shortcut into game state. Verified stable across 3
consecutive **full** `npm run test:browser` runs after both fixes (0
failures, 49/49 each time) - the actual bar this class of bug needs, not
just repeated runs of one file in isolation.

## 9. System ordering

Documented explicitly, matching `examples/fps-controls/main.ax`'s own
already-proven `on tick` order verbatim (this milestone didn't invent a
new order, it reused the established one):

```text
on tick:
  1. mouse-look (fps.look), only while pointer-locked
  2. read WASD -> forwardInput/strafeInput
  3. camera.position = fps.move(...)
  4. camera.target = fps.lookTarget(...)
  5. weapon cooldown countdown
  6. input.endFrame() (clears edge-triggered/delta input state)
```

Combat (`on mousedown`) is event-driven, not part of the per-tick order -
a shot resolves entirely within the click handler that triggered it
(raycast → entity lookup → damage → destroy), the same "an `on` handler
runs to completion before the next tick" model every other AXIS
interaction already follows.

## 10. Semantic correctness

Not re-derived from scratch here - each underlying mechanism already has
its own semantic-level proof from an earlier phase, cited rather than
duplicated: mouse-look's "right turns right" sign convention is
`tests/camera-controller.test.js`'s own subject (caught a real sign-error
bug once, per the language-platform audit's game-foundation addendum);
forward movement being camera-relative is the same package's own
`tests/browser/fps-controls.test.js` coverage. What's new and specific to
*this* milestone - "a shot hits the object actually under the crosshair,"
"damage reduces health across repeated hits, not just once," "a dead
target stays dead and a live one doesn't falsely register as hit," "reset
genuinely restores play, not just a counter" - is exactly what
§7/`tests/browser/fps.test.js` proves directly, from the player's own
perspective (real clicks, real key holds, reading the same HUD text a
real player would read), not by asserting an internal formula is
self-consistent.

## 11. Lifecycle / cleanup

- **Object lifecycle**: targets are never actually created or destroyed
  as three.js objects - object-pooling (`visible` toggling) is the
  entire mechanism, so there is nothing to leak on repeated "destruction."
- **Round reset**: rebuilds the ECS `world` from scratch
  (`freshWorld()`), restores every target's `visible`, and resets the
  player's position/yaw/pitch and the shared `state` (score, cooldown) -
  proven to work correctly a *second* time in §7's own reset test (not
  merely once), which is the actual bar for "a game that works only once
  is not a valid proof" (the milestone's own §20 instruction).
- **Scene disposal**: unaffected by anything this milestone added -
  `pointerLock`'s own existing dispose-on-scene-teardown behavior
  (already proven in `tests/browser/camera-controller.test.js`) is
  untouched; `raycast.fromCamera()` holds no resource of its own to leak
  (a stateless query against objects the scene's own existing lifecycle
  already owns).

## 12. Performance

Deliberately not optimized prematurely (per the milestone's own
instruction), but audited for obvious risk: `raycast.fromCamera()` builds
`[...this._object3Ds.values()]` fresh on every call - fine at this
slice's scale (a handful of named objects), and only ever called from a
real player click (cooldown-gated, not per-frame), not from `on tick`.
`fire`'s own entity/target-ref lookups (`find(...)`) are equally small,
fixed-size linear scans (four entities), not a concern at this scale. No
per-frame allocation was added to the tick loop beyond what
`examples/fps-controls/main.ax` already had.

## 13. Core source audit

Every file this milestone touched in `src/`, listed in full:

- **`src/renderer/scene3d.js`** - the only file changed. Added `raycast`,
  a class-and-handle addition mirroring `PointerLockHandle`'s own shape
  exactly. Generic (§4 justifies why), covered by
  `tests/browser/raycast-from-camera.test.js` (4 tests, none of them
  FPS-specific - object selection, range-limiting, distance reporting),
  and useful to any 3D AXIS application, not just this one.

No other `src/` file changed. `git diff 45ea137..HEAD -- src/` is
verified empty across every commit after the core-freeze checkpoint.

## 14. Test counts

879 → (prior milestones) → 923 unit tests before this milestone; 924
after (+1, `tests/examples.test.js`'s own new entry for
`examples/fps/main.ax`). 39 browser tests before; 49 after (+4
`raycast-from-camera.test.js`, +6 `fps.test.js`). All green. The FPS
browser file specifically verified stable across 3 consecutive standalone
runs and 3 consecutive full-suite runs, after the fixes in §8 (one real
product bug and two real, separately-diagnosed instances of the same
test-environment limitation).

## 15. Remaining limitations

Stated plainly, not rounded up:

- No collision between the player and arena geometry - the player can
  walk through walls. A real physics/collision primitive is a
  substantial, separate design question (see docs/architecture/2026-09-
  language-platform-audit.md's own roadmap notes on this), not attempted
  here.
- No audio at all - AXIS has no audio primitive; adding one was out of
  this milestone's scope (§17/§2).
- No enemy AI, no player health/damage - targets are static (§2). A
  patrol/attack system would reuse this slice's exact same ECS/`on tick`
  pattern, not need a new capability.
- `raycast.fromCamera()` only supports a single ray from the exact
  viewport center - no arbitrary ray origin/direction, no multi-ray
  queries (a shotgun spread, say). A real, deliberate scope limit for
  this milestone's own "smallest coherent" primitive, not a hidden gap.
- Object-pooling (fixed targets, `visible` toggling) is the *only* way to
  "remove" something from a running scene - there is still no way to
  spawn a genuinely new, arbitrary 3D object at runtime (see
  `docs/language.md`'s Reactive structure section) - a real, larger,
  separate architectural question this milestone doesn't resolve.

## 16. Architectural quality gate

- **Can the player controller be reused in another game?** Yes,
  unmodified - it's the literal same `input`/`camera` packages
  `examples/fps-controls/` already used for a non-combat demo.
- **Can the health/damage pattern be reused in a non-FPS game?** Yes -
  `makeHealth` is the exact shape `docs/language.md`'s own general
  "data with behavior" example already documents, with no FPS coupling.
- **Can `raycast.fromCamera()` be used for object selection outside
  combat?** Yes, directly - nothing about it references damage, weapons,
  or targets; `tests/browser/raycast-from-camera.test.js` tests it with
  zero FPS framing.
- **Can `axis-visibility` be reused for particles/UI/anything else that
  needs pooling?** Yes - it's a generic boolean scalar property, with no
  reference to targets or combat anywhere in its own source.
- **Can a third-party developer recreate this architecture?** Yes - every
  piece used here (packages, ECS, a runtime extension, `raycast`) is
  itself already documented in `docs/extensions.md`/
  `docs/runtime-extensions.md`/`docs/language.md` as a public, generic
  mechanism, not something this milestone quietly special-cased for
  itself.

## 17. Audio (explicitly addressed, per the milestone's own instruction not to silently skip it)

Audited directly: AXIS has no audio primitive anywhere in `src/`, and
nothing in the browser runtime wraps the Web Audio API. None of the three
options the milestone itself offers (a generic audio extension, an
external audio extension via the runtime extension API, or deferring) was
pursued beyond option 3 - deferred, documented here rather than expanding
this milestone's own scope. A real audio capability (playing a sound
effect on hit/destroy, say) is a reasonable, separate future runtime
extension - `registerScalarProperty` itself doesn't fit "play a one-shot
sound" at all (it's a per-object property getter/setter, not an event-
triggered action), so it would need its own, new registration API in
`extensionRegistry.js` (a `registerAction`/similar shape), a real design
question left for whenever a concrete need for it actually arises.

## 18. Final verdict

> Can AXIS build a meaningful FPS application without turning FPS-
> specific behavior into core runtime code?

```text
YES
```

`git diff 45ea137..HEAD -- src/` is empty, verified directly, across
every commit that built `examples/fps/` itself. The one core change this
entire milestone made (`raycast.fromCamera()`) landed *before* that
freeze, is general-purpose (proven by its own FPS-free test file and by
§16's reuse checklist), and is exactly the same category of addition
`pointerLock` already was in an earlier phase: a real browser capability
no `.ax` package could build, added once, generically, and then composed
into a specific application - not hardcoded into that application's own
genre.
