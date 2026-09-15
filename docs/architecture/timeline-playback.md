# Timeline playback controls: `pause`/`resume`/`reverse`

Status: **implemented.** `play NAME` was the only playback control a
`timeline` had - a restart, always from 0, always forward. This was #2 on
the project's own roadmap (queued right after nested scroll containers,
which [nested-scroll.md](nested-scroll.md) closed first).

```ax
on pauseBtn.click { pause reveal }
on resumeBtn.click { resume reveal }
on reverseBtn.click { reverse reveal }
```

Same target-name grammar `play`/`stop` already use (bare or computed);
same scroll-driven-timeline guard `play` already has (a timeline claimed
by a `scrollTimeline` can't be manually controlled at all, `play`
included - the same invariant, just enforced for three more verbs now).

## The state machine: `src/renderer/tween.js`

A wall-clock-driven timeline used to track only `startTime` - `elapsed =
now - startTime`, always increasing, always from 0. That has no way to
freeze in place, resume from exactly where it was, or run backward without
losing its position. Replaced with `baseElapsed`/`baseTime`/`direction`
(+1 or -1)/`paused`:

```
currentElapsed(now) = paused ? baseElapsed : baseElapsed + direction * (now - baseTime)
```

- **`play`/restart**: `baseElapsed = 0, baseTime = null, direction = 1,
  paused = false` - exactly the old behavior.
- **`pause`**: captures `currentElapsed(now)` into `baseElapsed`, resets
  `baseTime = now`, sets `paused = true` - `tickTimeline` simply skips a
  paused timeline entirely, so nothing advances until resumed.
- **`resume`**: `paused = false`, `baseTime = now` - continues from
  exactly the frozen value, in whichever direction it already was.
- **`reverse`**: captures `currentElapsed(now)` (works whether paused or
  not) into `baseElapsed`, resets `baseTime = now`, flips `direction`.
  Also clears `finished` - reversing away from either end (a natural
  finish, or having reversed all the way back to 0) is exactly what makes
  a "settled" timeline move again. `finished` was always "don't advance,"
  never "dead."

Because `pause`/`resume`/`reverse` all read the timeline's *current*
position through the same `currentElapsed` formula before changing
anything, none of them can jump or lose position - a real difference from
naively resetting `startTime` on resume, which would have skipped forward
by however long the pause actually lasted in wall-clock time.

Shared by both runtimes exactly like the stepping math
([tween-extraction.md](tween-extraction.md)) already was -
`scene3d.js`/`domClient.js` each get a `requireTimeline`/
`requirePageTimeline` helper (the existing lookup-plus-scroll-guard `play`
already needed, generalized to a `verb` parameter) and one thin wrapper
function per new statement, calling straight into `tween.js`.

## Language surface

Three new statements, same shape as `play`/`stop` (`parser.js`):
`PauseStmt`/`ResumeStmt`/`ReverseStmt`, each `{ target, targetIsExpr,
line }`. Usable anywhere `play`/`stop` already are - inside an `on`
handler, in either a `scene` or a `page`. Deliberately *not* specially
handled in `renameIdentifiers`/`captureLoopVariables` (interpreter.js) -
matching `PlayStmt`'s own existing (pre-existing, unrelated to this
milestone) gap: a bare target is always treated as a literal name, never
renamed for a component instance or captured from an enclosing loop
variable. A real, narrow limitation worth fixing together with `PlayStmt`
someday, not introduced fresh here.

## Verification

`tests/timeline-playback.test.js` covers parsing (all three statements,
computed targets, both domains) and `tween.js`'s own state machine
directly and exhaustively at the Node level, since it's pure, DOM/three.js
-free logic - pause-then-tick doesn't advance; resume continues from the
paused value regardless of how much wall-clock time passed while paused;
reverse flips in place without a jump; reversing a finished timeline
un-sticks it; reversing back to 0 finishes it at the *other* end; restart
resets direction back to forward. The full wiring (parser -> interpreter ->
`on`-handler dispatch -> tween.js) was verified end-to-end with the same
DOM-shim harness the other browser-only slices used: a real page with a
1-second opacity timeline and three buttons, driven through actual
`click` dispatches with a controlled fake clock - pause at 400ms holds
opacity at 0.4 through 500ms of elapsed wall-clock time, resume continues
smoothly from 0.4 (not from 0, not skipping ahead), and reverse
correctly turns the following 200ms into *decreasing* opacity from
wherever resume left it.
