// Animation timing validation: `duration`/`delay`/`at` must be finite,
// non-negative numbers (duration/delay) or finite numbers (at) before they
// ever reach the tween runtime (tween.js does pure arithmetic on them, no
// other validation layer) - NaN/Infinity/negative would otherwise produce a
// permanently-running animation, a NaN tween progress, or a render loop that
// never settles. Two build-time paths (interpreter.js's
// `applyAnimateTimingEntry`, for a load-time `animate`/timeline step) and
// one live-trigger path (evaluator.js's `parseAnimateTiming`, for an
// `animate` triggered from an `on` handler) all funnel through the same
// validation shape - see src/evaluator.js and src/interpreter.js.

import { test } from "node:test";
import assert from "node:assert/strict";
import { run } from "../src/run.js";
import { AxisRuntimeError } from "../src/interpreter.js";
import { tokenize } from "../src/lexer.js";
import { parse } from "../src/parser.js";
import { parseAnimateTiming } from "../src/evaluator.js";
import { stepAnimation } from "../src/renderer/tween.js";
import { createGlobalEnv } from "../src/globals.js";

// ---- build-time path (interpreter.js#applyAnimateTimingEntry) -----------

test("duration: 0 is valid - builds cleanly, no error", () => {
  const result = run(`scene main { cube box { } animate box { position.y -> 1 duration: 0 } }`);
  assert.equal(result.scenes[0].animations.length, 1);
  assert.equal(result.scenes[0].animations[0].duration, 0);
});

test("a negative duration is rejected at build time", () => {
  assert.throws(
    () => run(`scene main { cube box { } animate box { position.y -> 1 duration: -100 } }`),
    (err) => err instanceof AxisRuntimeError && /duration.*finite, non-negative/.test(err.message)
  );
});

test("a NaN duration (0/0) is rejected at build time", () => {
  assert.throws(
    () => run(`scene main { cube box { } animate box { position.y -> 1 duration: 0 / 0 } }`),
    (err) => err instanceof AxisRuntimeError && /duration.*finite, non-negative/.test(err.message)
  );
});

test("an infinite duration is rejected at build time", () => {
  assert.throws(
    () => run(`scene main { cube box { } animate box { position.y -> 1 duration: infinite } }`),
    (err) => err instanceof AxisRuntimeError && /duration.*finite, non-negative/.test(err.message)
  );
});

test("a NaN delay is rejected at build time", () => {
  assert.throws(
    () => run(`scene main { cube box { } animate box { position.y -> 1 duration: 500 delay: 0 / 0 } }`),
    (err) => err instanceof AxisRuntimeError && /delay.*finite, non-negative/.test(err.message)
  );
});

test("an infinite delay is rejected at build time", () => {
  assert.throws(
    () => run(`scene main { cube box { } animate box { position.y -> 1 duration: 500 delay: infinite } }`),
    (err) => err instanceof AxisRuntimeError && /delay.*finite, non-negative/.test(err.message)
  );
});

test("a negative delay is rejected at build time", () => {
  assert.throws(
    () => run(`scene main { cube box { } animate box { position.y -> 1 duration: 500 delay: -1 } }`),
    (err) => err instanceof AxisRuntimeError && /delay.*finite, non-negative/.test(err.message)
  );
});

test("the same validation applies inside a timeline step's own 'duration'", () => {
  assert.throws(
    () => run(`scene main { cube box { } timeline t { animate box { position.y -> 1 duration: -50 } } }`),
    (err) => err instanceof AxisRuntimeError && /duration.*finite, non-negative/.test(err.message)
  );
});

test("an infinite 'at' is rejected on a timeline step, a negative one is not", () => {
  assert.throws(
    () => run(`scene main { cube box { } timeline t { animate box { position.y -> 1 duration: 100 at: infinite } } }`),
    (err) => err instanceof AxisRuntimeError && /'at' must be a finite number/.test(err.message)
  );
  const result = run(`scene main { cube box { } timeline t { animate box { position.y -> 1 duration: 100 at: -50 } } }`);
  assert.equal(result.scenes[0].timelines[0].steps[0].at, -50);
});

// ---- live-trigger path (evaluator.js#parseAnimateTiming) ----------------
// This path only ever runs in the browser (triggered from an 'on' handler,
// via domClient.js/scene3d.js's own onCustomStatement hook - see
// evaluator.js's execute() default case) - exercised directly here, the
// same function the browser runtime calls, against a hand-parsed
// AnimateDecl pulled out of a real 'on' handler body.

function parseTriggeredAnimateDecl(source) {
  const program = parse(tokenize(source));
  const onDecl = program.items[0].body.find((s) => s.kind === "OnDecl");
  return onDecl.body.find((s) => s.kind === "AnimateDecl");
}

test("parseAnimateTiming rejects a negative duration the same way, live", () => {
  const decl = parseTriggeredAnimateDecl(
    `scene main { cube box { } on box.click { animate box { position.y -> 1 duration: -100 } } }`
  );
  assert.throws(
    () => parseAnimateTiming(decl, createGlobalEnv()),
    (err) => err instanceof AxisRuntimeError && /duration.*finite, non-negative/.test(err.message)
  );
});

test("parseAnimateTiming rejects an infinite delay the same way, live", () => {
  const decl = parseTriggeredAnimateDecl(
    `scene main { cube box { } on box.click { animate box { position.y -> 1 duration: 500 delay: infinite } } }`
  );
  assert.throws(
    () => parseAnimateTiming(decl, createGlobalEnv()),
    (err) => err instanceof AxisRuntimeError && /delay.*finite, non-negative/.test(err.message)
  );
});

test("parseAnimateTiming accepts duration: 0 live, same as build time", () => {
  const decl = parseTriggeredAnimateDecl(
    `scene main { cube box { } on box.click { animate box { position.y -> 1 duration: 0 } } }`
  );
  const timing = parseAnimateTiming(decl, createGlobalEnv());
  assert.equal(timing.duration, 0);
});

// ---- tween runtime never sees NaN progress for a zero-duration animation -

test("stepAnimation on a zero-duration animation applies t=1 once and finishes immediately - no NaN frame", () => {
  const anim = { finished: false, startTime: null, delay: 0, duration: 0, repeat: 1, easing: "linear", target: "box", changes: [{ path: "position.y", toValue: 1 }] };
  const applied = [];
  const needsMore = stepAnimation(anim, 1000, () => true, (target, change, t) => applied.push(t));
  assert.equal(needsMore, true); // this frame did real work
  assert.equal(anim.finished, true);
  assert.deepEqual(applied, [1]); // exactly one apply, at t=1 - never NaN
  // a second call, any time later, is a pure no-op (already finished)
  const again = stepAnimation(anim, 2000, () => true, () => applied.push("should not run"));
  assert.equal(again, false);
  assert.equal(applied.length, 1);
});
