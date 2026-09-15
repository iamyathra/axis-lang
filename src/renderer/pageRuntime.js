// Runs in the browser, not in Node. The core, framework-independent AXIS
// page runtime - `createPageRuntime(plan, options)` builds (or hydrates)
// one page's live DOM, wires up `on click`/`hover`/`unhover`/`change`/
// `submit` handlers, and lets those handlers actually mutate the page live,
// using the exact same evaluator the CLI uses to build the page graph. This
// is the DOM sibling of client.js; the same "one evaluator, two places it
// runs" idea, just over the DOM instead of three.js. It also mounts a
// `viewport`'s embedded 3D scene (via scene3d.js, the same runtime a
// whole-page scene file uses) and folds its animation into this page's own
// tick loop - see docs/architecture/page-scene-fusion.md.
//
// This file has exactly one caller-facing contract, used two ways:
//   - domClient.js (the standalone-site bootstrap `axis run`/`axis build`
//     load) calls `createPageRuntime(window.__AXIS_PAGE_PLAN__, { container:
//     document })` - hydrating server-rendered markup, same behavior this
//     file always had.
//   - mount.js (the embedding API) calls `createPageRuntime(plan, {
//     container: hostElement, render: true, scopeClass, inputs, ... })` -
//     no server-rendered markup exists yet, so this file builds it first
//     (see the `render` branch below, reusing domHtml.js's own node-to-HTML
//     renderer rather than a second DOM-construction implementation).
// Same runtime either way - see docs/architecture/embedding.md. No
// "embedded" fork of any of this: every module-level mutable variable the
// original single-instance script used to have is now closed over inside
// this function instead, which is what makes more than one call to
// `createPageRuntime` (two independent embedded instances on one host page)
// safe - each gets its own closure, nothing shared but the pure, stateless
// language modules (evaluator.js/globals.js/etc.) they both import.

import { evaluate, executeBlock, executeBlockAsync, truthy, typeName, literalUnit, parseAnimateTiming, resolveAnimateTarget, AxisRuntimeError } from "../evaluator.js";
import { createGlobalEnv } from "../globals.js";
import { suggest } from "../suggest.js";
import { cssForProperty } from "./domStyle.js";
import { PATH_TO_PROPERTY, COLOR_PROPERTIES } from "./domAnimate.js";
import { prepareColorChange, lerpColorRgb } from "./colorLerp.js";
import { isSafeUrl } from "../urlSafety.js";
import { stepAnimation, applyTimelineAtElapsed, tickTimeline, startTimelineState, restartTimeline, pauseTimeline, resumeTimeline, reverseTimeline } from "./tween.js";
import { renderPageFragment } from "./domHtml.js";
import { registeredElementTypes } from "../extensionRegistry.js";

export async function createPageRuntime(plan, options = {}) {
  const {
    container = document,
    inputs = {},
    scrollRoot: hostScrollRoot = null,
    render = false,
    scopeClass = null,
    // domRouter.js's own `(path, {replace}) => {}` - present only when this
    // instance was mounted by the router (this file has no idea routing
    // exists otherwise; see docs/architecture/routing.md). `null` here is
    // exactly what makes `navigate(...)`, below, a clear runtime error
    // instead of a silent no-op in a non-routed page/embedded instance.
    navigate: hostNavigate = null,
  } = options;

  // scene3d.js itself statically imports three.js - and domServer.js only
  // ever serves three.js (see threeVendor.js) when this page actually has a
  // `viewport`, so a plain page (most pages) must not even *request*
  // scene3d.js, let alone as a static top-level import: a failed static
  // import poisons this whole module's evaluation, silently breaking every
  // `on` handler on the page, not just the 3D-related parts. A dynamic
  // import, only when needed, keeps a viewport-free page paying nothing for
  // three.js while not risking the rest of the page's interactivity on it.
  const hasViewports = plan.nodes.some((n) => n.type === "viewport");
  const { createSceneRuntime } = hasViewports ? await import("./scene3d.js") : { createSceneRuntime: null };

  // Read once, up front, so both halves of this file that care about it - a
  // scroll-linked timeline (further down) and a load-time, perpetually
  // looping `animate`/`timeline` (runningAnimations/runningPageTimelines,
  // just below) - agree on the same snapshot for the life of this instance,
  // no mid-session flip-flopping if the OS setting changes while a visitor
  // is on the page.
  const REDUCED_MOTION = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Reactive structure (a `for`/non-literal `if` directly inside a
  // page/container/component body) - see docs/architecture/reactive-structure.md.
  // `interpreter.js` is only fetched when the plan actually has a reactive
  // block (same "pay nothing unless you use it" pattern as scene3d.js, just
  // above): re-running `PageBuilder`'s own declaration logic client-side is
  // how a reactive block's new content gets built, rather than a second,
  // parallel implementation of "what does an ObjectDecl mean."
  const hasReactiveBlocks = (plan.reactiveBlocks?.length ?? 0) > 0;
  const { PageBuilder } = hasReactiveBlocks ? await import("../interpreter.js") : { PageBuilder: null };
  const { buildNode: buildPlanNode } = hasReactiveBlocks ? await import("./domPlan.js") : { buildNode: null };
  const componentsMap = new Map((plan.components ?? []).map((c) => [c.name, c]));

  // `render: true` (mount.js only) - there's no server to have rendered
  // this instance's markup ahead of time (mount() parses/interprets/builds
  // the plan entirely client-side, from raw source text - see mount.js),
  // so it has to be built here instead, reusing exactly the same
  // node-to-HTML renderer domHtml.js's own server-side `renderPageHtml`
  // uses (renderPageFragment) - not a second, DOM-construction
  // implementation of "what does a plan node look like." `scopeClass`, if
  // given, both gets added to the container (so a plain CSS selector like
  // `.axis-abc123 button` can exist at all) and threaded through so the
  // responsive `<style>` block this produces is scoped under it - see
  // docs/architecture/embedding.md's CSS isolation section.
  if (render) {
    if (scopeClass) container.classList.add(scopeClass);
    container.innerHTML = renderPageFragment(plan, { scopeClass });
  }

  const nodesByName = new Map(plan.nodes.map((node) => [node.name, node]));
  const elementsByName = new Map();
  for (const el of container.querySelectorAll("[data-axis-name]")) {
    elementsByName.set(el.dataset.axisName, el);
  }

  // ---- SPA link navigation --------------------------------------------------
  // A `link` element is always a real, semantic `<a href="...">` - server-
  // rendered, right-clickable, ctrl/cmd-clickable, screen-reader-navigable,
  // exactly as before this feature existed (see docs/architecture/routing.md's
  // "Link component" section - a `<div>` pretending to be a link was never
  // on the table). The *one* thing routing adds: a plain, unmodified left
  // click on one whose `href` resolves to this same origin is intercepted -
  // `navigate()`'d instead of letting the browser do a full reload - so an
  // otherwise-ordinary anchor is what makes SPA navigation actually feel
  // like an SPA. Every other click (a modifier held, a right-click, a
  // `target="_blank"`, a different origin, a `mailto:`/`tel:` link, ...)
  // falls through to completely normal browser behavior, untouched.
  function isSameOriginPath(href) {
    if (!href || href.startsWith("#")) return false;
    try {
      return new URL(href, window.location.href).origin === window.location.origin;
    } catch {
      return false;
    }
  }
  function wireLinkNavigation(node, el) {
    if (node.type !== "link" || !hostNavigate) return;
    el.addEventListener("click", (event) => {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = el.getAttribute("target");
      if (target && target !== "_self") return;
      const href = el.getAttribute("href");
      if (!isSameOriginPath(href)) return;
      event.preventDefault();
      hostNavigate(new URL(href, window.location.href).pathname + new URL(href, window.location.href).search);
    });
  }
  for (const node of plan.nodes) {
    if (node.type !== "link") continue;
    const el = elementsByName.get(node.name);
    if (el) wireLinkNavigation(node, el);
  }

  // ---- conditional viewport visibility --------------------------------------
  // `visible: expr` on a `viewport` (interpreter.js/domPlan.js) is the one
  // AXIS-language trigger for mountViewport/unmountViewport (defined further
  // down, in "embedded 3D viewports") - see
  // docs/architecture/conditional-viewport.md. `viewportVisibility` is this
  // instance's single source of truth for "did visible actually change" -
  // seeded here, from the plan's own build-time value (exactly what the
  // server, or the render branch above, rendered), before reRender()'s very
  // first pass runs. That matters because that first pass sees every
  // binding as "changed" (its own cache starts empty) - without a seed
  // already in place, it would treat a reactive `visible` binding's very
  // first read as a real transition and try to mount a viewport a second
  // time, racing the initial per-node mount loop at the bottom of this
  // function that's about to do the real, one-time initial mount.
  const viewportVisibility = new Map(); // viewport name -> the visible boolean mountViewport/unmountViewport were last driven by
  for (const node of plan.nodes) {
    if (node.type === "viewport") viewportVisibility.set(node.name, node.visible);
  }

  // The one place `visible`'s reactive effect actually happens - called from
  // reRender() (a bound `visible: someState` expression changed) and from the
  // initial per-node mount loop alike, so a viewport's presence means the same
  // thing whether it's decided at page load or by a later handler. Toggles the
  // container's own `display` (page-DOM bookkeeping this file already owns -
  // see applyElementProperty) and calls the existing mountViewport/
  // unmountViewport pair (which alone own the runtime registry/disposal) -
  // this function orchestrates both, it doesn't duplicate either. A no-op
  // unless `visible` is an actual transition from what it was last driven by,
  // so a re-render that leaves it unchanged never dispose+remounts a live
  // runtime, and repeated identical toggles (true -> true, false -> false)
  // never double up.
  function setViewportVisible(node, visible) {
    if (viewportVisibility.get(node.name) === visible) return;
    viewportVisibility.set(node.name, visible);
    const el = elementsByName.get(node.name);
    if (el) el.style.display = visible ? "" : "none";
    if (visible) mountViewport(node);
    else unmountViewport(node.name);
  }

  // The one place a page-element property name turns into an actual DOM
  // mutation - shared by `LiveElement`'s imperative setters (a handler doing
  // `label.content = "..."`) and `reRender()`'s declarative re-evaluation (a
  // bound property expression that changed because a `state`/`let` it reads
  // changed), so there's exactly one mapping to keep in sync, not two.
  function applyElementProperty(node, el, key, value) {
    switch (key) {
      case "content":
      case "label":
        el.textContent = value;
        return;
      case "href":
      case "src":
        // A reactive/handler-assigned href or src can't be rejected at build
        // time (interpreter.js only catches a bad *literal* one) - sanitized
        // live instead, so a `javascript:` URL that only shows up once some
        // `state` takes on a particular value never actually reaches the DOM.
        // See urlSafety.js.
        if (!isSafeUrl(value)) {
          console.error(`[axis] '${key}' on '${node.name}' rejected an unsafe URL scheme, using "#" instead: ${value}`);
          el.setAttribute(key, "#");
          return;
        }
        el.setAttribute(key, value);
        return;
      case "alt":
        el.setAttribute("alt", value);
        return;
      case "value":
        el.value = value;
        return;
      case "placeholder":
        el.setAttribute("placeholder", value);
        return;
      case "kind":
        el.setAttribute("type", value);
        return;
      case "css":
        el.style.cssText += `; ${value}`;
        return;
      default:
        Object.assign(el.style, cssForProperty(node.type, key, value));
    }
  }

  // Wraps a real DOM element so `button.color = red` and `text.content = "..."`
  // mutate the actual page, not a disconnected copy - mirrors client.js's
  // LiveObject for three.js meshes.
  class LiveElement {
    constructor(node, el) {
      this._node = node;
      this._el = el;
    }
    _set(key, value) { applyElementProperty(this._node, this._el, key, value); }
    get content() { return this._el.textContent; }
    set content(v) { this._set("content", v); }
    get label() { return this._el.textContent; }
    set label(v) { this._set("label", v); }
    get href() { return this._el.getAttribute("href"); }
    set href(v) { this._set("href", v); }
    get src() { return this._el.getAttribute("src"); }
    set src(v) { this._set("src", v); }
    get alt() { return this._el.getAttribute("alt"); }
    set alt(v) { this._set("alt", v); }
    get value() { return this._el.value; }
    set value(v) { this._set("value", v); }
    get placeholder() { return this._el.getAttribute("placeholder"); }
    set placeholder(v) { this._set("placeholder", v); }
    get kind() { return this._el.getAttribute("type"); }
    set kind(v) { this._set("kind", v); }
    set css(v) { this._set("css", v); } // write-only - there's no single "current raw css" to read back
    get color() { return this._el.style.color; }
    set color(v) { this._set("color", v); }
    get background() { return this._el.style.background; }
    set background(v) { this._set("background", v); }
    get width() { return this._el.style.width; }
    set width(v) { this._set("width", v); }
    get height() { return this._el.style.height; }
    set height(v) { this._set("height", v); }
    get padding() { return this._el.style.padding; }
    set padding(v) { this._set("padding", v); }
    get gap() { return this._el.style.gap; }
    set gap(v) { this._set("gap", v); }
    get radius() { return this._el.style.borderRadius; }
    set radius(v) { this._set("radius", v); }
    get size() { return this._el.style.fontSize; }
    set size(v) { this._set("size", v); }
    get weight() { return this._el.style.fontWeight; }
    set weight(v) { this._set("weight", v); }
    get opacity() { return this._el.style.opacity; }
    set opacity(v) { this._set("opacity", v); }
    get border() { return this._el.style.border; }
    set border(v) { this._set("border", v); }
    get shadow() { return this._el.style.boxShadow; }
    set shadow(v) { this._set("shadow", v); }
    get cursor() { return this._el.style.cursor; }
    set cursor(v) { this._set("cursor", v); }
    get position() { return this._el.style.position; }
    set position(v) { this._set("position", v); }
    get top() { return this._el.style.top; }
    set top(v) { this._set("top", v); }
    get left() { return this._el.style.left; }
    set left(v) { this._set("left", v); }
    get right() { return this._el.style.right; }
    set right(v) { this._set("right", v); }
    get bottom() { return this._el.style.bottom; }
    set bottom(v) { this._set("bottom", v); }
    get z() { return this._el.style.zIndex; }
    set z(v) { this._set("z", v); }
  }

  const scriptEnv = createGlobalEnv();

  // ---- host embedding: inputs and output events ---------------------------
  // No new language grammar for either (see docs/architecture/embedding.md):
  // a host's "props" ARE this page's own top-level `state`/`let` (seeded
  // below, from `inputs`, against an explicit allow-list - the same
  // "validate a key against an allow-list" shape interpreter.js's own
  // component-param validation already uses); a host's "output events" are
  // just `emit("name", payload)` - a plain native function value, exactly
  // the shape evaluator.js#callFunction already accepts (see globals.js's
  // own `rgb`/`abs`/etc.), scoped to this one instance's own `listeners`
  // registry, not a global event bus. Defined before `plan.functions` are
  // defined below, so redefining `emit` in an .ax source collides with it
  // the same well-established way redefining any other global.js builtin
  // already does (Environment.define's own "already defined" guard) -
  // deliberately, not a new kind of restriction.
  const listeners = new Map(); // event name -> Set<callback>
  scriptEnv.define("emit", (args, line) => {
    const [name, payload] = args;
    if (typeof name !== "string") {
      throw new AxisRuntimeError("'emit' needs an event name (a string) as its first argument", line);
    }
    for (const cb of listeners.get(name) ?? []) {
      try {
        cb(payload);
      } catch (e) {
        console.error(`[axis] a host 'on("${name}", ...)' listener threw:`, e);
      }
    }
    return null;
  });

  // `navigate("/about")` / `navigate("/about", { replace: true })` - the
  // programmatic half of routing (`on submit { ... navigate("/dashboard") }`,
  // works from async code exactly like any other native function call -
  // see docs/architecture/routing.md). Defined unconditionally (not just
  // when this file actually has `route`s) so calling it anywhere it can't
  // work yet - a plain single-page file, or an embedding host that didn't
  // wire up a router - is a clear AxisRuntimeError, not "undefined
  // variable 'navigate'".
  scriptEnv.define("navigate", (args, line) => {
    const [path, navOptions] = args;
    if (typeof path !== "string") throw new AxisRuntimeError("'navigate' needs a path (a string) as its first argument", line);
    if (!hostNavigate) throw new AxisRuntimeError("'navigate' needs at least one 'route' declaration in this file", line);
    hostNavigate(path, { replace: navOptions != null && navOptions.replace === true });
    return null;
  });

  for (const fn of plan.functions) {
    scriptEnv.define(fn.name, { __axisType: "function", name: fn.name, params: fn.params, body: fn.body, closure: scriptEnv, isAsync: fn.isAsync });
  }
  // Top-level `let`/`state` - defined once, here, on the one env every
  // domain's own env is a child of. That's the whole mechanism: an
  // assignment to one of these from *any* handler - this page's or an
  // embedded viewport's - mutates this single shared cell (Environment.set,
  // evaluator.js, walks up to wherever a name is actually defined), so the
  // next reRender()/viewport reRender() anywhere in the app sees it. See
  // docs/architecture/reactive-state.md. `inputs` (mount.js's host-supplied
  // props) overrides a matching name's own build-time initial value right
  // here, at the point it's defined - after this, a `state` an embedder
  // seeded is completely indistinguishable from one the .ax source itself
  // initialized differently, which is exactly the point (one reactive
  // system, not two).
  const sharedVariableNames = Object.keys(plan.sharedVariables ?? {});
  const consumedInputs = new Set();
  for (const [name, { value, constant, initializer }] of Object.entries(plan.sharedVariables ?? {})) {
    const hasOverride = Object.prototype.hasOwnProperty.call(inputs, name);
    // `initializer` - only present when `value` contains a function (a
    // "data with behavior" record) - means `value` itself went through a
    // JSON round trip that reduced every function field's `.closure` to a
    // plain, prototype-less object; re-evaluating the original initializer
    // expression here, against this real `scriptEnv`, gives it a fresh,
    // working closure instead. See scene3d.js's identical fix (same root
    // cause, other domain) and
    // docs/architecture/2026-09-language-platform-audit.md's game-
    // foundation addendum for the full account - this is a real bug fix,
    // not a defensive measure: examples/entities.ax's own flagship demo
    // never actually worked in a real browser before this.
    scriptEnv.define(name, hasOverride ? inputs[name] : initializer ? evaluate(initializer, scriptEnv) : value, constant);
    if (hasOverride) consumedInputs.add(name);
  }
  const unknownInputs = Object.keys(inputs).filter((k) => !consumedInputs.has(k));
  if (unknownInputs.length > 0) {
    throw new AxisRuntimeError(
      `'${unknownInputs[0]}' isn't an input this component accepts${suggest(unknownInputs[0], sharedVariableNames)}${sharedVariableNames.length ? ` - try: ${sharedVariableNames.join(", ")}` : " - this component declares no top-level state/let to seed"}`
    );
  }

  const pageEnv = scriptEnv.child();
  for (const [name, { value, constant, initializer }] of Object.entries(plan.variables)) {
    // See the identical `initializer` handling just above, for the same
    // reason - a page-local `state`/`let` (not a file-top-level shared
    // one) is exactly as exposed to the JSON-closure bug.
    pageEnv.define(name, initializer ? evaluate(initializer, pageEnv) : value, constant);
  }
  for (const [name, node] of nodesByName) {
    const el = elementsByName.get(name);
    if (el) pageEnv.define(name, new LiveElement(node, el));
  }

  // ---- reactive re-render -------------------------------------------------
  // The smallest coherent model that gives `state`-bound properties a live
  // UI update without a developer manually setting `.content`/etc.: every
  // non-literal property expression was shipped through as a `bindings`
  // entry (see interpreter.js's PageBuilder.applyProperty), so after
  // anything runs that could have changed a variable, just re-evaluate all
  // of them against the live page environment and patch what actually
  // changed. No dependency tracking - re-checking a handful of small
  // expressions is cheap at the scale a page like this runs at.
  const lastBoundValues = new Map(); // "nodeName.key" -> last-applied value

  // ---- reactive structure ---------------------------------------------------
  // A `for`/non-literal `if` directly inside a page/container/component body
  // (interpreter.js's PageBuilder.registerReactiveBlocks) - AXIS's reactive
  // *values* (above) patch an already-fixed set of elements; this adds
  // reactive *structure*: the set of elements itself can now change. See
  // docs/architecture/reactive-structure.md.
  const blockInstanceNames = new Map(); // reactive block id -> the flat Set of node names it currently owns, across every instance
  const lastRawCss = new Map(); // node name -> the last `css:` raw string actually applied (avoids re-appending the same text to el.style.cssText every pass)
  const warnedBlocks = new Set(); // reactive block ids that already printed a rebuild error - don't spam the console every re-render

  // One entry per DOM element type this runtime knows how to mount live -
  // "add a new element type" means adding one entry here, not a tag lookup
  // split across two separate object literals to keep in sync. Mirrors
  // domHtml.js's own ELEMENT_RENDERERS registry (a local table there too,
  // deliberately not shared - see the note on that one for why
  // string-building and live DOM-building don't share an implementation).
  const ELEMENT_TAGS = {
    container: "div",
    form: "form",
    list: "ul",
    item: "li",
    paragraph: "p",
    button: "button",
    link: "a",
    image: "img",
    input: "input",
  };
  const REACTIVE_CONTENT_KEYS = ["content", "label", "href", "src", "alt", "value", "placeholder", "kind"];

  function createElementForNode(node) {
    const tag = node.type === "heading" ? `h${node.level ?? 1}` : ELEMENT_TAGS[node.type] ?? registeredElementTypes().get(node.type)?.tag ?? "div";
    const el = document.createElement(tag);
    el.dataset.axisName = node.name;
    return el;
  }

  function applyFullNode(node, el) {
    for (const key of REACTIVE_CONTENT_KEYS) {
      if (node[key] !== undefined) applyElementProperty(node, el, key, node[key]);
    }
    const { __raw, ...rest } = node.style ?? {};
    Object.assign(el.style, rest);
    if (__raw && lastRawCss.get(node.name) !== __raw) {
      lastRawCss.set(node.name, __raw);
      el.style.cssText += `; ${__raw}`;
    }
  }

  function upsertReactiveNode(node, scratch) {
    nodesByName.set(node.name, node);
    let el = elementsByName.get(node.name);
    const isNew = !el;
    if (isNew) {
      const parentEl = elementsByName.get(node.parent);
      if (!parentEl) {
        console.error(`[axis] can't mount '${node.name}' - its parent '${node.parent}' isn't on the page`);
        return;
      }
      el = createElementForNode(node);
      parentEl.appendChild(el);
      elementsByName.set(node.name, el);
    }
    applyFullNode(node, el);
    if (isNew) {
      pageEnv.define(node.name, new LiveElement(node, el));
      wireDynamicHandlers(node.name, el, scratch.handlers);
      wireLinkNavigation(node, el);
    }
  }

  function removeReactiveNode(name) {
    elementsByName.get(name)?.remove();
    elementsByName.delete(name);
    nodesByName.delete(name);
    handlersByTarget.delete(name);
    lastRawCss.delete(name);
    pageEnv.undefine(name);
    for (const key of lastBoundValues.keys()) {
      if (key.startsWith(`${name}.`)) lastBoundValues.delete(key);
    }
  }

  function runReactiveStmt(scratch, stmt, parentName) {
    const instances = [];
    if (stmt.kind === "IfStmt") {
      const branch = truthy(evaluate(stmt.condition, pageEnv)) ? stmt.then : stmt.else;
      if (branch) {
        const start = scratch.objects.length;
        scratch.runStatements(branch, pageEnv.child(), parentName);
        instances.push(scratch.objects.slice(start));
      }
    } else {
      const iterable = evaluate(stmt.iterable, pageEnv);
      if (Array.isArray(iterable)) {
        for (const item of iterable) {
          const iterEnv = pageEnv.child();
          iterEnv.define(stmt.varName, item);
          scratch.loopVarStack.push([stmt.varName, item]);
          const start = scratch.objects.length;
          scratch.runStatements(stmt.body, iterEnv, parentName);
          scratch.loopVarStack.pop();
          instances.push(scratch.objects.slice(start));
        }
      }
    }
    return instances;
  }

  function rebuildReactiveBlock(block) {
    try {
      const scratch = new PageBuilder("reactive", componentsMap, scriptEnv, new Map());
      const instances = runReactiveStmt(scratch, block.stmt, block.parentName);

      const freshNames = new Set();
      for (const rawObjs of instances) for (const raw of rawObjs) freshNames.add(raw.name);

      const prevNames = blockInstanceNames.get(block.id);
      if (prevNames !== undefined) {
        for (const name of prevNames) {
          if (!freshNames.has(name)) removeReactiveNode(name);
        }
      }

      for (const rawObjs of instances) {
        for (const raw of rawObjs) {
          upsertReactiveNode(buildPlanNode(raw), scratch);
        }
      }
      blockInstanceNames.set(block.id, freshNames);
    } catch (e) {
      if (!warnedBlocks.has(block.id)) {
        warnedBlocks.add(block.id);
        console.error(`[axis] couldn't update a reactive 'for'/'if': ${e.message ?? e}`);
      }
    }
  }

  function rebuildAllReactiveBlocks() {
    for (const block of plan.reactiveBlocks) rebuildReactiveBlock(block);
  }

  function reRender() {
    if (hasReactiveBlocks) rebuildAllReactiveBlocks();
    // `nodesByName.values()`, not `plan.nodes` - the two start out
    // identical (nodesByName is seeded from plan.nodes above) but a
    // reactive `if`/`for` rebuild (just above) can repurpose an existing
    // element for a *different* branch's node while reusing the same name
    // (e.g. an if/else where both branches declare `heading title { ... }`,
    // for visual continuity) - `upsertReactiveNode` keeps `nodesByName`
    // pointed at whichever node most recently owns that name, but
    // `plan.nodes` is the original, immutable build-time array and would
    // never reflect that, so re-checking bindings against it would
    // silently stomp the rebuild's own correct value right back to the
    // *other* branch's - see docs/architecture/routing.md's
    // examples/routing/site.ax note.
    for (const node of nodesByName.values()) {
      const el = elementsByName.get(node.name);
      if (!el || !node.bindings) continue;
      for (const [key, expr] of Object.entries(node.bindings)) {
        let value;
        try {
          value = evaluate(expr, pageEnv);
        } catch {
          continue; // a bad expression shouldn't crash the whole re-render pass
        }
        const cacheKey = `${node.name}.${key}`;
        if (lastBoundValues.get(cacheKey) === value) continue;
        lastBoundValues.set(cacheKey, value);
        if (key === "visible") {
          if (typeof value !== "boolean") continue;
          if (node.type === "viewport") setViewportVisible(node, value);
          else el.style.display = value ? "" : "none";
          continue;
        }
        applyElementProperty(node, el, key, value);
      }
    }
  }

  reRender();

  // ---- render-on-demand -----------------------------------------------------
  let disposed = false;
  let scheduled = false;
  function wake() {
    if (disposed || scheduled) return;
    scheduled = true;
    requestAnimationFrame((now) => {
      scheduled = false;
      if (disposed) return;
      if (tick(now)) wake();
    });
  }

  // ---- animation ----------------------------------------------------------
  const transformState = new Map(); // name -> {x, y, scale, rotation}

  function applyTransform(name) {
    const el = elementsByName.get(name);
    if (!el) return;
    const t = transformState.get(name) ?? { x: 0, y: 0, scale: 1, rotation: 0 };
    el.style.transform = `translate(${t.x}px, ${t.y}px) scale(${t.scale}) rotate(${t.rotation}deg)`;
  }

  // A color/background change's `from`/`to` are resolved to [r,g,b] once,
  // right when the animation/timeline is scheduled (see prepareChangeList,
  // below) - not reparsed every frame. Mirrors scene3d.js's own
  // prepareChanges/valueAt split for the exact same reason: color lerp
  // needs component math a plain `from + (to-from)*t` can't do on a string.
  function prepareChangeList(changes) {
    return changes.map((c) => (c.color ? prepareColorChange(c) : c));
  }

  function applyDomChange(target, change, t) {
    const el = elementsByName.get(target);
    if (!el) return;
    if (change.color) {
      el.style[change.property] = lerpColorRgb(change.fromRgb, change.toRgb, t);
      return;
    }
    const value = change.from + (change.to - change.from) * t;
    if (change.property === "opacity") {
      el.style.opacity = value;
      return;
    }
    const transform = transformState.get(target) ?? { x: 0, y: 0, scale: 1, rotation: 0 };
    if (change.property === "positionX") transform.x = value;
    else if (change.property === "positionY") transform.y = value;
    else if (change.property === "scale") transform.scale = value;
    else if (change.property === "rotation") transform.rotation = value;
    else return;
    transformState.set(target, transform);
    applyTransform(target);
  }

  const runningAnimations = plan.animations.map((anim) => {
    const changes = prepareChangeList(anim.changes);
    if (REDUCED_MOTION && anim.repeat === "infinite") {
      for (const change of changes) applyDomChange(anim.target, change, 1);
      return { ...anim, changes, startTime: null, finished: true };
    }
    return { ...anim, changes, startTime: null, finished: false };
  });

  // Only a "dom" step's changes ever go through applyDomChange (a "scene"
  // step's own changes are resolved by that viewport's own scene3d.js
  // runtime instead - see applyPageTimelineStep, below) - so only those get
  // their colors pre-resolved here.
  const runningPageTimelines = new Map(
    plan.timelines.map((t) => [
      t.name,
      startTimelineState(
        t.duration,
        t.steps.map((s) => (s.kind === "scene" ? s : { ...s, changes: prepareChangeList(s.changes) })),
        t.loop
      ),
    ])
  );

  function applyPageTimelineStep(step, t) {
    if (step.kind === "scene") {
      const runtime = viewportRuntimesByName.get(step.viewportName);
      if (!runtime) return; // still mounting (async) - contributes nothing yet, same as the plain viewport tick loop
      for (const change of step.changes) runtime.applyChangeToTarget(step.target, change, t);
    } else {
      for (const change of step.changes) applyDomChange(step.target, change, t);
    }
  }

  function seekPageTimeline(name, progress) {
    const rt = runningPageTimelines.get(name);
    if (!rt) return;
    rt.driver = "scroll";
    rt.finished = false;
    applyTimelineAtElapsed(rt, Math.max(0, Math.min(1, progress)) * rt.duration, applyPageTimelineStep);
  }

  function requirePageTimelineByName(name, verb, line) {
    const rt = runningPageTimelines.get(name);
    if (!rt) {
      throw new AxisRuntimeError(`can't ${verb} '${name}' - no timeline with that name on this page`, line);
    }
    if (rt.driver === "scroll") {
      throw new AxisRuntimeError(`can't ${verb} '${name}' - it's driven by scroll ('scrollTimeline'), not manual playback`, line);
    }
    return rt;
  }

  // `viewportName.timelineName` - the same dotted convention a page-level
  // `timeline` step already uses to cross-reference a viewport's own
  // embedded scene (interpreter.js's PageBuilder.buildTimelineStep), now
  // also usable directly in `play`/`pause`/`resume`/`reverse` from a
  // page-level `on` handler - not just from inside a page `timeline` step,
  // and not just indirectly via `scrollTimeline`. Resolved live, in the
  // browser, same as every other play/pause/resume/reverse target already
  // is (this file's own documented limitation on build-time validation for
  // these) - a typo'd viewport name is a clear runtime error, not a silent
  // no-op. Returns null for a plain (non-dotted) name, meaning "this page's
  // own timeline" - the caller falls through to its existing local logic.
  function dispatchTimelineControl(stmt, env, verb, applyLocal, applyRemote) {
    const name = resolveAnimateTarget(stmt, env);
    const dotIndex = name.indexOf(".");
    if (dotIndex === -1) {
      applyLocal(requirePageTimelineByName(name, verb, stmt.line));
      return;
    }
    const viewportName = name.slice(0, dotIndex);
    const timelineName = name.slice(dotIndex + 1);
    const runtime = viewportRuntimesByName.get(viewportName);
    if (!runtime) {
      throw new AxisRuntimeError(`can't ${verb} '${name}' - '${viewportName}' isn't a currently-mounted viewport on this page`, stmt.line);
    }
    applyRemote(runtime, timelineName);
  }

  function playPageTimeline(stmt, env) {
    dispatchTimelineControl(
      stmt, env, "play",
      (rt) => { restartTimeline(rt); wake(); }, // called from an `on` handler, outside tick() - wake an idle loop
      (runtime, name) => runtime.playTimelineByName(name)
    );
  }

  function pausePageTimeline(stmt, env) {
    dispatchTimelineControl(
      stmt, env, "pause",
      (rt) => pauseTimeline(rt, performance.now()),
      (runtime, name) => runtime.pauseTimelineByName(name)
    );
  }

  function resumePageTimeline(stmt, env) {
    dispatchTimelineControl(
      stmt, env, "resume",
      (rt) => { resumeTimeline(rt, performance.now()); wake(); },
      (runtime, name) => runtime.resumeTimelineByName(name)
    );
  }

  function reversePageTimeline(stmt, env) {
    dispatchTimelineControl(
      stmt, env, "reverse",
      (rt) => { reverseTimeline(rt, performance.now()); wake(); },
      (runtime, name) => runtime.reverseTimelineByName(name)
    );
  }

  function triggerAnimation(decl, env) {
    const targetName = resolveAnimateTarget(decl, env);
    if (!nodesByName.has(targetName)) {
      throw new AxisRuntimeError(`can't animate '${targetName}' - no element with that name on this page`, decl.line);
    }

    const timing = parseAnimateTiming(decl, env);
    const el = elementsByName.get(targetName);
    const t = transformState.get(targetName) ?? { x: 0, y: 0, scale: 1, rotation: 0 };
    const changes = [];

    for (const entry of timing.rest) {
      const key = entry.path.join(".");
      const property = PATH_TO_PROPERTY[key];
      if (!property) {
        throw new AxisRuntimeError(`can't animate '${key}' on a page element - try opacity, position.x, position.y, scale, rotation, color, or background`, decl.line);
      }
      const toValue = evaluate(entry.to, env);

      if (COLOR_PROPERTIES.has(property)) {
        if (typeof toValue !== "string") {
          throw new AxisRuntimeError(`animated value for '${key}' must be a color name or a string like "#ff6600", got a ${typeName(toValue)}`, decl.line);
        }
        // The DOM's own current value (whatever format it's serialized to)
        // - resolveRgb inside prepareColorChange normalizes it regardless,
        // same as it does for `to` - see colorLerp.js.
        const from = (el && el.style[property]) || (property === "color" ? "#000000" : "#ffffff");
        changes.push(prepareColorChange({ property, from, to: toValue, color: true }));
        continue;
      }
      if (typeof toValue !== "number") {
        throw new AxisRuntimeError(`animated value for '${key}' must be a number, got a ${typeName(toValue)}`, decl.line);
      }

      let from;
      let to = toValue;
      if (property === "opacity") from = el ? parseFloat(el.style.opacity || "1") : 1;
      else if (property === "positionX") from = t.x;
      else if (property === "positionY") from = t.y;
      else if (property === "scale") from = t.scale;
      else {
        from = t.rotation; // rotation
        if (literalUnit(entry.to) === "rad") to = (toValue * 180) / Math.PI;
      }
      changes.push({ property, from, to });
    }

    if (changes.length === 0) return;
    runningAnimations.push({ target: targetName, ...timing, changes, startTime: null, finished: false });
    wake(); // pushed from an `on` handler, outside tick() - wake an idle loop so this animation's first frame actually happens
  }

  // ---- embedded 3D viewports -----------------------------------------------
  const viewportRuntimes = [];
  const viewportRuntimesByName = new Map(); // viewport element name -> its mounted scene3d.js runtime - how a page-level timeline step reaches into it (applyPageTimelineStep, above)
  const viewportScrollUnsubscribes = new Map(); // viewport name -> its own addScrollLink removal, only present if it actually has one
  const pendingUnmount = new Set();
  const pendingMount = new Set();

  function reRenderAll() {
    reRender();
    for (const runtime of viewportRuntimes) runtime.reRender();
  }

  // ---- scroll-linked timelines ----------------------------------------------
  // `scrollTimeline: "name"` (interpreter.js/domPlan.js) - on a `viewport`,
  // drives that *scene's* own timeline; on any other element, this *page's*
  // own - turns that element's own scroll position into a timeline's
  // progress. `root` is the element `scrollRoot: "name"` names (see
  // docs/architecture/nested-scroll.md), falling back to a host-supplied
  // `options.scrollRoot` (mount.js/embedding.md - a host's own scrollable
  // wrapper, since an embedded instance can't assume it owns `window`'s own
  // scroll) when the node itself doesn't declare one, or the document
  // otherwise - the exact same formula either way, just measured against a
  // different "viewport."
  function scrollProgressFor(el, root) {
    const rect = el.getBoundingClientRect();
    const rootRect = root ? root.getBoundingClientRect() : { top: 0, height: window.innerHeight || document.documentElement.clientHeight };
    const relativeTop = rect.top - rootRect.top;
    const span = rootRect.height + rect.height;
    return span > 0 ? Math.max(0, Math.min(1, (rootRect.height - relativeTop) / span)) : 0;
  }

  function setPageProgressState(name, value, warn) {
    try {
      pageEnv.set(name, value);
    } catch (e) {
      if (warn.once) return;
      warn.once = true;
      console.error(`[axis] can't write scroll progress to '${name}': ${e.message ?? e}`);
      return;
    }
    reRenderAll();
  }

  const scrollLinkedTargets = []; // { element, root, lastProgress, onProgress(progress) }

  function addScrollLink(element, onProgress, root) {
    const entry = { element, root, lastProgress: null, onProgress };
    scrollLinkedTargets.push(entry);
    wake(); // this link's own first measurement still needs a frame to actually apply, even if nothing else on the page currently does
    return () => {
      const i = scrollLinkedTargets.indexOf(entry);
      if (i !== -1) scrollLinkedTargets.splice(i, 1);
    };
  }

  // Resolves the scroll-measurement root for one plan node: its own
  // `scrollRoot` (an AXIS-declared ancestor's name) if it has one, else the
  // host-supplied default (embedding), else undefined (document/window) -
  // one small helper so mountViewport's own scroll link and the static
  // per-node loop below agree on exactly the same resolution order.
  function resolveScrollRoot(node) {
    if (node.scrollRoot) return elementsByName.get(node.scrollRoot);
    return hostScrollRoot ?? undefined;
  }

  const HAS_SCROLL_LINKS = plan.nodes.some((n) => n.scrollTimeline || n.scrollProgress);
  const SCROLL_SETTLE_MS = 200;
  let scrollActiveUntil = 0;
  const scrollAbortController = new AbortController();
  if (HAS_SCROLL_LINKS) {
    const wakeOnScroll = () => {
      scrollActiveUntil = performance.now() + SCROLL_SETTLE_MS;
      wake();
    };
    window.addEventListener("scroll", wakeOnScroll, { passive: true, signal: scrollAbortController.signal });
    // A `scroll` event never bubbles except from `document` itself - a
    // nested scroll root (an AXIS-declared `scrollRoot`, or a host-supplied
    // one when embedded) needs its own listener, directly on that element,
    // or this instance would never wake back up for it.
    const rootNames = new Set(plan.nodes.map((n) => n.scrollRoot).filter(Boolean));
    for (const rootName of rootNames) {
      const rootEl = elementsByName.get(rootName);
      if (rootEl) rootEl.addEventListener("scroll", wakeOnScroll, { passive: true, signal: scrollAbortController.signal });
    }
    if (hostScrollRoot) hostScrollRoot.addEventListener("scroll", wakeOnScroll, { passive: true, signal: scrollAbortController.signal });
  }

  function mountViewport(node) {
    if (viewportRuntimesByName.has(node.name)) return; // already live
    pendingUnmount.delete(node.name); // this mount request supersedes any earlier still-pending unmount queued for this same in-flight mount
    if (pendingMount.has(node.name)) return; // already mounting - the in-flight promise below will pick up this now-current desired state
    const viewportContainer = elementsByName.get(node.name);
    if (!viewportContainer) return;
    pendingMount.add(node.name);
    createSceneRuntime(node.scene, { container: viewportContainer, scriptEnv, fitToContainer: true, onStateChange: reRenderAll, onInvalidate: wake })
      .then((runtime) => {
        pendingMount.delete(node.name);
        if (pendingUnmount.delete(node.name)) {
          runtime.dispose();
          return;
        }
        viewportRuntimes.push(runtime);
        viewportRuntimesByName.set(node.name, runtime);
        wake();
        if (node.scrollTimeline && REDUCED_MOTION) {
          runtime.seekTimeline(node.scrollTimeline, 1);
        }
        if (!node.scrollTimeline && !node.scrollProgress) return;
        const warn = { once: false };
        const removeLink = addScrollLink(
          viewportContainer,
          (p) => {
            if (node.scrollTimeline && !REDUCED_MOTION) runtime.seekTimeline(node.scrollTimeline, p);
            if (node.scrollProgress) {
              try {
                runtime.setState(node.scrollProgress, p);
              } catch (e) {
                if (!warn.once) {
                  warn.once = true;
                  console.error(`[axis] can't write scroll progress to '${node.scrollProgress}' in scene '${node.sceneName}': ${e.message ?? e}`);
                }
              }
            }
          },
          resolveScrollRoot(node)
        );
        viewportScrollUnsubscribes.set(node.name, removeLink);
      })
      .catch((err) => {
        pendingMount.delete(node.name);
        console.error(`[axis] couldn't start viewport '${node.name}': ${err.message ?? err}`);
      });
  }

  function unmountViewport(name) {
    const runtime = viewportRuntimesByName.get(name);
    if (!runtime) {
      pendingUnmount.add(name);
      return;
    }
    runtime.dispose();
    viewportRuntimesByName.delete(name);
    const i = viewportRuntimes.indexOf(runtime);
    if (i !== -1) viewportRuntimes.splice(i, 1);
    viewportScrollUnsubscribes.get(name)?.();
    viewportScrollUnsubscribes.delete(name);
  }

  for (const node of plan.nodes) {
    if (node.type === "viewport" && node.scene) {
      if (viewportVisibility.get(node.name)) mountViewport(node);
      continue;
    }

    if (!node.scrollTimeline && !node.scrollProgress) continue;
    const element = elementsByName.get(node.name);
    if (!element) continue;
    const root = resolveScrollRoot(node);
    if (node.scrollTimeline && REDUCED_MOTION) seekPageTimeline(node.scrollTimeline, 1);
    const warn = { once: false };
    addScrollLink(
      element,
      (p) => {
        if (node.scrollTimeline && !REDUCED_MOTION) seekPageTimeline(node.scrollTimeline, p);
        if (node.scrollProgress) setPageProgressState(node.scrollProgress, p, warn);
      },
      root
    );
  }

  // ---- interaction --------------------------------------------------------

  const handlersByTarget = new Map(); // name -> { click?, hover?, unhover?, change?, submit? }
  // Global handlers (target: null, see interpreter.js's interpretOnDecl) -
  // pulled out into plain lists, one per event, before they ever reach
  // handlersByTarget, both because multiple independent handlers for the
  // same global event are the expected case (not a one-body-per-event-per-
  // target collision to resolve) and so a `null` key never shows up in the
  // DOM-listener wiring loop below.
  const tickHandlers = [];
  const keydownHandlers = [];
  const keyupHandlers = [];
  const mousemoveHandlers = [];
  const mousedownHandlers = [];
  const mouseupHandlers = [];
  const GLOBAL_HANDLER_LISTS = {
    tick: tickHandlers,
    keydown: keydownHandlers,
    keyup: keyupHandlers,
    mousemove: mousemoveHandlers,
    mousedown: mousedownHandlers,
    mouseup: mouseupHandlers,
  };
  for (const handler of plan.handlers) {
    if (handler.target === null) {
      GLOBAL_HANDLER_LISTS[handler.event].push(handler.body);
      continue;
    }
    const forTarget = handlersByTarget.get(handler.target) ?? {};
    forTarget[handler.event] = handler.body;
    handlersByTarget.set(handler.target, forTarget);
  }

  const handlerHooks = {
    onCustomStatement: (stmt, stmtEnv) => {
      if (stmt.kind === "AnimateDecl") return triggerAnimation(stmt, stmtEnv);
      if (stmt.kind === "PlayStmt") return playPageTimeline(stmt, stmtEnv);
      if (stmt.kind === "PauseStmt") return pausePageTimeline(stmt, stmtEnv);
      if (stmt.kind === "ResumeStmt") return resumePageTimeline(stmt, stmtEnv);
      if (stmt.kind === "ReverseStmt") return reversePageTimeline(stmt, stmtEnv);
      throw new AxisRuntimeError(`'${stmt.kind}' can't be used inside an 'on' handler`, stmt.line);
    },
  };

  async function runHandler(targetName, event) {
    const body = handlersByTarget.get(targetName)?.[event];
    if (!body) return;
    try {
      await executeBlockAsync(body, pageEnv.child(), handlerHooks);
    } catch (e) {
      if (e instanceof AxisRuntimeError) console.error(`[axis] error in 'on ${targetName}.${event}': ${e.message}`);
      else console.error(e);
    } finally {
      reRenderAll();
    }
  }

  // Runs every handler for one global event ('tick'/'keydown'/'keyup') -
  // same shape as scene3d.js's own runGlobalHandlers; see the comment
  // there for the `dt`/`key` bindings and the fire-and-forget rationale.
  async function runGlobalHandlers(handlers, eventName, extraBindings) {
    if (handlers.length === 0) return;
    for (const body of handlers) {
      const handlerEnv = pageEnv.child();
      for (const [name, value] of Object.entries(extraBindings)) handlerEnv.define(name, value, true);
      try {
        await executeBlockAsync(body, handlerEnv, handlerHooks);
      } catch (e) {
        if (e instanceof AxisRuntimeError) console.error(`[axis] error in 'on ${eventName}': ${e.message}`);
        else console.error(e);
      }
    }
    reRenderAll();
  }

  let lastTickTime = null;
  function runTickHandlers(now) {
    if (tickHandlers.length === 0) return;
    const dt = lastTickTime === null ? 0 : Math.max(0, (now - lastTickTime) / 1000);
    lastTickTime = now;
    runGlobalHandlers(tickHandlers, "tick", { dt });
  }

  // See scene3d.js's own handleKeydown/handleKeyup for the full rationale
  // ('key' is the browser's raw KeyboardEvent.key, not a normalized/"is
  // held" convenience - that's a package's job to build). Listeners are
  // only attached if this page actually declares a handler for that event.
  function handleKeydown(event) {
    runGlobalHandlers(keydownHandlers, "keydown", { key: event.key });
  }
  function handleKeyup(event) {
    runGlobalHandlers(keyupHandlers, "keyup", { key: event.key });
  }
  if (keydownHandlers.length > 0) window.addEventListener("keydown", handleKeydown);
  if (keyupHandlers.length > 0) window.addEventListener("keyup", handleKeyup);

  // See scene3d.js's own handleMousemove/handleMousedown/handleMouseup for
  // the full rationale ('dx'/'dy' are MouseEvent.movementX/movementY -
  // pixels since the last event, not an absolute position; 'button' is
  // MouseEvent.button verbatim).
  function handleMousemove(event) {
    runGlobalHandlers(mousemoveHandlers, "mousemove", { dx: event.movementX, dy: event.movementY });
  }
  function handleMousedown(event) {
    runGlobalHandlers(mousedownHandlers, "mousedown", { button: event.button });
  }
  function handleMouseup(event) {
    runGlobalHandlers(mouseupHandlers, "mouseup", { button: event.button });
  }
  if (mousemoveHandlers.length > 0) window.addEventListener("mousemove", handleMousemove);
  if (mousedownHandlers.length > 0) window.addEventListener("mousedown", handleMousedown);
  if (mouseupHandlers.length > 0) window.addEventListener("mouseup", handleMouseup);

  function attachHandlerListeners(target, el, events) {
    if (events.click) el.addEventListener("click", () => runHandler(target, "click"));
    if (events.hover) el.addEventListener("mouseenter", () => runHandler(target, "hover"));
    if (events.unhover) el.addEventListener("mouseleave", () => runHandler(target, "unhover"));
    if (events.change) el.addEventListener("input", () => runHandler(target, "change"));
    if (events.submit) {
      el.addEventListener("submit", (event) => {
        event.preventDefault();
        runHandler(target, "submit");
      });
    }
  }

  for (const [target, events] of handlersByTarget) {
    const el = elementsByName.get(target);
    if (el) attachHandlerListeners(target, el, events);
  }

  function wireDynamicHandlers(target, el, blockHandlers) {
    const events = {};
    for (const handler of blockHandlers) {
      if (handler.target === target) events[handler.event] = handler.body;
    }
    if (Object.keys(events).length === 0) return;
    const forTarget = handlersByTarget.get(target) ?? {};
    Object.assign(forTarget, events);
    handlersByTarget.set(target, forTarget);
    attachHandlerListeners(target, el, forTarget);
  }

  // ---- the shared render loop -----------------------------------------------
  function tick(now) {
    let needsMore = false;

    // Opts this page out of render-on-demand's "stop when idle" the moment
    // any 'on tick' handler exists - see scene3d.js's own runTickHandlers
    // for why this is the correct, deliberate tradeoff rather than a bug.
    if (tickHandlers.length > 0) {
      needsMore = true;
      runTickHandlers(now);
    }

    for (const anim of runningAnimations) {
      if (stepAnimation(anim, now, (target) => elementsByName.has(target), applyDomChange)) needsMore = true;
    }

    for (const [name, rt] of runningPageTimelines) {
      if (rt.driver !== "playback" || rt.finished) continue;
      needsMore = true;
      tickTimeline(rt, now, applyPageTimelineStep, () => runHandler(name, "complete"));
    }

    if (HAS_SCROLL_LINKS && now < scrollActiveUntil) {
      needsMore = true;
      for (const link of scrollLinkedTargets) {
        const progress = scrollProgressFor(link.element, link.root);
        if (progress === link.lastProgress) continue;
        link.lastProgress = progress;
        link.onProgress(progress);
      }
    }

    for (const runtime of viewportRuntimes) {
      if (runtime.tick(now)) needsMore = true;
    }

    return needsMore;
  }

  wake(); // the initial mount always needs its first frame

  // ---- public instance API -------------------------------------------------
  // The one lifecycle contract every caller (domClient.js's standalone
  // bootstrap, mount.js's embedding API, and so every framework adapter
  // built on top of that) shares - see docs/architecture/embedding.md.
  //
  // `update`: re-seeds matching top-level `state`/`let` (the same allow-list
  // the constructor's own `inputs` seeding already validated against) via
  // `scriptEnv.set` (the exact same assignment path a plain `on` handler's
  // own mutation already goes through - Environment.set, evaluator.js) and
  // triggers one `reRenderAll()`, so an update is indistinguishable from any
  // other reactive-state change.
  //
  // `on`/`off`: this instance's own event bridge - see `emit`, above.
  //
  // `destroy`: tears down everything this instance owns and nothing it
  // doesn't. Reuses existing, already-correct disposal primitives rather
  // than inventing a second one - `unmountViewport` for every mounted
  // viewport (see docs/architecture/viewport-lifecycle.md's disposal
  // guarantees), an AbortController for the scroll listener(s) this
  // instance added, and the `disposed` flag to stop this instance's own
  // render-on-demand loop from scheduling another frame (a frame already
  // in flight when destroy() is called checks `disposed` and does nothing).
  // When this instance built its own DOM (`render: true` - i.e. an
  // embedded mount, never the standalone bootstrap, which hydrates
  // server-rendered content it doesn't unilaterally own), also removes
  // every element it created from `container` and drops this instance's
  // own scope class - an event listener attached directly to a removed
  // element is not explicitly unhooked (same reasoning
  // removeReactiveNode/viewport-lifecycle.md already documents: it becomes
  // unreachable, and its listeners with it, the moment nothing references
  // it anymore).
  function update(newInputs) {
    if (disposed) return;
    for (const [key, value] of Object.entries(newInputs ?? {})) {
      if (!sharedVariableNames.includes(key)) {
        throw new AxisRuntimeError(
          `'${key}' isn't an input this component accepts${suggest(key, sharedVariableNames)}${sharedVariableNames.length ? ` - try: ${sharedVariableNames.join(", ")}` : ""}`
        );
      }
      scriptEnv.set(key, value);
    }
    reRenderAll();
  }

  // Read-only snapshot of this instance's current top-level `state`/`let`
  // values, by name - the exact inverse of `inputs`' own seeding above.
  // domRouter.js's only caller: captured right before `destroy()` on every
  // navigation, then handed to the *next* page's `createPageRuntime` as its
  // own `inputs`, so a value like `loggedInUser` a handler mutated on one
  // route is still there on the next one, instead of resetting to its
  // build-time initial value - "app/global state survives navigation" (see
  // docs/architecture/routing.md), reusing this exact seeding mechanism
  // rather than a second, router-owned store of "current global state."
  function getSharedState() {
    const out = {};
    for (const name of sharedVariableNames) out[name] = scriptEnv.get(name);
    return out;
  }

  function on(name, cb) {
    if (!listeners.has(name)) listeners.set(name, new Set());
    listeners.get(name).add(cb);
    return () => off(name, cb);
  }

  function off(name, cb) {
    listeners.get(name)?.delete(cb);
  }

  function destroy() {
    if (disposed) return;
    disposed = true;
    for (const name of [...viewportRuntimesByName.keys()]) unmountViewport(name);
    if (keydownHandlers.length > 0) window.removeEventListener("keydown", handleKeydown);
    if (keyupHandlers.length > 0) window.removeEventListener("keyup", handleKeyup);
    if (mousemoveHandlers.length > 0) window.removeEventListener("mousemove", handleMousemove);
    if (mousedownHandlers.length > 0) window.removeEventListener("mousedown", handleMousedown);
    if (mouseupHandlers.length > 0) window.removeEventListener("mouseup", handleMouseup);
    scrollAbortController.abort();
    listeners.clear();
    if (render) {
      container.replaceChildren();
      if (scopeClass) container.classList.remove(scopeClass);
    }
    elementsByName.clear();
    nodesByName.clear();
    handlersByTarget.clear();
  }

  return { update, on, off, destroy, getSharedState };
}
