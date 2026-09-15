# Common AXIS mistakes

Every mistake below was actually reproduced against AXIS's real parser/
interpreter while writing this corpus (not guessed) - each ❌ genuinely
throws the error shown, each ✓ genuinely checks out clean with
`axis check`. If you're generating AXIS and something doesn't parse, check
here before inventing a workaround.

## 1. Assuming JavaScript syntax works directly

AXIS looks like JS/C in places but has its own, smaller grammar. A few
specific traps:

❌ Wrong - a bare statement/assignment at the top level of a file:
```ax
let x = 1
x = 2
scene main { cube box { color: red } }
```
```
expected 'scene', 'page', 'fn', ... at the top level, got 'x'
```
✓ Correct - the top level only allows *declarations* (`let`/`const`/`state`/
`fn`/`async fn`/`component`/`scene`/`page`/`import`/`export`/`route`/
`redirect`). A plain statement (an assignment, a loop, a bare call) has to
live inside a function, an `on` handler, or a component body:
```ax
let x = 1
fn setX(v) { x = v }
scene main {
    cube box { color: red }
    on box.click { setX(2) }
}
```

❌ Wrong - `if`/`while` without parentheses around the condition:
```ax
while x > 0 { x = x - 1 }
```
✓ Correct - AXIS requires parens here (unlike some languages that make them
optional):
```ax
while (x > 0) { x = x - 1 }
if (x > 0) { ... } else { ... }
```

❌ Wrong - `===`/`!==`:
```ax
if (a === b) { ... }
```
✓ Correct - AXIS only has `==`/`!=`, no strict-equality variant:
```ax
if (a == b) { ... }
```

❌ Wrong - semicolons as statement separators. AXIS doesn't use them at all;
just don't write them.

## 2. Confusing a property with an assignment

Object/element properties inside a declaration use `:`, not `=` - `=` is
only for assignment statements (inside a function/handler body).

❌ Wrong:
```ax
scene main {
    cube box { color red }
}
```
✓ Correct:
```ax
scene main {
    cube box { color: red }
}
```

## 3. Inventing color names

AXIS has exactly 14 built-in named colors: `red green blue yellow orange
purple white black gray grey pink brown cyan magenta`. There is no `teal`,
`navy`, `coral`, `indigo`, etc. as a bare identifier - anything else needs a
hex string.

❌ Wrong:
```ax
cube box { color: teal }
```
```
undefined variable 'teal'
```
✓ Correct:
```ax
scene main {
    cube box { color: "#008080" }
}
```

## 4. `component` always needs `(...)`, even with zero parameters

❌ Wrong:
```ax
component Card {
    container root { }
}
```
```
expected LPAREN but got LBRACE
```
✓ Correct:
```ax
component Card() {
    container root { }
}
```

## 5. Mixing incompatible types with an operator

`+` is overloaded for string concatenation with *any* other value
(`"Clicks: " + count` works, and so does `count + " clicks"`), but `-`/`*`/
`/` are still strictly numeric - they don't stringify.

❌ Wrong:
```ax
let label = "Count" - 1
```
```
can't subtract a number from a string
```
✓ Correct - use `+` for display strings, keep arithmetic between numbers:
```ax
let label = "Count: " + count
```

## 6. Forgetting `duration` on `animate`, or giving it a bad value

Every `animate` block needs a `duration`, and it must be a finite,
non-negative number (milliseconds, or a `Ns`/`Nms` literal - see
[docs/language.md](../language.md)'s Animation section).

❌ Wrong:
```ax
animate box { rotation.y -> 360deg }
```
```
animate block for 'box' is missing 'duration'
```
❌ Also wrong:
```ax
animate box { rotation.y -> 360deg duration: -500 }
```
✓ Correct:
```ax
scene main {
    cube box { color: red }
    animate box { rotation.y -> 360deg duration: 2s }
}
```

## 7. Using an easing name that doesn't exist

Eleven real names, in four families - not `ease-in-out`, not a bare
`bounce`, not a cubic-bezier array:

- `linear`
- `easeIn`, `easeOut`, `easeInOut` (quadratic - the default feel)
- `easeInCubic`, `easeOutCubic`, `easeInOutCubic` (same shapes, stronger)
- `easeInBack`, `easeOutBack`, `easeInOutBack` (slight overshoot)
- `easeOutBounce` (settles like a dropped ball - only the "out" direction exists)

## 8. Animating/binding to a target that doesn't exist (or a typo)

`animate`/`on`/`play` targets are checked against the actual declared
objects/elements/timelines in scope - a typo gets a real "did you mean"
suggestion (don't ignore it; it's usually right):

```
can't animate 'boxx' - no object with that name in scene 'main' - did you mean 'box'?
can't add an interaction to 'boxx' - no object or timeline with that name in scene 'main' - did you mean 'box'?
```

## 9. Treating a `component`'s parameters as reactive

A component's params are resolved **once**, at the point of use - like a
function argument, not a live binding back to the caller. If you pass a
`state` value into a component and that `state` changes later, the
component does not automatically re-render to reflect it. If you need
something inside a component to update live, give it its own `state` there,
or drive it through props at re-mount, not through an assumption that
passing a `state` variable in creates an ongoing subscription.

## 10. Direct `import Foo from "./foo.ax"` for embedding

That's JavaScript module-import syntax, and AXIS's own `import`/`export` is
for **AXIS-to-AXIS** module composition (`import Card from "./card.ax"`
inside a `.ax` file), not for pulling a `.ax` file into a JS/React app. For
embedding, `mount()`/`<Axis/>` take the file's **raw source text**, not a
module import:

❌ Wrong (in a `.jsx`/`.js` file):
```js
import Hero from "./hero.ax"; // there is no bundler loader for this
```
✓ Correct:
```js
import { mount } from "axis-lang";
import heroSource from "./hero.ax?raw"; // Vite's ?raw, or fetch() the text
await mount(document.getElementById("hero"), heroSource, { inputs: { title: "Hi" } });
```
See [REACT.md](REACT.md) / [HTML.md](HTML.md) and
[../architecture/embedding.md](../architecture/embedding.md).

## 11. Expecting a React prop change to be a remount

`<Axis source={...} title={...} />` only remounts (tears down and rebuilds
the whole AXIS instance) when `source` itself changes identity. Every other
prop flows into AXIS's own `state` reactively through `update()` - this is
intentional (cheap prop updates, not full teardown/rebuild on every render),
not a bug if a `title` change doesn't "feel like" a fresh mount.

## 12. Assuming `if`/`for` reactivity has keyed reordering

A page/scene's `if`/`for` re-runs reactively (add/remove real elements when
a `state` it depends on changes - see
[../architecture/reactive-structure.md](../architecture/reactive-structure.md)),
keyed by each item's own declared name. There's no list-reordering
diff (moving an existing item to a new position) beyond that - don't expect
DOM-node identity to survive a re-sort of an array driving a `for`, only
survive an add/remove.

## 13. Checking syntax only, not semantics

`axis check` validates the *whole* pipeline (lex, parse, imports,
interpretation, plan-build) - not just syntax. Don't assume a clean parse
means a valid program; always run `axis check` (or `axis check --json`,
see [VALIDATION.md](VALIDATION.md)) after generating or editing AXIS, and
read the diagnostic's `code`/`message`/`suggestion` rather than guessing
what's wrong from the syntax alone.

## 14. Assuming a page element still can't animate `color`/`background`

A page element's `animate`/`timeline` vocabulary is `opacity`,
`position.x`/`position.y`, `scale`, `rotation`, `color`, and `background` -
the last two were added later, so don't assume the older, shorter list
(without `color`/`background`) is still the full one. `color`/`background`
take a color name or a string like `"#ff6600"`, same as a scene's own
`color`, and interpolate as a real color lerp:

```ax
animate banner { background -> "#1a1a2e" color -> white duration: 500ms }
```

There's still no `width`/`height`/`filter`/`border-radius` animation on a
page element - don't assume the whole CSS surface animates just because
color does now.

## 15. Using `on TIMELINE.complete` on the wrong kind of target

`complete` only fires on a `timeline`'s own name, never on an object - and
a `timeline` only ever fires `complete`, never `click`/`hover`/etc.:

```ax
timeline intro { animate hero { opacity -> 1 duration: 500 } }
on intro.complete { print("done") }   ✓
on hero.complete { }                  ✗ 'complete' only works on a timeline
on intro.click { }                    ✗ 'click' isn't a timeline event
```

It also never fires for a `scrollTimeline`-driven timeline - scroll
scrubbing back and forth across a timeline's end isn't a "completion" the
way a `play`/`reverse` run finishing once is.

## 16. Giving `material.map` a `.glb`/`.gltf` path, or trying to animate it

`material.map` is a **texture** (an image file: `.jpg`/`.jpeg`/`.png`/
`.webp`/`.gif`), not a model - `model.src` is the one that takes `.glb`/
`.gltf`. Using the wrong extension for either is a clear build-time error
naming the file it actually needs.

```ax
cube crate { material.map: "./wood.jpg" }   ✓
cube crate { material.map: "./wood.glb" }   ✗ must point at a '.jpg'/... file
```

`material.map` is `on`-handler-mutable and `state`-bindable (a live texture
swap is a real operation), but it is **not** an `animate`/`timeline`
target - a texture doesn't interpolate, so `animate box { material.map ->
"..." }` is a clear build-time error, not a silent no-op.

## 17. Trying to animate scene fog, or putting `background`/`fogColor` on the wrong object

Scene backdrop/fog live on their own singleton block, `environment { ... }`
- not on `camera`, not as a top-level scene property, and not per-object:

```ax
scene main {
    environment { background: "#1a1a2e" fogColor: "#888888" } ✓
    camera { background: "#1a1a2e" }                          ✗ 'camera' doesn't have a 'background' property
}
```

`background` is `animate`/`timeline`-targetable and `state`-bindable, same
as a shape's `color`. Fog (`fogColor`/`fogNear`/`fogFar`) is **not** -
build-time only for now, so `animate environment { fogColor -> ... }` is a
clear error, and a `state`-bound `fogColor` is silently never re-applied
(it isn't even stashed as a binding) - a real, current limitation.

## 18. Putting `loop` inside the `animate` block instead of the timeline itself

`loop: true` is a property of the **timeline**, declared at its own top
level alongside its steps - not a property of one `animate` step (that's
still `duration`/`delay`/`repeat`/`easing`/`at`, unchanged):

```ax
timeline spin {
    loop: true                                    ✓ timeline-level
    animate box { rotation.y -> 360deg duration: 2s }
}

timeline spin {
    animate box { rotation.y -> 360deg duration: 2s loop: true }  ✗ unknown animate property 'loop'
}
```

A looping timeline never fires `on NAME.complete` - a lap wrapping around
isn't a completion the way a `play`/`reverse` run actually finishing is.

## 19. Assuming a page handler can't control a viewport's own timeline

`play`/`pause`/`resume`/`reverse` accept a dotted `"viewportName.timelineName"`
target from a *page*-level `on` handler, reaching directly into that
`viewport`'s embedded scene - not just via `animate ("stage.centerpiece")`
inside a page `timeline` step, and not just indirectly through
`scrollTimeline`:

```ax
on replay.click { play ("stage.intro") }
```

This is resolved live in the browser, like every other
play/pause/resume/reverse target - a typo'd viewport or timeline name is a
runtime error, not silently ignored.

## 20. Giving a `directionalLight` a `position`

A real three.js `DirectionalLight` object has a `.position` (its direction
is derived from `position` minus `target.position`) - this leaks into AXIS
generation from three.js familiarity alone, reproduced while writing an
otherwise-ordinary hero scene:

❌ Wrong:
```ax
directionalLight sun {
    position: (3, 4, 2)
    direction: (-1, -1, -1)
    intensity: 0.8
}
```
```
'directionalLight' doesn't have a 'position' property
```
✓ Correct - AXIS's `directionalLight` only ever takes `direction` (a plain
vector, not derived from two positions) - drop `position` entirely:
```ax
directionalLight sun {
    direction: (-1, -1, -1)
    intensity: 0.8
}
```
`pointLight`/`spotLight` are the ones that take `position` (they radiate
from a point, not along a fixed direction) - `spotLight` also takes
`target`, closer to three.js's own shape there.

## 21. Referencing a loop-body `let` alias inside an `on`/`animate` handler or a scene's own reactive property binding

Reproduced while building `benchmarks/task-03-data` (see that task's
`results.md` for the full account) - `axis check` reports **no
diagnostics** for this, and it looks completely idiomatic (it's the exact
style `examples/planets.ax`/`examples/configurator.ax` already use for
object declarations), but it silently fails at runtime:

❌ Wrong - aliasing a loop item into `let`, then using that alias (not the
loop's own iteration variable) inside a handler body, or inside a scene
object's own reactive property binding:
```ax
state selected = ""
let items = [{ name: "a", color: "#c1440e" }, { name: "b", color: "#4a90e2" }]

scene main {
    camera { position: (0, 2, 8) }
    for i in range(0, len(items)) {
        let p = items[i]
        cube (p.name) {
            color: selected == p.name ? "#ffffff" : p.color
        }
        on (p.name).click {
            selected = p.name
        }
    }
}
```
This compiles clean (`axis check` -> `valid: true`) and even runs without
crashing - clicking the cube throws `[axis] error in 'on a.click':
undefined variable 'p' - did you mean 'a'?` in the browser console (the
suggestion is a red herring - the real fix is below, not renaming `p` to
`a`), and the color binding just silently never updates (the error inside
it is swallowed rather than thrown, so nothing *looks* wrong short of
actually watching the color).
The loop's own iteration variable (`i` here) is captured into both a
handler body and a reactive property binding correctly when the loop
itself finishes running - a `let` derived from it is not.

✓ Correct - reference the shared array via the loop's own captured
variable (`items[i]`), not the alias, anywhere the value needs to survive
past the loop (an `on`/`animate` handler body, or a scene object's own
reactive property binding). `let p = items[i]` is still fine for the
object *declaration* itself (its properties are evaluated once, live,
while the loop is actually running - only code that runs *later* hits
this):
```ax
state selected = ""
let items = [{ name: "a", color: "#c1440e" }, { name: "b", color: "#4a90e2" }]

scene main {
    camera { position: (0, 2, 8) }
    for i in range(0, len(items)) {
        let p = items[i]
        cube (p.name) {
            color: selected == items[i].name ? "#ffffff" : items[i].color
        }
        on (p.name).click {
            selected = items[i].name
        }
    }
}
```
A page's own reactive `for` (a `container`'s children, say) does **not**
have this problem - it fully re-runs the loop body from source on every
state change (so `let p` is genuinely redeclared each time), unlike a
scene's flat, stored-binding recheck. If you're not sure which applies,
the workaround above (re-index via `i`) is safe everywhere.
