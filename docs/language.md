# The AXIS language

This is the actual reference - what's real right now, not what's planned. If something isn't mentioned here, assume it doesn't exist yet (check the README's "doesn't exist yet" list too).

## Comments

```ax
// a line comment, that's the only kind
```

## Values

- Numbers: `1`, `2.5`, `-3`. Some numbers carry a unit written right after them with no space: `360deg`, `2s`, `500ms`, `1.5rad`. The unit only matters in specific spots (see Animation below) - elsewhere a unit-suffixed number is just its numeric value.
- Strings: `"hello"`
- Booleans: `true`, `false`
- Vectors: `(1, 2, 3)` - 2, 3, or 4 numbers in parens make a Vec2/Vec3/Vec4. A single parenthesized expression, `(1 + 2)`, is just grouping, not a vector.
- Arrays: `[1, 2, 3]`, indexed with `arr[0]`
- Records: `{ name: "Earth", radius: 1 }` - a named bag of fields, read with `.name`/`.radius` (see Records, below)
- Colors: a handful of predefined names (`red`, `green`, `blue`, `yellow`, `orange`, `purple`, `white`, `black`, `gray`/`grey`, `pink`, `brown`, `cyan`, `magenta`) or a string like `"#ff6600"`
- `null` - "no value". Falsy, equal only to itself. The usual sentinel for a `state` that starts out empty (`state error = null`, then `error != null` to check).

## Variables

```ax
let x = 5        // can be reassigned
const y = 10     // can't
x = x + 1
x += 1           // same as x = x + 1
x -= 1
x *= 2
x /= 2
```

`let`/`const` work the same at the top level of a file, inside a `scene`, and inside functions. `+=`/`-=`/`*=`/`/=` are sugar - `x += expr` is exactly `x = x + expr`, so they work anywhere a plain assignment does (including `.property` and `array[i]` targets), not just on bare variables.

## Expressions

Arithmetic: `+  -  *  /  %`. Comparison: `==  !=  <  <=  >  >=`. Logical: `&&  ||  !` (both `&&`/`||` short-circuit). `+` also does string concatenation (`"n=" + 5` → `"n=5"`) and vector/array combination.

Vectors support component-wise math: `(1,2,3) + (1,1,1)`, and scaling by a plain number: `(1,2,3) * 2`. Read a component with `.x`/`.y`/`.z`/`.w`.

A quirk worth knowing: `-` glued directly to a digit with no space (`-5`) is read as a negative number literal, not the subtraction operator. `5-3` (no spaces) therefore reads as two adjacent numbers and is a syntax error - write `5 - 3` (a space before the `3`) when you mean subtraction.

## Functions

```ax
fn ringPosition(i, count, radius) {
    let angle = (i / count) * 360
    return (radius * cos(angle), 0, radius * sin(angle))
}
```

A named `fn` is declared at the top level of a file (not inside a scene/page/component - see Known limitations). Calling one with the wrong number of arguments is a runtime error, not a silent bug.

A function can also be a plain expression, with no name - usable anywhere a value is, most commonly as a callback to a standard-library function like `map`/`filter`/`sortBy` (see Standard library, below):

```ax
let double = fn(x) { return x * 2 }
let evens = filter([1, 2, 3, 4], fn(x) { return x % 2 == 0 })
```

It's a real closure over whatever's in scope where it's written, same as a named `fn`'s body already is - `async fn(...) { ... }` works too, the same rules as a named `async fn` (`await` inside it, can't be called without `await`).

## Control flow

A ternary/conditional expression - only the taken branch is evaluated, same short-circuit rule `&&`/`||` already follow:

```ax
let sign = x > 0 ? "positive" : "negative"
```

It binds looser than every binary operator - parenthesize it when it's an operand of one (`1 + (a ? 2 : 3)`, not `1 + a ? 2 : 3`, which parses as `(1 + a) ? 2 : 3`) - and is right-associative, so a chain reads the way you'd expect: `a ? 1 : b ? 2 : 3` is `a ? 1 : (b ? 2 : 3)`.

```ax
if (x > 0) {
    ...
} else if (x < 0) {
    ...
} else {
    ...
}

while (x > 0) {
    x = x - 1
}

for i in range(0, 5) {
    print(i)
}
```

`for..in` iterates an array - `range(a, b)` gives you `[a, a+1, ..., b-1]`.

`try { ... } catch (err) { ... }` catches a runtime error from inside the `try` block and binds `err`, inside the `catch` block only, to its message as a string - a plain out-of-range array index is just as catchable as a failed network request. See Async, below, for the case it's really for.

## Standard library

Available everywhere (functions and scenes):

| | |
|---|---|
| `PI` | 3.14159... |
| `abs(x)`, `min(...)`, `max(...)`, `floor(x)`, `ceil(x)`, `round(x)`, `sqrt(x)` | the usual math |
| `sin(deg)`, `cos(deg)` | trig, takes **degrees** (matches AXIS's degree-first angles) |
| `random()`, `random(a, b)` | a random number in `[0,1)` or `[a,b)` |
| `range(a, b)` | an array `[a, a+1, ..., b-1]` |
| `len(x)` | length of an array or string |
| `keys(record)` | a record's field names, as an array, in declaration order |
| `get(record, key, fallback)` | a field that might not be there - returns `fallback` instead of erroring if `key` is missing (a query-string param, an API response with an optional field, ...) |
| `str(x)` | turn any value into a string |
| `print(...)` | logs to the console (prefixed `[axis]`) |
| `now()` | milliseconds since the page loaded (or since epoch under Node) |
| `mag(v)`, `normalize(v)`, `dot(a, b)`, `lerp(a, b, t)` | vector math (`lerp` also works on two plain numbers) |
| `rgb(r, g, b)` | build a `"#rrggbb"` color string from 0-255 components |

Arrays (all pure - they return a new array, the original is untouched - except `push`/`pop`/`shift`/`unshift`, which mutate in place, the same way `arr[i] = ...` already does):

| | |
|---|---|
| `push(arr, item)`, `unshift(arr, item)` | append/prepend in place, return the new length |
| `pop(arr)`, `shift(arr)` | remove and return the last/first element in place - a clear error on an empty array, not `null` |
| `map(arr, fn)`, `filter(arr, fn)` | transform/keep-where, `fn` takes one argument (the item) |
| `find(arr, fn)` | the first matching element, or `null` if none match |
| `some(arr, fn)`, `every(arr, fn)` | whether any/all elements match |
| `reduce(arr, fn, initial)` | fold the array into one value - `fn` takes `(accumulator, item)` |
| `reverse(arr)` | a new, reversed array |
| `sort(arr)` | a new array in ascending order - every element must be a number, or every element a string |
| `sortBy(arr, fn)` | a new array ordered by `fn(item)` (a number or a string), not the elements themselves |
| `join(arr, sep)` | a string, each element `str()`-ed and joined by `sep` |
| `slice(arr-or-string, start)`, `slice(arr-or-string, start, end)` | a sub-range - works on a string too |
| `indexOf(arr-or-string, value)` | position of `value`, or `-1` - on an array, compares by value (records/vectors included), not identity |
| `includes(arr-or-string, value)` | whether `value` is present - a substring check on a string |

Strings:

| | |
|---|---|
| `split(str, sep)` | an array of substrings |
| `trim(str)` | with leading/trailing whitespace removed |
| `replace(str, search, replacement)` | every occurrence replaced, not just the first (AXIS has no regex, so this is the one thing you can't already do another way) |
| `upper(str)`, `lower(str)` | case-converted |
| `startsWith(str, prefix)`, `endsWith(str, suffix)` | boolean |

A function passed to `map`/`filter`/`find`/`some`/`every`/`sortBy` takes exactly one argument (the item) - AXIS functions have fixed arity (see Functions, above), so unlike JavaScript's optional callback arguments, a callback that also wants an index has nowhere to get one from `map` itself (use `range(0, len(arr))` and index in directly instead). Only `reduce`'s callback takes two.

Records, beyond `keys`/`get` (above):

| | |
|---|---|
| `values(record)` | field values, as an array, same order as `keys` |
| `entries(record)` | `{key: ..., value: ...}` records, one per field - a named pair, not a JavaScript-style `[key, value]` array, since AXIS already has a record type for exactly this shape |
| `has(record, key)` | whether `key` is one of the record's own fields |
| `merge(a, b)` | a new record with both records' fields - `b`'s fields win on a collision, same as a later assignment would |

## Records

A record is a named bag of fields - AXIS's answer to "I have a handful of related values I want to pass around as one thing":

```ax
let planet = { name: "Earth", radius: 1, color: "#4a90e2" }

print(planet.name)     // "Earth"
planet.radius = 1.1    // fields can be reassigned like any other property
```

- `{ key: value, key2: value2 }` - commas between fields are optional (same relaxed style AXIS already uses for property lists inside an object declaration), so a record often reads more naturally one field per line, no trailing commas needed:

```ax
let planet = {
    name: "Earth"
    radius: 1
    color: "#4a90e2"
}
```

- A field's value is any expression - a number, string, vector, array, another record, whatever.
- Reading a field that doesn't exist is a clear error with a "did you mean" suggestion, same as a typo'd variable name gets.
- `keys(record)` gives you a record's field names as an array, in the order they were declared - handy for iterating a record generically.
- Two records compare equal (`==`) by their fields' values, not by identity - `{ a: 1 } == { a: 1 }` is `true` even though they're two separately-built records.
- A bare `{ ... }` can't be used as a statement by itself - it's a value, so it has to be assigned to something, returned, passed as an argument, etc. (this also means old scene-syntax like `cube box { ... }`, typo'd inside a plain function/handler body where that grammar doesn't exist, still fails loudly instead of silently parsing as an unused record).

**This is what makes a scene or page genuinely data-driven** - keep the data as an array of records, and a `for` loop turns it into whatever it needs to be:

```ax
let planets = [
    { name: "Mercury", color: "#8c8c8c", radius: 0.3, distance: 3 },
    { name: "Venus",   color: "#e0c16c", radius: 0.5, distance: 4.5 },
]

for p in planets {
    sphere (p.name) {
        position: (p.distance, 0, 0)
        scale: (p.radius, p.radius, p.radius)
        color: p.color
    }
}
```

Add a planet to the array (or change one's size/color) and it just shows up correctly - no other line of the scene needs touching. See [`examples/planets.ax`](../examples/planets.ax) for a fuller version (one record per planet drives its geometry, color, *and* its own orbit speed).

### Data with behavior

A record can hold a function in a field just like any other value, and calling it through `.` gives that function a `self` bound to the record it came from - so a record's own fields can read/mutate the record itself, without any new syntax:

```ax
fn makeHealth(maxValue) {
    let health = { max: maxValue, value: maxValue }
    health.damage = fn(amount) { self.value = max(0, self.value - amount) }
    health.heal = fn(amount) { self.value = min(self.max, self.value + amount) }
    health.isDead = fn() { return self.value <= 0 }
    return health
}

let player = makeHealth(100)
player.damage(30)
str(player.value)   // "70"
```

- `self` is bound the moment `.method` is read off a record, not when the call actually happens - so a detached reference (`let f = player.damage; f(10)`) still correctly sees `player` as `self`. This is deliberately different from JavaScript's own `this`, which loses its receiver in exactly that situation.
- It's *access-time*, not fixed at the point a field was first assigned - `merge(player, { value: 50 }).isDead()` sees the merged record as `self`, not whichever record originally defined `isDead`.
- Purely structural: any record with a `damage` field can be called as `.damage(...)` - there's no named "type," and nothing to declare up front. `self` only ever appears inside a function that's actually being read off a record this way; referencing it anywhere else is an ordinary undefined-variable error.
- A plain field that happens to hold a function you didn't intend as a method (a stored callback, say) is completely unaffected - `self` is simply available if a function body chooses to use it, never required.
- This is the general primitive an entity/component-style architecture (game logic, simulations, anything wanting "data that knows how to change itself") builds on - see [`examples/entities.ax`](../examples/entities.ax), which combines it with page `state`/`on` handlers. AXIS itself has no `type`/`class` keyword - a "type" today is just whatever shape of record a function like `makeHealth` happens to build.

### Entities, components, systems

AXIS has no `entity`/`component`/`system` keyword, on purpose - the pattern is built entirely from what's already above (records, self-bound methods, arrays, `on tick`'s `dt`), not a second, privileged mechanism. See [`examples/game-foundation/`](../examples/game-foundation/)'s `axis_modules/ecs/` for a real package built this way:

```ax
fn makeHealth(value) {
    let h = { type: "Health", value: value }
    h.damage = fn(amount) { self.value = self.value - amount }
    h.isDead = fn() { return self.value <= 0 }
    return h
}

let player = makeEntity("player").add(makeHealth(100)).add(makeTransform(0, 0))
let health = player.get("Health")   // looked up by its own `type` tag
```

- **A component** is just a record with a `type` field (a plain string tag, read back with `.get(type)`/`.has(type)`) - the same "data with behavior" pattern above, nothing more. There's no base class or registration table to extend.
- **An entity** is a record wrapping an array of components (`makeEntity`'s own `add`/`get`/`has`/`remove`) - a composition point, not a hardcoded concept AXIS knows about.
- **A system** is an ordinary function, `fn(world, dt)` - `runSystems([a, b, c], world, dt)` just calls each one in array order, every tick. Ordering is argument order, nothing hidden.
- **Identity is explicit, not free.** AXIS's `==`/`!=` on records is structural (deep equality), not reference-based - two entities with identical component data would otherwise be indistinguishable. `makeWorld().spawn(entity)` mints a real, unique numeric `id`; `destroy(id)` takes that id, never an entity reference.
- **Cleanup**: a component with a `dispose()` method gets it called automatically when its entity is destroyed (`world.destroy(id)`) or the component itself is removed (`entity.remove(type)`) - the hook for releasing anything a component holds (a timer, a subscription) without leaking.
- A "system" composes with a 3D scene's own `on tick` the same way any other AXIS code does - nothing about entities/components/systems is 3D-specific; [`examples/game-foundation/main.ax`](../examples/game-foundation/main.ax)'s own demo is deliberately plain data (no scene at all), to prove the pattern doesn't secretly depend on rendering.

## Scenes

```ax
scene main {
    camera { position: (0, 2, 6) }

    cube box {
        position: (0, 0, 0)
        color: red
    }
}
```

A file can have more than one `scene`, but only the first one renders - `axis run`/`axis build` will warn you if there's more than one.

### Camera

`camera { position: (x, y, z) }` - a scene has at most one. By default it's a fixed viewpoint; `controls: "orbit"` makes it a real, interactive one - drag to orbit around the camera's own `target` point, scroll or pinch to zoom:

```ax
camera { position: (0, 2, 6) controls: "orbit" }
```

This is genuinely optional - a scene with no `camera` gets a sensible default position, and one with a plain `camera { position: ... }` stays fixed, exactly as before. Turning on `controls` only fetches three.js's OrbitControls addon when a scene actually uses it, same as `model` only fetching the glTF loader when a scene actually has one.

Beyond `position`/`controls`, a camera also accepts:

- `fov` (degrees, default `60`) - the perspective field of view. A smaller number reads as a telephoto lens (flatter, zoomed-in); a larger one as wide-angle (more visible, more distortion at the edges).
- `near`/`far` (default `0.1`/`100`) - the clip planes: anything closer than `near` or farther than `far` isn't rendered. Only worth touching for an unusually large or tiny scene (three.js's own z-fighting/precision behavior is what actually motivates changing these).
- `target` (a Vec3 point, default `(0, 0, 0)`) - what the camera looks at. Replaces what used to be a hardcoded "always looks at the origin."

```ax
camera { position: (0, 3, 8) fov: 45 target: (0, 1, 0) }
```

The camera itself is addressable by the fixed name `camera` - a real `animate`/`timeline` target for `position`, `fov`, `near`, `far`, and `target.x`/`target.y`/`target.z` (see Animation and Timelines, below), `on`-handler-mutable (`camera.position = (0, 4, 10)`, `camera.fov = 75`) and `state`-bindable exactly like any other named object's properties. A scene's camera keeps looking at its own `target` even while its position is being animated (unless `controls: "orbit"` is on, which takes over aiming from user drag instead, orbiting around that same `target` point). `rotation`/`scale` still aren't meaningful animate targets for a camera - `target` is the coherent way to aim one, not an independent Euler rotation. AXIS remains perspective-only; there's no orthographic camera type.

### Objects

Built-in shapes: `cube`, `sphere`, `plane`, `cylinder`. Every shape has `position`, `rotation`, `scale` (all Vec3, rotation in degrees), and `color`.

```ax
cube box {
    position: (1, 0, 0)
    rotation: (0, 45, 0)
    scale: (2, 1, 1)
    color: "#ff6600"
}
```

An object's name is normally a bare identifier (`cube box { ... }`), but it can also be a computed expression in parens - this is how you generate uniquely-named objects in a loop:

```ax
for i in range(0, 5) {
    cube ("box" + i) {
        position: (i * 2, 0, 0)
        color: blue
    }
}
```

### Materials

Every shape - and a loaded `model` (see below) - accepts a small set of dotted `material.*` properties on top of its plain `color`, the same physically-based properties a modern renderer actually asks for: how metallic the surface reads, how rough/glossy it is, opacity, and a self-lit glow.

```ax
sphere metal {
    color: "#d4a574"
    material.metalness: 0.9
    material.roughness: 0.2
}
```

- `material.color` - overlays `color` (a string, same rules).
- `material.metalness` (0-1) and `material.roughness` (0-1) - the two properties that actually make something read as metal, plastic, or matte stone. Both default to three.js's own defaults (`metalness: 0`, `roughness: 1` - a flat, non-metallic, non-shiny look, exactly what every shape already looked like before this) when not set, so existing scenes with no `material.*` properties render unchanged.
- `material.opacity` (0-1) - below 1, the object becomes real, renderer-level transparent (not just visually faded).
- `material.emissive` (a color) and `material.emissiveIntensity` (a number) - a self-lit glow, independent of any light in the scene.
- `material.map` - a texture, from an image file (`.jpg`/`.jpeg`/`.png`/`.webp`/`.gif`), validated the same way a `model`'s own `src` already is (relative path, no `..`). Loaded lazily and cached per scene, so several shapes sharing the same file only fetch/decode it once:

```ax
cube crate {
    color: white
    material.map: "./wood.jpg"
}
```

A texture loads asynchronously - the shape renders with its plain `color` the instant the scene mounts, then the texture fades in the moment the fetch resolves, the same "placeholder now, filled in once it's ready" shape a `model` already has. `material.map` is `on`-handler-mutable and `state`-bindable (swap it live - a day/night texture change, say) exactly like every other `material.*` field, but it's **not** an `animate`/`timeline` target - a texture doesn't interpolate, so `animate box { material.map -> "..." }` is a clear build-time error.

This is deliberately a small vocabulary - the PBR properties a developer actually reaches for, not every field three.js's `MeshStandardMaterial` exposes. `material.*` is a real `on`-handler-mutable, `state`-bindable value, exactly like `position`/`color` already are:

```ax
on metal.click {
    metal.material.roughness = 0.05
}
```

or bound to a reactive `state`, the same way `color`/`scale` already can be:

```ax
state polish = 0.2
sphere metal { material.roughness: polish }
```

### Shadows

`castShadow`/`receiveShadow` (booleans) control whether an object casts or receives shadows - both default to `true` for every shape and `model`. Shadows only actually render, though, when at least one light in the scene turns them on (see Lights, below) - a scene with no `shadows: true` light pays nothing for this, the same "opt-in cost" every other 3D feature here follows:

```ax
plane ground {
    rotation: (-90, 0, 0)
    scale: (10, 10, 1)
    receiveShadow: true
    castShadow: false
}
```

See [`examples/materials.ax`](../examples/materials.ax) for a complete scene using materials, shadows, and both ways a material property is live (a `state` binding and a direct `on`-handler mutation).

### Groups

`group` nests other declarations and applies its own transform on top of them - move or rotate the group and everything inside moves with it:

```ax
group rig {
    position: (0, 1, 0)
    cube arm { position: (1, 0, 0) color: red }
}
```

A shape (`cube`, etc.) can't contain other declarations - only `group` can (a `model`, below, can be nested inside one too).

A `group` is a real `LiveObject`, the same as a shape or a `model`: its own `position`/`rotation`/`scale` can be mutated from an `on` handler (`rig.position = (0, 2, 0)`) and can read a reactive `state` - the whole rig moves/rotates/scales together, one write instead of one per child.

### Lights

```ax
ambientLight fill { intensity: 0.4 }
directionalLight sun { direction: (-1, -1, -0.5) intensity: 1 color: white }
pointLight bulb { position: (2, 3, 0) intensity: 1.5 color: orange }
spotLight flash { position: (0, 5, 0) target: (0, 0, 0) angle: 30 penumbra: 0.3 intensity: 20 }
hemisphereLight sky { color: "#ffffff" groundColor: "#222233" intensity: 0.6 }
```

Without at least a little light, standard-material shapes look flat and dark - a scene with no lights of its own gets a faint hemisphere fill light for free (the same defaults shown above) so it isn't pitch black by default. Declaring your own `hemisphereLight` replaces that automatic one rather than adding a second, redundant light on top of it - useful once you want to tune or animate the sky/ground tint instead of accepting the fixed default. `hemisphereLight` is a directionless ambient gradient (a sky color fading to a ground color) - it doesn't accept `position`/`direction`/`shadows`, the same reason `ambientLight` doesn't either.

`spotLight` is a focused cone of light, aimed from its own `position` at `target` (a Vec3 point, default the origin) - `angle` (degrees, the cone's half-angle) and `penumbra` (0-1, how soft the cone's edge is) shape the beam.

A `directionalLight` or `spotLight` can cast real shadows with `shadows: true` - the single knob AXIS exposes for this, on purpose: a sensible shadow-map resolution and (for a directional light) camera frustum are picked for you, not a config surface to tune.

```ax
directionalLight sun { direction: (-1, -1.4, -0.6) shadows: true }
```

Turning `shadows` on for one light costs nothing for a scene that doesn't - the renderer's shadow-map pass itself only turns on when at least one light in the scene actually asks for it. `ambientLight`/`pointLight` don't accept `shadows` yet - point-light shadows are real work in three.js (a 6-way cubemap) that hasn't been wired up.

A light's `color`/`intensity` (and, for `hemisphereLight`, `groundColor`) are real `on`-handler-mutable, `state`-bindable, `animate`/`timeline`-targetable values, exactly like a shape's `color` is - flickering, flaring, or dimming a light is a normal `animate` block (`animate flash { intensity -> 0 duration: 400ms }`), not a special case.

### Environment

`environment { ... }` - like `camera`, a scene has at most one, and it's genuinely optional: a scene with no `environment` block renders against the same fixed dark backdrop every scene always has.

```ax
environment {
    background: "#1a1a2e"
    fogColor: "#888888"
    fogNear: 5
    fogFar: 40
}
```

- `background` (a color) - the scene's own backdrop, what used to be a fixed `"#111111"` everywhere. A real `animate`/`timeline` target (`animate environment { background -> "#000000" duration: 2s }`), `on`-handler-mutable, and `state`-bindable, exactly like a shape's `color`.
- `fogColor` (a color) - a real, simple linear fog, opt-in by presence: a scene with no `fogColor` has no fog at all, the same "pay nothing unless you use it" rule `shadows: true` already follows. `fogNear`/`fogFar` (numbers, default `10`/`50`) are the distances fog starts fading in and finishes fully opaque at - they only matter once `fogColor` is actually set.

Unlike `background`, fog is build-time only for now - `fogColor`/`fogNear`/`fogFar` aren't yet `state`-bindable or `animate`-targetable (a real, current limitation, not a design decision): whether fog exists in the scene at all is decided once, when it mounts.

### Models

A `model` loads its geometry and material from an external `.glb`/`.gltf` file instead of getting one of the built-in primitive shapes - the color, the material, the whole mesh comes from the file itself:

```ax
model earth {
    src: "./earth.glb"
    position: (0, 0, 0)
    scale: (1.2, 1.2, 1.2)
}
```

- `src` is required, and has to be a relative path (no leading `/`, no `..` segments - a model always lives inside the project directory) ending in `.glb` or `.gltf`, resolved against the `.ax` file you actually ran/built - **not** the file a component that declares a `model` was itself defined in, if that's different (unlike `import`, which does resolve relative to the importing file - this is a real, current limitation).
- Otherwise a `model` is positioned/rotated/scaled exactly like any other spatial object, and can be a target for `animate`.
- `on model.click`/`hover`/`unhover` work - clicking anywhere on the loaded mesh (every mesh inside the file, not just its outer bounds) fires the handler, the same as it would for a built-in shape. A `model` is a real `LiveObject` too, same as a shape - the handler body can mutate the model's own `position`/`rotation`/`scale` (`model.position = ...`), not just other objects/state.
- No `color`, but a `model` accepts the same `material.*` properties a shape does (see Materials, above) - `material.metalness: 0.8`, say - applied as an *overlay* on top of whatever material(s) the file itself already defines, not a replacement: a property AXIS doesn't set is left exactly as the file authored it (its own textures included), and a multi-mesh/multi-material file gets every one of its materials patched together, one write. `castShadow`/`receiveShadow` (see Shadows, above) work the same way too, applied to every mesh inside the file.
- `position`/`rotation`/`scale`/`material.*` are all genuinely live: a reactive `state` read into one of them re-renders the model after any handler runs, the same as a shape's does, and a `model` can be nested inside a `group` (see Groups, above) whose own transform is just as live - see [`examples/model.ax`](../examples/model.ax) and [`examples/materials.ax`](../examples/materials.ax).
- The exported workflow that's meant to feed this: **Blender → File → Export → glTF 2.0 (.glb) → drop the file in your project → `src: "./whatever.glb"`.** Meshes, hierarchy, and PBR materials (`baseColorFactor`, metallic/roughness, `doubleSided`) all load correctly - see [`examples/model.ax`](../examples/model.ax) (also demonstrates `camera { controls: "orbit" }` and a click handler that grows a separate, reactive indicator shape) and its fixture, [`examples/assets/pyramid.glb`](../examples/assets/pyramid.glb).
- A `model`'s own animation clips - skeletal or plain node-transform, exported from the same Blender file - load and play too. See Clips, just below.
- **Not supported yet:** morph targets, Draco/KTX2-compressed glTF.
- A scene with no `model` pays nothing for any of this - the loader (and three.js's `examples/jsm` addon it needs) is only fetched by the browser when a scene actually declares one.

### Clips

A `model`'s file can carry its own animation clips (a walk cycle, an idle sway, a one-shot gesture - baked in Blender, whether it's a skeletal/bone deformation or a plain object transform makes no difference to AXIS). `clip: "Walk"` selects one by name and plays it, looping, the instant the model finishes loading - the same "declared at the top level plays automatically" rule `animate`/`timeline` already follow:

```ax
model hero {
    src: "./hero.glb"
    clip: "Walk"
}
```

`play`/`stop` control a clip live, from an `on` handler - the same target-name grammar (bare or computed) `animate`/`on` already use, just with an explicit `on TARGET` naming *which* model:

```ax
on hero.click {
    play Idle on hero
}

on stopBtn.click {
    stop hero
}
```

- `play CLIP on TARGET` (re)starts CLIP on TARGET, looping, from its own beginning - switching to a different clip than whatever was already active is a hard cut, not a crossfade (one clip plays at a time - the smallest useful capability, not a blending system).
- `stop TARGET` freezes whichever clip is currently active on TARGET at its current pose - it does **not** rewind to the start. A no-op, not an error, if nothing is playing.
- A clip name that isn't a plain identifier (spaces, dots - real Blender/Mixamo exports often have these) needs the same parenthesized-computed form any other target does: `play ("mixamo.com|Walk") on hero`.
- TARGET must be a `model` - `play`/`stop` on anything else, or on a name that doesn't exist, is a clear runtime error.

A clip's own normalized progress (0 at its start, 1 at its end) is just another value `animate`/`timeline` can drive, alongside `position`/`rotation`/`material.*`/`color`/`intensity` - not a separate mechanism:

```ax
animate hero { progress -> 1 duration: 2s }
```

- Setting `progress` (directly, or eased over time via `animate`, or as a `timeline` step) pauses whatever native `play`ing was doing and scrubs the clip to that exact normalized time instead - `play`ing it again afterward resumes normal looping playback. The two are just two different ways of moving the same clip; nothing stops you from combining them (stop mid-`play`, scrub by hand, `play` again).
- Because `progress` is an ordinary animate-able property, it works everywhere `intensity`/`color` already do: inside a `timeline` (with `at`/`label`/stagger), and - since a `model` can live inside a `viewport` - driven by that viewport's own `scrollTimeline` exactly the way any other 3D property can be (see Timelines, below). Scrolling a page can scrub a character's clip precisely, reversibly, the same way it already can a camera move or a material change.
- If `progress` is set before any clip has been explicitly chosen (no `clip:` property, no `play` yet), it defaults to the file's first clip.

**Not supported:** inverse kinematics, bone manipulation, morph target animation, or blending between two active clips - see [docs/architecture/skeletal-animation.md](architecture/skeletal-animation.md) for the full architecture and what was deliberately left out. See [`examples/skeletal-animation.ax`](../examples/skeletal-animation.ax) and its fixture, [`examples/assets/character.glb`](../examples/assets/character.glb) (a small, genuinely skinned two-bone rig with two named clips).

### Building scenes procedurally

A scene body isn't limited to static declarations - `let`, `if`, `while`, and `for` work directly inside a `scene` (and inside a `group`), so you can generate objects instead of writing each one by hand. See the loop example above, or [`examples/showcase.ax`](../examples/showcase.ax) for a bigger one.

## Pages

```ax
page "My Site" {
    container hero {
        direction: "column"

        text heading {
            content: "Hello"
        }
    }
}
```

`page` is the web-document sibling of `scene` - same body grammar (`let`/`if`/`while`/`for`, object declarations, `animate`, `on`), a different top-level keyword, and it renders to real HTML/CSS in the browser instead of a three.js canvas. A page's title can be a plain identifier (`page Home { ... }`) or a string (`page "My Site" { ... }`), since a web page's title is naturally a string.

A file can have more than one `page`, but only the first one renders - `axis run`/`axis build` will warn you if there's more than one, same as with multiple scenes.

A file *can* define both `scene`s and `page`s now - see [Viewports](#viewports) below for how a page embeds one.

### Elements

Container-like elements nest other declarations (like `group` does for scenes) and each render as a different real HTML tag - so a page doesn't turn into div soup just because AXIS needed something to nest things in:

- `container` (`<div>`) - a plain layout box. `direction` (`"row"` or `"column"`), `align` (align-items), `justify` (justify-content), `gap`.
- `form` (`<form>`) - like `container`, plus submitting it (pressing Enter in a field, or a `button` inside it) fires `on form.submit` instead of actually navigating - see Interaction below.
- `list` (`<ul>`) / `item` (`<li>`) - a list and its entries. `item` nests other declarations too, same as `container`.

Leaf elements (can't nest other declarations - same restriction as 3D shapes vs. `group`):

- `text` (`<div>`) - a block of text. `content`, `color`, `size` (font size), `weight` (e.g. `"bold"`), `align` (text-align).
- `heading` (`<h1>`-`<h6>`) - `content`, `level` (1-6, default 1 - picks the tag), plus `color`/`size`/`weight`/`align`.
- `paragraph` (`<p>`) - `content`, `color`, `size`, `weight`, `align`.
- `button` - a clickable button. `label`, `color`.
- `link` (`<a>`) - `label`, `href`, `color`.
- `image` (`<img>`) - `src`, `alt`.
- `input` - a form field. `placeholder`, `value`, `kind` (the HTML `type` attribute - `"text"`, `"email"`, `"password"`, ... - defaults to `"text"`).

### Styling

These are available on every element above, container or leaf alike - a `text` used as a small pill or badge wants a background and padding just as much as a `container` does, so AXIS doesn't restrict them by element type the way it restricts `content` to text-like elements:

`background`, `padding`, `radius` (border-radius), `width`, `height`, `border` (a raw CSS border shorthand string, e.g. `"1px solid #333"`), `shadow` (→ `box-shadow`, a raw string), `opacity` (a number 0-1), `cursor` (a raw string, e.g. `"pointer"`), `position` (`"absolute"`, `"relative"`, `"fixed"`, or `"static"`) plus `top`/`left`/`right`/`bottom` and `z` (→ `z-index`) to go with it.

`width`/`height`/`padding`/`gap`/`radius`/`size`/`top`/`left`/`right`/`bottom` accept either a number (pixels) or a string for any other CSS size (`"50%"`, `"100vh"`). Colors/backgrounds accept the same color names and hex strings scenes do. `direction`/`align`/`justify`/`weight`/`position` are plain strings (`"row"`, `"center"`, `"between"`, `"bold"`, `"absolute"`, ...) rather than bare identifiers - there's no predefined `row`/`center`/`bold` keyword the way there's a predefined `red`.

**`css`** is a genuine escape hatch: a raw string appended verbatim to the element's generated inline style, for anything not modeled above. AXIS isn't a template framework - a developer who hits a CSS property this language doesn't know about yet shouldn't be stuck:

```ax
container badge {
    background: "#1a1a2e"
    css: "backdrop-filter: blur(6px)"
}
```

```ax
page Home {
    container list {
        direction: "column"
        gap: 8

        for i in range(0, 3) {
            text ("item" + i) { content: "Item " + i }
        }
    }
}
```

An element's name is normally a bare identifier, but (like scene objects) it can be a computed expression in parens for generating uniquely-named elements in a loop.

#### Responsive layout

`responsive: { tablet: { ... } mobile: { ... } }` overrides any of this same styling vocabulary at one of two fixed breakpoints - `tablet` (screens 1024px wide or narrower) and `mobile` (640px or narrower), not a configurable set:

```ax
container hero {
    direction: "row"
    gap: 24

    responsive: {
        tablet: { gap: 16 }
        mobile: { direction: "column" gap: 12 }
    }
}
```

- Compiles straight to real `@media` CSS rules at build time - there's no JavaScript involved, so it's correct on the very first paint, before the page even hydrates.
- Only a genuinely style-mappable property can appear inside a tier - `background`, `padding`, `radius`, `width`, `height`, `gap`, `border`, `shadow`, `opacity`, `cursor`, `position`/`top`/`left`/`right`/`bottom`/`z`, `direction`, `align`, `justify`, `color`, `size`, `weight`, and `css`. Not `content`/`label`/`href`/`src`/`level`/`value` - those aren't CSS declarations, there's nothing a media query could change about them - and not `visible` (see below).
- Still checked against whatever properties the element's own type actually has - `responsive: { mobile: { align: "center" } }` on a `button` is the same "doesn't have that property" error a top-level `align` on a `button` would already be.
- Evaluated once, like a literal - a `responsive` block isn't itself `state`-reactive in this version; only the values it's given at build time are used.
- `visible` can't be overridden inside `responsive` yet - on a `viewport`, hiding it isn't a plain style (it decides whether an entire 3D runtime exists), and that responsively would need real JavaScript this version doesn't add.

### Interaction on a page

`on button.click { ... }` / `on el.hover { ... }` / `on el.unhover { ... }` work exactly like they do in a scene (hover/unhover map to `mouseenter`/`mouseleave`), including scene-level `let` becoming mutable state a handler can update:

```ax
page Home {
    let clicks = 0

    button go { label: "Go" }
    text count { content: "0" }

    on go.click {
        clicks = clicks + 1
        count.content = str(clicks)
    }
}
```

Two more events exist only on pages: `on input.change { ... }` fires as an `input` element's value is typed, and `on form.submit { ... }` fires instead of the browser's normal (page-navigating) form submission - AXIS always calls `preventDefault()` for you, since there's no backend to submit to.

Assigning to `.content`, `.label`, `.href`, `.src`, `.alt`, `.value`, `.placeholder`, `.kind`, `.css`, or any of the styling properties above, from inside a handler, actually mutates the real DOM element, the same way assigning to `.color`/`.position` mutates a real mesh in a scene.

### State

A `let`/`const` at a page's top level already gives a handler somewhere to store a value between clicks (the `clicks` example above). `state` is the same idea, but the properties that read it update themselves - no manual `.content = ...` required:

```ax
page Home {
    state count = 0

    button go { label: "Go" }
    text label { content: "Count: " + count }

    on go.click {
        count += 1
    }
}
```

Clicking `go` here updates `label`'s text on its own. Mechanically: every non-literal property expression (`"Count: " + count`, not a bare `"Count: 0"`) is kept around, and after any `on` handler runs, AXIS re-evaluates every element's non-literal properties and patches whichever ones actually changed. There's no dependency tracking - it's a full but cheap re-check, not a targeted update - and honestly, a plain `let` read into a property gets exactly the same automatic re-check right now, since the mechanism doesn't distinguish. `state` is still the right thing to reach for: it says what you mean, and it's where a future, smarter version of this mechanism would apply.

`state` also works inside a `scene` now, the same way - a shape's `position`/`rotation`/`scale`/`color` that reads a `state` (or any variable) re-renders after any handler runs, exactly like a page element's properties do:

```ax
scene main {
    state clicks = 0
    cube box { scale: (1 + clicks * 0.1, 1 + clicks * 0.1, 1 + clicks * 0.1) }

    on box.click { clicks = clicks + 1 }
}
```

Clicking `box` here grows it - `scale` is re-evaluated (and the mesh patched) after the click, the same "re-check every binding after any handler runs" mechanism a page already uses.

#### Sharing state between a page and an embedded scene

`state` (and `let`) can be declared at the very top of a file too, outside any `scene`/`page` - and unlike a top-level `let` (which is just a value baked in once, the same for every domain that reads it), a top-level `state` is a genuinely **shared, mutable cell**: a page's `on` handler can write it, and any `scene` embedded via `viewport` (see above) that reads it in a shape's property re-renders - and the other direction works too, a scene's `on` handler (from a click on the 3D object itself) can write it and a page's bound text updates:

```ax
state clicks = 0

scene Product {
    cube item { color: "blue" }
    on item.click { clicks = clicks + 1 }
}

page Home {
    viewport hero { scene: "Product" }
    text label { content: "Clicks: " + clicks }
}
```

See [`examples/configurator.ax`](../examples/configurator.ax) for a complete, both-directions example (DOM buttons driving a 3D object's color/size, and clicking that object updating page text), and [docs/architecture/reactive-state.md](architecture/reactive-state.md) for exactly how this works and what it deliberately doesn't do yet (no derived values, no dependency tracking, only a shape's position/rotation/scale/color are live-bindable from the 3D side).

### Reactive structure

Everything above is reactive *values* - a property that reads `state` re-checks itself after a handler runs, but the actual set of elements was always fixed once the page loaded. A `for`/`if` directly inside a page, `container`, or `component` body now stays live too - the set of elements it produces can genuinely change:

```ax
state todos = [{ id: 1, label: "Write the report" }]

page Home {
    for t in todos {
        container ("row" + t.id) {
            text ("label" + t.id) { content: t.label }
            button ("remove" + t.id) { label: "Remove" }
        }

        on ("remove" + t.id).click {
            let out = []
            for x in todos {
                if (x.id != t.id) {
                    out = out + [x]
                }
            }
            todos = out
        }
    }
}
```

No new syntax - this is the exact `for`/`if` grammar every earlier example already used. What changed: every `for` (unconditionally - re-running a handful of iterations is exactly as cheap as re-checking a handful of property bindings, the same reasoning `state` itself already relies on) and every `if` whose condition isn't a bare literal now re-runs after any handler, anywhere on the page, the same moment every other binding re-checks itself. Elements are matched to what's already on the page by their own name - reassigning `todos` to a shorter or longer array adds or removes exactly the rows that actually appeared or disappeared, wherever in the list, without rebuilding the ones that didn't change.

A handler declared *inside* a `for` loop can read that loop's own variable (`t.id`, above) - it's captured by value at the point the handler is declared, the same "resolved once, not a live channel" idea a `component`'s own parameters already use (see Components, below).

What this doesn't do:

- **No list reordering.** Sorting an already-rendered list's own items, with nothing added or removed, won't move them in the DOM.
- **Only DOM elements and `component` instances** - a `scene`'s own `if`/`for` still only ever build once, at load. A `viewport` declared inside a reactive block needs the scene it embeds to already have been reachable from the page's own initial, non-reactive build - a real, current limitation, not silently broken (a clear console error explains it if you hit it).
- **Still no dependency tracking** - every reactive `for`/`if` re-runs on every handler, regardless of whether its own governing expression could plausibly have changed.

See [`examples/reactive-list.ax`](../examples/reactive-list.ax) and [docs/architecture/reactive-structure.md](architecture/reactive-structure.md) for the full design.

### Animation on a page

```ax
animate hero {
    opacity -> 1
    duration: 0.8s
    easing: easeOut
}
```

The same `animate` grammar scenes use (`duration`/`delay`/`repeat`/`easing`, in the same units), just a smaller set of animatable properties, since a page element doesn't have a 3D transform: `opacity`, `position.x`/`position.y` (an offset from the element's normal, in-flow layout position - not an absolute coordinate), `scale`, `rotation` (degrees, like scene rotations), and `color`/`background` (a color name or a string like `"#ff6600"`, same rules as a scene's own `color`). Multiple position/scale/rotation changes on the same element combine into one CSS `transform`, so a fade plus a move animate together cleanly instead of fighting over the `style` attribute; `color`/`background` interpolate as real color lerps (component-wise, not a CSS transition), the same smoothness a scene's own `material.color` already has.

```ax
animate banner {
    background -> "#1a1a2e"
    color -> white
    duration: 500ms
}
```

An element with no declared starting `color`/`background` animates from black text on a white background by default - the same "pick a sensible literal default" rule `opacity` (from `1`) and `scale` (from `1`) already follow when nothing else was set.

A page's `animate`, declared at the top level (or inside a `container`), plays automatically once the page loads - see "Triggering an animation from an event", right after the Interaction section below, for playing one only in response to a click/hover/etc instead.

### Viewports

A page can embed a `scene` - a real, live three.js canvas sitting inside an otherwise ordinary page - with `viewport`:

```ax
scene Earth {
    camera { position: (0, 1, 4) }
    model globe { src: "./earth.glb" }
    animate globe { rotation.y -> 360deg duration: 10s repeat: infinite }
}

page Home {
    heading title { content: "A 3D landing page" }

    viewport hero {
        scene: "Earth"
        width: 640
        height: 420
        radius: 16
    }
}
```

`viewport` is a leaf element like `image` - it can't contain other declarations, and it takes the same sizing/positioning properties every other element does (`width`, `height`, `radius`, `position`, ...; it defaults to `width: "100%"`, `height: 400` if you don't set your own, so it isn't invisible). `scene` is required and has to name a `scene` declared somewhere in the same file - either before or after the `page` that references it. `scrollTimeline: "NAME"` names one of that scene's own `timeline`s to drive from this viewport's own scroll position instead of playing on load - see Scenes' Timelines section.

`visible: expr` - a boolean, defaulting `true` - controls whether this `viewport` actually has a mounted 3D runtime at all, not just whether its canvas is painted:

```ax
state showScene = true

page Home {
    viewport hero { scene: "Earth" visible: showScene }
    button toggle { label: "Toggle" }
    on toggle.click { showScene = !showScene }
}
```

Going `true -> false` disposes the runtime completely - stops rendering, releases its GPU resources, removes its canvas, drops its scroll link if it had one - the same teardown an internal `unmountViewport` has always been able to do (see [docs/architecture/viewport-lifecycle.md](architecture/viewport-lifecycle.md)); this is just the first thing in the language that can actually trigger it. Going `false -> true` mounts a *fresh* runtime - a disposed one is never resurrected, only replaced. Setting it to whatever it already was (`true -> true`, `false -> false`) is a no-op: an unrelated `state` change elsewhere on the page never dispose+remounts a `viewport` that stayed visible the whole time. `visible` is deliberately `viewport`-only, not a property every element gets - it's a 3D-runtime lifecycle switch, not a general way to add/remove arbitrary content; there's no equivalent for a `container`/`text`/etc. yet. See [docs/architecture/conditional-viewport.md](architecture/conditional-viewport.md) and [`examples/conditional-viewport.ax`](../examples/conditional-viewport.ax).

A referenced scene means exactly the same thing whether it's embedded or run standalone: same rules, same errors, the whole 3D grammar (`camera`, shapes, `model`, lights, `animate`, `on`) works unchanged inside it. A `let`/`fn` declared at the very top of the file (outside both the `scene` and the `page`) is visible to both, so a color or a helper function can genuinely be shared between them:

```ax
let accent = "#4a90e2"
scene Earth { cube box { color: accent } }
page Home { viewport hero { scene: "Earth" } }
```

Two things a `viewport` does *not* do yet, on purpose:

- **No two-way state sharing beyond that top-level `let`/`fn`.** A page's `on`/`state` can't reach into a scene's own objects, and a scene's `on` can't reach a page's elements - each keeps its own handlers and its own object names, exactly as if it were a separate file. A page-level `on hero.click { ... }` still works, though - `viewport` is an ordinary DOM element, so clicking it (or a mesh inside it, which bubbles up through the canvas) fires like clicking anything else.
- **No DOM/3D coordinate projection** - there's no way (yet) to make an HTML label track a 3D object's on-screen position, or a 3D camera react to scroll position.

See [docs/architecture/page-scene-fusion.md](architecture/page-scene-fusion.md) for the full design and what's deliberately still missing, and [`examples/landing.ax`](../examples/landing.ax) for a complete page that uses one.

## Routing

A file with at least one `route` is a real multi-page site - `route`
decides which already-declared `page` a URL renders, instead of a file
always rendering its first one:

```ax
route "/" Home
route "/about" About
route "/projects/:id" Project
route "*" NotFound
redirect "/old-projects" "/projects"

page Home { ... }
page About { ... }
page Project {
    text t { content: "Project " + params.id }
}
page NotFound { ... }
```

- **`route "pattern" PageName`** - `PageName` must be a `page` with a plain
  identifier title (`page Project { ... }`, not a string one). A `:name`
  segment (`/projects/:id`) captures into `params`; `"*"` is a catch-all,
  always tried last regardless of declaration order - the way to wire up a
  404 page. Referencing an undeclared page, or declaring the same pattern
  twice, is a build-time error.
- **`redirect "from" "to"`** - checked before any route; a match means
  `from` never renders a page at all (an HTTP 302 from the dev server; an
  immediate client-side redirect once the app has loaded).
- **`params`** / **`query`** - implicit records, available on every page in
  a routed file with no declaration needed. `params` has one string field
  per `:name` segment the matched route declared. `query` is built from the
  URL's own query string (a repeated key becomes an array); since its keys
  are never statically known, read one with `get(query, "key", fallback)`
  (a general stdlib function, not routing-specific) rather than
  `query.key` directly - the latter is a build-time error unless that exact
  key happens to be present.
- **`navigate(path)`** / **`navigate(path, { replace: true })`** -
  programmatic navigation, callable from anywhere a function call is legal,
  including after `await`:

  ```ax
  on form.submit {
      let result = await api.post("/login", { email: email })
      if (result.ok) {
          navigate("/dashboard")
      }
  }
  ```

- **`link`** - unchanged syntax, real `<a href="...">` either way. New
  behavior: a plain click on one whose `href` is same-origin navigates
  without a full page reload; every other click (a modifier held, a
  different origin, `target="_blank"`, ...) is completely normal browser
  behavior.

**A `let` computed from `params`/`query` is not itself reactive** - only an
element's own property expressions and an `if`/`for`'s own condition are.
Call `findProject(params.id)` again wherever you need its result, rather
than caching it once in a `let`, if it should reflect the current route.
And a reactive `if`/`for` needs an ordinary `container` to mount its
generated content *into* - it can't sit bare at a page's own top level (see
reactive structure, above).

`axis build` pre-renders one static HTML file per *static* route
(`/about` -> `dist/about/index.html`); a dynamic route
(`/projects/:id`) is handled entirely client-side once the page's JS has
loaded, since there's no fixed URL to pre-render one at. A `"*"` page, if
declared, is additionally written to `dist/404.html`. See
[docs/architecture/routing.md](architecture/routing.md) for the full
design, its SSR boundaries, and what a real deployment still needs to
configure (a static host's own fallback for an unmatched URL), and
[`examples/routing/site.ax`](../examples/routing/site.ax) for a complete
multi-page site.

## Animation

```ax
animate box {
    rotation.y -> 360deg
    duration: 2s
    delay: 200ms
    repeat: infinite
    easing: easeInOut
}
```

- The target (`box`) must already be declared in the scene, either as a plain name or as a computed `("box" + i)` - see "Computed animate/on targets", right after Interaction below, for wiring up a loop-generated object individually. `camera` is a real target too, for its `position`, `fov`, `near`, `far`, and `target.x/y/z` - see Scenes' Camera section.
- You can animate any of `position.x/y/z`, `rotation.x/y/z`, `scale.x/y/z`, `material.metalness`/`material.roughness`/`material.opacity`/`material.emissiveIntensity`, `color`/`material.color`/`material.emissive` (a real color interpolation, not string-swapping), a light's own `intensity` (and, for `hemisphereLight`, `groundColor`), and a `model`'s own animation-clip `progress` (see Models' Clips section, below) - one `animate` block can change several at once, on any object type that has the property (a `group` has no `material`, a `pointLight` has no `material` either, and so on - an unsupported path is a build-time warning, not a hard error, and is simply skipped).
- `duration` and `delay` take a time value (`2s` or `500ms`); a plain number with no unit is treated as milliseconds.
- `repeat` is a positive whole number, or `infinite`.
- `easing` is one of a small, coherent set of curve families (default `linear`):
  - `linear`
  - `easeIn` / `easeOut` / `easeInOut` (quadratic - the default "smooth" feel)
  - `easeInCubic` / `easeOutCubic` / `easeInOutCubic` (the same shapes, stronger)
  - `easeInBack` / `easeOutBack` / `easeInOutBack` (a slight overshoot past the target before settling - good for a reveal that should feel a little springy)
  - `easeOutBounce` (settles like a dropped ball - only the "out" direction exists, since that's the only one anyone actually reaches for)

Declared at the top level of a scene (or inside a `group`) like this, it plays automatically once the scene loads. See "Triggering an animation from an event", right after Interaction below, for playing one only in response to a click/hover/etc.

## Interaction

```ax
let clicks = 0

on box.click {
    clicks = clicks + 1
    box.color = green
}

on box.hover {
    box.scale = (1.2, 1.2, 1.2)
}

on box.unhover {
    box.scale = (1, 1, 1)
}
```

- Events: `click`, `hover`, `unhover`.
- Inside a handler, the object you're interacting with (and every other named shape in the scene) is available by name, and assigning to `.color`, `.position`, `.rotation`, or `.scale` actually moves/recolors the real thing on screen.
- A `let` declared at the top level of the scene is visible to every handler and can be reassigned from inside one - that's how a click counter or an on/off toggle holds its value between clicks. A `let`/`const` declared inside a loop or a group is local to that scope and isn't visible to handlers, same as it wouldn't be visible outside a function.
- Handler bodies run with the full language available - `if`, `while`, `for`, function calls, the works.

### Per-frame updates

`on tick { ... }` runs once every rendered frame, for as long as the scene/page it's declared in exists - it's the one `on` event with no target at all (every other event belongs to a specific object or timeline):

```ax
let velocityX = 2

cube box { position: (0, 0, 0) color: red }

on tick {
    if (box.position.x > 3 || box.position.x < -3) {
        velocityX = 0 - velocityX
    }
    box.position = (box.position.x + velocityX * dt, box.position.y, box.position.z)
}
```

- `dt` is bound automatically inside the handler body - the real time (in **seconds**, not AXIS's usual milliseconds - the standard convention for a per-frame delta in game/physics code) since the previous frame. `0` on the very first frame a handler runs, never negative.
- Works inside a `scene` and a `page` alike, and inside a `component`.
- Multiple `on tick { ... }` blocks in the same scene/page are all independent and all run, every frame - there's no collision to resolve the way there is between two `on box.click` blocks for the same object.
- This is the general primitive movement, physics-like behavior, timers, and simulations all build on - AXIS doesn't have a built-in physics engine, but the bounce above needed none; see [`examples/tick.ax`](../examples/tick.ax).
- A real, deliberate tradeoff: a scene/page with any `on tick` handler opts out of render-on-demand's "stop rendering when nothing changed" (see docs/architecture/render-on-demand.md) - it keeps rendering every frame for as long as it exists, since a tick handler's own body is exactly the kind of change render-on-demand has no way to see coming. A scene/page with no `on tick` is completely unaffected - it still renders on demand exactly as before.

### Keyboard input

`on keydown { ... }` / `on keyup { ... }` - the other global, no-target `on` events - fire on a real keyboard event anywhere on the page, with `key` bound automatically inside the body to the key that was pressed/released (whatever the browser's own `KeyboardEvent.key` says - `"a"`, `"ArrowUp"`, `" "` for space, ...):

```ax
state lastKey = "none"

on keydown {
    lastKey = key
}
```

- Fires on every native key repeat while a key is held down, the same way the browser's own `keydown` does - AXIS doesn't filter or debounce this.
- `key` is a raw value, not normalized (case as typed) or turned into an "is this key currently held" convenience - that's deliberately left to be built on top, the same way [`examples/tick.ax`](../examples/tick.ax)'s bounce needed no physics engine. [`examples/keyboard-input/`](../examples/keyboard-input/) does exactly that: a tiny local package (`axis_modules/input/`) tracks which keys are currently held (a plain array - see "Local packages," above, and note records have no dynamic/computed field access in AXIS, so a `key -> bool` map isn't how this is built), and an `on tick` handler reads that state every frame to move a cube - `on keydown`/`on keyup` update the *event*, `on tick` drives the *continuous* movement.
- Works inside a `scene` and a `page` alike, same as `on tick`.

### Mouse input

`on mousemove { ... }` / `on mousedown { ... }` / `on mouseup { ... }` - three more global, no-target `on` events. `mousemove` binds `dx`/`dy` - how far the mouse moved *since the last event*, in pixels (the browser's own `MouseEvent.movementX`/`movementY`), not an absolute cursor position - AXIS has no "where is the mouse right now" primitive. `mousedown`/`mouseup` bind `button` (`0`/`1`/`2` - left/middle/right, `MouseEvent.button` verbatim):

```ax
state x = 200
state y = 150

on mousemove {
    x = x + dx
    y = y + dy
}
```

- A delta-only primitive is deliberate, not a limitation to work around - it's exactly what a mouse-look camera controller wants (accumulate `dx`/`dy` into yaw/pitch), and anything that wants an absolute position can track its own by accumulating deltas from a known starting point, the same way [`examples/mouse-input.ax`](../examples/mouse-input.ax) tracks a reticle's position.
- No click-and-drag gesture, no double-click detection - same "raw primitive, a package builds the convenience" philosophy as keyboard input, above. A pointer-lock request specifically is a genuine scene-level primitive, `pointerLock` - see Pointer lock, below - since only the browser's own Pointer Lock API can actually stop the OS cursor from hitting the screen edge; no package could build that on top of `dx`/`dy` alone.
- Works inside a `scene` and a `page` alike.

### A first-person camera controller

Combining `on tick`, `on keydown`/`on keyup`, and `on mousemove` gives a real first-person controller - mouse-look plus WASD/arrow-key movement relative to where the camera is facing - built entirely from the primitives above, no new mechanism needed:

```ax
let yaw = 0
let pitch = 0

on mousemove {
    yaw = yaw + dx * 0.2
    pitch = pitch - dy * 0.2
    if (pitch > 89) { pitch = 89 }
    if (pitch < -89) { pitch = -89 }
}

on tick {
    let dirX = cos(pitch) * sin(yaw)
    let dirY = sin(pitch)
    let dirZ = 0 - cos(pitch) * cos(yaw)
    camera.target = (camera.position.x + dirX, camera.position.y + dirY, camera.position.z + dirZ)
}
```

- `yaw`/`pitch` are angles in degrees, accumulated from `dx`/`dy` - `yaw` increases turning right (a positive `dx`, mouse moving right, must increase it - moving the mouse right and turning left would be a very disorienting bug). Pitch is clamped so looking straight up/down doesn't flip the camera past vertical.
- `camera.target` (not `camera.rotation` - a camera's rotation isn't a meaningful `animate`/`on` target, see the Camera section above) is what actually aims it, computed fresh from `yaw`/`pitch` every tick using ordinary spherical-to-Cartesian trigonometry - no special camera-aiming primitive exists or is needed.
- Ground movement (WASD relative to facing direction, not world axes) composes the same `sin(yaw)`/`cos(yaw)` values with a held-key tracker (see Keyboard input, above).
- This composition surfaced a real interpreter bug during development, since fixed: a vector literal like `camera.position: (0, 2, 8)` wasn't recognized as literal, so it was spuriously treated as a live "binding" that got reset to its original value after every handler call - which silently broke *any* `on tick`-driven movement of a literally-positioned object, including [`examples/tick.ax`](../examples/tick.ax)'s own bounce. Fixed in `interpreter.js`'s `isLiteralExpr`; see `tests/literal-bindings.test.js` and the platform audit's game-dev-foundation addendum for the full account.

The math above is exactly what [`examples/fps-controls/`](../examples/fps-controls/)'s two packages do, packaged for reuse instead of re-derived per scene: `axis_modules/camera/`'s `makeFpsCamera(config)` (`look(dx, dy)` for mouse-look, `lookTarget(position)` for the aiming point, `move(position, forwardInput, strafeInput, dt)` for facing-relative ground movement - each independent, so a scene can use `look`/`lookTarget` alone for a free-look/third-person camera with no WASD at all) and `axis_modules/input/`'s `makeInputState()` (`isKeyDown`/`wasKeyPressed`/`wasKeyReleased`, `mouseDX`/`mouseDY`, `isMouseDown` - normalized input state built on the raw events above, with an `endFrame()` reset step for the edge-triggered/delta fields). Neither package is a special, built-in mechanism - both are ordinary local packages (see Local packages, below) a scene imports like any other; nothing about "camera controller" or "input state" is hardcoded into AXIS itself. See `docs/architecture/2026-09-language-platform-audit.md`'s game-foundation addendum for the full design rationale, including a real bug the semantic-level tests for this exact math caught before it shipped once already.

### Pointer lock

A scene gets one browser-API abstraction, `pointerLock` - always available inside a scene's own `on` handlers, no import needed (like `camera`/`environment`):

```ax
cube box { position: (0, 0, -5) }

on box.click {
    pointerLock.request()
}

on tick {
    if (pointerLock.isLocked) {
        // mouse-look math here - dx/dy from `on mousemove` mean the same
        // thing locked or not; lock only stops the OS cursor from
        // hitting the screen edge and clamping further movement.
    }
}
```

- `pointerLock.request()` asks the browser to lock the mouse to this scene's own canvas - like the real Pointer Lock API it wraps, this needs a genuine user gesture (a click) to succeed; a request made any other way simply leaves `isLocked` false, which a scene already has to handle (the browser lets a user press Escape to unlock at any moment, which this doesn't need to detect specially - `isLocked` just reflects it on the very next tick).
- `pointerLock.isLocked` - a boolean, read fresh every time - is deliberately polled from `on tick` rather than a separate `on pointerlockchange` event: `on tick` already runs every frame, so polling costs nothing extra and needs no new `on` event vocabulary.
- `pointerLock.exit()` releases the lock programmatically. A scene that's disposed while it holds the lock (a `viewport`'s `visible: false`, say) releases it automatically - nothing is left dangling on a canvas that no longer exists.
- DOM pages have no `pointerLock` - it's a 3D-scene-only capability (the browser API itself locks to a specific element, and a scene's own canvas is the only element AXIS has one of per scene).

### Raycasting

A scene also gets `raycast`, a second always-available handle (no import needed): `raycast.fromCamera()` (an optional `maxDistance` argument) casts a ray from the camera, straight through the center of the viewport - the one meaningful "aim point" once the pointer is locked, when the OS cursor's own position stops being meaningful - and returns either `null` (nothing hit, or nothing within `maxDistance`) or a record `{ name, distance }` naming the nearest object actually hit, by its own AXIS name:

```ax
cube target { position: (0, 0, -8) color: red }

on target.click {
    let hit = raycast.fromCamera(20)
    if (hit != null && hit.name == "target") {
        // aimed at, and within range of, 'target'
    }
}
```

- Considers every named object in the scene, not just ones with an `on click`/`hover` handler declared - deliberately more general than the click/hover raycasting `on <object>.click` itself already does internally, since "what's under the crosshair" is useful for plenty of things besides firing that object's own handler (object selection, a reticle, a line-of-sight check).
- `maxDistance` defaults to unlimited - a real range limit is exactly the kind of thing application data (a weapon, a sensor) should express, not something this primitive hardcodes.
- `hit.name` is an ordinary string - compare it with `==` against whatever names you care about, the same as any other AXIS value.

### Triggering an animation from an event

`animate` isn't only a top-level, plays-on-load declaration - the exact same block also works as a statement inside an `on` handler (or an `if`/`while`/`for` nested in one), where it means "play this now" instead:

```ax
cube box { color: blue }

on box.click {
    animate box {
        scale.x -> 1.5
        scale.y -> 1.5
        scale.z -> 1.5
        duration: 0.3s
        easing: easeOut
    }
}
```

and, on a page, exactly the same way:

```ax
button reveal { label: "Show more" }

on reveal.click {
    animate reveal {
        rotation -> 180
        duration: 0.2s
    }
}
```

- Same grammar, same `duration`/`delay`/`repeat`/`easing`/target-property rules as a top-level `animate` - the only difference is *when* it plays.
- Unlike a load-time `animate`, its starting point ("from") is whatever the object's/element's current position, rotation, scale, or opacity actually is at the moment the handler runs - not a value fixed when the scene/page was built. Click the same button twice in a row and the second animation starts from wherever the first one left off, not from the beginning again.
- Works inside a `component`'s own handlers too, namespaced to the instance exactly like a declared `animate`/`on` target is (see Components, below) - `animate self { ... }` inside `Card`'s own `on likeBtn.click` targets that specific card, not every card on the page.
- `animate` used anywhere else - inside a plain `fn`, for instance, where there's no live handler context to trigger it in - is a clear error at the moment that code actually runs.

### Computed animate/on targets

A loop-generated set of objects can be wired up individually, not just as a group - `animate`/`on`'s target can be a computed `(expr)`, exactly like an object's own name already can be:

```ax
scene main {
    for i in range(0, 5) {
        cube ("box" + i) { position: (i * 2, 0, 0) color: red }

        on ("box" + i).click {
            animate ("box" + i) { scale.y -> 2 duration: 0.3s }
        }
    }
}
```

- The expression is evaluated wherever the `animate`/`on` itself is - for a top-level (plays-on-load) `animate`, or an `on`, that's at scene/page build time, so it sees that loop iteration's own `i`; for a triggered `animate` inside a handler, it's evaluated live, against whatever the handler's own env has in scope (its scene/page's top-level variables - see the note on that above).
- It must evaluate to a string, and that string must name an object/element that actually exists (by the time this runs) - same "no object with that name" error, with the same "did you mean" suggestion, a bare-name target already gives you.
- Inside a `component`, a computed target resolves relative to that component instance, same as a bare one does - `("row" + i)` inside `Card`'s body still only ever reaches that card's own `row0`/`row1`/..., never another instance's.

## Timelines

`animate` is one shot: one target, one set of changes, one duration. A `timeline` is choreography - a named, ordered sequence of `animate` steps, each with its own target, that plays out on one shared clock:

```ax
scene main {
    camera { position: (0, 2, 10) }
    cube hero { color: "#d4a574" scale: (0.01, 0.01, 0.01) }

    timeline intro {
        animate hero {
            scale.x -> 1
            scale.y -> 1
            scale.z -> 1
            duration: 600ms
            easing: easeOut
        }

        animate camera {
            position.z -> 6
            duration: 900ms
        }
    }
}
```

A `timeline` is declared at the top level of a scene *or a page* and plays automatically once it loads, the same as a top-level `animate` does. Each step inside is exactly `animate`'s own grammar - the same target, the same property paths, the same `easing` - just without `delay`/`repeat` (see `at`, below, which replaces `delay`'s job here). A scene's own timeline targets its own objects (position/rotation/scale/material/color/intensity - see Animation, above); a page's own targets its own elements (opacity/position.x/position.y/scale/rotation - see Animation on a page, above) - and, uniquely, can *also* reach into a `viewport`'s embedded 3D scene, so one timeline can choreograph DOM and 3D together (see "DOM + 3D in one timeline," below) - AXIS's central answer to "animate this" regardless of what "this" actually is.

### Sequencing: `at`, and `previous`

By default, a step starts the instant the one before it finishes - a `timeline` reads top to bottom as a sequence, not a pile of things all starting at once. Give a step an explicit `at` (a plain number of milliseconds, or an expression) to move it:

```ax
timeline intro {
    animate hero { scale.x -> 1 scale.y -> 1 scale.z -> 1 duration: 600 }

    // starts 200ms after the scale-up above finishes, not immediately
    animate hero { material.roughness -> 0.15 duration: 400 at: previous + 200 }

    // starts 300ms *before* that one finishes - a deliberate overlap
    animate camera { position.z -> 6 duration: 900 at: previous - 300 }
}
```

`previous` is a real variable, automatically kept up to date to the *immediately preceding* step's own end time (in ms) - `at: previous + 200` and `at: previous - 300` are just ordinary AXIS arithmetic on a number, not a second timing language.

### Labels

`label NAME` marks the current position on the timeline's own clock as a variable, so a later step can jump to (or offset from) a meaningful point instead of a step count away:

```ax
timeline intro {
    animate hero { scale.x -> 1 scale.y -> 1 scale.z -> 1 duration: 600 }

    label heroSettled

    animate title { position.y -> 0 duration: 400 at: heroSettled + 100 }
    animate subtitle { position.y -> 0 duration: 400 at: heroSettled + 250 }
}
```

A `label` is just a number bound in the timeline's own scope at the point it's declared - readable by anything textually after it (including inside a nested `if`/`for`/`while`), not before, the same "no hoisting" rule everything else in AXIS follows.

### Stagger

There's no dedicated "stagger" keyword - it's an ordinary `for` loop generating steps, each offset by `at`:

```ax
timeline reveal {
    for i in range(0, 5) {
        animate ("card" + i) {
            position.y -> 0
            duration: 500
            easing: easeOut
            at: i * 80
        }
    }
}
```

`let`/`const`/`if`/`while`/`for` all work inside a `timeline` body for exactly this reason - building a choreography procedurally, the same way a scene body already builds objects procedurally.

### Playback: `play`

`play NAME` (usable inside an `on` handler, or a function called from one) restarts an already-declared timeline from its own beginning:

```ax
on hero.click {
    play intro
}
```

`pause NAME`/`resume NAME`/`reverse NAME` (the same grammar, usable in the same places) give you the rest of manual playback:

```ax
on pauseBtn.click { pause intro }
on resumeBtn.click { resume intro }
on reverseBtn.click { reverse intro }
```

- `pause` freezes the timeline exactly where it currently is - not reset to the start, the same "freeze in place" idea `stop` already has for a model's clip (see Models' Clips section). A no-op, not an error, if it's already paused or has already finished.
- `resume` continues a paused timeline from precisely where it was frozen, in whichever direction it was already moving - not from 0, and not skipped ahead by however long it sat paused. A no-op if it wasn't actually paused.
- `reverse` flips which direction the timeline is currently advancing in, in place, without restarting or losing its current position - the one thing that can also un-stick a *finished* timeline (one that reached either end): reversing it makes it start moving back from wherever it settled. Works whether the timeline is currently paused or actively playing.

See "Not yet supported," below, for what's still not here (a playback speed multiplier, loop, completion callbacks), and Scroll, next, for the other way a timeline's clock can be driven.

`play`/`pause`/`resume`/`reverse` and scroll don't mix: once something claims a timeline for scroll (see below), any of these four is a clear error rather than a silent no-op - a scroll-linked timeline's whole point is that its state is a pure function of scroll position, so a manual control would just be overwritten by the next scroll-driven frame anyway.

### DOM + 3D in one timeline

A page-level `timeline`'s steps aren't limited to that page's own elements - a step can cross-reference an object inside a `viewport`'s embedded scene too, written as a computed (parenthesized, quoted) target of the form `"viewportName.objectName"`:

```ax
scene reveal {
    camera { position: (0, 2, 10) }
    model hero { src: "./hero.glb" scale: (0.01, 0.01, 0.01) }
}

page Home {
    heading title { content: "Look closer" opacity: 0 }
    viewport stage { scene: "reveal" }

    timeline intro {
        animate title { opacity -> 1 duration: 500 }
        animate ("stage.hero") { scale.x -> 1 scale.y -> 1 scale.z -> 1 duration: 700 at: previous }
        animate ("stage.camera") { position.z -> 6 duration: 700 at: previous }
    }
}
```

One timeline, one schedule, one clock - `title` (a real page element), `stage.hero` (a real 3D model), and `stage.camera` (that scene's own camera) all sequenced together with the same `at`/`previous`/`label` machinery. This is not two timelines kept in sync - `("stage.hero")`'s property paths and value rules are the scene's own (position/rotation/scale/material/color/intensity, same as any scene-level step), resolved against the *actual* object `stage` embeds, validated against it at build time exactly the way a bare target is.

- `stage` must name a `viewport` declared in the same page; `hero` must be an object that viewport's own scene actually has (or `"camera"`, for that scene's camera - see Scenes' Camera section). Typos get the same "did you mean" treatment a bare target does.
- Exactly one `.` - `"stage.hero.material"` isn't a thing; use `("stage.hero") { material.metalness -> ... }` instead, the same dotted-property-path syntax a scene-level step already uses.
- This cross-domain form only exists inside a page-level `timeline` step. A plain top-level `animate` on a page still only targets that page's own elements.

### Scroll

A `timeline` normally plays on its own clock, once, on load. `scrollTimeline: "NAME"` on an element replaces that clock with *that element's own* scroll position instead - the named timeline stops auto-playing, and its progress becomes a deterministic function of how far the visitor has scrolled through that element. The same property means the same thing everywhere it appears - the only thing that changes is *whose* timeline it drives:

```ax
scene reveal {
    camera { position: (0, 2, 10) }
    model hero { src: "./hero.glb" scale: (0.01, 0.01, 0.01) }

    timeline arc {
        animate hero { scale.x -> 1 scale.y -> 1 scale.z -> 1 duration: 1000 }
        animate camera { position.z -> 6 duration: 1000 at: previous - 400 }
    }
}

page Home {
    viewport stage { scene: "reveal" scrollTimeline: "arc" height: 2000 }
}
```

- On a `viewport`, `scrollTimeline` drives that *embedded scene's* own timeline (`arc`, above - validated against that scene at build time). On any other element - a `container`, a `heading`, anything - it drives a timeline declared in the *page itself* (validated at runtime instead, since a page-level timeline can be declared anywhere in the file, including after the element referencing it).
- Nothing about the timeline itself changes either way - it's still the exact same sequence of `animate` steps, `at`, `label`, `previous`, stagger, cross-domain targets, all of it. Scroll is a *driver*, not a second animation system - the interpolation, easing, and every property path are all the same engine `play`-driven timelines use.
- Progress is `0` the moment the element's own top edge would enter the bottom of the window, `1` the moment its bottom edge would leave the top - a deterministic function of that element's own position and `height` (a taller element is a longer, slower scroll-through), not scroll pixels or elapsed time. There's no separate range/start/end property to configure - `height` *is* the range.
- Scrubbing is exact and reversible: the same scroll position always produces the same timeline state, whichever direction you scrolled to get there. Scroll up and the choreography runs backwards; jump with the scrollbar and it jumps straight to that point - there's no "catching up," no queued animation, no drift.
- `prefers-reduced-motion: reduce` skips tying motion to scroll entirely - the timeline is seeked once to its own finished, settled state (what the choreography ends on), so the composition still reads correctly without any motion.
- Multiple scroll-linked elements on the same page are fully independent - each tracks its own scroll position, with no shared/global state between them (see [`examples/scroll-story.ax`](../examples/scroll-story.ax), which has two `viewport`s, and [`examples/unified-story.ax`](../examples/unified-story.ax), which drives one page-level, DOM+3D timeline from a single wrapping container's own scroll position).

Progress is always measured from whichever element `scrollTimeline`/
`scrollProgress` is actually declared on - so a `position: "sticky"`
element used *for that measurement* would indeed get stuck at whatever
progress it had the instant it pinned (its own bounding box stops moving).
The fix is which element you measure from, not new AXIS syntax: declare
`scrollTimeline`/`scrollProgress` on a plain, tall, normally-flowing wrapper
`container`, and give the `viewport` (or any element) you actually want
visually pinned its own `position: "sticky"` as a *nested child* of that
wrapper - the wrapper's own rect keeps moving continuously for the whole
scroll-through, completely independent of its child's own pinned state:

```ax
page Home {
    container pin {
        height: 3000
        scrollTimeline: "arc"

        viewport stage {
            scene: "reveal"
            position: "sticky"
            top: 0
            height: 500
        }
    }

    timeline arc {
        animate ("stage.hero") { rotation.y -> 360deg duration: 2000 }
    }
}
```

This is the "tall wrapper, pinned inner element" scrollytelling pattern,
and it needs no new language feature - `position` was already an ordinary
CSS string, `scrollTimeline`/`scrollProgress` already worked on any element
(not just `viewport`), and a page-level timeline could already cross-
reference a `viewport`'s embedded scene (see "DOM + 3D in one timeline,"
above). See [docs/architecture/sticky-scroll-timeline.md](architecture/sticky-scroll-timeline.md)
and [`examples/sticky-scroll.ax`](../examples/sticky-scroll.ax).

### Nested scroll containers

By default, `scrollTimeline`/`scrollProgress` measure against the document's own scroll position. `scrollRoot: "name"` measures against a scrollable *container* instead - the other piece of the "tall wrapper, pinned inner element" pattern for when the pinned content lives inside its own scrollable box rather than the page itself:

```ax
container panel {
    css: "overflow-y: auto"
    height: 320

    container track {
        height: 1600
        scrollTimeline: "reveal"
        scrollRoot: "panel"
    }
}
```

`scrollRoot` has to name a real ancestor of the element declaring it (an immediate parent, or further up) - the same "did you mean" treatment any other target name gets if it doesn't. Making the container actually scroll is your own `css: "overflow-y: auto"` (or a `responsive` override) - AXIS doesn't infer that from `scrollRoot` alone. Works on a `viewport` too, not just plain containers. See [docs/architecture/nested-scroll.md](architecture/nested-scroll.md).

### Scroll progress as data

`scrollTimeline` is scroll driving *animation*. `scrollProgress: "NAME"` is the same measurement driving *data* instead - it writes an element's own scroll progress (0-1, the identical number `scrollTimeline` already computes) into a `state` (or a plain `let` - see below), through AXIS's ordinary reactive-state machinery, not a separate scroll-to-value system:

```ax
state progress = 0

scene reveal {
    camera { position: (0, 2, 8) }
    cube box { rotation: (0, progress * 360, 0) scale: (0.5 + progress * 0.8, 0.5 + progress * 0.8, 0.5 + progress * 0.8) }
}

page Home {
    container hero {
        scrollProgress: "progress"
        height: 2000

        text readout { content: "progress: " + round(progress * 100) + "%" }
        viewport stage { scene: "reveal" }
    }
}
```

One scroll position, one number, two consumers: `readout`'s own text binding and `box`'s own `rotation`/`scale` both just read `progress` the normal way any reactive value is read - neither one knows or cares that scroll is what's changing it. This is the same principle `scrollTimeline` already follows, generalized: scroll is a *driver*, and a `state` variable is exactly as valid a thing for it to drive as a timeline is.

- Scoping matches `scrollTimeline` exactly: on a `viewport`, `scrollProgress` targets a variable in the *embedded scene's* own scope (validated at build time against that scene, same as `scrollTimeline`); on any other element, the page's own (or, by the normal parent-chain walk every variable lookup already does, a shared top-level `state` either domain can read - see the example above, where `progress` is declared at the very top of the file specifically so both the scene and the page can read it).
- Works on a `let` too, not only `state` - AXIS's reactive re-render doesn't distinguish between them (see State, above); `state` is still the right one to reach for, since it says what you mean.
- `scrollTimeline` and `scrollProgress` are independent - set one, the other, or both on the same element. Setting both costs one shared measurement per frame, not two.
- Reduced motion does **not** freeze this. `prefers-reduced-motion` stops `scrollTimeline` from tying *animation* to scroll, but `scrollProgress` keeps updating live either way - a "you're 40% through" readout is information, not motion, and AXIS treats the two differently on purpose.

See [`examples/scroll-progress.ax`](../examples/scroll-progress.ax) for a complete version of the example above.

### Completion

`on TIMELINE.complete { ... }` runs once, the instant a wall-clock-driven (`play`/`reverse`-triggered) timeline reaches either end - the same handler-body grammar a `click`/`hover` handler already uses, just targeting a `timeline`'s own name instead of an object's:

```ax
timeline intro {
    animate hero { opacity -> 1 duration: 500 }
}

on intro.complete {
    print("intro finished")
}
```

`complete` is the one event that only ever means "this timeline finished playing" - it's a build-time error on an ordinary object, and any event other than `complete` is a build-time error on a timeline. It never fires for a scroll-driven timeline (`scrollTimeline`) - scrubbing back and forth across a timeline's end while scrolling isn't a meaningful "completion" the way a `play`/`reverse` run finishing once is.

### Looping a timeline

`loop: true`, declared at a timeline's own top level (alongside its `animate`/`label` steps), makes a `play`-driven run repeat from the beginning automatically once it reaches the end, instead of just stopping there:

```ax
timeline spin {
    loop: true
    animate box { rotation.y -> 360deg duration: 2s }
}
```

A looping timeline never "finishes" in the sense `on TIMELINE.complete` (above) means - each lap wrapping around is a continuation, not a completion, so `complete` never fires for one. `reverse` still works on a looping timeline - it flips which direction the loop itself advances in, in place, the same as on any other timeline. There's still no playback-speed multiplier.

### Cross-viewport timeline control

A page-level `on` handler can `play`/`pause`/`resume`/`reverse` a `viewport`'s own embedded-scene timeline directly, using the same `"viewportName.timelineName"` dotted name a page-level `timeline` step already uses to cross-reference a viewport's own objects:

```ax
scene product {
    cube box { color: orange }
    timeline spin { animate box { rotation.y -> 360deg duration: 1.5s } }
}

page Home {
    viewport stage { scene: "product" }
    button replay { label: "Replay" }
    on replay.click { play ("stage.spin") }
}
```

This is resolved live, in the browser, the same as every other `play`/`pause`/`resume`/`reverse` target already is - not build-time validated, so a typo'd viewport or timeline name is a clear runtime error, not a silent no-op.

### Not yet supported

Real, current limitations, not design decisions:

- No per-step callbacks - `on TIMELINE.complete` (above) covers a timeline finishing as a whole, but a timeline's individual steps are still pure `animate` changes, not arbitrary code.

See [`examples/cinematic.ax`](../examples/cinematic.ax) for a load-driven choreography using labels, stagger, `at`, material/light/camera targeting, and `play`; [`examples/scroll-story.ax`](../examples/scroll-story.ax) for the same engine driven by scroll; and [`examples/unified-story.ax`](../examples/unified-story.ax) for one scroll-driven, page-level timeline choreographing DOM elements and a 3D scene together.

## Components

```ax
component Card(title, description) {
    state likes = 0

    container root {
        direction: "column"
        gap: 8

        heading cardTitle { content: title level: 3 }
        paragraph cardDesc { content: description }
        text likeCount { content: likes + " like(s)" }
        button likeBtn { label: "Like" }
    }

    on likeBtn.click {
        likes += 1
    }
}
```

A `component` is a reusable, parameterized chunk of declarative content - a language-level thing, not a visual template. Its body uses exactly the same grammar a `scene`/`page` body does (object declarations, `state`/`let`, `on`, `animate`, `if`/`for`/`while`, and nested component instantiations), declared at the top level of a file next to `scene`/`page`/`fn`.

**Using** a component isn't new syntax - it's ordinary object-declaration syntax, with the component's name standing in for a built-in type like `container`:

```ax
page Home {
    Card projectA {
        title: "AXIS"
        description: "A language for building the web."
    }

    Card projectB {
        title: "Nimbus"
        description: "Cloud backups without the busywork."
    }
}
```

Every declared parameter must be supplied as a property; an unknown property is a clear error with a "did you mean" suggestion against the component's own parameter list.

**What actually happens when a component is used** (this matters for reasoning about it, so it's worth being precise):

- **Transparent expansion, no wrapper element.** `Card projectA { ... }` isn't a container that gets an extra element around it - its own top-level declaration(s) become direct children of whatever `Card` was declared inside (here, `page Home` itself). If a component's body has one top-level `container`, that container is what you get; there's no invisible extra `<div>`.
- **Every name the component declares gets namespaced under the instance name**, so `projectA` and `projectB` above don't collide even though they're built from the exact same component: internally, the elements are `projectA.root`, `projectA.cardTitle`, ..., `projectB.root`, `projectB.cardTitle`, and so on. This is invisible from inside the component (you still write `on likeBtn.click`, not `on projectA.likeBtn.click`) - the namespacing is applied automatically to element names and to `on`/`animate` targets.
- **A component only sees globals, functions, and its own parameters/`state`/`let`** - never the page/scene it's used inside. This is deliberate encapsulation: a component is meant to be reusable across pages without silently depending on some specific caller's variables.
- **Parameters are resolved once, at the point of use** - like a function argument, not a live, reactive channel back to the caller. If the value you pass in later changes (because it came from a `state` variable in the caller), the component does not re-render to reflect that. Component-local `state`/`let`, however, work exactly like page-level `state`/`let` do - see the State section above.
- **`state`/`let` intended to be visible to the component's own `on` handlers must be declared at the component's own top level**, not nested inside one of its containers - same "only top-level bindings are captured" rule that already applied to scenes and pages, unchanged by components.
- Components work inside a `scene` too, not just a `page` - the mechanism doesn't know or care which domain it's used in, only whether the component's own body declares things that domain understands.

## Modules

```ax
// utils.ax
export fn shout(text) {
    return text + "!"
}

export component Card(title) {
    heading h { content: title }
}
```

```ax
// main.ax
import shout from "./utils.ax"
import Card from "./components/card.ax"

page Home {
    Card hero { title: shout("hi") }
}
```

`export` is a modifier on a top-level `fn`, `component`, `let`, or `const` - it marks that declaration as importable elsewhere. `scene`/`page` are entry points, not reusable units, so `export scene`/`export page` is a syntax error. `import Name from "./relative/path.ax"` pulls in whatever `Name` exports under that same name - one name per `import` line, no destructuring, no aliasing. The path is resolved relative to the *importing* file and must end in `.ax`.

Imports are resolved transitively (a file you import can have its own imports) and are deduplicated, so a "diamond" - two different files you import both depending on a third - doesn't produce a duplicate/colliding definition. A few things are checked with a clear error rather than failing obscurely:

- importing a file that doesn't exist
- importing a name a file doesn't export (the error lists what it *does* export)
- an import path that doesn't end in `.ax`
- a circular import (file A imports file B imports file A) - reported directly, not as infinite recursion

### Local packages

`import Name from "some-name"` - a bare specifier, no leading `./` or `../` - resolves as a **package** instead of a file: AXIS looks for `axis_modules/some-name/index.ax`, walking upward from the importing file's own directory the same way Node walks `node_modules` (so it doesn't matter how deeply nested the file doing the importing is - the search finds the project's one `axis_modules/` at its root). A package is nothing more than an ordinary directory of `.ax` files; there's no registry and no `axis add` yet - this is deliberately a local-only foundation (see the roadmap in [docs/architecture/2026-09-language-platform-audit.md](../docs/architecture/2026-09-language-platform-audit.md)), not an npm-scale package ecosystem. See [docs/extensions.md](../docs/extensions.md) for the full contract a package author (not just a package *consumer*) needs.

A package can optionally carry its own `axis_modules/some-name/axis.json` - a plain JSON object with `name`, `version` (both purely informational today - a human/future-registry label, not yet checked against anything) and `main` (the one field resolution actually reads: the entry file to load instead of the `index.ax` default, relative to the package's own directory, must end in `.ax`, and can't escape the package directory via `../` or an absolute path). No `axis.json` at all resolves exactly as before it existed - `index.ax`.

```json
// axis_modules/some-name/axis.json
{ "name": "some-name", "version": "0.1.0", "main": "src/index.ax" }
```

`axis.json` also has a third, optional field, `runtimeExtension` - a JS file (not `.ax`) that registers a genuinely new, live-settable 3D scalar property (`box.someNewProperty = ...` inside an `on` handler, or a triggered `animate`) from outside AXIS's own source. This is a real, separate capability from an ordinary package's `.ax`-only surface - see [docs/runtime-extensions.md](../docs/runtime-extensions.md) for the full contract, including its honest scope limits and trust-model implications (a runtime extension's JS runs with full browser privileges, unlike pure `.ax` source).

```ax
// axis_modules/badge/index.ax
import toneColor from "./colors.ax"   // a package's own files import each other normally

export component Badge(label, tone) {
    container pill { background: toneColor(tone) padding: 8 radius: 999
        text pillLabel { content: label color: white }
    }
}
```

```ax
// main.ax
import Badge from "badge"

page Home {
    Badge status { label: "Passing" tone: "success" }
}
```

A package's own internal helper (`toneColor` above) only needs to be reachable *from inside the package* - `main.ax` never has to know it exists, exactly the same "a file's own imports travel with it" rule already true for a plain multi-file project (see [`examples/app-with-package/`](../examples/app-with-package/) and, for the ordinary-file version of the same rule, [`examples/app/`](../examples/app/)'s `card.ax` importing `shout` on its own behalf). A bare specifier that still ends in `.ax` (almost always a relative path someone forgot the `./` on) is a clear, distinct error rather than a confusing "package not found."

A syntax error inside an *imported* file is reported against that file specifically (the right file's source line gets printed, not the file you actually ran) - a runtime error inside an imported *component*'s own body is reported the same way. A runtime error inside an imported plain *function*'s body is not currently attributed to its file this precisely - it still reports a line number, just without which file that line is in. Modules are resolved entirely before interpretation starts - the language core (the parser's grammar aside, `evaluator.js`/`interpreter.js`) has no idea files or imports exist; by the time it runs, it's just looking at one ordinary, flat program, exactly as if everything had been written in one file.

## Async

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

`async fn` marks a top-level function as one that can `await`. Calling one *without* `await`, from somewhere that can't suspend, is a clear error rather than a `Promise` silently becoming a value:

```text
error in app.ax: 'loadProjects' is an async function - call it with 'await', inside an 'on' handler or another async function (line 12)
```

`await expr` is legal inside an `async fn`'s body, and inside any `on` handler's body with no `async` keyword needed at all - a handler is always async-capable, the same way a browser's own `addEventListener` callback can just be `async (e) => {}`. It's *not* legal at the top level of a `scene`/`page`'s own declarative body, or inside an `animate { ... }` block (even one written inside an otherwise-async `on` handler) - both build/evaluate through a path that can't suspend. Using `await` in either place is a syntax error at parse time, not a confusing failure at runtime.

**`fetch(url)` / `fetch(url, options)`** - close to the browser's own shape. Resolves to a record: `ok`, `status`, `statusText`, plus two more `await`-able methods, `json()` and `text()`. `options` is a record: `method` (a string, e.g. `"POST"`), `headers` (a record), `body` (a string sent as-is, or a record/array auto-JSON-encoded).

```ax
let response = await fetch("/api/projects", { method: "POST", body: { name: "Nimbus" } })
if (response.ok) {
    let data = await response.json()
}
```

**`api.get(url)` / `api.post(url, body)` / `api.put(url, body)` / `api.delete(url)`** - the higher-level convenience most code should reach for: sends/parses JSON directly (no separate `.json()` call), and throws a clear, `try`/`catch`-able error on a non-2xx response or a non-JSON body:

```text
error: 'api.get' got 404 Not Found from '/api/projects/9'
```

A JSON object/array that comes back from either is converted into AXIS's own record/array shapes on the way in - `keys(...)`, `.field` access, and "did you mean" on a missing field all work on it exactly like a value written directly in source. Sending a record/array back out (a request body) goes through the same conversion in reverse.

**What this doesn't do (yet):** no build-time/server-rendered data fetching (`await` only works client-side, inside a handler - a page can't pre-fetch data at `axis build` time); no request cancellation, timeout, or de-duplication; no streaming bodies, Server-Sent Events, or WebSockets; a caught error (`err` in `catch`) is always a plain string message, not a structured value with its own `.status`. See [docs/architecture/async-await.md](architecture/async-await.md) for the full design and reasoning.

## Errors

Syntax and runtime errors point at a line number and print the offending source line. Typos in object types, colors, animate/interaction targets, and variable names get a "did you mean" suggestion when something close enough exists:

```text
error in scene.ax: can't animate 'boxx' - no object with that name in scene 'main' - did you mean 'box'? (line 12)
```

`axis check` (below) goes further: it classifies every error into a stable, versioned `Diagnostic` (a `severity`, a machine-readable `code`, the message, a location when one exists, and a suggestion when one exists - see [docs/ai/VALIDATION.md](ai/VALIDATION.md)) and can print that as JSON (`--json`) instead of text, for tooling/AI-agent consumption. `docs/ai/` is a whole small corpus aimed specifically at AI coding agents generating AXIS - see [docs/ai/README.md](ai/README.md).

## CLI

```bash
axis create <name>                scaffold a new starter project in ./<name>
axis run <file.ax>                render a .ax file's first scene or page in the browser, live-reloading on save
axis build <file.ax> [--out dir]  write a static, servable copy of the render to disk (default: dist)
axis graph <file.ax>              parse and interpret a .ax file, print the scene/page graph as JSON
axis check <file.ax> [--json]     validate a .ax file - lexing, parsing, imports, and semantics (not just syntax) - see docs/ai/VALIDATION.md for --json's exact schema
axis fmt <file.ax> [--check]      reformat a .ax file to AXIS's canonical style in place (--check: report only, exit 1 if formatting is needed, don't write)
axis inspect <file.ax> [--json]   print the scenes/pages/components/objects/timelines/routes a file declares, as a tree or a flattened JSON list
axis lsp                          run the AXIS language server (diagnostics/formatting/hover/definition/document symbols over stdio) - for an editor to spawn
axis version                      print the AXIS version
```

A file renders as a page if it defines any `page` - a page can embed a `scene` via `viewport` (see Viewports, above), so a file defining both is normal, not an error. A file with only `scene`s renders the first one standalone. A file with at least one `route` renders as a multi-page site instead (see Routing, above) - every page some route reaches, not just the first one. Picking which page renders when a file has more than one and *no* `route`s isn't built yet - AXIS always uses the first and warns about the rest.

Every command resolves `import`s starting from the file you name - `axis check` walks the whole import graph too (a missing/broken import is a check failure, not just "the entry file parses").

### `axis create`

`axis create my-app` scaffolds `my-app/main.ax` - a small starter that touches the language's actual shape (a page, an embedded 3D scene via `viewport`, and a shared `state` driving both a DOM label and the 3D object), not a blank file or a single red cube. `cd my-app && axis run main.ax` to see it.

### `axis run`'s live reload

`axis run` watches the entry file (its own directory, actually - see below) and, on every save that produces a working build, pushes already-open browser tabs a reload over a small Server-Sent-Events connection (`/__axis_reload__` - no WebSocket library needed for a one-way "something changed" signal). A save that doesn't compile prints the error to the terminal, exactly like `axis check` would, and leaves the last good build running - the dev server never crashes and the browser never goes blank because of a mid-edit typo.

Two honest limitations: only the entry file itself is watched, not files it `import`s (a real gap, not a design choice); and switching a file between defining only a `scene` and defining a `page` while `axis run` is already running isn't picked up live - restart it (which server to start, and which client runtime to serve, is decided once, at startup).

## Embedding

Everything above describes AXIS as a standalone site (`axis run`/`axis build`). AXIS can also be embedded into an existing HTML page or React application, without adopting it for the whole site - see [docs/architecture/embedding.md](architecture/embedding.md) for the full design.

### Plain HTML/JS

```html
<div id="hero"></div>
<script type="module">
  import { mount } from "axis-lang";

  const source = await (await fetch("./hero.ax")).text();
  const instance = await mount(document.getElementById("hero"), source, {
    inputs: { title: "Hello" },
  });

  instance.on("notify", (payload) => console.log("AXIS said:", payload));
  instance.update({ title: "Updated later" });
  // instance.destroy() when you're done with it
</script>
```

- `source` is the `.ax` file's raw text, not a path - fetch it, `?raw`-import it (Vite), or read it however your own tooling already gets text into JS.
- The `.ax` file needs exactly one `page` - that's the embeddable unit.
- **Inputs are just top-level `state`/`let`** - no new syntax. `mount()`'s `inputs` seeds them; `instance.update(...)` changes them later, reactively, through the exact same mechanism an internal `on` handler's own assignment uses. An unknown key throws immediately.
- **`emit("name", payload)`** (call it like any function, from an `on` handler or anywhere else) sends an event out to the host - `instance.on("name", callback)` receives it. Per-instance, not a global bus.
- `mount(target, source, { scrollRoot })` - pass a host element as `scrollRoot` when embedding inside your own scrollable container (not the window) so `scrollTimeline`/`scrollProgress` measure against it by default.

### React

```jsx
import { Axis } from "axis-react";
import heroSource from "./hero.ax?raw";

<Axis source={heroSource} title="Hello" intensity={0.8} onNotify={(payload) => console.log(payload)} />
```

`axis-react` (`packages/axis-react`) is a small, separate adapter - `axis-lang` itself never imports React. Any prop named `onXxx` (a function) subscribes to that AXIS output event (lowercase-first: `onNotify` -> `emit("notify", ...)`); every other prop is a host input. Mounts once per distinct `source`; ordinary prop changes flow into AXIS via `update()`, not a remount; unmounting the `<Axis/>` element calls `destroy()`.

## Known limitations

Worth repeating from the README, since these are exactly the things people run into first:

- Direct `import Hero from "./hero.ax"` isn't supported - `mount()`/`<Axis/>` take the file's raw source text instead (see Embedding, above). A real bundler loader plugin is real, separate future work.
- A `viewport`/3D component embedded via `mount()` inside a third-party bundler (not AXIS's own dev server) currently needs that bundler to also resolve `/vendor/three.module.js` itself - see docs/architecture/embedding.md's "Known limitations."

- `state`'s reactive re-render doesn't actually distinguish `state` from a plain `let` right now (see the State section above) - there's no dependency tracking, just a full but cheap re-check of every bound property after any handler runs.
- No layout mode besides flexbox (`direction`/`align`/`justify`/`gap`) - no CSS grid yet, though `position: "absolute"` plus `top`/`left`/`right`/`bottom` covers manual placement.
- A component's parameters are resolved once, at the point of use - not a reactive channel back to the caller (see the Components section above).
- `import` supports one name per line, no destructuring/aliasing/renaming (`import X as Y` doesn't exist).
- A runtime error inside an imported plain function's body isn't attributed to its own file yet - only imported components get that (see the Modules section above).
- `on` handlers can now read an *enclosing `for` loop's* own variable (captured by value - see the Reactive structure section above), but still can't see a plain `let`/`const` local to a `group`/`container`/`if`/`while`, only the scene/page's own top-level names and whichever loop(s) they're nested in.
- A `page` can embed a `scene` via `viewport` now, but there's no two-way state sharing between them beyond a shared top-level `let`/`fn`, and no DOM/3D coordinate projection (an HTML label tracking a 3D object's screen position, say) - see the Viewports section above and [docs/architecture/page-scene-fusion.md](architecture/page-scene-fusion.md).
- `visible: expr` now works on any page element (a plain, cheap display toggle), not just `viewport` (a real mount/unmount lifecycle there) - see the Viewports section above. A `for`/`if` (see Reactive structure, above) covers genuine add/remove now too, but there's still no keyed identity beyond an element's own name, and no list reordering.
- A `component` can't declare a `viewport` inside it (untested path).
- `responsive` overrides aren't reactive - they're evaluated once, like a literal, not re-checked after a `state` update (see the Responsive layout section above).
- `play`/`pause`/`resume`/`reverse` don't resolve a component-namespaced or loop-captured target the way `animate`/`on` targets do - a real, narrow, pre-existing gap (not introduced by adding `pause`/`resume`/`reverse` - `play` already had it).
- A named `fn` (or `component`) can't be declared inside a scene/page/component body - only at a file's true top level. A helper that needs page-local `state` has to take it as an explicit parameter rather than closing over it (see `examples/stdlib.ax`); an inline `fn(...) { ... }` expression (see Functions, above) is how you adapt a top-level helper to a callback shape that needs to see that state.
- `axis fmt` can't yet format an inline `fn(...) { ... }` expression whose body is more than one statement (or a nested `if`/`for`/`while`/`try`) - it fails with a clear error rather than mis-formatting it. Pull a lambda that big out into a named top-level `fn` instead. A single-statement body (`fn(x) { return ... }`, the common case for `map`/`filter`/`sortBy`/...) formats normally.
