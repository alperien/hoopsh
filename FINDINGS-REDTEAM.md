# Wave-2 Red Team — findings log (work in progress)

Baseline: `npm test` at 554c7bb — 246 pass / 0 fail / 1 todo.

Findings accumulate below as probes run. Severity: CRITICAL / MAJOR / MINOR.

## Probes run so far (details in final report)
- P1 parallel invariance (batch/flow/flowEndgame; workers 1/2/3/7/12, workers>games, 1 game, 0 games): IDENTICAL — claim holds.
- P2 failure policy (bogus task via worker, SIGKILL mid-run, --workers abc/0/-1, --games abc): loud nonzero-exit failures, no partials — claim holds.
- P3 endgame flag-off byte-identity vs merge parent 476104f (2 seeds, full events+frames): IDENTICAL; endgame:false === undefined — claim holds.
- P4 endgame ON x team rebounds x jitter (3 games): timeout budget/decrement OK, box balances, no undefined/NaN in pbp/broadcast, timeout narration present. Same-seed rerun identical.
- Note (minor): `npm run batch -- --games 0` prints an all-zero FAIL report, exit 0 (report-only note shown).
- Note (minor): maybeTimeout suppresses stop_run for ANY team inside the final-period advance window — a LEADING team can never call a timeout late (margin<0 required for advance; !advanceWindow required for stop_run).
