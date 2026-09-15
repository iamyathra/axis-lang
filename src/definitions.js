// Go-to-definition and hover, both built on the same primitives: the
// symbol index (symbols.js) and the raw token stream (lexer.js already
// tracks line+col per token - nothing new needed there). No parser-state/
// completion machinery here - see this file's own limitation note below
// for why that's a deliberate v3.7 boundary, not an oversight.
//
// AXIS's own name resolution (evaluator.js's Environment, interpreter.js's
// `objectsByName`) mixes two different lookup rules: plain variables
// resolve through lexical scope, but an `animate`/`on` *target* name
// resolves against every named object declared anywhere in the enclosing
// scene/page/component, regardless of nesting depth (see SceneBuilder in
// interpreter.js). This file follows the same two-tier shape rather than
// reimplementing full lexical scoping: "does this name match an object/
// timeline anywhere in the enclosing scene/page/component?" first, then
// "does it match a top-level declaration?" - good enough for real AXIS
// programs (a name collision across those two tiers is already something
// AXIS itself treats as fine, since they're genuinely different
// namespaces) without needing a second copy of evaluator.js's own
// lexical-scope walk.
//
// LIMITATION, stated plainly rather than faked: this only resolves a name
// to a *declaration* (an object/timeline/scene/page/component/fn/let/
// const/state name) - it does not resolve a plain local variable inside a
// function/handler body to its own `let` (that needs real lexical scoping,
// not just line-range containment, and AXIS's grammar allows shadowing
// that line ranges alone can't disambiguate correctly). Asking for the
// definition of a local variable currently returns null, not a wrong
// answer.

import { collectSymbols, flattenSymbols } from "./symbols.js";
import { NAMED_COLORS, EASING_NAMES } from "./globals.js";
import { EVENT_NAMES } from "./interpreter.js";

function isIdentToken(tok) {
  return tok.type === "IDENT";
}

// The token whose span covers (line, col), or null. 1-indexed, matching
// every AST node's own `.line`/lexer token `.col`.
export function tokenAt(tokens, line, col) {
  for (const tok of tokens) {
    if (tok.line !== line) continue;
    const text = tok.type === "STRING" ? `"${tok.value}"` : String(tok.value ?? tok.type);
    const start = tok.col;
    const end = tok.col + text.length;
    if (col >= start && col < end) return tok;
  }
  return null;
}

// The innermost scene/page/component symbol whose line range contains
// `line` - the object-name namespace `findDefinition` searches first.
function enclosingContainer(flatSymbols, line) {
  let best = null;
  for (const sym of flatSymbols) {
    if (!["scene", "page", "component"].includes(sym.kind)) continue;
    if (line < sym.line || line > (sym.endLine ?? sym.line)) continue;
    if (!best || sym.line > best.line) best = sym;
  }
  return best;
}

// Resolves the identifier at (line, col) to a declaration site. Returns
// `{ name, kind, line, path, objectType? }` or null (not an identifier
// there, or it doesn't resolve to any known declaration - see this file's
// header for what "doesn't resolve" honestly includes).
export function findDefinition(program, tokens, line, col) {
  const tok = tokenAt(tokens, line, col);
  if (!tok || !isIdentToken(tok)) return null;

  const flat = flattenSymbols(collectSymbolsCached(program));
  const container = enclosingContainer(flat, line);
  if (container) {
    const localMatch = flat.find((s) => s.path.startsWith(`${container.path}.`) && s.name === tok.value && (s.kind === "object" || s.kind === "timeline"));
    if (localMatch) return localMatch;
  }
  const topLevelMatch = flat.find((s) => !s.path.includes(".") && s.name === tok.value);
  return topLevelMatch ?? null;
}

// Curated, honest hover text: only for names this file can actually say
// something true and specific about - a resolved user declaration, or one
// of AXIS's small closed vocabularies (already the single source of truth
// in globals.js/interpreter.js, not redefined here). Anything else (a
// plain local variable, a builtin function name, an arbitrary expression)
// returns null rather than a guess.
export function hoverText(program, tokens, line, col) {
  const tok = tokenAt(tokens, line, col);
  if (!tok || !isIdentToken(tok)) return null;

  const def = findDefinition(program, tokens, line, col);
  if (def) return describeSymbol(def);

  if (NAMED_COLORS.includes(tok.value)) return `AXIS named color \`${tok.value}\``;
  if (EASING_NAMES.includes(tok.value)) return `AXIS easing curve \`${tok.value}\``;
  if (EVENT_NAMES.has(tok.value)) return `AXIS interaction event \`${tok.value}\` (used as \`on target.${tok.value} { ... }\`)`;
  return null;
}

function describeSymbol(sym) {
  switch (sym.kind) {
    case "scene":
      return `scene \`${sym.name}\``;
    case "page":
      return `page \`${sym.name}\``;
    case "component":
      return `component \`${sym.name}(${(sym.params ?? []).join(", ")})\``;
    case "function":
      return `${sym.isAsync ? "async " : ""}fn \`${sym.name}(${(sym.params ?? []).join(", ")})\``;
    case "object":
      return `${sym.objectType} \`${sym.name}\` (declared line ${sym.line})`;
    case "timeline":
      return `timeline \`${sym.name}\``;
    case "let":
    case "const":
      return `${sym.kind} \`${sym.name}\``;
    case "state":
      return `state \`${sym.name}\``;
    case "route":
      return `route \`${sym.name}\` -> page \`${sym.pageName}\``;
    default:
      return `${sym.kind} \`${sym.name}\``;
  }
}

// A tiny memo keyed by AST identity (not source text) - a single request
// handler in lsp.js may call findDefinition/hoverText more than once per
// program per request; correctness never depends on it (cache is
// per-Program-object, invalidated for free the moment a caller reparses).
const symbolsCache = new WeakMap();
function collectSymbolsCached(program) {
  if (!symbolsCache.has(program)) symbolsCache.set(program, collectSymbols(program));
  return symbolsCache.get(program);
}
