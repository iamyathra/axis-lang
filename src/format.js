// A real, AST-based formatter for AXIS source - `axis fmt` reprints the
// exact same lexer/parser this file's own siblings use (lexer.js/
// parser.js), never a second grammar. See docs/architecture/ (or this
// file's own comments) for the honest limitations this design accepts
// rather than fakes:
//
// - Comments are preserved, but only positionally, not verbatim-adjacent
//   to arbitrary tokens: every `//` comment becomes either a same-line
//   trailing comment (when it shared a source line with a single-line
//   statement/property) or a standalone leading comment on its own line
//   immediately before whatever follows it - never mid-expression. A
//   comment inside a multi-line construct's own header line (e.g. between
//   an object's type and its name) isn't representable and gets pushed to
//   just before that construct instead.
// - `x += 1` round-trips as `x += 1` (parser.js's Assignment node now
//   carries `compoundOp` precisely so this file doesn't have to guess) -
//   but AXIS has no other syntax sugar to lose, so this is the only case
//   that needed it.
// - `page Home { ... }` vs `page "Home" { ... }` round-trips exactly as
//   written (parser.js's PageDecl now carries `titleIsString` precisely so
//   this file doesn't have to guess, the same reason Assignment carries
//   `compoundOp`) - even though both spellings mean the same thing to the
//   interpreter, and only the bare-identifier form is valid where `route`
//   needs to reference the page by name.
// - A string value that ends in a literal backslash can't be safely
//   re-encoded as an AXIS string literal at all (AXIS's own escaping rule
//   - only `\"` is special - makes that specific case genuinely ambiguous,
//   not a bug in this formatter) - formatting such a file throws
//   AxisFormatError rather than silently emitting something that
//   round-trips wrong.
//
// Every other construct reprints losslessly: format(format(source)) ===
// format(source) is enforced by tests/format.test.js's idempotence check
// against every canonical example plus targeted per-construct fixtures.

import { tokenize } from "./lexer.js";
import { parse } from "./parser.js";

export class AxisFormatError extends Error {
  constructor(message) {
    super(message);
    this.name = "AxisFormatError";
  }
}

const INDENT_UNIT = "    ";

// ---- expression printing (precedence-aware) --------------------------

// Ternary ('a ? b : c') binds looser than every binary operator - parser.js
// checks for it above `||` (parseExpression, before parseOr) - so its own
// "precedence" for minPrec purposes is 0, one below `||`'s 1.
const TERNARY_PRECEDENCE = 0;

const BINARY_PRECEDENCE = {
  "||": 1,
  "&&": 2,
  "==": 3,
  "!=": 3,
  "<": 4,
  "<=": 4,
  ">": 4,
  ">=": 4,
  "+": 5,
  "-": 5,
  "*": 6,
  "/": 6,
  "%": 6,
};

function printStringLiteral(value) {
  if (value.endsWith("\\")) {
    throw new AxisFormatError(
      `can't safely format a string ending in a literal backslash ("${value}") - AXIS's own string escaping (only \\" is special) makes that ambiguous to re-encode, not a formatter bug`
    );
  }
  return `"${value.replace(/"/g, '\\"')}"`;
}

// `minPrec`: the smallest binary precedence allowed to appear *unparenthesized*
// at this position - a Binary node whose own operator precedence is lower
// gets wrapped in parens so re-parsing produces the identical tree.
function printExpr(node, minPrec = 0) {
  switch (node.kind) {
    case "Number":
      return `${node.value}${node.unit ?? ""}`;
    case "String":
      return printStringLiteral(node.value);
    case "Boolean":
      return node.value ? "true" : "false";
    case "Null":
      return "null";
    case "Identifier":
      return node.value;
    case "Vector":
      return `(${node.items.map((item) => printExpr(item, 0)).join(", ")})`;
    case "Array":
      return `[${node.items.map((item) => printExpr(item, 0)).join(", ")}]`;
    case "Record":
      return node.fields.length === 0
        ? "{}"
        : `{ ${node.fields.map((f) => `${f.key}: ${printExpr(f.value, 0)}`).join(", ")} }`;
    case "Unary":
      return `${node.op}${printUnaryOperand(node.operand)}`;
    // The condition prints at precedence 1 (same as a Binary's own left
    // operand - parser.js's condition is parseOr(), which never re-enters
    // ternary parsing) so a *parenthesized* nested ternary used as the
    // condition - the one way one can appear there, since bare it would
    // already have been consumed by an outer '?' - gets its required
    // parens back. then/else print at 0 (bare): both are grammatically
    // parseExpression() (parser.js's parseExpression), so a nested ternary
    // there needs no parens to round-trip correctly.
    case "Ternary": {
      const text = `${printExpr(node.condition, 1)} ? ${printExpr(node.then, 0)} : ${printExpr(node.else, 0)}`;
      return minPrec > TERNARY_PRECEDENCE ? `(${text})` : text;
    }
    case "Await":
      return `await ${printUnaryOperand(node.operand)}`;
    case "Member":
      return `${printPostfixBase(node.object)}.${node.property}`;
    case "Index":
      return `${printPostfixBase(node.object)}[${printExpr(node.index, 0)}]`;
    case "Call":
      return `${printPostfixBase(node.callee)}(${node.args.map((a) => printExpr(a, 0)).join(", ")})`;
    // An inline function expression - `fn(x) { return x * 2 }` - only
    // supported here for a single-statement body that itself prints on one
    // line (a Return/ExprStmt/Assignment). printExpr's whole contract is
    // "return one flat string" (every other expression kind is either a
    // leaf or recurses into more flat strings) - a multi-statement or
    // nested-block body genuinely can't fit that contract without a bigger
    // change to how expressions print (threading the comment queue and a
    // real indent through printExpr, not just this one case). Refusing
    // loudly here is the same "don't silently misformat" policy this file
    // already uses for comments elsewhere - pull a bigger lambda out into a
    // named top-level `fn` instead. See docs/language.md's Known
    // limitations.
    case "FnExpr": {
      const asyncPrefix = node.isAsync ? "async " : "";
      const paramsText = node.params.join(", ");
      if (node.body.length === 0) return `${asyncPrefix}fn(${paramsText}) { }`;
      if (node.body.length > 1) {
        throw new AxisFormatError(
          "format.js can't format an inline function expression with more than one statement yet - pull it out into a named top-level 'fn' instead"
        );
      }
      const [stmt] = node.body;
      if (stmt.kind !== "ReturnStmt" && stmt.kind !== "ExprStmt" && stmt.kind !== "Assignment") {
        throw new AxisFormatError(
          `format.js can't format an inline function expression whose body is a '${stmt.kind}' yet - pull it out into a named top-level 'fn' instead`
        );
      }
      const bodyText = printPlainStatement(stmt, "").join(" ").trim();
      return `${asyncPrefix}fn(${paramsText}) { ${bodyText} }`;
    }
    case "Binary": {
      const prec = BINARY_PRECEDENCE[node.op];
      // left-associative: the left child needs parens only if it binds
      // *looser* than this operator; the right child needs parens at
      // *equal or looser* precedence, since without them the printed text
      // would re-associate to a different (wrong) tree on reparse.
      const left = printExpr(node.left, prec);
      const right = printExpr(node.right, prec + 1);
      const text = `${left} ${node.op} ${right}`;
      return prec < minPrec ? `(${text})` : text;
    }
    default:
      throw new AxisFormatError(`format.js doesn't know how to print an expression of kind '${node.kind}'`);
  }
}

// Unary/Await bind tighter than every binary operator (parser.js's
// parseUnary only ever recurses into parsePostfix/parsePrimary) - a Binary
// operand can only appear here if the author explicitly parenthesized it
// (parsePrimary's `(expr)` branch), so it must stay parenthesized to mean
// the same thing.
function printUnaryOperand(node) {
  return node.kind === "Binary" ? `(${printExpr(node, 0)})` : printExpr(node, Infinity);
}

// The base of a.b / a[i] / a(...) - only a Binary/Unary/Await base
// (reachable only via an explicit parenthesized expression in source)
// needs parens; every other kind is already tight-binding.
function printPostfixBase(node) {
  return node.kind === "Binary" || node.kind === "Unary" || node.kind === "Await" ? `(${printExpr(node, 0)})` : printExpr(node, Infinity);
}

function printTarget(target, targetIsExpr) {
  return targetIsExpr ? `(${printExpr(target, 0)})` : target;
}

function printPath(path) {
  return path.join(".");
}

// ---- comment plumbing --------------------------------------------------

// Comments have no place in the AST at all (lexer.js discards them) - this
// class is the one place format.js tracks them, fed by lexer.js's
// `onComment` hook. `line` is 1-indexed, matching every AST node's `.line`.
class CommentQueue {
  constructor(comments) {
    this.comments = [...comments].sort((a, b) => a.line - b.line);
    this.i = 0;
  }

  peek() {
    return this.comments[this.i];
  }

  // Leading comments: every remaining comment strictly before `line`.
  takeBefore(line) {
    const taken = [];
    while (this.i < this.comments.length && this.comments[this.i].line < line) {
      taken.push(this.comments[this.i]);
      this.i++;
    }
    return taken;
  }

  // A trailing, same-line comment: only if the next comment is on exactly
  // `line` (the single line a just-printed simple entry occupied).
  takeTrailingOn(line) {
    if (this.i < this.comments.length && this.comments[this.i].line === line) {
      return this.comments[this.i++];
    }
    return null;
  }

  hasMoreBefore(line) {
    return this.i < this.comments.length && this.comments[this.i].line < line;
  }
}

function commentLine(indent, comment) {
  return `${indent}${comment.text.trimEnd()}`;
}

// Prints a list of body entries (already-parsed nodes, in source order),
// each rendered by `printOne(entry, indent) -> string[]`, with comments
// interleaved by position and a blank line between entries whose own kind
// is in `spaced` (every other adjacent pair prints with no blank line -
// e.g. consecutive plain statements, or consecutive object properties).
// `closeLine` (see parser.js's parseBlock) is where trailing comments
// inside this body, after its last real entry, get flushed - without it,
// a comment right before a closing '}' would incorrectly print *after*
// the '}' instead of before it.
function printEntries(entries, indent, printOne, queue, { blankBetween, closeLine, singleLineKinds }) {
  const lines = [];
  entries.forEach((entry, i) => {
    const leading = queue.takeBefore(entry.line ?? Infinity);
    if (leading.length > 0) {
      if (lines.length > 0) lines.push("");
      for (const c of leading) lines.push(commentLine(indent, c));
    } else if (i > 0 && blankBetween) {
      lines.push("");
    }

    const entryLines = printOne(entry, indent);
    if (entryLines.length === 1 && singleLineKinds.has(entry.kind) && entry.line != null) {
      const trailing = queue.takeTrailingOn(entry.line);
      lines.push(trailing ? `${entryLines[0]} ${trailing.text.trimEnd()}` : entryLines[0]);
    } else {
      lines.push(...entryLines);
    }
  });

  if (closeLine != null) {
    const trailing = queue.takeBefore(closeLine);
    if (trailing.length > 0) {
      if (lines.length > 0) lines.push("");
      for (const c of trailing) lines.push(commentLine(indent, c));
    }
  }
  return lines;
}

const SINGLE_LINE_SCENE_ENTRY_KINDS = new Set(["Property", "LabelDecl", "TimelineProperty", "PlayStmt", "PlayClipStmt", "StopClipStmt", "PauseStmt", "ResumeStmt", "ReverseStmt"]);
const SINGLE_LINE_PLAIN_KINDS = new Set([
  "LetDecl",
  "StateDecl",
  "Assignment",
  "ExprStmt",
  "ReturnStmt",
  "PlayStmt",
  "PlayClipStmt",
  "StopClipStmt",
  "PauseStmt",
  "ResumeStmt",
  "ReverseStmt",
]);

// ---- scene/page/component-flavored entries (parseSceneEntry) ----------

function printSceneEntry(entry, indent, queue) {
  switch (entry.kind) {
    case "Property":
      return [`${indent}${printPath(entry.path)}: ${printExpr(entry.value, 0)}`];
    case "LetDecl":
    case "StateDecl":
      return printLetOrState(entry, indent);
    case "IfStmt":
      return printIfStmt(entry, indent, queue, printSceneEntry);
    case "WhileStmt":
      return printWhileStmt(entry, indent, queue, printSceneEntry);
    case "ForStmt":
      return printForStmt(entry, indent, queue, printSceneEntry);
    case "AnimateDecl":
      return printAnimateDecl(entry, indent, queue);
    case "OnDecl":
      return printOnDecl(entry, indent, queue);
    case "TimelineDecl":
      return printTimelineDecl(entry, indent, queue);
    case "ObjectDecl":
      return printObjectDecl(entry, indent, queue);
    case "LabelDecl":
      return [`${indent}label ${entry.name}`];
    case "TimelineProperty":
      return [`${indent}${entry.name}: ${printExpr(entry.value, 0)}`];
    case "PlayStmt":
      return [`${indent}play ${printTarget(entry.target, entry.targetIsExpr)}`];
    case "PlayClipStmt":
      return [`${indent}play ${printTarget(entry.clip, entry.clipIsExpr)} on ${printTarget(entry.target, entry.targetIsExpr)}`];
    case "StopClipStmt":
      return [`${indent}stop ${printTarget(entry.target, entry.targetIsExpr)}`];
    case "PauseStmt":
      return [`${indent}pause ${printTarget(entry.target, entry.targetIsExpr)}`];
    case "ResumeStmt":
      return [`${indent}resume ${printTarget(entry.target, entry.targetIsExpr)}`];
    case "ReverseStmt":
      return [`${indent}reverse ${printTarget(entry.target, entry.targetIsExpr)}`];
    default:
      throw new AxisFormatError(`format.js doesn't know how to print a scene/page entry of kind '${entry.kind}'`);
  }
}

function printLetOrState(decl, indent) {
  const kw = decl.kind === "StateDecl" ? "state" : decl.constant ? "const" : "let";
  const exportPrefix = decl.exported ? "export " : "";
  return [`${indent}${exportPrefix}${kw} ${decl.name} = ${printExpr(decl.value, 0)}`];
}

function printObjectDecl(decl, indent, queue) {
  const nameText = decl.name == null ? "" : decl.nameIsExpr ? ` (${printExpr(decl.name, 0)})` : ` ${decl.name}`;
  const header = `${indent}${decl.objectType}${nameText}`;

  const entries = [...decl.properties, ...decl.children];
  if (entries.length === 0 && !queue.hasMoreBefore(decl.bodyCloseLine ?? Infinity)) {
    return [`${header} { }`];
  }

  const inner = indent + INDENT_UNIT;
  const lines = [`${header} {`];
  // properties (tight, no blank lines) then a blank line then children
  // (blank-line separated) - this mirrors how parser.js's ObjectDecl
  // already splits `properties`/`children` into two groups regardless of
  // how the author interleaved them in source (see parseObjectDecl), so
  // this reprint doesn't lose any ordering AXIS's own AST didn't already
  // normalize away.
  const propLines = printEntries(decl.properties, inner, (p, ind) => printSceneEntry(p, ind, queue), queue, {
    blankBetween: false,
    closeLine: decl.children.length === 0 ? decl.bodyCloseLine : decl.children[0].line,
    singleLineKinds: SINGLE_LINE_SCENE_ENTRY_KINDS,
  });
  lines.push(...propLines);
  const childLines = printEntries(decl.children, inner, (c, ind) => printSceneEntry(c, ind, queue), queue, {
    blankBetween: true,
    closeLine: decl.bodyCloseLine,
    singleLineKinds: SINGLE_LINE_SCENE_ENTRY_KINDS,
  });
  if (childLines.length > 0) {
    if (propLines.length > 0) lines.push("");
    lines.push(...childLines);
  }
  lines.push(`${indent}}`);
  return lines;
}

function printAnimateDecl(decl, indent, queue) {
  const header = `${indent}animate ${printTarget(decl.target, decl.targetIsExpr)}`;
  if (decl.entries.length === 0) return [`${header} { }`];
  const inner = indent + INDENT_UNIT;
  const lines = [`${header} {`];
  lines.push(
    ...printEntries(
      decl.entries,
      inner,
      (e, ind) =>
        e.kind === "AnimateTarget" ? [`${ind}${printPath(e.path)} -> ${printExpr(e.to, 0)}`] : [`${ind}${printPath(e.path)}: ${printExpr(e.value, 0)}`],
      queue,
      { blankBetween: false, closeLine: decl.bodyCloseLine, singleLineKinds: new Set(["AnimateTarget", "Property"]) }
    )
  );
  lines.push(`${indent}}`);
  return lines;
}

function printOnDecl(decl, indent, queue) {
  // 'on tick { ... }' (parser.js's isGlobalOnEvent) has no target at all -
  // decl.target is null, not a name/expression to print with '.event'.
  const header = decl.target === null ? `${indent}on ${decl.event}` : `${indent}on ${printTarget(decl.target, decl.targetIsExpr)}.${decl.event}`;
  return printBracedBody(header, decl.body, indent, queue, printPlainStatement, { blankBetween: false, singleLineKinds: SINGLE_LINE_PLAIN_KINDS });
}

function printTimelineDecl(decl, indent, queue) {
  const header = `${indent}timeline ${decl.name}`;
  return printBracedBody(header, decl.body, indent, queue, printSceneEntry, { blankBetween: true, singleLineKinds: SINGLE_LINE_SCENE_ENTRY_KINDS });
}

// ---- plain-code statements (parsePlainStatement) -----------------------

function printPlainStatement(stmt, indent, queue) {
  switch (stmt.kind) {
    case "LetDecl":
    case "StateDecl":
      return printLetOrState(stmt, indent);
    case "IfStmt":
      return printIfStmt(stmt, indent, queue, printPlainStatement);
    case "WhileStmt":
      return printWhileStmt(stmt, indent, queue, printPlainStatement);
    case "ForStmt":
      return printForStmt(stmt, indent, queue, printPlainStatement);
    case "ReturnStmt":
      return [stmt.value == null ? `${indent}return` : `${indent}return ${printExpr(stmt.value, 0)}`];
    case "TryStmt":
      return printTryStmt(stmt, indent, queue);
    case "AnimateDecl":
      return printAnimateDecl(stmt, indent, queue);
    case "PlayStmt":
      return [`${indent}play ${printTarget(stmt.target, stmt.targetIsExpr)}`];
    case "PlayClipStmt":
      return [`${indent}play ${printTarget(stmt.clip, stmt.clipIsExpr)} on ${printTarget(stmt.target, stmt.targetIsExpr)}`];
    case "StopClipStmt":
      return [`${indent}stop ${printTarget(stmt.target, stmt.targetIsExpr)}`];
    case "PauseStmt":
      return [`${indent}pause ${printTarget(stmt.target, stmt.targetIsExpr)}`];
    case "ResumeStmt":
      return [`${indent}resume ${printTarget(stmt.target, stmt.targetIsExpr)}`];
    case "ReverseStmt":
      return [`${indent}reverse ${printTarget(stmt.target, stmt.targetIsExpr)}`];
    case "Assignment": {
      const target = printExpr(stmt.target, 0);
      if (stmt.compoundOp) return [`${indent}${target} ${stmt.compoundOp}= ${printExpr(stmt.value.right, 0)}`];
      return [`${indent}${target} = ${printExpr(stmt.value, 0)}`];
    }
    case "ExprStmt":
      return [`${indent}${printExpr(stmt.expr, 0)}`];
    default:
      throw new AxisFormatError(`format.js doesn't know how to print a statement of kind '${stmt.kind}'`);
  }
}

function printBracedBody(header, body, indent, queue, printEntry, { blankBetween, singleLineKinds }) {
  if (body.length === 0 && !queue.hasMoreBefore(body.closeLine ?? Infinity)) return [`${header} { }`];
  const inner = indent + INDENT_UNIT;
  const lines = [`${header} {`];
  lines.push(...printEntries(body, inner, (e, ind) => printEntry(e, ind, queue), queue, { blankBetween, closeLine: body.closeLine, singleLineKinds }));
  lines.push(`${indent}}`);
  return lines;
}

function printIfStmt(stmt, indent, queue, printEntry) {
  const singleLineKinds = printEntry === printPlainStatement ? SINGLE_LINE_PLAIN_KINDS : SINGLE_LINE_SCENE_ENTRY_KINDS;
  const blankBetween = printEntry !== printPlainStatement;
  const lines = printBracedBody(`${indent}if (${printExpr(stmt.condition, 0)})`, stmt.then, indent, queue, printEntry, { blankBetween, singleLineKinds });
  if (stmt.else == null) return lines;
  // `else if (...)` - parser.js represents this as `else: [thatIfStmt]`
  // (a one-element array, not a special node kind) - detect it the same
  // way and print it as a continuation, not a nested block.
  if (stmt.else.length === 1 && stmt.else[0].kind === "IfStmt") {
    const elseIfLines = printIfStmt(stmt.else[0], indent, queue, printEntry);
    lines[lines.length - 1] = `${lines.pop()} else ${elseIfLines[0].trimStart()}`;
    lines.push(...elseIfLines.slice(1));
    return lines;
  }
  const elseLines = printBracedBody("else", stmt.else, indent, queue, printEntry, { blankBetween, singleLineKinds });
  lines[lines.length - 1] = `${lines.pop()} ${elseLines[0]}`;
  lines.push(...elseLines.slice(1));
  return lines;
}

function printWhileStmt(stmt, indent, queue, printEntry) {
  const singleLineKinds = printEntry === printPlainStatement ? SINGLE_LINE_PLAIN_KINDS : SINGLE_LINE_SCENE_ENTRY_KINDS;
  const blankBetween = printEntry !== printPlainStatement;
  return printBracedBody(`${indent}while (${printExpr(stmt.condition, 0)})`, stmt.body, indent, queue, printEntry, { blankBetween, singleLineKinds });
}

function printForStmt(stmt, indent, queue, printEntry) {
  const singleLineKinds = printEntry === printPlainStatement ? SINGLE_LINE_PLAIN_KINDS : SINGLE_LINE_SCENE_ENTRY_KINDS;
  const blankBetween = printEntry !== printPlainStatement;
  return printBracedBody(`${indent}for ${stmt.varName} in ${printExpr(stmt.iterable, 0)}`, stmt.body, indent, queue, printEntry, {
    blankBetween,
    singleLineKinds,
  });
}

function printTryStmt(stmt, indent, queue) {
  const tryLines = printBracedBody(`${indent}try`, stmt.tryBlock, indent, queue, printPlainStatement, {
    blankBetween: false,
    singleLineKinds: SINGLE_LINE_PLAIN_KINDS,
  });
  const catchLines = printBracedBody(`catch (${stmt.errName})`, stmt.catchBlock, indent, queue, printPlainStatement, {
    blankBetween: false,
    singleLineKinds: SINGLE_LINE_PLAIN_KINDS,
  });
  tryLines[tryLines.length - 1] = `${tryLines.pop()} ${catchLines[0]}`;
  tryLines.push(...catchLines.slice(1));
  return tryLines;
}

// ---- top-level items ----------------------------------------------------

function printTopLevelItem(item, indent, queue) {
  switch (item.kind) {
    case "SceneDecl":
      return printBracedBody(`${indent}scene ${item.name}`, item.body, indent, queue, printSceneEntry, {
        blankBetween: true,
        singleLineKinds: SINGLE_LINE_SCENE_ENTRY_KINDS,
      });
    case "PageDecl": {
      const title = item.titleIsString ? printStringLiteral(item.title) : /^[A-Za-z_][A-Za-z0-9_]*$/.test(item.title) ? item.title : printStringLiteral(item.title);
      return printBracedBody(`${indent}page ${title}`, item.body, indent, queue, printSceneEntry, {
        blankBetween: true,
        singleLineKinds: SINGLE_LINE_SCENE_ENTRY_KINDS,
      });
    }
    case "ComponentDecl": {
      const exportPrefix = item.exported ? "export " : "";
      return printBracedBody(`${indent}${exportPrefix}component ${item.name}(${item.params.join(", ")})`, item.body, indent, queue, printSceneEntry, {
        blankBetween: true,
        singleLineKinds: SINGLE_LINE_SCENE_ENTRY_KINDS,
      });
    }
    case "FnDecl": {
      const exportPrefix = item.exported ? "export " : "";
      const asyncPrefix = item.isAsync ? "async " : "";
      return printBracedBody(`${indent}${exportPrefix}${asyncPrefix}fn ${item.name}(${item.params.join(", ")})`, item.body, indent, queue, printPlainStatement, {
        blankBetween: false,
        singleLineKinds: SINGLE_LINE_PLAIN_KINDS,
      });
    }
    case "LetDecl":
      return printLetOrState(item, indent);
    case "StateDecl":
      return printLetOrState(item, indent);
    case "ImportDecl":
      return [`${indent}import ${item.name} from ${printStringLiteral(item.path)}`];
    case "RouteDecl":
      return [`${indent}route ${printStringLiteral(item.pattern)} ${item.pageName}`];
    case "RedirectDecl":
      return [`${indent}redirect ${printStringLiteral(item.from)} ${printStringLiteral(item.to)}`];
    default:
      throw new AxisFormatError(`format.js doesn't know how to print a top-level item of kind '${item.kind}'`);
  }
}

// ---- entry point ---------------------------------------------------------

// Formats AXIS source text, returning the canonical form. Throws
// AxisSyntaxError (re-thrown from the real parser - an invalid program
// can't be formatted, same as it can't be checked) or AxisFormatError (a
// valid program this formatter genuinely can't safely reprint - see this
// file's header comment for the two known cases).
export function formatSource(source) {
  const comments = [];
  const tokens = tokenize(source, { onComment: (line, col, text) => comments.push({ line, col, text }) });
  const program = parse(tokens);
  const queue = new CommentQueue(comments);

  const lines = printEntries(program.items, "", (item, ind) => printTopLevelItem(item, ind, queue), queue, {
    blankBetween: true,
    closeLine: program.closeLine,
    singleLineKinds: new Set(["LetDecl", "StateDecl", "ImportDecl", "RouteDecl", "RedirectDecl"]),
  });

  return lines.join("\n") + "\n";
}
