# Routing: a real, multi-page AXIS program

Status: **implemented**, with explicit boundaries below. Reverses a prior,
deliberate decision (2026-audit.md: "AXIS is closer to scrollytelling
single-page than a router framework") - a program that declares `route`s
now genuinely is a multi-page site, at the language level, not something
bolted on with a third-party router.

## The one fact everything else follows from

**A `route` maps a URL pattern to an already-declared `page`, by name -
routing doesn't introduce a second way to describe a page.** `page Home {
... }` is exactly the same construct it always was; `route "/" Home` is a
new, separate top-level declaration that says "when the URL is `/`, this is
the page to mount." A file can declare pages routes never reach (dead code,
warned about the same way an un-embedded `scene` already is) and, before
this feature, a file with more than one `page` just rendered the first one
and warned about the rest - `route` is what turns "more than one page" from
a warning into the actual, intended shape of a real site.

## Architecture: reusing the existing page runtime, not a second one

The brief for this work was explicit: don't build a second rendering
architecture. Concretely, almost nothing new was built - existing pieces
were made to do one more job each:

- **`createPageRuntime`** (pageRuntime.js) - completely unchanged in what it
  *is*: one page's live DOM, wired up, with a `{update, on, off, destroy,
  getSharedState}` lifecycle contract. Routing calls it exactly the way
  `mount()`/the standalone bootstrap already did - once per page, `render:
  false` to hydrate server-rendered markup, `render: true` to build fresh
  DOM client-side. Its own `destroy()` (already correct - viewport
  disposal, scroll-listener `AbortController`, DOM cleanup) is 100% of a
  route's own teardown; navigating away from a page **is** calling
  `destroy()` and building a new instance, nothing more.
- **`interpreter.js`** - unchanged for its core job (building a page's
  static graph). The one small addition: when a file has any `route`,
  `params`/`query` are seeded as two more entries in the same
  `sharedVariables` mechanism a `state`/`let` already uses to cross
  page/scene boundaries (docs/architecture/reactive-state.md) - see
  "params/query" below for exactly what that does and doesn't cover.
- **`domPlan.js`** - `buildSinglePagePlan` is the *existing*
  `buildDomPlan` logic, factored out so it can run once per routed page
  instead of always for "the first page in the file." `buildDomRouterPlan`
  is the new multi-page wrapper: builds only the pages something actually
  routes to (same "don't pay for what isn't reachable" rule an un-embedded
  `scene` already gets), hoists `functions`/`sharedVariables` to the
  router plan's own top level (identical for every page in one program, so
  duplicating them per page would be pure waste), and `resolvedPagePlan`
  re-merges them back onto one page's plan for whoever needs a
  complete, self-contained page (domServer.js server-rendering a request,
  domRouter.js mounting one client-side).
- **`domServer.js`** - `startDomRouterServer` is a real dev server that
  matches the *request's own* URL against the route table, per request,
  and server-renders whichever page matched - correctly, including a
  dynamic route (`/projects/:id`), since there's a live server to match
  against. `writeDomRouterStaticSite` is its static-build sibling: every
  *static* route pattern gets its own pre-rendered `index.html`
  (`/about` -> `about/index.html`); a `"*"` catch-all, if declared,
  additionally becomes `404.html` (the filename most static hosts already
  look for automatically).
- **`domHtml.js`** - `renderRouterPageHtml` is `renderPageHtml`'s routed
  sibling, sharing the same document-shell template (`renderHtmlDocument`).
  It embeds the *whole* router plan (`window.__AXIS_ROUTER_PLAN__`), not
  just the one page that got server-rendered, plus which route actually
  matched (`window.__AXIS_INITIAL_ROUTE__`) - the same "ship the AST,
  interpret it everywhere" tradeoff the rest of AXIS already makes (see
  2026-audit.md), so the client can navigate to every other page with zero
  further server round-trips. Its ceiling: this doesn't scale indefinitely
  for a site with hundreds of pages (every page's full AST ships to every
  visitor) - fine for a marketing/portfolio-sized site, worth measuring
  before assuming it's fine for something much larger. Not addressed here;
  flagged the same honest way the single-page build's own lack of code
  splitting already is.
- **`router.js`** (new) - the one genuinely new piece of logic: pure route
  matching (`matchRoute`, `parseQuery`, `isStaticPattern`), no Node or DOM
  APIs, shared by the dev server (matching a request) and the browser
  (matching a client-side navigation) - the same "one implementation, two
  places it runs" shape evaluator.js/globals.js/plan.js already use.
- **`domRouter.js`** (new) - the client-side orchestrator: matches
  `location.pathname`, mounts the right page via `createPageRuntime`,
  handles `navigate()`/link clicks/back-forward by destroying the old
  instance and creating a new one. `domClient.js` only reaches for this
  (a dynamic `import()`) when `window.__AXIS_ROUTER_PLAN__` exists - a
  plain, non-routed page (still the common case, and every page written
  before this feature) is entirely unaffected and pays nothing for it.

## The language surface

```ax
route "/" Home
route "/about" About
route "/projects/:id" Project
route "*" NotFound
redirect "/old-projects" "/projects"
```

- **`route "pattern" PageName`** - `PageName` must be a `page` declared with
  a plain identifier title (`page Project { ... }`, not `page "My Site" {
  ... }` - there's no valid token to reference the latter with). A pattern
  segment starting with `:` (`:id`) captures that URL segment into `params`;
  `"*"` is the one special pattern, always tried last regardless of
  declaration order, for a catch-all/404 page. A route referencing an
  undeclared page, or the same pattern declared twice, is a build-time
  error with a "did you mean" suggestion where relevant.
- **`redirect "from" "to"`** - matched with the exact same pattern grammar
  as a route (including `:params`, though see "Known limitations" -
  they're not substituted into `to`), and checked *before* any route: a
  match means the browser (dev server: an HTTP 302; already-loaded client:
  `navigate(to, {replace: true})`) never renders a page for `from` at all.
- **`params`** - a record, one field per `:name` segment the *matched*
  route declared, always a string (`params.id`). Implicitly available on
  every page in a routed file - not something you declare yourself.
- **`query`** - a record built from the URL's query string
  (`?tag=a&tag=b` -> `{ tag: ["a", "b"] }`, a repeated key becomes an
  array; a single one stays a plain string). Its keys are never statically
  known (unlike `params`'s, which come from the route pattern itself), so
  reading a key directly (`query.q`) is a build-time "record doesn't have a
  field" error unless that exact key happens to be present - use the new
  `get(record, key, fallback)` stdlib function instead:
  `get(query, "q", "")`. This isn't routing-specific - `get` works on any
  record, including one that came back from `api.get(...)`.
- **`navigate(path)` / `navigate(path, { replace: true })`** - programmatic
  navigation, callable from anywhere a function call is legal (an `on`
  handler, after an `await`, ...). Calling it in a file with no `route`
  declarations, or from an embedded instance the host didn't wire a router
  into, is a clear `AxisRuntimeError`, not a silent no-op.
- **`link`** - unchanged syntax, but new behavior: a plain (unmodified,
  left-button, no `target="_blank"`) click on one whose `href` resolves to
  the *same origin* is intercepted (`navigate()`'d) instead of triggering a
  full page reload. Every other click - a modifier held, right-click,
  `target="_blank"`, a different origin, `mailto:`/`tel:`, ... - is
  completely normal browser behavior, untouched. It was, and still is, a
  real `<a href="...">` - never a `<div>` pretending to be one.

## params/query are reactive state, but a `let` derived from them isn't

`params`/`query` are seeded through the exact same `sharedVariables`/
`inputs` mechanism `state` and `mount()`'s own host-input seeding already
use - so a property expression that reads `params.id` or `query.tab`
*directly* re-evaluates correctly (both at server-render time, once the
request's real match is known, and, redundantly-but-harmlessly, again on
the client via the ordinary `reRender()` pass that already runs once right
after every `createPageRuntime()` call). What does **not** happen
automatically: a plain `let x = someFunctionOf(params.id)` is computed
*once*, like any other `let`, and is never re-run just because `params`
later differs - only an element's own property expressions, and an `if`/
`for`'s own condition/iterable, are tracked as reactive. Call
`someFunctionOf(params.id)` again wherever you need its result, rather than
caching it in a `let`, if that result should reflect the current route -
see `examples/routing/site.ax`'s `WorkDetail` page for the pattern (and its
own comment on exactly this).

## A reactive `if`/`for` needs a container to mount into

Not new to routing - true of `if`/`for` in general (reactive-structure.md)
- but worth repeating here because a route's own page is the single most
likely place to reach for a reactive `if` (params-dependent content is
*inherently* conditional). A reactive block sitting bare at a page's own
top level has no element to `appendChild` its generated content into
(the page itself isn't one); wrap it in an ordinary `container` first.
`examples/routing/site.ax`'s `WorkDetail` page does exactly this
(`container detail { if (...) { ... } else { ... } }`).

## A real bug this work found and fixed

Building the routing example (`WorkDetail`'s `if`/`else`, both branches
declaring `container body { heading title { ... } ... }` - the same names,
deliberately, so switching branches doesn't visually restart) surfaced a
real, pre-existing defect in `reRender()` (pageRuntime.js), unrelated to
routing itself: its property-binding re-check loop iterated the page's
static, build-time `plan.nodes` array rather than `nodesByName`'s *current*
values. `nodesByName` is exactly what a reactive-block rebuild
(`upsertReactiveNode`) keeps pointed at whichever branch's node currently
owns a given element name - iterating the wrong collection meant a
rebuild's correct new content got silently overwritten, one line later in
the same `reRender()` pass, by the *other* branch's stale, build-time
binding. Fixed by iterating `nodesByName.values()` instead - the two
collections start identical (`nodesByName` is seeded from `plan.nodes`), so
this is behavior-neutral for every page without reactive `if`/`for`
branches that reuse names this way (confirmed: all 529 tests unaffected).
Verified with real Chromium, both before (the bug) and after (fixed) - see
this doc's own git history/commit for the exact repro if it's ever useful
again.

## SSR / static output

- **Dev server (`axis run`)** does true per-request server-side rendering
  for *any* route, static or dynamic - it's a real server, matching a real
  request's path/query live. `curl localhost:PORT/projects/42?tab=info`
  gets back HTML with `params`/`query` already reflected? **No** - see the
  next point. What it *does* correctly reflect: which page the URL
  matched, and that page's own build-time content for anything that
  doesn't derive from `params`/`query`.
- **The raw, pre-JavaScript HTML does not reflect `params`/`query`.**
  `buildSinglePagePlan` computes each page's own static content once, at
  interpretation time (when the CLI starts, or `axis build` runs) - not
  per request. `params`/`query`-dependent content is corrected
  *client-side*, synchronously, via the exact same `reRender()` pass that
  already runs once, immediately, at the end of every `createPageRuntime()`
  call (this is not new to routing - it's the same mechanism that already
  makes `mount()`'s `inputs` override a build-time default correctly).
  In practice this means: a real user, and any crawler that executes
  JavaScript (Googlebot and most modern crawlers do), sees correct content
  effectively immediately, before any interaction; a tool that fetches raw
  HTML and never runs JS sees the page's build-time placeholder for
  anything `params`/`query`-derived. This is a real, deliberate boundary,
  not something faked as "full SSR" - true per-request re-evaluation of a
  page's own bindings (not just which page renders) would need real
  per-request re-interpretation, which is a substantially bigger change,
  left for a future pass if a real site's SEO needs actually demand it.
- **Static build (`axis build`)** pre-renders one `index.html` per *static*
  route pattern (no `:param`, not `*`) - `/about` -> `dist/about/index.html`.
  A dynamic route (`/projects/:id`) has no fixed URL to pre-render at all;
  it's handled entirely client-side once any page's JS has loaded (every
  page's plan, dynamic routes included, ships in each static page's own
  `window.__AXIS_ROUTER_PLAN__`). A `route "*" ..." page, if declared, is
  additionally written to `dist/404.html`.
- **Server fallback.** A static host serving these files as plain files
  needs to be told what to do with a URL that has no matching file at all
  (a fresh request to `/projects/42`, never having been pre-rendered) -
  AXIS can't configure an arbitrary host's own routing from here. The
  common, standard answer: configure the host to serve `index.html` (or
  rely on its own automatic `404.html` handling, which most static hosts
  already do) for any unmatched path, so the client-side router takes over
  - Netlify's `_redirects` (`/* /index.html 200`), Vercel's `rewrites`,
  nginx's `try_files $uri /index.html`, GitHub Pages' automatic
  `404.html` fallback. None of this is AXIS-specific; it's the same
  requirement every client-side-routed SPA has.

## Scroll behavior

A deliberately simple default, not per-URL scroll memory: every SPA-driven
navigation (a `navigate()` call, a link click, back/forward) resets scroll
to the top. The one exception is the very first page load, where the
browser's own natural behavior (respecting a `#fragment`, restoring
mid-reload scroll position, ...) is left alone entirely.
`history.scrollRestoration` is set to `"manual"` once, at bootstrap, so the
browser's own automatic restoration doesn't fight this.

## Document title

A page's own `title` (`page About { ... }`'s name/title) is what becomes
`document.title` on navigation - the exact same field a page's title has
always been, no new `title:` property inside a page's body. A page
declared as `page "About - My Studio" { ... }` (a string title) gets that
full string as its `<title>`; one declared as `page About { ... }` (needed
to be `route`-referenceable at all) gets the bare name. If a nicer,
distinct document title matters, use a string-titled page for the
non-routed case, or route through a distinctly-named page - a real,
current limitation (routing needs an identifier title; a nicer document
title wants a full sentence) worth revisiting together if it matters for a
real site.

## Lifecycle: what survives navigation, what doesn't

- **Route-local state is destroyed.** Every navigation - even to the "same"
  page under a different route pattern - fully `destroy()`s the outgoing
  page instance and creates a fresh one. A page's own `state`/`let`, DOM,
  event listeners, and any embedded viewport's three.js resources are all
  torn down and rebuilt from scratch. Simpler and more predictable than
  trying to diff "is this really the same page" - and correct: a route's
  own params/query genuinely did just change, so its content should too.
- **App/global state survives.** Every *other* shared `state`/`let` (a
  logged-in user, a theme toggle, a shopping cart - anything not `params`/
  `query`) is captured (`instance.getSharedState()`) right before the
  outgoing instance is destroyed, and handed to the next page as `inputs` -
  the same mechanism `mount()`'s host-supplied inputs already use. A value
  a handler mutated on one page is still there on the next one.
- **An async request in flight when its page is left is not cancelled.**
  If an `on` handler's `await api.get(...)` resolves after `destroy()` has
  already run, its subsequent `state = ...` assignment still executes
  (nothing currently stops it) but has no visible effect - the destroyed
  instance's own DOM/env are gone, and nothing re-renders from them. Not a
  crash, but not automatically cancelled either - a real, current
  limitation; an AbortController-based cancellation hook is the natural
  next step if a real app needs to react to this (e.g. to avoid the wasted
  network request continuing at all).

## HTML embedding and React (`mount()`/`axis-react`)

Unaffected, and deliberately so: `mount()` never wires a `navigate`
callback into `createPageRuntime` on its own, so an embedded instance's
`navigate(...)` calls (if its source has `route`s at all - unusual for an
embedded fragment, but not forbidden) throw the same clear error a
non-routed page's would. **AXIS never owns the host page's URL/history
unless the host explicitly opts in** - routing was never meant to "hijack"
an embedding host's own router (Rule: a mounted AXIS instance must not
unexpectedly take over navigation). A host that *does* want an embedded
AXIS instance to drive routing can pass its own `navigate: (path, opts) =>
hostRouter.push(path)` through `mount()`'s options today (the option
already exists at the `createPageRuntime` layer `mount()` calls into) -
`mount()` itself doesn't yet expose this as a documented, first-class
option; a small, real gap worth closing if an embedder actually needs it.

## Multiple AXIS instances on one page

Each `createPageRuntime` instance (routed or not) is fully self-contained -
its own `scriptEnv`, its own `elementsByName`/`nodesByName`, its own
listeners. Two independent embedded instances (routed or not) on one host
page don't share any of that. What *is* shared, necessarily, if two
*routed* AXIS instances were both mounted on the same host page: the real
browser `window.history`/`popstate` - two independent `domRouter.js`
orchestrators would both react to every `popstate` event and both try to
own `window.location`. This was never a supported configuration
(`domRouter.js` is the standalone/embedded-as-the-whole-page bootstrap, not
designed for two of itself at once) - a documented limitation, not
something silently broken by this feature. A single AXIS instance
embedded via `mount()` inside a *host* application that has its own router
is the supported multi-router shape (see "HTML embedding," above); two
independent *AXIS* routers on one page is not.

## Accessibility

Every navigational element is, and remains, a real `<a href="...">` -
never a clickable `<div>`. Keyboard navigation (Tab to a link, Enter to
activate it), right-click ("open in new tab"), and screen-reader link
semantics are all standard browser/anchor behavior, unaffected by the SPA
click interception (which only ever intercepts a plain, unmodified left
click). **Focus is not currently moved on navigation** - after an SPA
transition, focus stays wherever it was (often the link that was just
clicked, which is a reasonable default, but not a deliberate one) rather
than being moved to the new page's main heading - a real, common SPA
accessibility gap, not yet addressed here.

## Not built (deliberately, this pass)

- **Route transitions** (an exit animation before navigation, an enter
  animation after) - no hook exists yet for "run this before the old page
  is destroyed." The existing `animate`/`timeline` engine could
  theoretically drive one; wiring it to a navigation lifecycle event is a
  clean, still-open extension point, not attempted here.
- **Nested routes / layouts** (`/dashboard`, `/dashboard/projects` sharing
  a persistent shell that doesn't remount) - a route maps to exactly one
  whole page today; there's no "parent route renders a layout, child route
  renders inside it" concept. The `Nav`/`Footer` components in
  `examples/routing/site.ax` show the *composition* alternative (every
  page just includes them) - real reuse, just not a persistent-across-
  navigation DOM subtree.
- **Redirect param substitution** - `redirect "/p/:id" "/x"` matches, but
  `to` is used exactly as written; a captured `:id` isn't available to
  substitute into it. Static-to-static redirects (the common case) are
  unaffected.
