# Wave-2 Red Team — final findings

> **STATUS (2026-07-29): historical record.** MINOR-2 and MINOR-4 are since
> resolved ([../REGISTER.md](../REGISTER.md) W11/W13, commits ce64b1d /
> d6d6157); MINOR-1 and MINOR-3 remain open as W10/W12.

Target: merge state 554c7bb (wave-1 integration). Baseline `npm test` at that state: 246 pass / 0 fail / 1 todo.
Probe scripts are committed at `tools/redteam-probes/` (probe-parallel, probe-kill, dump-game,
probe-endgame-on, probe-eg-det, probe-corpus, probe-season, probe-packs, probe-goldens,
probe-narr-default; run via
`node --disable-warning=ExperimentalWarning --import ./tools/register.mjs tools/redteam-probes/<script>.mjs`).

**Bottom line: no CRITICAL or MAJOR findings. Every headline claim survived direct attack.
Four MINOR findings + two notes.**

## Findings

### MINOR-1 — Box score contradicts the wave's own shot-clock-turnover scoring research
`packages/harness/src/turing.ts:103` (this wave) renders `Turnover by Team (shot clock)` citing
"bbref charges shot-clock violations to the TEAM, never a player (10/10 in the reference corpus)".
But `packages/stats/src/box.ts:318-321` folds every turnover — including `kind: 'shot_clock'` —
into the ball-holder's individual TOV line (the engine synthesizes a holder for the event,
`sim/game.ts:226`). Player TOV is inflated vs the official convention the narration layer itself
established; team totals unaffected. The playerless-team-rebound philosophy was not applied to
turnovers. Not fixed here: box.ts's documented fold philosophy and consistency.test.ts assert the
current behavior — it is a scoring-convention decision, not a one-liner.

### MINOR-2 — A leading team can never call a late timeout
`sim/endgame.ts` maybeTimeout: `advance` requires margin < 0; `stop_run` requires `!advanceWindow`;
`advanceWindow` is true for ANY team (leading included) inside `timeoutAdvanceClockSec` of the
final period. Net: a leading team being run on in the last ~2 minutes is barred from stopping the
run. The doc comment claims the suppression protects a *trailing* team's budget; the code
suppresses both sides. Observed [1,1,2] timeouts/game across 3 endgame-ON probes is consistent
with the narrow triggers. Texture gap, not an invariant violation.

### MINOR-3 — Team-rebound side lottery lacks an empty-candidates fallback
`sim/resolve.ts` resolveTeamReboundSide: nobody within `reboundCutoffFt` -> `Rng.weighted([0,0])`
-> uniform 50/50 side pick (weighted()'s total<=0 branch), unlike resolveRebound's explicit
closest-player fallback (added there after an audited invariant violation) and vs the documented
"same positioning-weighted lottery" claim. No crash, deterministic, rare; locally skews the ORB%
expectation the mechanic promises to preserve.

### MINOR-4 — `npm run batch -- --games 0` exits 0 with an all-FAIL report
Prints a 0/17-bands report of zeros (gate inactive, note shown) and exit 0. A scripted caller
checking only the exit code sees success on a run that simulated nothing.
Repro: `npm run batch -- --games 0 --workers 3`.

### Notes (not defects)
- Fitter accepts arithmetically impossible lines (60 ppg on 5 FGA + 2 FTA): emits a schema-valid
  pack, prints err 475 honestly — but the written artifact carries no fit-quality marker; a
  pipeline ignoring stdout gets a "fitted" roster scoring ~8 ppg. Repro: feed `rosters:fit` a
  season line of 60 ppg on 5 FGA + 2 FTA (the probe fixture was not committed; construct it
  from that description).
- NCAA claim-count: brief said "3 rulepack bugs"; README documents R1-R3 bugs + R4 (OT foul reset)
  + R5 inventory. R1 (bonusFreeThrows 2 inherited via ...NBA; NCAA is 1-and-1 from the 7th),
  R2 (keyWidthFt 16 inherited; NCAA 12, unwired) and R4 (endPeriod resets teamFoulsPeriod every
  period incl. OT) verified accurate against rulepack.ts/possession.ts. Nothing imports data/ncaa.

## Claims that held up under attack
1. Parallel runner bit-identical across worker counts: 7-game batch JSON identical for workers
   1/2/3/7/12; flow + flowEndgame identical w1 vs w3; 1 game w4 == w1; 0 games -> []. Failure
   policy: SIGKILLed worker mid-run rejects the whole run loudly (job file kept, no partials);
   unknown task via worker loud; --workers abc/0/-1 and --games abc/-1/2.5 loud, exit 1.
2. Endgame flag-OFF byte-identity: HEAD with endgame:false/omitted is byte-identical (full
   events+frames+score, 2 seeds, ~2 MB each) to merge parent 476104f (pre-endgame engine); no RNG
   leak; default streams contain no timeout events.
3. Endgame ON (x team rebounds x jitter, 3 games): timeout budget respected, remaining decrements
   exactly, box balances, no undefined/NaN/[object in pbp or broadcast, timeout narration present,
   same-seed rerun byte-identical.
4. Team rebounds / optional ReboundEvent.player: TRB = player sum + team rebounds, dead-ball FT
   formalities count nowhere (tests assert it; probes agree); narration, turing register, and
   viewer (`e.player ? nm(e.player) : 'by Team'`) all handle playerless events.
5. Corpus 184/184: shards contain exactly the 184 corpus ids, no dups; the parser's own validation
   re-run over the SHIPPED play arrays passes 184/184; all 4,968 per-game derived metric fields and
   the distribution blocks (means, p10/p50/p90, min/max, pooled possessions n=36,703) recompute
   exactly; flow-reference dist blocks equal corpus distributions. External spot checks: CLE@BRK
   131-124 (quarter sums 57/57/80/61 match ESPN exactly), SAS@NOP 120-116 OT, CLE@ATL 102-124.
6. Fitter: garbage rejected loudly (negatives, pct>1, 3PA>FGA, empty, dup ids) or fitted with
   honestly-reported error; never writes an invalid pack; --iters 99 hits the hard cap, exit 1.
   Spacing-jitter guard confirmed: 0 two-point attempts >= 22 ft across two full games.
7. Season/Monte-Carlo: MC genuinely resamples (n=6 margin sd 26.2); reruns byte-identical; n=1
   works; dup ids / 1-team / self-matchup / unknown team / tied outcome all loud; 3-team byes give
   2 games each; diff zero-sum; W==L; duplicate fixtures get distinct seeds; empty schedule OK;
   season CLI (4 teams / 6 games) invariants hold; simone CLI runs custom packs clean.
8. Roster tooling: roster:new output validates clean; validator catches duplicate starters (which
   the engine's own validateTeam misses — schema.ts comment acknowledges this); 8 legal-extreme
   packs (all-0, all-100, weightLb 0, wingspan 0, 5'0" roster, rotationMinutes 0/1e308, pace 0)
   all pass roster:validate AND simulate to a clean game_end under validate:'strict'. No pack found
   that passes the validator and crashes or stalls simulateGame.
9. Goldens: 8/8 sampled re-baselined fingerprints (ci-fp, acceptance-0, golden-0..5) match HEAD
   event/frame hashes and scores.
