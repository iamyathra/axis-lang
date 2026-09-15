// Recursive-descent parser. Turns the token list from lexer.js into an AST
// of plain objects. Each node has a `kind` field so the evaluator/interpreter
// can switch on it without needing classes.
//
// Two "flavors" of statement block exist and they share almost everything:
//   - a scene body (or an object body, since groups nest scene-like content)
//     can contain the declarative constructs (objects, animate, on) as well
//     as plain statements (let, if, while, for)
//   - a function/handler body only contains plain statements - an object
//     declaration doesn't mean anything inside a function
// Rather than duplicating the block-parsing logic, parseBlock takes which
// "entry parser" to use for its statements, and if/while/for propagate that
// same entry parser into their own nested bodies. That's the only thing that
// distinguishes "scene grammar" from "plain code" grammar.

import { AxisSyntaxError } from "./lexer.js";

const ASSIGNABLE_KINDS = new Set(["Identifier", "Member", "Index"]);
const COMPOUND_ASSIGN_OPS = { PLUSEQ: "+", MINUSEQ: "-", STAREQ: "*", SLASHEQ: "/" };

// 'on' events with no target at all - see Parser.parseOnDecl.
// 'keydown'/'keyup' give the handler body a bound `key` (see
// interpreter.js's interpretOnDecl and both renderers' key-handler wiring)
// - a raw primitive (whatever the browser's own KeyboardEvent.key says),
// deliberately not a "is this key held" convenience: that's exactly the
// kind of thing a package can build on top (see
// docs/architecture/2026-09-language-platform-audit.md's Phase G/H
// addenda), not something AXIS's own core needs an opinion on.
// 'mousemove' binds `dx`/`dy` (movement since the last event, in pixels -
// MouseEvent.movementX/movementY, works whether or not the pointer is
// locked); 'mousedown'/'mouseup' bind `button` (0/1/2 - left/middle/
// right, MouseEvent.button verbatim). Same "raw primitive, no built-in
// convenience" philosophy - no pointer-lock request, no click-and-drag
// gesture, no double-click detection; those are for a package to build,
// same as `on keydown`'s own "held key" tracker (docs/language.md's
// Keyboard input section).
const GLOBAL_ON_EVENTS = new Set(["tick", "keydown", "keyup", "mousemove", "mousedown", "mouseup"]);

export class Parser {
  constructor(tokens) {
    this.tokens = tokens;
    this.pos = 0;
    // Whether `await` is legal at this point in the grammar - true only
    // while parsing the body of an `async fn` or an `on` handler (both are
    // runtime entry points that get executed through evaluator.js's async
    // execution path; see docs/architecture/async-await.md). Left false for
    // everything else - a scene/page's own declarative body, a plain (non-
    // async) `fn`, and (deliberately, see parseAnimateDecl) an `animate`
    // block's property values, all still run through the *synchronous*
    // evaluator, which has no way to suspend.
    this.inAsyncContext = false;
  }

  peek(offset = 0) {
    return this.tokens[this.pos + offset];
  }

  next() {
    return this.tokens[this.pos++];
  }

  check(type) {
    return this.peek().type === type;
  }

  isKeyword(word, offset = 0) {
    const tok = this.peek(offset);
    return tok.type === "IDENT" && tok.value === word;
  }

  expect(type, context) {
    const tok = this.peek();
    if (tok.type !== type) {
      throw new AxisSyntaxError(
        `expected ${type}${context ? ` (${context})` : ""} but got ${tok.type}`,
        tok.line,
        tok.col
      );
    }
    return this.next();
  }

  expectKeyword(word) {
    const tok = this.peek();
    if (tok.type !== "IDENT" || tok.value !== word) {
      throw new AxisSyntaxError(`expected '${word}' but got '${tok.value ?? tok.type}'`, tok.line, tok.col);
    }
    return this.next();
  }

  // ---- top level ----------------------------------------------------

  parseProgram() {
    const items = [];
    while (!this.check("EOF")) {
      if (this.isKeyword("scene")) items.push(this.parseScene());
      else if (this.isKeyword("page")) items.push(this.parsePage());
      else if (this.isKeyword("fn")) items.push(this.parseFnDecl(false));
      else if (this.isAsyncFn()) items.push(this.parseFnDecl(true));
      else if (this.isKeyword("component")) items.push(this.parseComponentDecl());
      else if (this.isKeyword("let") || this.isKeyword("const")) items.push(this.parseLetDecl());
      // A top-level `state` is how a value gets shared, live, between every
      // scene and page in the file - see interpreter.js's `sharedVariables`
      // and docs/architecture/reactive-state.md. It reuses parseStateDecl
      // unchanged (same grammar as a page/scene-local `state`).
      else if (this.isKeyword("state")) items.push(this.parseStateDecl());
      else if (this.isKeyword("import")) items.push(this.parseImportDecl());
      else if (this.isKeyword("export")) items.push(this.parseExportDecl());
      else if (this.isKeyword("route")) items.push(this.parseRouteDecl());
      else if (this.isKeyword("redirect")) items.push(this.parseRedirectDecl());
      else {
        const tok = this.peek();
        throw new AxisSyntaxError(
          `expected 'scene', 'page', 'fn', 'async fn', 'component', 'let', 'const', 'state', 'import', 'export', 'route', or 'redirect' at the top level, got '${tok.value ?? tok.type}'`,
          tok.line,
          tok.col
        );
      }
    }
    return { kind: "Program", items, closeLine: this.peek().line };
  }

  // `async fn name(...) { ... }` - two soft keywords in a row, so this is a
  // one-token lookahead rather than a new grammar production: `async` isn't
  // meaningful by itself anywhere else in AXIS.
  isAsyncFn() {
    return this.isKeyword("async") && this.peek(1).type === "IDENT" && this.peek(1).value === "fn";
  }

  // `export` is a modifier, not its own declaration - it just tags whatever
  // reusable top-level thing follows so modules.js knows it's importable.
  // `scene`/`page` are entry points, not reusable units, so exporting one
  // is a clear error rather than something modules.js has to reject later.
  parseExportDecl() {
    const start = this.expectKeyword("export");
    let item;
    if (this.isKeyword("fn")) item = this.parseFnDecl(false);
    else if (this.isAsyncFn()) item = this.parseFnDecl(true);
    else if (this.isKeyword("component")) item = this.parseComponentDecl();
    else if (this.isKeyword("let") || this.isKeyword("const")) item = this.parseLetDecl();
    else {
      const tok = this.peek();
      throw new AxisSyntaxError(
        `'export' can only be used on 'fn', 'async fn', 'component', 'let', or 'const', got '${tok.value ?? tok.type}'`,
        tok.line,
        tok.col
      );
    }
    item.exported = true;
    item.line = start.line;
    return item;
  }

  // One name per import, no destructuring/aliasing - `import Name from
  // "./path.ax"` binds whatever `Name` exports under that same name.
  parseImportDecl() {
    const start = this.expectKeyword("import");
    const name = this.expect("IDENT", "imported name").value;
    this.expectKeyword("from");
    const path = this.expect("STRING", "module path").value;
    return { kind: "ImportDecl", name, path, line: start.line };
  }

  // `route "/projects/:id" Project` - maps a URL path pattern to a `page`
  // declared elsewhere in this file, by its own name. A route's page must
  // have a plain identifier title (`page Project { ... }`, not `page "My
  // Site" { ... }`) - there'd be no valid token to write here for a
  // string-titled one, and interpreter.js gives a clear error if the name
  // doesn't match any declared page. `"*"` is the one special pattern - a
  // catch-all for anything no other route matched (see router.js's
  // matchRoute, which always checks it last regardless of where it's
  // declared) - the conventional way to wire up a 404 page.
  parseRouteDecl() {
    const start = this.expectKeyword("route");
    const pattern = this.expect("STRING", "route pattern").value;
    const pageName = this.expect("IDENT", "page name").value;
    return { kind: "RouteDecl", pattern, pageName, line: start.line };
  }

  // `redirect "/old" "/new"` - when the first path matches (same pattern
  // grammar as `route`, dynamic `:segments` included), the router replaces
  // the URL with the second immediately, without ever mounting a page.
  parseRedirectDecl() {
    const start = this.expectKeyword("redirect");
    const from = this.expect("STRING", "redirect source pattern").value;
    const to = this.expect("STRING", "redirect target path").value;
    return { kind: "RedirectDecl", from, to, line: start.line };
  }

  parseComponentDecl() {
    const start = this.expectKeyword("component");
    const name = this.expect("IDENT", "component name").value;
    this.expect("LPAREN");
    const params = [];
    if (!this.check("RPAREN")) {
      params.push(this.expect("IDENT", "parameter name").value);
      while (this.check("COMMA")) {
        this.next();
        params.push(this.expect("IDENT", "parameter name").value);
      }
    }
    this.expect("RPAREN");
    // a component body is declarative, same grammar a scene/page body
    // uses (object decls, state/let, on, animate, if/for/while, and -
    // since parseSceneEntry treats an unrecognized IDENT as an object
    // decl - nested component instantiation for free).
    const body = this.parseBlock((p) => p.parseSceneEntry());
    return { kind: "ComponentDecl", name, params, body, line: start.line };
  }

  // `isAsync` - whether this is `async fn` (the caller already consumed and
  // checked for the 'async' keyword via isAsyncFn) - only changes two
  // things: it's recorded on the AST node (interpreter.js carries it onto
  // the resulting function value, evaluator.js's callFunction refuses to
  // call one synchronously), and it's the one thing (besides an `on`
  // handler body) that makes `await` legal inside this body - see
  // `inAsyncContext`.
  parseFnDecl(isAsync) {
    if (isAsync) this.expectKeyword("async");
    const start = this.expectKeyword("fn");
    const name = this.expect("IDENT", "function name").value;
    this.expect("LPAREN");
    const params = [];
    if (!this.check("RPAREN")) {
      params.push(this.expect("IDENT", "parameter name").value);
      while (this.check("COMMA")) {
        this.next();
        params.push(this.expect("IDENT", "parameter name").value);
      }
    }
    this.expect("RPAREN");
    const prevAsync = this.inAsyncContext;
    this.inAsyncContext = isAsync;
    const body = this.parseBlock((p) => p.parsePlainStatement());
    this.inAsyncContext = prevAsync;
    return { kind: "FnDecl", name, params, body, isAsync, line: start.line };
  }

  // An anonymous function value - `fn(x) { return x * 2 }`, or
  // `async fn(x) { await ... }` - usable anywhere an expression is (a
  // 'map'/'filter'/'sortBy'/... callback, a let's value, a call argument,
  // ...), unlike a named `fn` declaration (parseFnDecl), which only exists
  // at the top level of a program. Same params/body grammar, just no name.
  // Evaluated as a real closure over whatever environment is in scope where
  // it's written - see evaluator.js's "FnExpr" case.
  parseFnExpr() {
    const isAsync = this.isAsyncFn();
    if (isAsync) this.expectKeyword("async");
    const start = this.expectKeyword("fn");
    this.expect("LPAREN");
    const params = [];
    if (!this.check("RPAREN")) {
      params.push(this.expect("IDENT", "parameter name").value);
      while (this.check("COMMA")) {
        this.next();
        params.push(this.expect("IDENT", "parameter name").value);
      }
    }
    this.expect("RPAREN");
    const prevAsync = this.inAsyncContext;
    this.inAsyncContext = isAsync;
    const body = this.parseBlock((p) => p.parsePlainStatement());
    this.inAsyncContext = prevAsync;
    return { kind: "FnExpr", params, body, isAsync, line: start.line };
  }

  parseScene() {
    const start = this.expectKeyword("scene");
    const name = this.expect("IDENT", "scene name").value;
    const body = this.parseBlock((p) => p.parseSceneEntry());
    return { kind: "SceneDecl", name, body, line: start.line };
  }

  // A page is the web-document sibling of a scene - same declarative body
  // grammar (parseSceneEntry is domain-agnostic: object decls, properties,
  // animate, on, plus plain let/if/while/for), just a different top-level
  // keyword and a title that can be a plain identifier or a string ("My
  // Site"), since a web page's title is naturally a string, not a variable
  // name.
  parsePage() {
    const start = this.expectKeyword("page");
    const titleIsString = this.check("STRING");
    const title = titleIsString ? this.next().value : this.expect("IDENT", "page name").value;
    const body = this.parseBlock((p) => p.parseSceneEntry());
    // `titleIsString` is purely informational (interpreter.js only ever
    // reads `.title`) - kept so src/format.js can round-trip `page "Home"`
    // as written instead of always collapsing to the otherwise-identical
    // `page Home`, the same reason Assignment carries `compoundOp`.
    return { kind: "PageDecl", title, titleIsString, body, line: start.line };
  }

  // ---- blocks ---------------------------------------------------------
  // `parseEntry` is a (parser) => node function - either parseSceneEntry or
  // parsePlainStatement - and it's what makes a block "scene-shaped" or
  // "plain code"-shaped.

  parseBlock(parseEntry) {
    this.expect("LBRACE");
    const statements = [];
    while (!this.check("RBRACE")) {
      statements.push(parseEntry(this));
    }
    const close = this.expect("RBRACE");
    // `closeLine` (the closing '}'s own line) is an extra, non-index
    // property on the plain array every existing consumer already treats
    // `statements` as - invisible to `for..of`/`.map`/JSON.stringify, so
    // every current caller is unaffected. It exists only so src/format.js
    // knows where a block *ends*, not just where its own children start
    // (their `.line`), which is what lets it correctly decide whether a
    // comment near the end of a block belongs inside it (before the '}')
    // or after it (before the next sibling in the parent block).
    statements.closeLine = close.line;
    return statements;
  }

  // ---- scene-flavored entries ------------------------------------------
  // Anything that can appear directly inside `scene NAME { ... }` or inside
  // an object body (since `group` nests scene-like content). This includes
  // the declarative constructs (objects, animate, on) plus plain statements
  // (let/if/while/for) for procedural scenes.

  parseSceneEntry() {
    if (this.isKeyword("let") || this.isKeyword("const")) return this.parseLetDecl();
    if (this.isKeyword("state")) return this.parseStateDecl();
    if (this.isKeyword("if")) return this.parseIfStmt((p) => p.parseSceneEntry());
    if (this.isKeyword("while")) return this.parseWhileStmt((p) => p.parseSceneEntry());
    if (this.isKeyword("for")) return this.parseForStmt((p) => p.parseSceneEntry());
    if (this.isKeyword("animate")) return this.parseAnimateDecl();
    if (this.isKeyword("on")) return this.parseOnDecl();
    if (this.isKeyword("timeline")) return this.parseTimelineDecl();

    const tok = this.peek();
    if (tok.type !== "IDENT") {
      throw new AxisSyntaxError(`unexpected token '${tok.type}' in a scene body`, tok.line, tok.col);
    }

    const after = this.peek(1);
    if (after.type === "COLON" || after.type === "DOT") return this.parseProperty();
    if (after.type === "IDENT" || after.type === "LBRACE" || after.type === "LPAREN") return this.parseObjectDecl();

    throw new AxisSyntaxError(`unexpected token after '${tok.value}' in a scene body`, after.line, after.col);
  }

  parseProperty() {
    const line = this.peek().line;
    const path = this.parsePath();
    this.expect("COLON", `after '${path.join(".")}'`);
    const value = this.parseExpression();
    // `line` (the property's own first token) is purely informational -
    // nothing in interpreter.js/evaluator.js reads it (they use the
    // *value* expression's own `.line` for error locations instead) - it
    // exists only so src/format.js can correctly place a comment that
    // appeared right before this property, rather than losing track of
    // position entirely (a Property node previously carried no line at
    // all).
    return { kind: "Property", path, value, line };
  }

  parseObjectDecl() {
    const typeTok = this.expect("IDENT", "object type");
    let name = null;
    let nameIsExpr = false;

    if (this.check("IDENT")) {
      name = this.next().value;
    } else if (this.check("LPAREN")) {
      this.next();
      name = this.parseExpression();
      this.expect("RPAREN");
      nameIsExpr = true;
    }

    const entries = this.parseBlock((p) => p.parseSceneEntry());
    const properties = entries.filter((e) => e.kind === "Property");
    const children = entries.filter((e) => e.kind !== "Property");

    return {
      kind: "ObjectDecl",
      objectType: typeTok.value,
      name,
      nameIsExpr,
      properties,
      children,
      bodyCloseLine: entries.closeLine,
      line: typeTok.line,
    };
  }

  // `animate box { ... }` / `on box.click { ... }` and their computed forms
  // `animate (expr) { ... }` / `on (expr).click { ... }` - same idea as an
  // object declaration's own name/nameIsExpr (parseObjectDecl, above),
  // just under target/targetIsExpr since "target" is what interpreter.js
  // already calls it. A bare name stays a plain string so the common case
  // never pays for being wrapped in an AST node.
  parseTarget(what) {
    if (this.check("LPAREN")) {
      this.next();
      const target = this.parseExpression();
      this.expect("RPAREN");
      return { target, targetIsExpr: true };
    }
    return { target: this.expect("IDENT", what).value, targetIsExpr: false };
  }

  // An `animate` block's property values are always evaluated through the
  // *synchronous* evaluator, on both its paths - build time (plays-on-load,
  // interpreter.js) and live-trigger (client.js/pageRuntime.js's
  // triggerAnimation, called from hooks.onCustomStatement, which never goes
  // through the async execution path even when the enclosing `on` handler
  // does). `await` inside one would parse but then fail confusingly deep
  // inside a runtime that can't suspend - so it's rejected right here,
  // consistently, regardless of whether this `animate` sits at scene/page
  // top level or as a trigger inside an already-async `on` handler.
  parseAnimateDecl() {
    const start = this.expectKeyword("animate");
    const prevAsync = this.inAsyncContext;
    this.inAsyncContext = false;
    const { target, targetIsExpr } = this.parseTarget("animate target name");
    this.expect("LBRACE");
    const entries = [];
    while (!this.check("RBRACE")) {
      const line = this.peek().line;
      const path = this.parsePath();
      if (this.check("ARROW")) {
        this.next();
        const to = this.parseExpression();
        entries.push({ kind: "AnimateTarget", path, to, line });
      } else {
        this.expect("COLON", `after '${path.join(".")}'`);
        const value = this.parseExpression();
        entries.push({ kind: "Property", path, value, line });
      }
    }
    const close = this.expect("RBRACE");
    this.inAsyncContext = prevAsync;
    return { kind: "AnimateDecl", target, targetIsExpr, entries, bodyCloseLine: close.line, line: start.line };
  }

  // An `on` handler body always runs through evaluator.js's async execution
  // path at runtime (pageRuntime.js/scene3d.js's runHandler), the same way a
  // browser DOM event listener can just be `async (e) => {}` with no special
  // declaration - so, unlike a plain `fn`, it doesn't need an `async`
  // keyword of its own for `await` to be legal inside it.
  // 'on tick { ... }' - a global, per-frame handler, not tied to any
  // object (see docs/language.md's "Per-frame updates" section). Checked
  // before the ordinary 'on TARGET.EVENT' grammar below: a bare 'tick'
  // immediately followed by '{' (not '.') is this form; 'tick.click { ... }'
  // (an object actually named "tick") still falls through to the ordinary
  // path below untouched, since the next token there is DOT, not LBRACE.
  isGlobalOnEvent() {
    return this.peek().type === "IDENT" && GLOBAL_ON_EVENTS.has(this.peek().value) && this.peek(1).type === "LBRACE";
  }

  parseOnDecl() {
    const start = this.expectKeyword("on");
    const prevAsync = this.inAsyncContext;
    this.inAsyncContext = true;
    if (this.isGlobalOnEvent()) {
      const event = this.next().value;
      const body = this.parseBlock((p) => p.parsePlainStatement());
      this.inAsyncContext = prevAsync;
      return { kind: "OnDecl", target: null, targetIsExpr: false, event, body, line: start.line };
    }
    const { target, targetIsExpr } = this.parseTarget("interaction target name");
    this.expect("DOT");
    const event = this.expect("IDENT", "event name").value;
    const body = this.parseBlock((p) => p.parsePlainStatement());
    this.inAsyncContext = prevAsync;
    return { kind: "OnDecl", target, targetIsExpr, event, body, line: start.line };
  }

  // `timeline NAME { ... }` - a named, ordered choreography of `animate`
  // steps, always a top-level scene entry (unlike `animate`, a timeline
  // can't be declared inline inside an `on` handler - see `play`, below,
  // for how a handler re-triggers an already-declared one). Its body reuses
  // `animate`'s own grammar for each step, plus `label` (a named point on
  // the timeline's own clock) and ordinary let/if/while/for for procedural
  // choreography (stagger is just a `for` loop - see docs/language.md).
  parseTimelineDecl() {
    const start = this.expectKeyword("timeline");
    const name = this.expect("IDENT", "timeline name").value;
    const body = this.parseBlock((p) => p.parseTimelineEntry());
    return { kind: "TimelineDecl", name, body, line: start.line };
  }

  parseTimelineEntry() {
    if (this.isKeyword("label")) return this.parseLabelDecl();
    if (this.isKeyword("let") || this.isKeyword("const")) return this.parseLetDecl();
    if (this.isKeyword("if")) return this.parseIfStmt((p) => p.parseTimelineEntry());
    if (this.isKeyword("while")) return this.parseWhileStmt((p) => p.parseTimelineEntry());
    if (this.isKeyword("for")) return this.parseForStmt((p) => p.parseTimelineEntry());
    if (this.isKeyword("animate")) return this.parseAnimateDecl();
    if (this.check("IDENT") && this.peek(1).type === "COLON") return this.parseTimelinePropertyDecl();
    const tok = this.peek();
    throw new AxisSyntaxError(
      `expected 'animate', 'label', 'let', 'const', 'if', 'while', 'for', or a property like 'loop: true' inside a timeline, got '${tok.value ?? tok.type}'`,
      tok.line,
      tok.col
    );
  }

  // A bare `key: value` property at a timeline's own top level - currently
  // only `loop` (see interpreter.js's interpretTimelineDecl), but parsed
  // generically the same way every other "parse the shape, validate the
  // name in the interpreter" property in this language is, not hardcoded
  // to one specific keyword here. Distinguished from `label NAME` (no
  // colon) and from an `animate` step's own entries (nested one level
  // deeper, inside `animate TARGET { ... }`) by being a bare `IDENT COLON
  // expr` at the timeline's own top level.
  parseTimelinePropertyDecl() {
    const tok = this.expect("IDENT", "timeline property name");
    this.expect("COLON", `after '${tok.value}'`);
    const value = this.parseExpression();
    return { kind: "TimelineProperty", name: tok.value, value, line: tok.line };
  }

  // `label NAME` - binds NAME, for the rest of this timeline, to the
  // timeline's own running cursor time (a plain number of milliseconds) at
  // the point it's declared - see interpreter.js's interpretTimelineDecl.
  // A real AXIS variable, not a string tag: `at: heroReveal + 200` is just
  // ordinary arithmetic, not a second timing language.
  parseLabelDecl() {
    const start = this.expectKeyword("label");
    const name = this.expect("IDENT", "label name").value;
    return { kind: "LabelDecl", name, line: start.line };
  }

  // `play NAME` - (re)starts an already-declared `timeline` from its own
  // beginning. A plain statement, so it works inside an `on` handler (or an
  // if/while/for nested in one), the same target-name grammar (bare or
  // computed) `animate`/`on` already use.
  //
  // `play CLIP on TARGET` - the model-clip sibling of the above, disambiguated
  // for free: both forms start by parsing one `parseTarget` (a timeline name,
  // or a clip name - the exact same bare-or-computed grammar covers both,
  // since a clip name is just as much an opaque string as a timeline name
  // is), and only the clip form is followed by the keyword `on`. No
  // backtracking needed - `on` can never legally follow a bare `play NAME`
  // statement (a new statement starts there instead), so seeing it is an
  // unambiguous signal to keep parsing the second target. See
  // interpreter.js's renameIdentifiers (PlayClipStmt/StopClipStmt cases) and
  // scene3d.js's playClip/stopClip for the runtime half.
  parsePlayStmt() {
    const start = this.expectKeyword("play");
    const { target: first, targetIsExpr: firstIsExpr } = this.parseTarget("timeline or clip name");
    if (this.isKeyword("on")) {
      this.next();
      const { target, targetIsExpr } = this.parseTarget("model name");
      return { kind: "PlayClipStmt", clip: first, clipIsExpr: firstIsExpr, target, targetIsExpr, line: start.line };
    }
    return { kind: "PlayStmt", target: first, targetIsExpr: firstIsExpr, line: start.line };
  }

  // `stop TARGET` - pauses whichever animation clip is currently playing on
  // a `model`, freezing it at its current pose (not resetting to frame 0) -
  // see scene3d.js's stopClip for exactly what "stop" means at runtime.
  parseStopStmt() {
    const start = this.expectKeyword("stop");
    const { target, targetIsExpr } = this.parseTarget("model name");
    return { kind: "StopClipStmt", target, targetIsExpr, line: start.line };
  }

  // `pause NAME`/`resume NAME`/`reverse NAME` - playback controls for an
  // already-declared `timeline`, the same target-name grammar (bare or
  // computed) `play` already uses. `pause` freezes it at its current
  // elapsed position (not reset to 0, the same "freeze in place" idea
  // `stop` already has for a model's clip); `resume` continues it from
  // there; `reverse` flips which direction it's currently advancing in,
  // in place, without restarting. See scene3d.js/domClient.js for exactly
  // what each means at runtime, and docs/language.md's Timelines section.
  parsePauseStmt() {
    const start = this.expectKeyword("pause");
    const { target, targetIsExpr } = this.parseTarget("timeline name");
    return { kind: "PauseStmt", target, targetIsExpr, line: start.line };
  }

  parseResumeStmt() {
    const start = this.expectKeyword("resume");
    const { target, targetIsExpr } = this.parseTarget("timeline name");
    return { kind: "ResumeStmt", target, targetIsExpr, line: start.line };
  }

  parseReverseStmt() {
    const start = this.expectKeyword("reverse");
    const { target, targetIsExpr } = this.parseTarget("timeline name");
    return { kind: "ReverseStmt", target, targetIsExpr, line: start.line };
  }

  parsePath() {
    const parts = [this.expect("IDENT", "property name").value];
    while (this.check("DOT")) {
      this.next();
      parts.push(this.expect("IDENT", "path segment").value);
    }
    return parts;
  }

  // ---- plain-code statements --------------------------------------------
  // Function bodies, `on` handler bodies, and if/while/for bodies nested
  // inside those all use this - no object/on declarations here, just
  // ordinary code, plus `animate` (a trigger, not a declaration, in this
  // context - see the note on that branch below).

  parsePlainStatement() {
    if (this.isKeyword("let") || this.isKeyword("const")) return this.parseLetDecl();
    if (this.isKeyword("if")) return this.parseIfStmt((p) => p.parsePlainStatement());
    if (this.isKeyword("while")) return this.parseWhileStmt((p) => p.parsePlainStatement());
    if (this.isKeyword("for")) return this.parseForStmt((p) => p.parsePlainStatement());
    if (this.isKeyword("return")) return this.parseReturnStmt();
    if (this.isKeyword("try")) return this.parseTryStmt();
    // Same `animate target { ... }` grammar as a top-level scene/page entry,
    // just usable inside an `on` handler (or an if/while/for nested in one)
    // too - here it's not "play automatically on load" but "play now",
    // triggered the moment this statement actually runs. See interpreter.js
    // (renameIdentifiers' AnimateDecl case) and client.js/domClient.js
    // (triggerAnimation) for the two halves of what makes that true.
    if (this.isKeyword("animate")) return this.parseAnimateDecl();
    if (this.isKeyword("play")) return this.parsePlayStmt();
    if (this.isKeyword("stop")) return this.parseStopStmt();
    if (this.isKeyword("pause")) return this.parsePauseStmt();
    if (this.isKeyword("resume")) return this.parseResumeStmt();
    if (this.isKeyword("reverse")) return this.parseReverseStmt();

    // A record literal is a value, not a statement - `{ color: red }` sitting
    // on its own only ever means something as a value assigned or passed
    // somewhere (`let x = { ... }`, `return { ... }`, an argument, ...), all
    // of which reach parseExpression from somewhere other than here. Bare
    // like this it's virtually always a mistake - most commonly leftover
    // object-declaration syntax (`cube box { ... }`) typo'd inside a plain
    // function/handler body, where that grammar doesn't exist.
    if (this.check("LBRACE")) {
      const tok = this.peek();
      throw new AxisSyntaxError("a record literal can't be used as a statement by itself - assign it to something, e.g. 'let x = { ... }'", tok.line, tok.col);
    }

    const line = this.peek().line;
    const expr = this.parseExpression();
    if (this.check("EQ")) {
      if (!ASSIGNABLE_KINDS.has(expr.kind)) {
        throw new AxisSyntaxError("the left side of '=' isn't something you can assign to", line, this.peek().col);
      }
      this.next();
      const value = this.parseExpression();
      return { kind: "Assignment", target: expr, value, line };
    }
    const compoundOp = COMPOUND_ASSIGN_OPS[this.peek().type];
    if (compoundOp) {
      if (!ASSIGNABLE_KINDS.has(expr.kind)) {
        throw new AxisSyntaxError(`the left side of '${this.peek().value}' isn't something you can assign to`, line, this.peek().col);
      }
      const opTok = this.next();
      const rhs = this.parseExpression();
      const value = { kind: "Binary", op: compoundOp, left: expr, right: rhs, line: opTok.line };
      // `compoundOp` is purely informational - evaluator.js only ever reads
      // `.target`/`.value` off an Assignment (the desugared Binary already
      // has the real semantics) - kept so a tool that reprints source (see
      // src/format.js) can tell "x += 1" apart from the otherwise-identical
      // AST a literal "x = x + 1" produces, and round-trip the one the
      // author actually wrote instead of always expanding it.
      return { kind: "Assignment", target: expr, value, compoundOp, line };
    }
    return { kind: "ExprStmt", expr, line };
  }

  parseLetDecl() {
    const kw = this.next(); // 'let' or 'const'
    const name = this.expect("IDENT", "variable name").value;
    this.expect("EQ");
    const value = this.parseExpression();
    return { kind: "LetDecl", name, value, constant: kw.value === "const", line: kw.line };
  }

  // `state` is always mutable (that's the whole point - a reactive value a
  // page's bound properties re-read after it changes), so unlike
  // let/const there's no `const state` variant.
  parseStateDecl() {
    const kw = this.expectKeyword("state");
    const name = this.expect("IDENT", "variable name").value;
    this.expect("EQ");
    const value = this.parseExpression();
    return { kind: "StateDecl", name, value, line: kw.line };
  }

  parseIfStmt(parseEntry) {
    const start = this.expectKeyword("if");
    this.expect("LPAREN");
    const condition = this.parseExpression();
    this.expect("RPAREN");
    const thenBranch = this.parseBlock(parseEntry);
    let elseBranch = null;
    if (this.isKeyword("else")) {
      this.next();
      elseBranch = this.isKeyword("if") ? [this.parseIfStmt(parseEntry)] : this.parseBlock(parseEntry);
    }
    return { kind: "IfStmt", condition, then: thenBranch, else: elseBranch, line: start.line };
  }

  parseWhileStmt(parseEntry) {
    const start = this.expectKeyword("while");
    this.expect("LPAREN");
    const condition = this.parseExpression();
    this.expect("RPAREN");
    const body = this.parseBlock(parseEntry);
    return { kind: "WhileStmt", condition, body, line: start.line };
  }

  parseForStmt(parseEntry) {
    const start = this.expectKeyword("for");
    const varName = this.expect("IDENT", "loop variable name").value;
    this.expectKeyword("in");
    const iterable = this.parseExpression();
    const body = this.parseBlock(parseEntry);
    return { kind: "ForStmt", varName, iterable, body, line: start.line };
  }

  parseReturnStmt() {
    const start = this.expectKeyword("return");
    let value = null;
    if (!this.check("RBRACE")) value = this.parseExpression();
    return { kind: "ReturnStmt", value, line: start.line };
  }

  // `try { ... } catch (err) { ... }` - general-purpose error handling, not
  // tied to async/await (a plain out-of-range array index is just as
  // catchable), but most useful alongside it: `await api.get(...)` failing
  // (a network error, a non-2xx status) is the main reason this exists at
  // all. `err` is bound, inside the catch block only, to the failing
  // error's message as a plain string - see evaluator.js's TryStmt case for
  // exactly what gets caught (never a `return`'s own control-flow signal).
  parseTryStmt() {
    const start = this.expectKeyword("try");
    const tryBlock = this.parseBlock((p) => p.parsePlainStatement());
    this.expectKeyword("catch");
    this.expect("LPAREN");
    const errName = this.expect("IDENT", "catch parameter name").value;
    this.expect("RPAREN");
    const catchBlock = this.parseBlock((p) => p.parsePlainStatement());
    return { kind: "TryStmt", tryBlock, errName, catchBlock, line: start.line };
  }

  // ---- expressions (precedence climbing, low to high) -------------------

  // The one place `?`/`:` combine into a ternary - checked here, above
  // `||`, so a ternary's own condition/branches can freely contain any
  // looser-than-`?:`-nowhere-applicable operator without parens, while a
  // ternary used as an *operand* of something tighter (a `+`, a unary `-`,
  // a call argument's containing expression, ...) still goes through
  // parseExpression too, since every one of those eventually bottoms out
  // here for its own operands - it just never needs to, because a bare
  // ternary is already legal virtually everywhere an expression is.
  // Right-associative by construction: both branches recurse into
  // parseExpression (not parseOr), so 'a ? b : c ? d : e' reads as
  // 'a ? b : (c ? d : e)', and 'a ? b ? c : d : e' reads as
  // 'a ? (b ? c : d) : e' - the inner ternary's own ':' is consumed before
  // control returns here to look for the outer one.
  parseExpression() {
    const condition = this.parseOr();
    if (!this.check("QUESTION")) return condition;
    this.next();
    const thenExpr = this.parseExpression();
    this.expect("COLON", "in a ternary expression ('a ? b : c')");
    const elseExpr = this.parseExpression();
    return { kind: "Ternary", condition, then: thenExpr, else: elseExpr, line: condition.line };
  }

  parseOr() {
    let left = this.parseAnd();
    while (this.check("OR")) {
      const op = this.next();
      left = { kind: "Binary", op: "||", left, right: this.parseAnd(), line: op.line };
    }
    return left;
  }

  parseAnd() {
    let left = this.parseEquality();
    while (this.check("AND")) {
      const op = this.next();
      left = { kind: "Binary", op: "&&", left, right: this.parseEquality(), line: op.line };
    }
    return left;
  }

  parseEquality() {
    let left = this.parseRelational();
    while (this.check("EQEQ") || this.check("BANGEQ")) {
      const op = this.next();
      left = { kind: "Binary", op: op.value, left, right: this.parseRelational(), line: op.line };
    }
    return left;
  }

  parseRelational() {
    let left = this.parseAdditive();
    while (this.check("LT") || this.check("LTE") || this.check("GT") || this.check("GTE")) {
      const op = this.next();
      left = { kind: "Binary", op: op.value, left, right: this.parseAdditive(), line: op.line };
    }
    return left;
  }

  parseAdditive() {
    let left = this.parseMultiplicative();
    while (this.check("PLUS") || this.check("MINUS")) {
      const op = this.next();
      left = { kind: "Binary", op: op.value, left, right: this.parseMultiplicative(), line: op.line };
    }
    return left;
  }

  parseMultiplicative() {
    let left = this.parseUnary();
    while (this.check("STAR") || this.check("SLASH") || this.check("PERCENT")) {
      const op = this.next();
      left = { kind: "Binary", op: op.value, left, right: this.parseUnary(), line: op.line };
    }
    return left;
  }

  parseUnary() {
    if (this.isKeyword("await")) {
      const tok = this.next();
      if (!this.inAsyncContext) {
        throw new AxisSyntaxError(
          "'await' can only be used inside an 'async fn' or an 'on' handler",
          tok.line,
          tok.col
        );
      }
      return { kind: "Await", operand: this.parseUnary(), line: tok.line };
    }
    if (this.check("BANG") || this.check("MINUS")) {
      const op = this.next();
      return { kind: "Unary", op: op.value, operand: this.parseUnary(), line: op.line };
    }
    return this.parsePostfix();
  }

  parsePostfix() {
    let expr = this.parsePrimary();
    for (;;) {
      if (this.check("LPAREN")) {
        const start = this.next();
        const args = [];
        if (!this.check("RPAREN")) {
          args.push(this.parseExpression());
          while (this.check("COMMA")) {
            this.next();
            args.push(this.parseExpression());
          }
        }
        this.expect("RPAREN");
        expr = { kind: "Call", callee: expr, args, line: start.line };
      } else if (this.check("DOT")) {
        this.next();
        const prop = this.expect("IDENT", "property name");
        expr = { kind: "Member", object: expr, property: prop.value, line: prop.line };
      } else if (this.check("LBRACKET")) {
        const start = this.next();
        const index = this.parseExpression();
        this.expect("RBRACKET");
        expr = { kind: "Index", object: expr, index, line: start.line };
      } else {
        break;
      }
    }
    return expr;
  }

  parsePrimary() {
    const tok = this.peek();

    // An anonymous function value - checked before the generic IDENT
    // branch below, since 'fn'/'async' are ordinary IDENT tokens (AXIS has
    // no reserved-word token type) and would otherwise just become a bare
    // Identifier named "fn".
    if (this.isKeyword("fn") || this.isAsyncFn()) return this.parseFnExpr();

    if (tok.type === "NUMBER") {
      this.next();
      return { kind: "Number", value: tok.value, unit: tok.unit, line: tok.line };
    }

    if (tok.type === "STRING") {
      this.next();
      return { kind: "String", value: tok.value, line: tok.line };
    }

    if (tok.type === "IDENT") {
      if (tok.value === "true" || tok.value === "false") {
        this.next();
        return { kind: "Boolean", value: tok.value === "true", line: tok.line };
      }
      if (tok.value === "null") {
        this.next();
        return { kind: "Null", line: tok.line };
      }
      this.next();
      return { kind: "Identifier", value: tok.value, line: tok.line };
    }

    if (tok.type === "LPAREN") {
      this.next();
      const items = [this.parseExpression()];
      while (this.check("COMMA")) {
        this.next();
        items.push(this.parseExpression());
      }
      this.expect("RPAREN");
      return items.length === 1 ? items[0] : { kind: "Vector", items, line: tok.line };
    }

    if (tok.type === "LBRACKET") {
      this.next();
      const items = [];
      if (!this.check("RBRACKET")) {
        items.push(this.parseExpression());
        while (this.check("COMMA")) {
          this.next();
          items.push(this.parseExpression());
        }
      }
      this.expect("RBRACKET");
      return { kind: "Array", items, line: tok.line };
    }

    if (tok.type === "LBRACE") return this.parseRecordLiteral();

    throw new AxisSyntaxError(`unexpected token in an expression: ${tok.type}`, tok.line, tok.col);
  }

  // A record literal - `{ name: "Earth", radius: 1 }` - only ever shows up
  // in expression position (a property value, an array item, a call
  // argument, ...), which parsePrimary only gets invoked for, so there's no
  // ambiguity with the `{ ... }` block grammar scene/page/component/function
  // bodies use (those are parsed by parseBlock, never by an expression
  // parser). Commas between fields are optional, same relaxed style AXIS
  // already uses for property lists inside an object declaration - a field
  // per line reads just as clearly without them.
  parseRecordLiteral() {
    const start = this.expect("LBRACE");
    const fields = [];
    const seen = new Set();
    while (!this.check("RBRACE")) {
      const keyTok = this.expect("IDENT", "record field name");
      if (seen.has(keyTok.value)) {
        throw new AxisSyntaxError(`duplicate field '${keyTok.value}' in record literal`, keyTok.line, keyTok.col);
      }
      seen.add(keyTok.value);
      this.expect("COLON", `after '${keyTok.value}'`);
      const value = this.parseExpression();
      fields.push({ key: keyTok.value, value });
      if (this.check("COMMA")) this.next();
    }
    this.expect("RBRACE");
    return { kind: "Record", fields, line: start.line };
  }
}

export function parse(tokens) {
  return new Parser(tokens).parseProgram();
}
