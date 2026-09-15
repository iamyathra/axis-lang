// `pause NAME`/`resume NAME`/`reverse NAME` - playback controls for an
// already-declared `timeline`, alongside the existing `play NAME` restart
// (see docs/language.md's Timelines section and
// docs/architecture/timeline-playback.md). Same target-name grammar (bare
// or computed) `play`/`stop` already use. What's build-time-checkable
// (parsing, the shape stored in a handler's body) is covered here - the
// actual per-frame playback state machine (pause/resume/reverse, in
// src/renderer/tween.js) is client-side runtime behavior with no
// Node-testable surface (same reasoning tests/timelines.test.js's header
// already gives for `play`) - see the architecture doc for how it was
// actually verified.

import { test } from "node:test";
import assert from "node:assert/strict";
import { run } from "../src/run.js";
import { pauseTimeline, resumeTimeline, reverseTimeline, restartTimeline, startTimelineState, tickTimeline } from "../src/renderer/tween.js";

// ---- parsing / interpreter shape --------------------------------------

test("'pause NAME' parses inside an 'on' handler", () => {
  const result = run(`
    scene main {
      cube box { color: red }
      timeline intro { animate box { position.y -> 1 duration: 100 } }
      on box.click { pause intro }
    }
  `);
  assert.equal(result.scenes[0].handlers[0].body[0].kind, "PauseStmt");
  assert.equal(result.scenes[0].handlers[0].body[0].target, "intro");
});

test("'resume NAME' and 'reverse NAME' parse the same way", () => {
  const result = run(`
    scene main {
      cube box { color: red }
      timeline intro { animate box { position.y -> 1 duration: 100 } }
      on box.click { resume intro }
      on box.hover { reverse intro }
    }
  `);
  assert.equal(result.scenes[0].handlers[0].body[0].kind, "ResumeStmt");
  assert.equal(result.scenes[0].handlers[1].body[0].kind, "ReverseStmt");
});

test("a computed target parses for pause/resume/reverse too, same as play/stop already do", () => {
  const result = run(`
    scene main {
      cube box { color: red }
      timeline intro { animate box { position.y -> 1 duration: 100 } }
      on box.click { pause ("intro") }
    }
  `);
  assert.equal(result.scenes[0].handlers[0].body[0].targetIsExpr, true);
});

test("pause/resume/reverse work inside a page's own 'on' handler too, not just a scene's", () => {
  const result = run(`
    page Home {
      button go { label: "go" }
      timeline intro { animate go { opacity -> 1 duration: 100 } }
      on go.click { pause intro }
    }
  `);
  assert.equal(result.pages[0].handlers[0].body[0].kind, "PauseStmt");
});

// ---- tween.js's own playback state machine (pure, Node-testable) -------

test("play/restart starts a fresh timeline at elapsed 0, moving forward", () => {
  const rt = startTimelineState(1000, [{ at: 0, duration: 1000, easing: "linear", changes: [] }]);
  let seen = [];
  tickTimeline(rt, 0, (step, t) => seen.push(t));
  assert.deepEqual(seen, [0]);
});

test("pause freezes the timeline's current position - ticking afterward doesn't advance it", () => {
  const rt = startTimelineState(1000, [{ at: 0, duration: 1000, easing: "linear", changes: [] }]);
  tickTimeline(rt, 0, () => {}); // starts it
  tickTimeline(rt, 300, () => {}); // advances to t=0.3
  pauseTimeline(rt, 300);
  let seen = [];
  tickTimeline(rt, 900, (step, t) => seen.push(t)); // should NOT tick at all while paused
  assert.deepEqual(seen, []);
});

test("resume continues from exactly where it was paused, not from 0", () => {
  const rt = startTimelineState(1000, [{ at: 0, duration: 1000, easing: "linear", changes: [] }]);
  tickTimeline(rt, 0, () => {});
  tickTimeline(rt, 300, () => {}); // t=0.3
  pauseTimeline(rt, 300);
  resumeTimeline(rt, 5000); // resumed much later in wall-clock time - shouldn't matter
  let seen = [];
  tickTimeline(rt, 5100, (step, t) => seen.push(t)); // 100ms after resuming
  assert.equal(seen[0], 0.4); // 0.3 (where it paused) + 100ms/1000ms = 0.4, not jumped or reset
});

test("resume on a timeline that was never paused is a no-op", () => {
  const rt = startTimelineState(1000, [{ at: 0, duration: 1000, easing: "linear", changes: [] }]);
  tickTimeline(rt, 0, () => {});
  resumeTimeline(rt, 500); // never paused
  assert.equal(rt.paused, false);
});

test("reverse flips direction in place - no jump, no restart", () => {
  const rt = startTimelineState(1000, [{ at: 0, duration: 1000, easing: "linear", changes: [] }]);
  tickTimeline(rt, 0, () => {});
  tickTimeline(rt, 600, () => {}); // t=0.6
  reverseTimeline(rt, 600);
  let seen = [];
  tickTimeline(rt, 800, (step, t) => seen.push(t)); // 200ms later, but now REVERSING
  assert.equal(seen[0], 0.4); // 0.6 - 200/1000 = 0.4
});

test("reversing a naturally-finished timeline (reached the end) starts it moving back from there", () => {
  const rt = startTimelineState(1000, [{ at: 0, duration: 1000, easing: "linear", changes: [] }]);
  tickTimeline(rt, 0, () => {});
  tickTimeline(rt, 1000, () => {}); // reaches the end
  assert.equal(rt.finished, true);
  reverseTimeline(rt, 1000);
  assert.equal(rt.finished, false);
  let seen = [];
  tickTimeline(rt, 1300, (step, t) => seen.push(t));
  assert.equal(seen[0], 0.7); // 1.0 - 300/1000
});

test("reversing all the way back to 0 finishes it again, frozen at the start", () => {
  const rt = startTimelineState(1000, [{ at: 0, duration: 1000, easing: "linear", changes: [] }]);
  tickTimeline(rt, 0, () => {});
  tickTimeline(rt, 500, () => {}); // t=0.5
  reverseTimeline(rt, 500);
  tickTimeline(rt, 1000, () => {}); // 500ms in reverse -> reaches 0
  assert.equal(rt.finished, true);
  let seen = [];
  tickTimeline(rt, 1500, (step, t) => seen.push(t)); // should no longer tick - finished
  assert.deepEqual(seen, []);
});

// ---- onComplete ---------------------------------------------------------

test("tickTimeline calls onComplete exactly once, the instant it reaches the end", () => {
  const rt = startTimelineState(1000, [{ at: 0, duration: 1000, easing: "linear", changes: [] }]);
  let completions = 0;
  tickTimeline(rt, 0, () => {}, () => completions++);
  tickTimeline(rt, 500, () => {}, () => completions++); // not there yet
  assert.equal(completions, 0);
  tickTimeline(rt, 1000, () => {}, () => completions++); // reaches the end
  assert.equal(completions, 1);
  tickTimeline(rt, 1500, () => {}, () => completions++); // already finished - short-circuits before onComplete
  assert.equal(completions, 1);
});

test("tickTimeline calls onComplete again after a reverse reaches the other end", () => {
  const rt = startTimelineState(1000, [{ at: 0, duration: 1000, easing: "linear", changes: [] }]);
  let completions = 0;
  const onComplete = () => completions++;
  tickTimeline(rt, 0, () => {}, onComplete);
  tickTimeline(rt, 1000, () => {}, onComplete);
  assert.equal(completions, 1);
  reverseTimeline(rt, 1000);
  tickTimeline(rt, 1000, () => {}, onComplete);
  tickTimeline(rt, 2000, () => {}, onComplete); // 1000ms in reverse -> reaches 0
  assert.equal(completions, 2);
});

test("tickTimeline never calls onComplete for a scroll-driven timeline", () => {
  const rt = startTimelineState(1000, [{ at: 0, duration: 1000, easing: "linear", changes: [] }]);
  rt.driver = "scroll";
  let completions = 0;
  tickTimeline(rt, 1000, () => {}, () => completions++);
  assert.equal(completions, 0);
});

// ---- loop -----------------------------------------------------------------

test("a loop: true timeline wraps around instead of finishing, and never calls onComplete", () => {
  const rt = startTimelineState(1000, [{ at: 0, duration: 1000, easing: "linear", changes: [] }], true);
  let completions = 0;
  tickTimeline(rt, 0, () => {}, () => completions++);
  tickTimeline(rt, 1016, () => {}, () => completions++); // 16ms past the end - one lap plus overshoot
  assert.equal(rt.finished, false);
  assert.equal(completions, 0);
  assert.equal(rt.baseElapsed, 16); // carried the overshoot into the next lap, not snapped to 0
});

test("a loop: true timeline keeps advancing across many laps", () => {
  const rt = startTimelineState(1000, [{ at: 0, duration: 1000, easing: "linear", changes: [] }], true);
  let last;
  tickTimeline(rt, 0, () => {});
  tickTimeline(rt, 300, (step, t) => (last = t));
  assert.equal(last, 0.3);
  // Crosses the first lap boundary this frame - shows t=1 momentarily (same
  // as a non-looping timeline would on its very last frame); the wrap
  // itself only affects where the *next* tick starts from.
  tickTimeline(rt, 1016, (step, t) => (last = t));
  assert.equal(last, 1);
  assert.equal(rt.finished, false);
  tickTimeline(rt, 1032, (step, t) => (last = t)); // 16ms into lap 2
  assert.ok(Math.abs(last - 0.032) < 1e-9);
  tickTimeline(rt, 2032, (step, t) => (last = t)); // crosses the second lap boundary
  assert.equal(last, 1);
  assert.equal(rt.finished, false);
});

test("a loop: true timeline wraps symmetrically in reverse", () => {
  const rt = startTimelineState(1000, [{ at: 0, duration: 1000, easing: "linear", changes: [] }], true);
  tickTimeline(rt, 0, () => {});
  reverseTimeline(rt, 0);
  tickTimeline(rt, 16, () => {}); // 16ms past 0, running backward
  assert.equal(rt.finished, false);
  assert.equal(rt.baseElapsed, 984); // wrapped to near the end (1000 - 16), not snapped to 1000
});

test("loop: false (the default) still finishes normally - loop doesn't change existing behavior", () => {
  const rt = startTimelineState(1000, [{ at: 0, duration: 1000, easing: "linear", changes: [] }]);
  let completions = 0;
  tickTimeline(rt, 0, () => {}, () => completions++);
  tickTimeline(rt, 1000, () => {}, () => completions++);
  assert.equal(rt.finished, true);
  assert.equal(completions, 1);
});

test("play/restart resets direction back to forward from 0, even after a reverse", () => {
  const rt = startTimelineState(1000, [{ at: 0, duration: 1000, easing: "linear", changes: [] }]);
  tickTimeline(rt, 0, () => {});
  reverseTimeline(rt, 0);
  restartTimeline(rt);
  assert.equal(rt.direction, 1);
  assert.equal(rt.paused, false);
  // the tick that follows a restart always re-seeds its own baseline at
  // whatever `now` it's given, the same "first tick after a (re)start is
  // always elapsed 0" behavior this had before pause/resume/reverse
  // existed - a *second* tick, 100ms later, is where forward progress
  // actually shows up.
  let seen = [];
  tickTimeline(rt, 100, (step, t) => seen.push(t));
  assert.equal(seen[0], 0);
  tickTimeline(rt, 200, (step, t) => seen.push(t));
  assert.equal(seen[1], 0.1);
});

test("pause on an already-finished timeline is a no-op, not an error", () => {
  const rt = startTimelineState(1000, [{ at: 0, duration: 1000, easing: "linear", changes: [] }]);
  tickTimeline(rt, 0, () => {});
  tickTimeline(rt, 1000, () => {});
  assert.equal(rt.finished, true);
  pauseTimeline(rt, 1000); // shouldn't throw
  assert.equal(rt.paused, false); // finished, never actually paused
});
