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
- P5 corpus: 184 unique games, shard ids == corpus ids, 0 dups. Independent re-run of the parser's own validate/flow/grammar/possession functions over the SHIPPED play arrays: 184/184 pass three-way score validation; ALL 4968 per-game derived metric fields match; distributions (means/percentiles/min/max, pooled possession n=36703) match recomputation (stddev delta was my population-vs-sample formula, theirs is consistent). External spot-checks vs ESPN: CLE@BRK 131-124 (qPts profile 57/57/80/61 matches quarter sums exactly), SAS@NOP 120-116 OT, CLE@ATL 102-124 — all real. Corpus claim HOLDS.
- P6 fitter: impossible lines (60ppg/5FGA), mpg 0, 100% shooting — all yield schema-VALID packs with honestly-reported huge fit error; neg stats/pct>1/3PA>FGA/empty rejected loudly; dup names refused at pack validation (exit 1); --iters over budget throws. Claim holds (minor: no pts-vs-volume cross-check, error only on console, not in artifact).
- P7 season/MC: resampling real (n=6 margins sd 26.2), rerun byte-identical, n=1 OK, dup ids/1-team/self-matchup/unknown-team/tie all loud, 3-team byes give 2 games each, diff zero-sum, dup fixtures get distinct seeds, empty schedule OK. Claims hold.
