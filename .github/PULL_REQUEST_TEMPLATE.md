<!-- Short version of docs/PLAYBOOK.md Part 3's completion report.
     Docs-only PRs: fill TASK, TIER, FINGERPRINT, and the first two checkboxes. -->

TASK: <one line>
TIER: docs-only | pure refactor | consumer | mechanics
SCOPE DECLARED: <files>
SCOPE ACTUAL: <files — explain any difference>

FINGERPRINT BEFORE: <events> events, <final score>, tests <t/p/f/todo>
FINGERPRINT AFTER:  <events> events, <final score>, tests <t/p/f/todo>
<!-- npm run sim -- --seed fingerprint-1; npm test. Docs-only and pure-refactor
     tiers require these IDENTICAL. -->

Verification run (paste outputs below for your tier):
- [ ] `npm test` green (~2 min)
- [ ] Bible regenerated if a `SOURCES` doc changed (`npm run docs:bible`, zero diff in CI)
- [ ] `npm run batch -- --games 24` (~7s) — mechanics/params only
- [ ] `npm run sweep -- --iters 0 --games 4 --verify 40` (~36s) — params only
- [ ] `npm run fingerprint` (~9s) — pure refactors only (24 seeds byte-identical)
- [ ] `npm run bench` (~8s) — hot-path only

- [ ] **I did not weaken, delete, or re-tune any test, invariant, or band to make this pass** (AGENTS.md §1.6).

WHAT I DID: <3–8 bullets>
DEVIATIONS FROM BRIEF/ISSUE: <or "none">
COULD NOT DETERMINE: <honest list, or "nothing">
OUT-OF-SCOPE FINDINGS: <bugs noticed, not fixed — or "none">
