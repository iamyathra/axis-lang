# AXIS baseline - 2026-09-14

Verified directly against the repository and a real npm pack/install, not
taken from README/VISION/prior-audit claims. Prior-phase reports (927/51
unit+browser test counts, the third-party extension proof, etc.) were used
as leads to check, not facts to repeat - each figure below was re-measured
in this session.

```text
Git branch:          main
HEAD:                6244450 (docs: add a real npm Install section, disambiguate vN labels from package version)
origin/main:         b2f10a9 (26 commits behind HEAD before this session; 53 behind after)
unpushed commits:    53 (not yet pushed - see "Distribution" below)
working tree:        clean
unit tests:          929 / 929 pass (npm test)
browser tests:       53 / 53 pass (npm run test:browser, real headless Chromium via Playwright)
packaging test:      1 / 1 pass (npm run test:packaging - new this session)
npm package status:  never published; axis-lang 1.0.0, axis-react 0.1.0
GitHub status:       public repo, iamyathra/axis-lang; local work far ahead of it
package versions:    axis-lang 1.0.0 (root), axis-react 0.1.0 (packages/axis-react)
README version:      prose describes "v3.7"/"v3.8" feature-milestone labels - now
                     explicitly disambiguated from the npm package version (see below)
CLI version:         axis version -> reads package.json's version directly (1.0.0)
AXIS language version: no separate concept - the CLI/package version is authoritative
```

## Version inconsistency found and fixed

README and several docs describe feature work using "vN" labels (v3.1
through v3.8) as an informal chronological development-history scheme -
these predate the npm package's own `1.0.0` version and were never meant
to be the same number. Before this session, nothing said so: a stranger
reading "This is v3.7" directly above a `package.json` reading `1.0.0`
had no way to know that wasn't a real mismatch. Fixed with a one-line
disambiguation in README (see the "Install" section) rather than
renaming years of historical milestone references - the smallest fix that
removes the actual confusion.

## Distribution bug found and fixed (this session's highest-priority finding)

`axis build`/`axis run` crashed with `ENOENT` for **every real
npm-installed consumer** - `src/renderer/threeVendor.js` located three.js
via a path hardcoded relative to its own file location inside axis-lang's
package directory, which only worked by accident in this repo (axis-lang
IS the node_modules root here). A real `npm install` hoists the shared
`three` dependency to the installing project's own top-level
`node_modules` instead. Found by literally running `npm pack` + `npm
install` (both as a project dependency and via `npm install -g`) into a
scratch directory and executing `axis create`/`axis check`/`axis
build`/`axis run` for real - not by reading the code. Fixed by resolving
three's real package root via Node's own module resolution instead of a
hardcoded layout assumption; verified against both a local and a global
real install afterward. Regression-proofed by
`tests/packaging/npm-install-build.test.js` (opt-in, `npm run
test:packaging`), which fails against the old code and passes against the
fix.

Separately, the npm tarball itself was shipping every example's own
`node_modules` verbatim - `examples/embed-react/node_modules` alone added
18MB+ of vendored React/Vite/lightningcss binaries neither `.gitignore`
nor npm's own defaults excluded once `files` explicitly whitelisted
`examples/`. Real tarball: 15.3MB / 532 files before, 448KB / 164 files
after.

## What was NOT yet done (explicitly out of scope for this baseline)

- **git push / npm publish**: 53 local commits are unpushed;
  `axis-lang`/`axis-react` have never been published. Both are
  irreversible, externally-visible actions - prepared and verified
  ready, but held for explicit user sign-off before executing (per this
  session's own scoping agreement), not attempted.
- **5 real external developer testers** (mission's own external-testing
  section): no mechanism exists in this session to recruit actual humans.
  Not fabricated - explicitly marked unavailable rather than simulated.
- The 5-benchmark-task suite (AXIS vs. React+Three.js), showcases,
  competitor-comparison doc, evaluator-duplication audit, and the rest of
  the mission's later sections have not been started yet - this document
  covers only the baseline + first-mission (distribution) work completed
  so far.
