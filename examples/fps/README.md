# AXIS FPS Flagship Proof

A real, playable first-person arena - the vertical slice built for the
FPS Flagship Proof milestone. See
[docs/fps-proof.md](../../docs/fps-proof.md) for the full architectural
report (what's reused, what's new, what's deliberately out of scope, and
why).

## Run it

```bash
node bin/axis.js run examples/fps/main.ax
```

Click into the arena to lock the pointer, then:

- **WASD** (or arrow keys) - move
- **Mouse** - look around
- **Click** - shoot
- **R** - reset the round

Destroy all four targets, or just knock a few down and press R to try
again.

## What this is built from

- `axis_modules/input/`, `axis_modules/camera/` - copied unchanged from
  [`examples/fps-controls/`](../fps-controls/) (the game-foundation
  phase's reusable input-state and first-person-camera packages).
- `axis_modules/ecs/` - copied unchanged from
  [`examples/game-foundation/`](../game-foundation/) (entity/component/
  system primitives - targets are entities, `Health` is a component).
- `axis_modules/axis-visibility/` - a new runtime extension (see
  [docs/runtime-extensions.md](../../docs/runtime-extensions.md)),
  registering a `visible` scalar property - the mechanism this game's own
  "destroying" a target actually uses (object-pooling: pre-declare every
  target, toggle it on/off, since a scene's own objects aren't reactive).
- `raycast.fromCamera()` - the one genuinely new *core* primitive this
  milestone added to AXIS itself (see
  [docs/language.md](../../docs/language.md)'s Raycasting section) - a
  general-purpose "what's under the crosshair" query, not an FPS-specific
  one.

Everything else - the weapon (a plain data record), health/damage
(a `makeHealth` component in the same "data with behavior" shape
`docs/language.md`'s own example uses), the arena, the HUD, reset - is
ordinary AXIS application code in `main.ax`, composing the above. No
FPS-specific branch exists anywhere in AXIS's own `src/`.
