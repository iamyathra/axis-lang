// The engine behind `axis check` - runs a .ax file (and everything it
// `import`s) through the real pipeline (lex -> parse -> resolve imports ->
// interpret -> build a render plan) and reports the result as a list of
// Diagnostic objects (see diagnostics.js), instead of exiting the process
// or printing anything itself. cli.js's `check` command is a thin
// text/--json formatter over this; nothing here is CLI-specific, so it's
// directly unit-testable and reusable by any future tool (an editor
// extension, an LSP) that wants the same validation without shelling out.
//
// Deliberately stops short of anything that needs a browser (per the 2026
// audit: "do not fake validation by simply attempting a browser render") -
// building the render plan is the last step that's still pure data in, pure
// data out (see renderer/plan.js's own header comment), so it's included;
// mounting/rendering to an actual DOM or three.js scene is not.
//
// A top-level `while`/`for` that never terminates will hang this exactly as
// it would `axis run`/`axis build` - the interpreter's own "over a million
// iterations" guard (evaluator.js) is what stops a runaway loop, not
// anything added here.

import { readFileSync } from "node:fs";
import { resolveModules, AxisModuleError } from "./modules.js";
import { interpret } from "./interpreter.js";
import { AxisSyntaxError } from "./lexer.js";
import { AxisRuntimeError } from "./evaluator.js";
import { buildRenderPlan } from "./renderer/plan.js";
import { buildDomPlan, buildDomRouterPlan } from "./renderer/domPlan.js";
import { errorToDiagnostic, DIAGNOSTIC_SCHEMA_VERSION } from "./diagnostics.js";

function result(valid, diagnostics) {
  return { version: DIAGNOSTIC_SCHEMA_VERSION, valid, diagnostics };
}

function errorResult(severity, code, message, path, suggestion = null) {
  return result(severity !== "error", [{ severity, code, message, file: path, location: null, source: null, suggestion }]);
}

// Checks `path` (and anything it `import`s) and returns
// `{ version, valid, diagnostics }`. Never throws for an invalid *AXIS*
// program - an AxisSyntaxError/AxisRuntimeError/AxisModuleError always
// becomes a diagnostic instead. A genuinely unexpected exception (a bug in
// AXIS itself) still propagates, since silently swallowing it as if it were
// a user error would be actively misleading.
export function checkFile(path) {
  if (!path.endsWith(".ax")) {
    return errorResult("error", "AXIS_CLI_INVALID_FILE_TYPE", `expected a .ax file, got '${path}'`, path);
  }

  let source;
  try {
    source = readFileSync(path, "utf8");
  } catch (err) {
    return errorResult("error", "AXIS_IO_FILE_NOT_READABLE", `couldn't read '${path}': ${err.message}`, path);
  }

  const diagnosticFor = (err) => errorToDiagnostic(err, { requestedPath: path, requestedSource: source });

  let program;
  try {
    program = resolveModules(path);
  } catch (err) {
    if (err instanceof AxisSyntaxError || err instanceof AxisModuleError) return result(false, [diagnosticFor(err)]);
    throw err;
  }

  let interpretResult;
  try {
    interpretResult = interpret(program);
  } catch (err) {
    if (err instanceof AxisRuntimeError) return result(false, [diagnosticFor(err)]);
    throw err;
  }

  const hasScenes = interpretResult.scenes.length > 0;
  const hasPages = interpretResult.pages.length > 0;
  const hasRoutes = (interpretResult.routes?.length ?? 0) > 0;
  if (!hasScenes && !hasPages) {
    return errorResult(
      "error",
      "AXIS_SEMANTIC_NO_RENDERABLE_ROOT",
      "no 'scene' or 'page' found to render",
      path,
      'Add a top-level `scene name { ... }` or `page "Title" { ... }` block.'
    );
  }

  let plan;
  try {
    plan = hasRoutes ? buildDomRouterPlan(interpretResult) : hasPages ? buildDomPlan(interpretResult) : buildRenderPlan(interpretResult);
  } catch (err) {
    if (err instanceof AxisRuntimeError) return result(false, [diagnosticFor(err)]);
    throw err;
  }

  const warnings = (plan.warnings ?? []).map((message) => ({
    severity: "warning",
    code: "AXIS_PLAN_WARNING",
    message,
    file: path,
    location: null,
    source: null,
    suggestion: null,
  }));

  return result(true, warnings);
}
