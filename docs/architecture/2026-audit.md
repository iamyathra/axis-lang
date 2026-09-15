# AXIS architectural audit — 2026-09

*(Historical - findings below predate v3.5-3.8 and the 2026-09-12
general-purpose-language pivot. Still accurate on the pipeline shape and
the fixes this audit recommended (reactive structure, tween unification)
all landed. For the current architecture question - is AXIS extensible
enough to become a real platform - see
[2026-09-language-platform-audit.md](2026-09-language-platform-audit.md).)*

Full read of the pipeline: lexer → parser → evaluator/globals → interpreter →
renderer/plan.js + renderer/domPlan.js → renderer/client.js + domClient.js +
scene3d.js, plus modules.js, the server layer, and every doc/example. This is
the Phase 0/1 deliverable from the "take AXIS to 100/100" milestone — a
report first, before any code changes.

## The one fact everything else follows from

**AXIS has reactive *values*, not reactive *structure*.**

The entire scene/page graph — every object `if`/`for` produces, every
component expansion, every nesting decision — is built exactly once, in
Node, by `interpreter.js`, at `axis run`/`axis build` time. What ships to the
browser is a frozen, already-shaped tree (`renderer/plan.js` /
`renderer/domPlan.js`'s output, JSON-serialized into
`window.__AXIS_PAGE_PLAN__`) plus a table of `bindings`: property
expressions that get *re-evaluated* after a handler runs and patched onto
the existing DOM/three.js nodes if they changed value
(`domClient.js#reRender`, `scene3d.js#reRender`).

That's a deliberate, well-executed design — full re-check instead of
dependency tracking is explicitly documented as an honest tradeoff, and it's
genuinely elegant that a "reactive" page element and a plain one use the
same mechanism. But it has a hard ceiling: **an `if`/`for` never re-runs**.
Once the page loads, the set of DOM elements or 3D objects that exist is
fixed forever. A `state` array can't add or remove list items; a boolean
`state` can't show/hide an arbitrary section (only `viewport.visible` has a
bespoke escape hatch for exactly one element type); a component instantiated
in a loop can't add/remove instances.

This single fact is *why* "conditional rendering," "repeated structures,"
and "keyed reconciliation" (Phase 1's DOM checklist) are all still marked
missing in the README, and why a component's params are "resolved once, at
the point of use" rather than reactive — they're not three separate gaps,
they're one gap in three places. Fixing it properly (see the recommendation
below) fixes all three at once, which is the coherent, non-duplicative path
Rule 3 asks for.

**The good news:** the fix is smaller than it sounds, because
`interpreter.js` is already environment-agnostic — it imports only
`evaluator.js`, `globals.js`, `suggest.js`, `assetPath.js`, none of which
touch Node or the DOM. `SceneBuilder`/`PageBuilder` could run in the browser
exactly as they run in the CLI. The natural design is: ship a small, marked
subset of the AST (the body of a reactive `if`/`for` block) to the browser,
and when a `state` it reads changes, re-run *that block's own*
interpretation against the live env, producing a fresh list of objects keyed
by name (AXIS already requires unique names in scope, so keys are free),
diff against what's currently mounted, and add/remove only the delta. This
is "compose existing primitives" (Rule 2) rather than inventing a virtual
DOM: it's the exact same `interpretObjectDecl`/`dispatchSceneStatement`
machinery, just invoked again, later, against a smaller input.

## Architecture, domain by domain

### Language core (lexer/parser/evaluator/globals) — solid, no changes needed

Clean, small, well-tested. `Environment` is a simple parent-chained map;
records/vectors are tagged plain objects, not classes, which keeps
JSON-round-tripping (Node → browser) trivial — this is why a scene's
`variables` can just be handed to the browser as-is. No structural issues
found here. The one real rough edge: `Environment.get`/`.set` do a linear
walk up the parent chain per lookup, with no caching — irrelevant at
today's scale (a handler body has a handful of variables), worth knowing if
a `for` loop inside a hot per-frame path ever got added (it hasn't).

### Interpreter — the component/module system already solves "composition"

Phase 2's "component/composition model" question is largely already
answered well: `component` (transparent expansion, per-instance namespacing
via a prefix + rename map) plus `import`/`export` (transitive, deduped,
circular-import-checked) together give large sites a real way to split into
files and reusable chunks without inventing a second templating language.
This shouldn't be redesigned — it should be finished (make params reactive,
see above) and documented better as *the* answer to "how do I avoid one
giant .ax file," since the README doesn't currently frame it that way.

One inconsistency worth naming: `DeclarativeBuilder` is a genuinely shared
base class for scene/page (good — Rule 3's "one lifecycle model" is
respected), but `SceneBuilder.applyProperty` and `PageBuilder.applyProperty`
independently reimplement the same "validate key against an allow-list,
evaluate, type-check, stash a binding" shape with no shared helper beyond
`isLiteralExpr`. Not urgent, but a `validateAndApplyProperty(target, prop,
env, rules)` helper would remove ~40 lines of parallel structure between the
two and make it harder for the two domains to drift on how a binding gets
stashed.

### Render-plan layer (plan.js/domPlan.js) — appropriately boring

This is exactly what a seam layer should look like: pure data in, pure data
out, unit-testable without a browser. `buildChange`/`buildDomChange` are
correctly shared/mirrored between the two files. No issues.

### Browser runtime (domClient.js / scene3d.js / client.js) — duplicated tween scheduling

The single biggest "duplicated mechanism" in the codebase: `domClient.js`'s
`tick()`/`applyDomChange`/`applyPageTimelineAtElapsed` and `scene3d.js`'s
`tick()`/`applyChange`/`applyTimelineAtElapsed` independently implement the
*identical* cycle/repeat/delay/easing math (`cyclesElapsed`, `isLastCycle`,
`rawT`, easing lookup) — copy-pasted, not shared. Rule 3 asks for "one
conceptual timeline architecture," and conceptually there is one (both files
agree on what `duration`/`delay`/`repeat`/`easing`/`at` mean, both get that
from the same `evaluator.js#parseAnimateTiming`), but the *runtime stepping
code* is two implementations that could silently drift (e.g., a future
easing-curve bug fix applied to one and forgotten in the other — it already
nearly happened once, per plan.js's own comment about a rotation-unit bug
that was live for a while). Recommend extracting a tiny shared
`renderer/tween.js`: `stepAnimation(anim, now)` and
`applyTimelineAtElapsed(rt, elapsed, applyOneChange)`, parameterized by an
`applyOneChange(target, change, t)` callback, used by both domClient.js and
scene3d.js. This is pure refactor — no behavior change, closes a real
"two files to remember to fix" risk, and is small (well under a day).

Aside from that, this layer is unusually careful: the viewport
mount/unmount race handling (`pendingMount`/`pendingUnmount`), the
render-on-demand `dirty`/`invalidate()`/`onInvalidate` wiring, and the
disposal path (`disposeSceneResources` walking geometries/materials/textures,
`AbortController` for event listeners) are all genuinely production-grade —
better than most hand-rolled three.js integrations. No leaks or races found
in this layer beyond what's already documented as a known limitation (a
missed click during a viewport's async mount window).

### Server/build layer — fine, one real production concern

`axis build` embeds the *entire* interpreted program — every function body,
every handler body, every property-binding expression, as raw AST — into
one inline `<script>window.__AXIS_PAGE_PLAN__ = {...}</script>` JSON blob.
There's no code splitting and no minification. For a small page this is
irrelevant; for the flagship site (Phase 9) this is worth actually
measuring rather than assuming — see Phase 7 below. This is a known,
deliberate tradeoff of "ship the AST, interpret it everywhere" (which is
what makes "one evaluator, two places it runs" possible at all) and
shouldn't be "fixed" by turning AXIS into a compiler — that would be a much
bigger project than this milestone and isn't what AXIS is. Just measure and
document the ceiling.

## Concrete findings by category

**Missing primitives that block "exceptional websites" (Must fix — Phase 2):**
1. **No reactive structure** (`if`/`for` never re-run) — see above. This is
   the foundational fix; conditional rendering, reactive lists, and
   reactive component params all fall out of it.
2. **No responsive mechanism at all.** `width`/`height` accept CSS strings
   (`"50vw"`) so a single fluid layout is possible, but there is no way to
   express "different layout under 768px" — no media-query primitive, no
   way to read viewport width into a `state`, nothing. This is a hard
   requirement for "not desktop-only demos" (Phase 2.2) and currently a
   flat zero.
3. **Only the document scroll source.** A scrollable sub-container
   (`overflow: auto`) isn't a valid `scrollTimeline`/`scrollProgress`
   source — already #1 on the project's own roadmap.

**Security (Must fix):**
4. `href`/`src` are HTML-*attribute*-escaped (`escapeAttr`,
   `applyElementProperty`'s `href`/`src` cases) but never scheme-validated.
   A `link.href` or `image.src` built from a reactive `state` that
   ultimately traces to user input (an `input.value` via `on
   input.change`) can carry a `javascript:` URL straight into the DOM. Low
   likelihood given AXIS's current use cases, but a real, cheap-to-close
   gap for a language whose whole pitch is "safe by default." Fix: reject
   (or neutralize) non-http(s)/mailto/tel/relative schemes in both
   `domHtml.js` (SSR) and `domClient.js` (live writes).

**Accessibility (Should fix — Phase 6):**
5. `<html>` has no `lang` attribute (`domHtml.js`) — trivial, real fix.
6. `prefers-reduced-motion` is only honored for *scroll-linked* timelines.
   A load-time `animate`/`timeline` with `repeat: infinite` (a spinning
   decorative element, say) still runs unconditionally. AXIS should read
   the media query once, globally, and skip/settle non-scroll animation
   too when it's set — same mechanism already built, just not applied
   everywhere motion exists.

**Animation (Should fix — Phase 3, per the project's own roadmap):**
7. No pause/resume/reverse/speed/seek/completion-callback on a `play`-driven
   timeline or a model's clip playback — `play` only ever restarts from 0.
8. Camera isn't `state`-bindable (position only, via `animate`/`on`) —
   inconsistent with every other spatial object.

**Useful additions (B-tier — small, general value):**
9. Generalize `visible: expr` from `viewport`-only to any element. Much
   cheaper than the viewport case (no GPU teardown, just a display toggle)
   and is a natural, tiny extension once reactive structure (item 1) exists
   for the general case — but a plain display-toggle version doesn't even
   need that, and is worth shipping on its own first as a quick win.
10. A minimal per-page `meta` (description, at least) for SEO — currently
    only `<title>` is settable.
11. Deliberately *not* recommending: crossfade between animation clips,
    DOM↔3D coordinate projection (an HTML label tracking a 3D object's
    screen position), CSS Grid as a second layout mode. All three are real
    and would each show up eventually, but none blocks the flagship-site
    test, and Rule 5/7 argue for waiting for a demonstrated need rather
    than speculating now. Grid in particular: `position: absolute` +
    flexbox already covers what the flagship site needs; add it only if
    the flagship build actually hurts without it.

**Explicitly out of scope for this milestone (C-tier / by design):**
12. Multi-page routing. AXIS's own identity here is closer to
    "scrollytelling single page" than "multi-route app" — the flagship
    site brief asks for sections, not routes. Staying out avoids turning
    AXIS into a router-and-framework project it was never meant to be
    (Rule 4/5). Worth a documented limitation, not a gap to close now.
13. A general virtual-DOM diffing framework, physics, particles, audio,
    multiplayer — all named in VISION.md as aspirational "eventually," none
    demonstrated as needed by anything in this milestone's brief.

## Recommendation

Prioritize, in this order, because each later item either depends on or is
far cheaper after the one before it:

1. **Reactive structure for `if`/`for`** (client-side re-interpretation of a
   reactive block, keyed by name, diffed against the DOM/scene) — the one
   foundational fix that unlocks conditional rendering, reactive lists, and
   reactive component params simultaneously.
2. **Responsive layout primitive** — the smallest coherent mechanism is a
   built-in reactive `state`-like value for viewport width/breakpoint (so
   existing reactive bindings/`if` already do the rest) rather than new CSS
   syntax — decide the exact shape before writing code (see plan).
3. **Nested scroll containers** — extend `scrollProgressFor` to measure
   against a declared scrollable ancestor instead of only the document.
4. **`href`/`src` scheme validation** (security) and **`lang` attribute /
   universal reduced-motion** (accessibility) — small, mechanical, do
   alongside the above.
5. **Shared tween-scheduling extraction** (domClient.js/scene3d.js
   dedup) — pure refactor, do once the above land so it isn't fighting
   in-flight changes.
6. **Timeline playback controls** (pause/resume/reverse) — per the
   project's own roadmap, valuable for the flagship site's replay-on-demand
   moments.
7. **Generalized `visible`** on any element (quick, independent win).
8. Build the flagship site, then revisit this list against what it
   actually needed (Phase 10).
