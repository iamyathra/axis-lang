// The framework-independent embedding API - the one new public entry point
// this milestone adds. `mount(target, source, options)` boots the exact
// same AXIS runtime a standalone `axis run`/`axis build` site uses
// (pageRuntime.js's `createPageRuntime` - see docs/architecture/
// embedding.md), just pointed at a host-supplied DOM element instead of the
// whole document, and fed a `.ax` file's raw source text instead of a
// server-rendered page.
//
// `lexer.js -> parser.js -> interpreter.js -> domPlan.js` is the exact same
// pipeline `axis run`/`axis build` (src/cli.js) already uses to build a
// page's render plan - none of those four files have ever had a Node- or
// browser-specific import (see interpreter.js's own module comment), so
// running that same pipeline here, in the browser, at mount() time, isn't a
// second implementation of "what does an .ax file mean," it's the same one,
// invoked later and closer to the host page than usual.
//
// `source` is raw text, not a URL/path: this file does no fetching and
// makes no assumption about how the host got the text (a `fetch()`, a
// bundler's raw-text import - Vite's `?raw`, webpack's `asset/source` - a
// Node `readFileSync` for a build step, ...) - see docs/architecture/
// embedding.md for why, and PHASE 6 of the milestone brief for the same
// reasoning applied to the React adapter (packages/axis-react).
import { run } from "./run.js";
import { buildDomPlan } from "./renderer/domPlan.js";
import { createPageRuntime } from "./renderer/pageRuntime.js";

let nextInstanceId = 0;

// A short, unique-enough-per-page class name for this instance's own CSS
// scope (see domHtml.js's renderPageFragment/buildResponsiveStyleBlock and
// docs/architecture/embedding.md's isolation strategy) - a running counter
// plus a few random base36 characters, not a full UUID: this only ever has
// to be unique among the instances actually mounted on one host page at
// once, not globally.
function scopeClassFor() {
  return `axis-${(nextInstanceId++).toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// Mounts one `.ax` file's single `page` into `target`, returning the same
// `{ update, on, off, destroy }` lifecycle handle `createPageRuntime`
// itself returns - `mount()` is a thin driver on top of it (parse/
// interpret/build, pick a scope class, delegate), not a second lifecycle
// model of its own. See docs/architecture/embedding.md.
//
// `target` must be a real, already-in-the-document Element the host
// already owns and controls - no selector strings (Rule 4: no global DOM
// assumptions; the host resolves its own `document.querySelector`) and no
// implicit fallback to `document.body`.
//
// `options`:
//   - `inputs` (object, optional): this component's host-controllable
//     "props" - must match the .ax source's own top-level `state`/`let`
//     names exactly (an unknown key throws, listing the valid ones) - see
//     docs/architecture/embedding.md's "inputs are state" design.
//   - `scrollRoot` (Element, optional): a host-owned scrollable ancestor to
//     measure scroll-linked timelines/progress against by default, instead
//     of the window - for embedding inside the host's own scroll
//     container, not just a normally document-scrolled page. A node's own
//     explicit `scrollRoot: "name"` (an AXIS-declared ancestor) still wins
//     over this when it has one.
export async function mount(target, source, options = {}) {
  if (!(target instanceof Element)) {
    throw new TypeError(
      "mount(target, ...) needs a real, already-in-the-document DOM Element - resolve your own selector first, e.g. mount(document.querySelector('#hero'), ...)"
    );
  }
  if (typeof source !== "string") {
    throw new TypeError("mount(target, source, ...) needs 'source' to be a string of raw .ax source text");
  }
  if (options.scrollRoot !== undefined && options.scrollRoot !== null && !(options.scrollRoot instanceof Element)) {
    throw new TypeError("options.scrollRoot must be a real DOM Element");
  }

  const interpretResult = run(source);
  if (interpretResult.pages.length === 0) {
    throw new Error("mount() needs exactly one 'page' declaration in the source - found none (a 'scene'-only file isn't an embeddable unit yet)");
  }
  if (interpretResult.pages.length > 1) {
    throw new Error(
      `mount() needs exactly one 'page' declaration in the source - found ${interpretResult.pages.length} (${interpretResult.pages.map((p) => `'${p.title}'`).join(", ")}). Split multi-page sources into one file per embeddable component.`
    );
  }

  const plan = buildDomPlan(interpretResult);

  return createPageRuntime(plan, {
    container: target,
    inputs: options.inputs ?? {},
    scrollRoot: options.scrollRoot ?? null,
    render: true,
    scopeClass: scopeClassFor(),
  });
}
