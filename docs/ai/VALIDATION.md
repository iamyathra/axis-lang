# The `axis check` / `axis check --json` contract

`axis check <file.ax> [--json]` runs a `.ax` file (and everything it
`import`s) through AXIS's real pipeline - lex, parse, resolve imports,
interpret, build a render plan - without opening a browser or a dev server.
It's the one command an AI agent (or a human, or an editor extension) needs
to know a program is valid.

```
source
  -> lex + parse (syntax)
  -> resolve imports (module graph)
  -> interpret (semantics: types, unknown properties/targets/events,
                timing validation, component params, ...)
  -> build a render plan (the one remaining check that's still pure data:
     "is a declared scene ever embedded", etc. - surfaced as *warnings*,
     not errors)
```

This is the actual pipeline `axis run`/`axis build` use up through "build a
render plan" - `check` does not fake validation by going further and trying
to mount to a real DOM or three.js scene (see
[../architecture/2026-audit.md](../architecture/2026-audit.md)).

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Valid. May still have `severity: "warning"` diagnostics. |
| `1` | Invalid - at least one `severity: "error"` diagnostic. |
| `2` | Couldn't run the check at all (missing `<file.ax>` argument, or an internal AXIS bug - not a problem with your program). |

## Human-readable mode (default)

```
✓ app.ax is valid
```

or, with one or more problems:

```
✗ app.ax is invalid

error[AXIS_VALIDATION_INVALID_DURATION] app.ax:12:14
'duration' must be a finite, non-negative number, got -500

  12 | duration -500
     |          ^

suggestion: Use a positive, finite number of milliseconds, e.g. `duration: 500`.
```

A caret under the offending token appears only when AXIS actually knows the
column (true for lexer/parser errors; most semantic errors only carry a line
number - see "Location precision," below). This format is for humans reading
a terminal - don't parse it. Parse `--json`.

## `--json` mode: the machine-readable contract

`axis check <file.ax> --json` prints **one JSON object and nothing else** to
stdout - no logs, no warnings, no partial output, even if the `.ax` program
itself calls the `print()` builtin at the top level (AXIS's `print` is
suppressed for the duration of a `--json` check). Anything AXIS itself needs
to say about the *check command* (not the program) goes to stderr, never
stdout.

### Shape

```json
{
  "version": 1,
  "valid": false,
  "diagnostics": [
    {
      "severity": "error",
      "code": "AXIS_VALIDATION_INVALID_DURATION",
      "message": "'duration' must be a finite, non-negative number, got -500",
      "file": "app.ax",
      "location": { "start": { "line": 12, "column": 14 } },
      "source": { "line": "duration -500", "pointerStart": 9, "pointerLength": 4 },
      "suggestion": "Use a positive, finite number of milliseconds, e.g. `duration: 500`."
    }
  ]
}
```

A valid program with no warnings:

```json
{ "version": 1, "valid": true, "diagnostics": [] }
```

### Field reference

| Field | Type | Always present? | Notes |
| --- | --- | --- | --- |
| `version` | number | yes | Schema version, currently `1`. See "Versioning," below. |
| `valid` | boolean | yes | `true` iff there are zero `severity: "error"` diagnostics. Warnings alone don't make a program invalid. |
| `diagnostics` | array | yes | May be empty. Order is: the single fatal error that stopped the pipeline (if any), otherwise every plan-level warning. |
| `diagnostics[].severity` | `"error"` \| `"warning"` | yes | AXIS has no other severities today. |
| `diagnostics[].code` | string | yes | One of the stable codes in [ERROR_CODES.md](ERROR_CODES.md). Always present, even when nothing more specific matched (falls back to a per-category code like `AXIS_RUNTIME_ERROR`). |
| `diagnostics[].message` | string | yes | The actual AXIS error message, human-written, with any `(line N)`/`(line N, column N)` suffix stripped (that information is in `location` instead). |
| `diagnostics[].file` | string | yes | The file the problem is actually in - for an error inside an `import`ed component, this is the imported file's own path, not the file you ran `check` on. |
| `diagnostics[].location` | object \| `null` | no | `{ start: { line, column? } }`. `null` when AXIS genuinely has no line number for this error (a module-resolution error, or "no scene/page found at all"). |
| `diagnostics[].source` | object \| `null` | no | `{ line, pointerStart?, pointerLength? }` - the offending source line's text, plus a caret's position *when the column is known*. `null` when there's no `location` to pull a line from. |
| `diagnostics[].suggestion` | string \| `null` | no | A concrete fix. Either a "did you mean 'x'?" from AXIS's own typo-suggestion engine, or a short hand-written note for the highest-frequency codes. `null` is honest, not a bug - most codes don't have one yet. |

### Location precision (read this before assuming every diagnostic has a column)

AXIS's lexer and parser track both line *and* column for every token.
AXIS's interpreter/evaluator (everything semantic: unknown properties,
timing validation, unknown targets, type errors, ...) only tracks **line**
today. That means:

- A syntax error (`AXIS_LEX_*`, `AXIS_PARSE_*`) always has
  `location.start.column` and a `source.pointerStart`/`pointerLength`.
- A semantic error (`AXIS_SEMANTIC_*`, `AXIS_VALIDATION_*`) has
  `location.start.line` but **no `column`** - `source.line` is still
  present (so you can show the line), but there's no caret to draw.
- A module-resolution error (`AXIS_MODULE_*`) and
  `AXIS_SEMANTIC_NO_RENDERABLE_ROOT` have `location: null` entirely - there
  is no single line the problem is "at."

Don't assume `location.start.column` exists; check for it.

### One diagnostic per invalid run (today)

AXIS's pipeline stops at the first error, the same way `axis run`/`axis
build` do - there's no partial-recovery multi-error parsing/interpretation
yet. So `diagnostics` for an **invalid** program currently has exactly one
`severity: "error"` entry. A **valid** program's `diagnostics` can have
*multiple* `severity: "warning"` entries (every plan-level warning is
collected, not just the first). If AXIS ever grows multi-error recovery,
`diagnostics` gaining more error entries is additive, not a breaking schema
change - don't assume "exactly one" as a hard invariant when writing a
consumer.

### Versioning

`version` will only change for an actual breaking change to this shape
(a field renamed or removed, a type changed). Adding a new `code` to
[ERROR_CODES.md](ERROR_CODES.md), or a new optional field, is not a breaking
change and does not bump `version`.

## Non-goals

`axis check` does not run a linter/style-checker (AXIS has no formatter or
style rules yet), does not check anything that requires an actual browser
(a `viewport`'s three.js mount, a real network `fetch`, DOM measurement),
and does not execute `on` handlers (those only run live, from user
interaction) - it validates the program's *structure*, the same thing
`axis run`/`axis build` would fail on before ever opening a browser tab.
