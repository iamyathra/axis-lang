// Normalizes AXIS's three existing error classes (AxisSyntaxError from
// lexer.js/parser.js, AxisRuntimeError from evaluator.js/interpreter.js,
// AxisModuleError from modules.js) into one canonical, machine-readable
// Diagnostic shape - the single format `axis check`'s human and `--json`
// output both render from, and the contract docs/ai/VALIDATION.md documents.
//
// This is deliberately NOT a second validation system: AXIS still has
// exactly one place that decides whether a program is valid (the real
// lex/parse/interpret/plan pipeline in check.js) and exactly one place that
// writes error messages (the throw sites in lexer.js/parser.js/evaluator.js/
// interpreter.js/modules.js, unchanged by this file). What this module adds
// is a *classification* layer on top of those already-thrown errors: a
// `code` (for a curated, high-value subset of AXIS's message templates,
// matched by fixed substrings enumerated directly from the source below -
// not guessed, not regex-sniffed from arbitrary text) plus a `suggestion`
// (either the "did you mean 'x'?" hint suggest.js already generates, parsed
// back out of its own single fixed format, or a short hand-written fix for
// the highest-frequency codes). A generic per-error-class code
// (AXIS_LEX_ERROR/AXIS_PARSE_ERROR/AXIS_RUNTIME_ERROR/AXIS_MODULE_ERROR) is
// used for anything not specifically classified, so every diagnostic always
// has *a* code, even for messages this file doesn't know about yet.
//
// If a throw site's message wording changes, the matching rule below needs
// a matching update - tests/diagnostics.test.js exercises one real thrown
// error per rule so drift is caught, not silent.

import { readFileSync } from "node:fs";
import nodePath from "node:path";
import { AxisSyntaxError } from "./lexer.js";
import { AxisRuntimeError } from "./evaluator.js";
import { AxisModuleError } from "./modules.js";

export const DIAGNOSTIC_SCHEMA_VERSION = 1;

// [substring-or-RegExp, code] - checked in order, first match wins. Kept as
// substring checks (not regex) wherever a plain `includes` is enough; a
// RegExp only where the match needs to anchor or use alternation. Exported
// so tests/diagnostics.test.js and scripts/gen-error-codes-doc.mjs can
// enumerate every code this module can actually produce, without a second,
// hand-maintained list of the same codes drifting out of sync.
export const SYNTAX_RULES = [
  [/^unterminated string/, "AXIS_LEX_UNTERMINATED_STRING"],
  [/^unexpected character/, "AXIS_LEX_UNEXPECTED_CHARACTER"],
  [/^expected '.+' but got/, "AXIS_PARSE_EXPECTED_TOKEN"],
  ["expected ", "AXIS_PARSE_EXPECTED_TOKEN"],
  [/^'await' /, "AXIS_PARSE_AWAIT_OUTSIDE_ASYNC"],
  ["can't be used as a statement by itself", "AXIS_PARSE_INVALID_STATEMENT"],
  ["isn't something you can assign to", "AXIS_PARSE_INVALID_ASSIGNMENT_TARGET"],
  [/^duplicate field/, "AXIS_PARSE_DUPLICATE_FIELD"],
  [/^unexpected token/, "AXIS_PARSE_UNEXPECTED_TOKEN"],
];

export const MODULE_RULES = [
  [/^can't find '|^can't find package '/, "AXIS_MODULE_NOT_FOUND"],
  [/^circular import/, "AXIS_MODULE_CIRCULAR_IMPORT"],
  [/must end in '\.ax'/, "AXIS_MODULE_INVALID_PATH"],
  [/doesn't export/, "AXIS_MODULE_MISSING_EXPORT"],
];

export const RUNTIME_RULES = [
  [/^undefined variable/, "AXIS_SEMANTIC_UNDEFINED_VARIABLE"],
  [/^can't assign to '.+' - it's a const/, "AXIS_SEMANTIC_CONST_ASSIGNMENT"],
  [/is already defined/, "AXIS_SEMANTIC_ALREADY_DEFINED"],
  [/is defined more than once/, "AXIS_SEMANTIC_ALREADY_DEFINED"],
  [/is declared more than once/, "AXIS_SEMANTIC_ALREADY_DEFINED"],
  [/must be a finite, non-negative number.*got \w*[dD]elay/, "AXIS_VALIDATION_INVALID_DELAY"], // rare "delay" naming variants, checked before the generic duration/delay rule
  [/^'duration' must be a finite, non-negative number/, "AXIS_VALIDATION_INVALID_DURATION"],
  [/^'delay' must be a finite, non-negative number/, "AXIS_VALIDATION_INVALID_DELAY"],
  [/must be a finite, non-negative number/, "AXIS_VALIDATION_INVALID_TIMING"],
  [/missing 'duration'/, "AXIS_VALIDATION_MISSING_DURATION"],
  [/'repeat' must be a positive whole number/, "AXIS_VALIDATION_INVALID_REPEAT"],
  [/^unknown easing/, "AXIS_VALIDATION_UNKNOWN_EASING"],
  [/^unknown event/, "AXIS_SEMANTIC_UNKNOWN_EVENT"],
  [/^unknown camera controls/, "AXIS_SEMANTIC_UNKNOWN_VALUE"],
  [/^unknown operator|^unknown unary operator/, "AXIS_SEMANTIC_UNKNOWN_OPERATOR"],
  [/no object( or timeline)? with that name/, "AXIS_SEMANTIC_UNKNOWN_TARGET"],
  [/doesn't have a '.+' property/, "AXIS_SEMANTIC_UNKNOWN_PROPERTY"],
  [/doesn't have a '.+' field/, "AXIS_SEMANTIC_UNKNOWN_PROPERTY"],
  [/doesn't have a '.+' breakpoint/, "AXIS_SEMANTIC_UNKNOWN_PROPERTY"],
  [/no property '.+' on this value/, "AXIS_SEMANTIC_UNKNOWN_PROPERTY"],
  [/needs a color name or a string like/, "AXIS_SEMANTIC_INVALID_COLOR"],
  [/needs a \d-value vector|needs a 3-value vector/, "AXIS_SEMANTIC_INVALID_VECTOR"],
  [/^vector components must be numbers/, "AXIS_SEMANTIC_INVALID_VECTOR"],
  [/^'src' /, "AXIS_SEMANTIC_INVALID_MODEL_SRC"],
  [/can't use a ".+:" URL/, "AXIS_SEMANTIC_UNSAFE_URL"],
  [/ran for over a million iterations/, "AXIS_SEMANTIC_LOOP_LIMIT_EXCEEDED"],
  [/'for\.\.in' needs an array/, "AXIS_SEMANTIC_INVALID_LOOP_TARGET"],
  [/expects \d+ argument\(s\), got/, "AXIS_SEMANTIC_ARITY_MISMATCH"],
  [/isn't callable$/, "AXIS_SEMANTIC_NOT_CALLABLE"],
  [/is out of range for an array/, "AXIS_SEMANTIC_INDEX_OUT_OF_RANGE"],
  [/array indices must be whole numbers/, "AXIS_SEMANTIC_INDEX_OUT_OF_RANGE"],
  [/^invalid assignment target$/, "AXIS_SEMANTIC_INVALID_ASSIGNMENT_TARGET"],
  [/can't (add|subtract|multiply|divide|negate|combine|index|read|set)/, "AXIS_SEMANTIC_TYPE_MISMATCH"],
  [/needs (a|two) numbers?/, "AXIS_SEMANTIC_TYPE_MISMATCH"],
  [/needs true or false/, "AXIS_SEMANTIC_TYPE_MISMATCH"],
  [/needs a string/, "AXIS_SEMANTIC_TYPE_MISMATCH"],
  [/can't be used (here|inside)/, "AXIS_SEMANTIC_UNSUPPORTED_IN_CONTEXT"],
  [/isn't supported inside/, "AXIS_SEMANTIC_UNSUPPORTED_IN_CONTEXT"],
  [/can't contain other declarations/, "AXIS_SEMANTIC_INVALID_NESTING"],
  [/'return' can only be used inside a function/, "AXIS_SEMANTIC_RETURN_OUTSIDE_FUNCTION"],
];

// Short, hand-written fixes for the highest-frequency codes above - not
// attempted for the long tail (a null suggestion is honest; a guessed one
// isn't). A "did you mean 'x'?" hint from suggest.js (extracted below)
// always wins over these when both would apply.
const SUGGESTION_BY_CODE = {
  AXIS_VALIDATION_INVALID_DURATION: "Use a positive, finite number of milliseconds, e.g. `duration: 500`.",
  AXIS_VALIDATION_INVALID_DELAY: "Use a positive, finite number of milliseconds, e.g. `delay: 200`.",
  AXIS_VALIDATION_INVALID_TIMING: "Use a positive, finite number of milliseconds.",
  AXIS_VALIDATION_MISSING_DURATION: "Add a `duration:` to the animate block, e.g. `duration: 500`.",
  AXIS_VALIDATION_INVALID_REPEAT: "Use a positive whole number, or the keyword `infinite`.",
  AXIS_VALIDATION_UNKNOWN_EASING: "Use one of: linear, easeIn, easeOut, easeInOut.",
  AXIS_SEMANTIC_UNSAFE_URL: "Use an http(s)/mailto/tel URL, or a relative path/anchor.",
  AXIS_SEMANTIC_INVALID_COLOR: 'Use a named color (e.g. `red`) or a hex string like `"#ff6600"`.',
  AXIS_SEMANTIC_CONST_ASSIGNMENT: "Declare it with `let` instead of `const` if it needs to change.",
  AXIS_SEMANTIC_LOOP_LIMIT_EXCEEDED: "Check the loop's exit condition - it never became false within a million iterations.",
  AXIS_SEMANTIC_NO_RENDERABLE_ROOT: 'Add a top-level `scene name { ... }` or `page "Title" { ... }` block.',
};

// One-line human description per code - the single source docs/ai/
// ERROR_CODES.md is generated from (see scripts/gen-error-codes-doc.mjs).
// tests/diagnostics.test.js asserts every code any rule table above can
// actually produce, plus every check.js-level/fallback code, has an entry
// here - so this list can't silently drift out of sync with the code.
export const CODE_CATALOG = {
  AXIS_LEX_UNTERMINATED_STRING: "A string literal was never closed with a matching quote.",
  AXIS_LEX_UNEXPECTED_CHARACTER: "A character the lexer doesn't recognize as the start of any token.",
  AXIS_PARSE_EXPECTED_TOKEN: "The parser expected a specific token (a keyword, `{`, `:`, etc.) and found something else.",
  AXIS_PARSE_UNEXPECTED_TOKEN: "A token appeared somewhere the grammar doesn't allow it.",
  AXIS_PARSE_INVALID_STATEMENT: "A valid expression was used where a statement is required (e.g. a bare record literal).",
  AXIS_PARSE_INVALID_ASSIGNMENT_TARGET: "The left side of `=`/`+=`/etc. isn't a variable, property, or index - it can't be assigned to.",
  AXIS_PARSE_DUPLICATE_FIELD: "The same field name appears twice in one record literal.",
  AXIS_PARSE_AWAIT_OUTSIDE_ASYNC: "`await` was used outside an `async fn` (or a function it calls transitively).",
  AXIS_PARSE_ERROR: "A syntax error that doesn't match any more specific parse rule above.",
  AXIS_MODULE_NOT_FOUND: "An `import`'s path doesn't resolve to a file on disk, or a bare name doesn't resolve to a package under `axis_modules/`.",
  AXIS_MODULE_CIRCULAR_IMPORT: "Two or more files `import` each other, directly or indirectly.",
  AXIS_MODULE_INVALID_PATH: "An `import` path doesn't end in `.ax`.",
  AXIS_MODULE_MISSING_EXPORT: "An `import` names something the target file doesn't `export`.",
  AXIS_MODULE_ERROR: "A module-resolution error that doesn't match any more specific rule above.",
  AXIS_SEMANTIC_UNDEFINED_VARIABLE: "A name is referenced that isn't defined in any enclosing scope.",
  AXIS_SEMANTIC_CONST_ASSIGNMENT: "Something declared with `const` was assigned to.",
  AXIS_SEMANTIC_ALREADY_DEFINED: "A name (variable, object, timeline, scene, page, or route) is declared more than once where it must be unique.",
  AXIS_VALIDATION_INVALID_DURATION: "An `animate`/timeline-step `duration` isn't a finite, non-negative number.",
  AXIS_VALIDATION_INVALID_DELAY: "An `animate` `delay` isn't a finite, non-negative number.",
  AXIS_VALIDATION_INVALID_TIMING: "A timing value (not specifically `duration`/`delay`) isn't a finite, non-negative number.",
  AXIS_VALIDATION_MISSING_DURATION: "An `animate` block has no `duration` at all.",
  AXIS_VALIDATION_INVALID_REPEAT: "`repeat` isn't a positive whole number or the keyword `infinite`.",
  AXIS_VALIDATION_UNKNOWN_EASING: "An `easing` value isn't one of linear/easeIn/easeOut/easeInOut.",
  AXIS_SEMANTIC_UNKNOWN_EVENT: "An `on` handler names an event AXIS doesn't recognize.",
  AXIS_SEMANTIC_UNKNOWN_VALUE: "A property was given a value from a fixed set (e.g. `camera.controls`) that isn't in that set.",
  AXIS_SEMANTIC_UNKNOWN_OPERATOR: "An internal-only case - an operator token reached evaluation without the parser recognizing it first.",
  AXIS_SEMANTIC_UNKNOWN_TARGET: "An `animate`/`on`/`play`/timeline-step target doesn't name any object/element that exists.",
  AXIS_SEMANTIC_UNKNOWN_PROPERTY: "A property, record field, or responsive breakpoint name doesn't exist on the thing it's used on.",
  AXIS_SEMANTIC_INVALID_COLOR: 'A `color`/`material.color`/`material.emissive` value isn\'t a color name or a `"#rrggbb"` string.',
  AXIS_SEMANTIC_INVALID_VECTOR: "A position/rotation/scale value isn't a 2-4 component vector of numbers.",
  AXIS_SEMANTIC_INVALID_MODEL_SRC: "A `model`'s `src` isn't a valid relative `.glb`/`.gltf` path.",
  AXIS_SEMANTIC_UNSAFE_URL: "An `href`/`src` value uses a URL scheme outside the http(s)/mailto/tel/relative allowlist (see src/urlSafety.js).",
  AXIS_SEMANTIC_LOOP_LIMIT_EXCEEDED: "A `while` loop ran past AXIS's own runaway-loop guard (one million iterations).",
  AXIS_SEMANTIC_INVALID_LOOP_TARGET: "A `for..in` was given something that isn't an array.",
  AXIS_SEMANTIC_ARITY_MISMATCH: "A function was called with the wrong number of arguments.",
  AXIS_SEMANTIC_NOT_CALLABLE: "Something that isn't a function was called like one.",
  AXIS_SEMANTIC_INDEX_OUT_OF_RANGE: "An array was indexed with a non-integer, or an index outside its length.",
  AXIS_SEMANTIC_INVALID_ASSIGNMENT_TARGET: "The runtime-side twin of AXIS_PARSE_INVALID_ASSIGNMENT_TARGET - reached only via a path the parser's own check doesn't cover.",
  AXIS_SEMANTIC_TYPE_MISMATCH: "An operator or builtin was used with a value of the wrong type (e.g. subtracting a number from a string).",
  AXIS_SEMANTIC_UNSUPPORTED_IN_CONTEXT: "A statement kind (e.g. `state`, `timeline`) was used somewhere that kind isn't valid (e.g. inside a component, inside a timeline step).",
  AXIS_SEMANTIC_INVALID_NESTING: "An element/object type that can't contain children was given children.",
  AXIS_SEMANTIC_RETURN_OUTSIDE_FUNCTION: "`return` was used outside any function body.",
  AXIS_SEMANTIC_NO_RENDERABLE_ROOT: "The file (and everything it imports) has no top-level `scene` or `page` at all.",
  AXIS_RUNTIME_ERROR: "A runtime/semantic error that doesn't match any more specific rule above.",
  AXIS_PLAN_WARNING: "Not an error - something the render-plan step noticed that's worth a developer's attention (e.g. a `scene` no `viewport` ever embeds).",
  AXIS_CLI_INVALID_FILE_TYPE: "`axis check` was given a path that doesn't end in `.ax`.",
  AXIS_IO_FILE_NOT_READABLE: "The file (or an imported file) couldn't be read from disk.",
  AXIS_INTERNAL_ERROR: "An unexpected failure that isn't a problem with the AXIS *program* being checked - likely a bug in AXIS itself.",
};

// Codes used directly (not via a rule-table match) by this file's fallback
// paths or by check.js - listed here, alongside the rule tables above, so
// tests/diagnostics.test.js can assert CODE_CATALOG covers every code AXIS
// can actually emit, not just the ones with a pattern rule.
export const NON_RULE_CODES = [
  "AXIS_PARSE_ERROR",
  "AXIS_MODULE_ERROR",
  "AXIS_RUNTIME_ERROR",
  "AXIS_INTERNAL_ERROR",
  "AXIS_PLAN_WARNING",
  "AXIS_CLI_INVALID_FILE_TYPE",
  "AXIS_IO_FILE_NOT_READABLE",
  "AXIS_SEMANTIC_NO_RENDERABLE_ROOT",
];

function classify(message, rules) {
  for (const [pattern, code] of rules) {
    if (typeof pattern === "string" ? message.includes(pattern) : pattern.test(message)) return code;
  }
  return null;
}

// suggest.js always appends exactly this shape - parsing it back out here
// (rather than threading a separate return value through every one of the
// ~15 call sites that use it) keeps suggest.js itself as the one place that
// owns the wording.
const DID_YOU_MEAN = / - did you mean '([^']+)'\?/;

function extractSuggestion(message, code) {
  const match = DID_YOU_MEAN.exec(message);
  if (match) return `Did you mean '${match[1]}'?`;
  return SUGGESTION_BY_CODE[code] ?? null;
}

function safeReadFile(filePath) {
  try {
    return readFileSync(filePath, "utf8");
  } catch {
    return undefined;
  }
}

function sourceContext(source, line, column) {
  if (!source || !line) return null;
  const text = source.split("\n")[line - 1];
  if (text === undefined) return null;
  if (column == null) return { line: text };
  return { line: text, pointerStart: Math.max(0, column - 1), pointerLength: 1 };
}

// Strips the "(line N)" / "(line N, column N)" suffix AxisSyntaxError's and
// AxisRuntimeError's own constructors bake into `.message` - the raw
// message (without location) is what a diagnostic's `message` field carries,
// since `location` already carries the same information structurally.
function stripLocationSuffix(message) {
  return message.replace(/ \(line \d+(?:, column \d+)?\)$/, "");
}

// Converts any error caught from the check pipeline into one Diagnostic.
// `requestedPath`/`requestedSource` are the file/text `axis check` was
// actually pointed at - for an error attributed to a *different* file (an
// imported component, via `.filePath` - see interpreter.js/modules.js) this
// reads that file instead, the same cross-file attribution cli.js's own
// reportError already does for `run`/`build`/`graph`.
export function errorToDiagnostic(err, { requestedPath, requestedSource }) {
  const sameFile = !err.filePath || err.filePath === nodePath.resolve(requestedPath);
  const file = sameFile ? requestedPath : err.filePath;
  const source = sameFile ? requestedSource : safeReadFile(err.filePath);

  if (err instanceof AxisSyntaxError) {
    const code = classify(err.message, SYNTAX_RULES) ?? "AXIS_PARSE_ERROR";
    const message = stripLocationSuffix(err.message);
    return {
      severity: "error",
      code,
      message,
      file,
      location: { start: { line: err.line, column: err.column } },
      source: sourceContext(source, err.line, err.column),
      suggestion: extractSuggestion(message, code),
    };
  }

  if (err instanceof AxisRuntimeError) {
    const code = classify(err.message, RUNTIME_RULES) ?? "AXIS_RUNTIME_ERROR";
    const message = stripLocationSuffix(err.message);
    return {
      severity: "error",
      code,
      message,
      file,
      location: err.line ? { start: { line: err.line } } : null,
      source: sourceContext(source, err.line, null),
      suggestion: extractSuggestion(message, code),
    };
  }

  if (err instanceof AxisModuleError) {
    const code = classify(err.message, MODULE_RULES) ?? "AXIS_MODULE_ERROR";
    return {
      severity: "error",
      code,
      message: err.message,
      file,
      location: null,
      source: null,
      suggestion: extractSuggestion(err.message, code),
    };
  }

  // Anything else is a genuine bug in AXIS itself, not an invalid program -
  // represented plainly rather than crashing `axis check` or leaking a raw
  // stack trace into --json's stdout.
  return {
    severity: "error",
    code: "AXIS_INTERNAL_ERROR",
    message: err.message ?? String(err),
    file,
    location: null,
    source: null,
    suggestion: null,
  };
}
