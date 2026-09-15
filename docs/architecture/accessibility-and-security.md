# Small, always-on fixes: URL safety and reduced motion

Status: **implemented.** Three narrow, mechanical items from the same
audit pass, batched together because none needed new language surface:

## `href`/`src` scheme validation (security)

`link.href`/`image.src` were HTML-*attribute*-escaped (so no markup could
break out of the attribute) but never scheme-checked - a value that traced
back to user input (an `input.value` piped through `state` into a `href`,
say) could in principle carry a `javascript:` URL straight into the DOM.
Low-likelihood given AXIS's current examples, but cheap to close and
consistent with the boundary `assetPath.js`'s `assetSrcError` already
draws for a `model`'s `src` (a relative-path allowlist, just for a
different kind of URL).

`src/urlSafety.js#isSafeUrl` is a small scheme allowlist
(`http:`/`https:`/`mailto:`/`tel:`, or no scheme at all - a relative path,
an anchor, plain text): shared, pure, no Node/browser-specific code.
`interpreter.js`'s `PageBuilder.applyProperty` rejects a bad *literal* (or
a reactive property's bad *initial* value) with a build-time error, same
line-number/clear-message standard as everything else here; `domClient.js`'s
`applyElementProperty` can't reject a live, handler-assigned or
reactively-bound value the same way (its real value isn't known until
runtime), so it sanitizes instead - substituting `"#"` and a single
`console.error`, the same "a bad expression shouldn't crash the whole
page" leniency the rest of this file's reactive bindings already have.

## `<html lang="en">`

Both HTML renderers (`domHtml.js` for a page, `html.js` for a standalone
scene) now declare a document language - a one-line, always-correct
default (AXIS has no i18n/locale concept to pick a different one from yet).

## `prefers-reduced-motion` for load-time animation, not just scroll

Previously, `prefers-reduced-motion: reduce` only affected a
*scroll-linked* `timeline` (see
[sticky-scroll-timeline.md](sticky-scroll-timeline.md)/[nested-scroll.md](nested-scroll.md)).
A load-time `animate` declared with `repeat: infinite` - a spinning or
pulsing decorative element, the common case for genuinely perpetual motion
- still ran unconditionally. Extended the exact same "skip the motion,
land on the settled state" treatment to it: `domClient.js` and
`scene3d.js` (shared by both a standalone scene page and a `viewport`-
embedded one) each read the media query once, and for any `animate` whose
`repeat` is `"infinite"`, apply every one of its changes once, at `t=1`,
instead of ever starting the tween.

Deliberately scoped to `repeat: infinite` only, not every `animate`: a
brief, one-shot transition (an entrance fade, a hover response) is
generally accepted even under reduced motion, and disabling those too
would make an AXIS page feel inert for a reduced-motion visitor rather
than calmer. `timeline`s aren't affected either way here - they have no
`repeat` of their own to loop on load (see docs/language.md's "not yet
supported" list); a *scroll-linked* one was already covered before this.

## Verification

`tests/security.test.js` and `tests/accessibility.test.js` cover the
build-time contracts (URL rejection with a clear message, the `lang`
attribute on both renderers) at the Node level. The reduced-motion
extension is pure runtime behavior with no Node-testable equivalent (same
reasoning as every other browser-only mechanism in this repo) - verified
with the same from-scratch DOM shim [reactive-structure.md](reactive-structure.md)
built: a page with one `repeat: infinite` `animate` and one plain one-shot
`animate`, hydrated once with a mocked `matchMedia` returning
`matches: true` and once returning `false`. With reduced motion on, the
infinite one lands immediately at its end transform (`rotate(360deg)`)
while the one-shot fade is left running normally (mid-fade, not frozen);
with it off, the infinite one is captured mid-tween instead, confirming
the toggle actually gates behavior rather than being inert either way.
