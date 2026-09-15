# The flagship site: Nimbus Studio

`examples/nimbus-studio.ax` - a single-page studio/portfolio site, built
using nothing but what AXIS already had plus everything this milestone
added, no hidden JavaScript. This is the "banger website test" the
project's own brief required, and the audit trail for what building a
genuinely real site actually needed, per Phase 9/10.

## What it exercises

- **Sticky nav** (`position: "sticky"`, already existing).
- **A cinematic hero**: a real `.glb` model (`examples/assets/character.glb`,
  its `"Wave"` clip auto-playing) inside a `viewport`, plus a load-time
  camera dolly-in `timeline`.
- **`responsive:`** (this milestone) on the hero (row -> column on mobile,
  the model viewport shrinking rather than disappearing), the feature-card
  row, the project grid, and the footer.
- **A `component`-built feature row** (`FeatureCard`, three instances) and
  a reusable `NavLink`, both pre-existing capability, proving composition
  scales to a real page without a giant flat file.
- **Sticky scrollytelling**: a tall wrapper driving a pinned `viewport`'s
  own scene timeline (camera + object rotation) as the page scrolls -
  the exact pattern [sticky-scroll-timeline.md](sticky-scroll-timeline.md)
  already built.
- **Reactive structure** (this milestone): a filterable, add/archive
  project grid (`for p in visibleProjects(projects, activeFilter)`) - the
  entire reason reactive structure was worth building. Filtering,
  archiving a specific card (removal from the *middle* of the list, not
  just the tail), and adding a new one all reconcile correctly, live.
- **A nested reactive `if`** for a single-open FAQ accordion, directly
  inside a reactive `for` - the exact pattern that surfaced and led to
  fixing the loop-variable-capture gap and the nested-registration bug,
  below.
- **`scrollRoot`** (this milestone): a scrollable testimonial panel whose
  own scroll position drives a live "reading: N%" readout, independent of
  the page's own scroll.
- **Reduced motion / responsive**: verified live (see Verification).

## What building it actually found (Phase 10 triage)

Two of these were real bugs, found and fixed *during* this build, not
theoretical - exactly what dogfooding is for:

### Must-fix (found and fixed in this session)

1. **An `on` handler declared inside a `for` loop couldn't read that
   loop's own variable at all.** The FAQ toggle and the per-project
   "Archive" button both need this (`on ("remove" + p.id).click { ... p.id
   ... }`) - without it, reactive lists have no way to act on *which* item
   was clicked. Fixed via `captureLoopVariables`
   (interpreter.js) - see [reactive-structure.md](reactive-structure.md).
2. **A reactive `if` nested inside a reactive `for` (the FAQ accordion)
   was independently, and incorrectly, registered as its own top-level
   reactive block** - it referenced the *outer* loop's variable
   (`faqOpen == f.id`), which doesn't exist once registered on its own,
   so every rebuild of that inner block threw. Fixed by suppressing
   registration while already inside an enclosing loop's own iteration -
   see reactive-structure.md's updated design note. Caught immediately by
   this build (a console error on every click) rather than shipping silent.

### Useful additions (real friction, not urgent - not built this milestone)

3. **No ternary/conditional expression.** Coloring the active filter
   button needed a small named function (`filterButtonColor`) instead of
   an inline `activeFilter == "all" ? "#4a90e2" : "#1c1c28"`. Works fine,
   reads fine, but is real friction an AI or a human would hit constantly -
   probably the single highest-value small addition AXIS could make next.
4. **A page-level handler can't `play`/`pause`/`reverse` a viewport's
   *embedded scene's own* timeline by name** - only `scrollTimeline`
   (scroll-driven) crosses that boundary. A "replay the cinematic" button
   next to a 3D viewport is a natural, common pattern this can't express
   directly today; the workaround (drive it through `scrollProgress`/
   `state` instead) is real but indirect.
5. **No model/viewport "loaded" signal.** There's no `on viewport.ready`/
   `on model.load` to hook a loading spinner or placeholder to - the box
   is correctly sized from the start (no layout jump) but has no
   affordance while the `.glb` fetches. Not blocking for this site (the
   fixture loads near-instantly), but a real gap for a heavier model on a
   slow connection.
6. **`responsive` can't touch `visible`** (documented already in
   [responsive-layout.md](responsive-layout.md)) - this build worked
   around it by shrinking the hero viewport on mobile rather than hiding
   it outright. A real, if secondary, mobile-performance lever (skip
   loading a 3D scene's assets entirely below some breakpoint) that's
   currently unavailable.
7. **Array literals require commas between items; record literals don't.**
   `[ {...} {...} ]` is a syntax error (needs `[ {...}, {...} ]`), an
   inconsistency this build's own `projects`/`faqs` data hit immediately.
   Small, but the kind of surprise both a human and an AI generating AXIS
   would trip on.

### Confirmed application-specific / non-issues (validates earlier scoping)

- **CSS Grid** was never missed - flexbox plus `responsive` handled every
  layout this site needed (row/column feature cards, the project grid,
  the footer), matching the Phase 0 audit's call not to add it
  speculatively.
- **Routing** was never missed - a single scrollable page was the right
  shape for this kind of site, matching the Phase 0 audit's call.
- **List reordering** (a documented reactive-structure boundary) was
  never needed here either - only add/remove, never re-sorting an
  already-rendered list in place.

None of the "useful addition" items were promoted to this milestone's
scope - per Rule 7 (no premature abstraction) and Rule 5 (keep the
language small), a single flagship build finding them once is a reason to
write them down for a future milestone, not a mandate to build them now.

## Verification

`node bin/axis.js check`/`build` both pass with zero warnings.
Browser-verified with the same from-scratch DOM shim used throughout this
session's other architecture docs (no jsdom dependency), driven against
the real, unmodified `domClient.js` served by a live `axis run` instance -
covering, in one continuous session against the actual page: initial load
(all four projects visible, the "All" filter correctly highlighted),
switching to the "Design" filter (exactly the two design projects remain,
"Design" now highlighted instead), archiving "Aurora" specifically (removed
from the *middle* of the underlying array, the rest correctly patched, not
rebuilt), returning to "All" (three projects, confirming the archive
persisted across a filter change), adding a new project (a fully live,
freshly-created card appears), the FAQ accordion (opening one closes
whichever other was open - single-open behavior, driven entirely by the
fixed nested-reactive-block bug above), and the nested-scroll testimonial
panel (scrolling the panel *itself*, not the page, correctly advances its
own readout). Zero console errors across the entire run. The two `viewport`
elements (which need a real WebGL context this shim doesn't provide) were
excluded from this specific pass only - both reuse the exact
`scene3d.js`/`viewport` mount path already exercised standalone by
`examples/model.ax`/`examples/skeletal-animation.ax`/`examples/
sticky-scroll.ax`, unmodified by anything in this milestone except the
`responsive`/reduced-motion extensions, each independently verified in
their own architecture docs.
