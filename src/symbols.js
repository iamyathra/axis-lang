// A reusable symbol index over the real parser AST - the one thing
// `axis inspect`, go-to-definition, and document-symbol support (LSP) all
// build on, so there's exactly one place that knows what counts as a
// "symbol" in AXIS. No second grammar, no invented symbol kinds - every
// kind here is a real, named AXIS declaration (see docs/language.md):
// scene, page, component, fn, route, top-level let/const/state, and,
// nested inside a scene/page/component body, an object declaration (a
// `cube`/`container`/... with a name) and a `timeline`.
//
// A symbol's `line` is where it's declared; `endLine` (when the
// declaration has a body) is parser.js's own `closeLine`/`bodyCloseLine` -
// together they're the line RANGE definitionLookup.js uses to decide which
// symbol table a given cursor line's identifier should resolve against
// (see that file for why plain line-range scoping, not full block
// scoping, is what AXIS's grammar actually needs).

// Statement kinds that can themselves contain nested scene-entry content
// worth walking into for symbols, even though they aren't symbols
// themselves (an `if`/`while`/`for` is control flow, not a declaration).
function childBodiesOf(entry) {
  switch (entry.kind) {
    case "IfStmt":
      // Two separate bodies, not one flattened list - `else` may itself be
      // `[nestedIfStmt]` (an `else if` chain), which the generic recursion
      // below already handles correctly as "a body containing one IfStmt
      // entry," the same way it handles any other body.
      return [entry.then, entry.else].filter(Boolean);
    case "WhileStmt":
    case "ForStmt":
      return [entry.body];
    default:
      return [];
  }
}

// Walks a scene/page/component body (or an object's own children, or a
// control-flow body nested inside one), collecting ObjectDecl/TimelineDecl
// symbols at any depth - flattening past `if`/`while`/`for` wrappers (they
// aren't symbols) but stopping at a nested ObjectDecl's own children,
// which become *that* symbol's own child list instead of this one's.
function collectSceneSymbols(entries) {
  const symbols = [];
  for (const entry of entries) {
    if (entry.kind === "ObjectDecl") {
      if (entry.name != null && !entry.nameIsExpr) {
        symbols.push({
          name: entry.name,
          kind: "object",
          objectType: entry.objectType,
          line: entry.line,
          endLine: entry.bodyCloseLine ?? entry.line,
          children: collectSceneSymbols(entry.children),
        });
      } else {
        // an unnamed/computed-name object (`(expr) { ... }`) can't be
        // referenced by name, so it isn't a symbol itself - but whatever
        // it nests can still be walked for its own named children.
        symbols.push(...collectSceneSymbols(entry.children));
      }
    } else if (entry.kind === "TimelineDecl") {
      symbols.push({ name: entry.name, kind: "timeline", line: entry.line, endLine: entry.body.closeLine ?? entry.line, children: [] });
    } else {
      for (const body of childBodiesOf(entry)) symbols.push(...collectSceneSymbols(body));
    }
  }
  return symbols;
}

// Builds the full document symbol tree for a parsed Program. Does not
// parse itself - pass the result of `parse(tokenize(source))` (see
// check.js/format.js for the same pattern) so a caller that already has
// the AST (an LSP request handler, say) never pays for a second parse.
export function collectSymbols(program) {
  const symbols = [];
  for (const item of program.items) {
    switch (item.kind) {
      case "SceneDecl":
      case "PageDecl": {
        const name = item.kind === "SceneDecl" ? item.name : item.title;
        symbols.push({
          name,
          kind: item.kind === "SceneDecl" ? "scene" : "page",
          line: item.line,
          endLine: item.body.closeLine ?? item.line,
          children: collectSceneSymbols(item.body),
        });
        break;
      }
      case "ComponentDecl":
        symbols.push({
          name: item.name,
          kind: "component",
          params: item.params,
          exported: !!item.exported,
          line: item.line,
          endLine: item.body.closeLine ?? item.line,
          children: collectSceneSymbols(item.body),
        });
        break;
      case "FnDecl":
        symbols.push({
          name: item.name,
          kind: "function",
          params: item.params,
          isAsync: !!item.isAsync,
          exported: !!item.exported,
          line: item.line,
          endLine: item.body.closeLine ?? item.line,
          children: [],
        });
        break;
      case "LetDecl":
        symbols.push({ name: item.name, kind: item.constant ? "const" : "let", exported: !!item.exported, line: item.line, children: [] });
        break;
      case "StateDecl":
        symbols.push({ name: item.name, kind: "state", line: item.line, children: [] });
        break;
      case "RouteDecl":
        symbols.push({ name: item.pattern, kind: "route", pageName: item.pageName, line: item.line, children: [] });
        break;
      case "RedirectDecl":
        symbols.push({ name: item.from, kind: "redirect", to: item.to, line: item.line, children: [] });
        break;
      case "ImportDecl":
        symbols.push({ name: item.name, kind: "import", path: item.path, line: item.line, children: [] });
        break;
      default:
      // nothing else declares a name at the top level
    }
  }
  return symbols;
}

// Flattens the tree into a single list, each entry carrying its own
// `path` (dot-joined ancestor names, e.g. "main.box") - what
// `axis inspect --json` actually returns, and what definitionLookup.js
// searches (it needs "which symbols are in scope at line N," which is
// easiest to answer over a flat list filtered by line range).
export function flattenSymbols(symbols, path = []) {
  const flat = [];
  for (const sym of symbols) {
    const fullPath = [...path, sym.name];
    flat.push({ ...sym, path: fullPath.join(".") });
    if (sym.children?.length) flat.push(...flattenSymbols(sym.children, fullPath));
  }
  return flat;
}
