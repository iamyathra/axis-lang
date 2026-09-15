// The cycle/repeat/delay/easing stepping math both browser runtimes need -
// domClient.js (a DOM element) and scene3d.js (a three.js object) - is
// conceptually one timeline architecture (Rule 3: one thing, not two to
// keep in sync), but until now the actual *stepping code* was two
// hand-written copies of it. Extracted here so a future fix to this math
// only has to happen once. Everything genuinely different between the two
// callers (how a change actually gets applied, what "does this target
// still exist" means, any render-on-demand `dirty` bookkeeping) stays
// entirely with the caller, passed in as plain callbacks - this file
// knows nothing about the DOM or three.js.

import { EASINGS } from "./easing.js";

// Advances one already-scheduled `animate` (load-time or triggered from an
// `on` handler) by exactly one frame.
//
// `hasTarget(name)`: does the target this animation was scheduled against
// still exist (a DOM element removed from the page, a disposed scene's
// object, ...) - if not, the animation is retired rather than erroring.
// `applyOneChange(target, change, t)`: actually apply one interpolated
// change - the one thing a DOM write and a three.js mutation have nothing
// in common on.
//
// Returns whether this animation needed a frame at all this call (i.e.
// "was it not already finished when this was called") - which is exactly
// what a caller's own `needsMore` accumulator wants, whether or not this
// particular frame did anything (still waiting out its own `delay`, or
// its target just vanished) - an animation only ever stops asking for
// frames once `anim.finished` is true.
export function stepAnimation(anim, now, hasTarget, applyOneChange) {
  if (anim.finished) return false;
  if (anim.startTime === null) anim.startTime = now;

  const elapsed = now - anim.startTime - anim.delay;
  if (elapsed < 0) return true;

  if (!hasTarget(anim.target)) {
    anim.finished = true;
    return true;
  }

  // A zero-duration animation has already reached its end the instant its
  // delay elapses - skip the cycle/t math entirely rather than dividing by
  // zero (elapsed/0 is NaN when elapsed is also 0, Infinity otherwise -
  // either way, one bad frame before this would otherwise self-correct).
  // Mirrors applyTimelineAtElapsed's own `step.duration <= 0 ? 1 : ...` guard.
  if (anim.duration <= 0) {
    for (const change of anim.changes) applyOneChange(anim.target, change, 1);
    anim.finished = true;
    return true;
  }

  const cyclesElapsed = Math.floor(elapsed / anim.duration);
  const isLastCycle = anim.repeat !== "infinite" && cyclesElapsed >= anim.repeat;
  const rawT = isLastCycle ? 1 : (elapsed % anim.duration) / anim.duration;
  const t = (EASINGS[anim.easing] ?? EASINGS.linear)(rawT);

  for (const change of anim.changes) applyOneChange(anim.target, change, t);

  if (isLastCycle) anim.finished = true;
  return true;
}

// A `timeline`'s own already-fully-scheduled steps (every step carries an
// absolute `at`, computed once at build time - see interpreter.js's
// buildTimelineSteps), evaluated at a given elapsed time. Shared by
// wall-clock playback and scroll-driven seeking alike (both are just
// different ways of producing `elapsed` - see docs/language.md's
// Timelines section) - idempotent, so calling this twice with the same
// `elapsed` always produces the same result, which is what makes
// scroll-scrubbing exact and reversible.
//
// `applyStep(step, t)`: the one thing that differs by caller - a page
// timeline step is either a DOM change or (via a cross-referenced
// `viewport`) a call into that scene's own runtime; a scene timeline step
// is always a three.js object mutation. Resolving *which* target a step
// actually means, and what "apply" means for it, is entirely the caller's
// job - this only handles the shared per-step timing math.
export function applyTimelineAtElapsed(rt, elapsed, applyStep) {
  for (const step of rt.steps) {
    const stepElapsed = elapsed - step.at;
    if (stepElapsed < 0) continue;
    const rawT = step.duration <= 0 ? 1 : Math.min(1, stepElapsed / step.duration);
    const t = (EASINGS[step.easing] ?? EASINGS.linear)(rawT);
    applyStep(step, t);
  }
}

// ---- playback state ---------------------------------------------------
// A wall-clock-driven timeline's position is `baseElapsed`, advanced from
// `baseTime` at `direction` (+1 forward, -1 reverse) ms per ms - rather
// than the single `startTime` this used before `pause`/`resume`/`reverse`
// existed, since those need to freeze/resume/flip direction *from
// wherever it currently is*, not always from 0. `paused` and `finished`
// both mean "don't advance," for different reasons (an explicit pause
// vs. having run all the way to one end) - kept as two separate flags
// (rather than collapsing "paused" into a third `finished` state) because
// `resume` only ever needs to undo the first one.
export function startTimelineState(duration, steps, loop = false) {
  return { duration, steps, driver: "playback", finished: steps.length === 0, paused: false, baseElapsed: 0, baseTime: null, direction: 1, loop };
}

function currentElapsed(rt, now) {
  if (rt.paused || rt.baseTime === null) return rt.baseElapsed;
  return rt.baseElapsed + rt.direction * (now - rt.baseTime);
}

// The per-frame wrapper around applyTimelineAtElapsed: only advances a
// wall-clock-driven (`driver === "playback"`) timeline that isn't paused
// or already finished, and marks it finished once elapsed time has
// reached either end (0, running in reverse; its own full duration,
// running forward - `reverse` is exactly what lets it reach the *first*
// one). A scroll-driven timeline (`driver === "scroll"`) is left alone
// here entirely - seekTimeline/seekPageTimeline call
// applyTimelineAtElapsed directly instead, since scroll supplies its own
// `elapsed`.
// `onComplete` (optional): called exactly once per `play`/`reverse` run, the
// instant this timeline reaches either end - never on a tick that was
// already finished (the early `rt.finished` return above means this
// function's own `reachedEnd` block only ever executes on the one tick that
// transitions `finished` from false to true), never for a scroll-driven
// timeline (`driver !== "playback"` returns before reaching it) - scroll
// scrubbing back and forth across a timeline's end isn't a meaningful
// "completion" the way a wall-clock run finishing once is - and never for a
// `loop: true` timeline (see the note just below `reachedEnd`, below): a
// lap ending isn't a completion either, it's a continuation. The caller is
// what actually knows how to run an `on NAME.complete` handler body (a
// scene's own executeBlockAsync vs. a page's) - this only decides *when*.
export function tickTimeline(rt, now, applyStep, onComplete) {
  if (rt.driver !== "playback" || rt.finished || rt.paused) return;
  if (rt.baseTime === null) rt.baseTime = now;
  const elapsed = currentElapsed(rt, now);
  const clamped = Math.max(0, Math.min(rt.duration, elapsed));
  applyTimelineAtElapsed(rt, clamped, applyStep);
  const reachedEnd = rt.direction >= 0 ? elapsed >= rt.duration : elapsed <= 0;
  if (reachedEnd) {
    if (rt.loop && rt.duration > 0) {
      // Wrap around in place, carrying over whatever this frame's own
      // overshoot past the end was (elapsed can land a few ms beyond
      // duration/before 0 depending on frame timing) rather than snapping
      // to exactly 0/duration every lap - so a loop's actual speed stays
      // accurate over many laps instead of quietly losing a few ms each
      // time. Direction-symmetric: reversing into a loop wraps at 0 back
      // to the end, the same idea just mirrored.
      const overshoot = rt.direction >= 0 ? elapsed - rt.duration : -elapsed;
      rt.baseElapsed = rt.direction >= 0 ? overshoot : rt.duration - overshoot;
      rt.baseTime = now;
      return;
    }
    rt.finished = true;
    rt.baseElapsed = clamped;
    rt.baseTime = now;
    onComplete?.();
  }
}

// `play NAME` - (re)starts from the very beginning, forward, exactly as
// before `pause`/`resume`/`reverse` existed.
export function restartTimeline(rt) {
  rt.driver = "playback";
  rt.finished = rt.steps.length === 0;
  rt.paused = false;
  rt.baseElapsed = 0;
  rt.baseTime = null;
  rt.direction = 1;
}

// `pause NAME` - freezes it at its *current* elapsed position (not reset
// to 0, the same "freeze in place" idea `stop` already has for a model's
// clip). A no-op, not an error, if it's already paused or already
// finished - nothing to freeze either way.
export function pauseTimeline(rt, now) {
  if (rt.paused || rt.finished) return;
  rt.baseElapsed = currentElapsed(rt, now);
  rt.baseTime = now;
  rt.paused = true;
}

// `resume NAME` - continues a paused timeline from exactly where it was
// frozen, in whichever direction it was already headed. A no-op if it
// wasn't actually paused (never started, or naturally finished - `reverse`
// is what un-sticks a finished one, not `resume`).
export function resumeTimeline(rt, now) {
  if (!rt.paused) return;
  rt.paused = false;
  rt.baseTime = now;
}

// `reverse NAME` - flips which direction it's currently advancing in,
// *in place*, without restarting or losing its current position -
// captures wherever it actually is right now (paused or not) as the new
// reference point, then flips the sign. Also the one thing that can move
// a *finished* timeline again (reversing away from whichever end it
// settled at) - `finished` only ever meant "don't advance," not "dead."
// Leaves `paused` exactly as it was: reversing a paused timeline just
// changes which way `resume` will continue it.
export function reverseTimeline(rt, now) {
  rt.baseElapsed = Math.max(0, Math.min(rt.duration, currentElapsed(rt, now)));
  rt.baseTime = now;
  rt.direction = -rt.direction;
  rt.finished = false;
}
