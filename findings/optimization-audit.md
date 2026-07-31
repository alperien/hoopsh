# optimization-audit — the wave index

The optimization-side review of MyCareer and the calibration machinery.
Audited tree: `2436ce9` (main at the career fun wave merge, 2026-07-31).
Run 2026-07-31/08-01. This file is the ledger a REGISTER row cites; the
per-domain reports beside it carry the findings at full resolution, per the
branch citation convention.

Branch base note: this branch is based at `b7aa87a` (the feat/career-fun-wave
tip), whose tree hash (`e946c81`) is identical to the audited merge commit
`2436ce9`. Every file:line citation in these reports resolves against this
branch's own tree. Main has since moved (the amari-critiques and
pass-volume-2 landings); line numbers in files those waves touched may have
shifted on main.

## Method

- 21 read-only auditors, one disjoint domain each, instructed to read every
  line, verify line numbers, and probe cheap claims (nothing above 4
  simulated games). Each report ends with "What is done well" and "Verified
  sound" sections, so coverage is explicit.
- 3 adversarial verification passes re-checked every CRITICAL and HIGH
  against HEAD: code as described, severity fair, prior registration,
  counter-evidence. Verdicts across 38 headline checks: 30 CONFIRMED,
  8 CONFIRMED-WITH-CORRECTION, 0 OVERSTATED, 0 WRONG. Corrections are
  recorded in verify-*.md and folded into the counts below.
- Empirical runs on two fresh clones (2 cores and 4 cores): the suite,
  fingerprints, batch at n=48/96, the sweep verify rung plus six fresh seed
  bases, bench, two full gm:career-acceptance fleets (blessed and fresh
  seeds), fresh flow/oos/texture/calreport reads, and a full noise-floor
  regeneration.

## Counts

279 findings filed: 4 CRITICAL, 34 HIGH, 94 MEDIUM, 147 LOW.
After merging multi-auditor convergences: 4 CRITICAL, 27 HIGH.

The four criticals:

1. career-accept: the reacting-world acceptance gate is tautological
   (career-acceptance.ts:200 re-reads a counter trust.ts always clears at
   the threshold in the same call; the gate cannot fail).
2. career-nba: the epilogue ring harvest invents rings (epilogue.ts:37;
   every guard in the was-I-there check is vacuous; probe-verified).
3. career-nba: the Euro descent funnels veterans into draftPrep and the
   draft can select them, overwriting real draft history (tick.ts:397 +
   nbabridge.ts:874; three auditors converged).
4. career-app: /api/career/save is not gated on a running sim
   (server.ts:230; a mid-run save serializes a torn mid-week state that
   double-charges on reload).

## The reports

| file | domain | C | H | M | L |
|---|---|---|---|---|---|
| opt-sweep.md | sweep, sweep-worker, solve, knobs | 0 | 0 | 5 | 11 |
| opt-gates.md | bands, scoreboard (flowboard) | 0 | 2 | 5 | 6 |
| opt-noise.md | noisefloor, noise-floor.gen, calreport, aggregate | 0 | 1 | 4 | 7 |
| opt-fit.md | fit-roster | 0 | 1 | 3 | 7 |
| opt-validate.md | oos, fidelity, texture, turing | 0 | 1 | 6 | 3 |
| opt-flow.md | flow, flow-metrics, probes | 0 | 0 | 1 | 5 |
| opt-infra.md | parallel, run, cli, args, bench, fingerprint | 0 | 0 | 4 | 4 |
| opt-season.md | season, matchup, league drivers | 0 | 0 | 1 | 7 |
| engine-surface.md | sim/params.ts, model/derived.ts, knob registration | 0 | 1 | 5 | 8 |
| career-params.md | career params, types, packs | 0 | 1 | 6 | 4 |
| career-create.md | creation | 0 | 2 | 4 | 8 |
| career-stock.md | stock, perception | 0 | 2 | 3 | 8 |
| career-trust.md | trust, approach | 0 | 4 | 5 | 7 |
| career-week.md | week, tick, fastsim | 0 | 3 | 7 | 6 |
| career-circuits.md | circuits | 0 | 1 | 6 | 7 |
| career-nba.md | nbabridge, money, epilogue | 2 | 3 | 6 | 8 |
| career-phone.md | phone (numeric and determinism lens) | 0 | 1 | 5 | 12 |
| career-accept.md | career-acceptance harness | 1 | 4 | 5 | 3 |
| career-app.md | career views, saves, server routes, screens | 1 | 2 | 4 | 7 |
| franchise-seams.md | dev, injury, retire, careerControlled, rules passthrough | 0 | 3 | 7 | 7 |
| docs-claims.md | CALIBRATION, REGISTER, CAREER docs vs code | 0 | 2 | 2 | 12 |
| verify-measurement.md | adversarial pass, measurement domains | - | - | - | - |
| verify-career.md | adversarial pass, career domains | - | - | - | - |
| verify-late.md | adversarial pass, late-wave findings | - | - | - | - |

## Empirical anchors (re-measure commands per the register convention)

- Suite 1401/1399/0 fail/2 todo; fingerprints 28/28 byte-identical on two
  machines (`npm test`; `npm run fingerprint`).
- Bands 17/17 at n=48 and n=96 (`npm run batch -- --games 48|96`).
- The verify rung exits 1 at HEAD on the default bases (trb 47.83 vs the 47
  ceiling on swp-alpha); across nine bases total, 7 pass, with the two
  misses on the two documented ceiling-sitters (trb, fgPct). Six knobs sit
  on their search rails, warned by the tool itself
  (`npm run sweep -- --iters 0 --games 4 --verify 40`).
- Two full acceptance fleets pass all four gates on both the blessed and a
  fresh seed; every pilot went first round on both (walkon r1p7/r1p10,
  fourstar r1p1 twice); the zero-event-streak band missed on all pilots,
  worst 34 weeks (`npm run gm:career-acceptance`).
- Fresh instrument reads: oos FAIL on astdShare 53.7 vs the 54.0 floor;
  calreport prints the Jokic TRB/AST/Post rows OUTSIDE while exiting 0
  (`npm run oos`; `npm run calreport`).
- Noise floor regenerated on the audited engine: fgPct center 0.4903 vs the
  committed 0.4809, astdShare 0.5631 vs the committed 0.5397, trb 46.16 vs
  the 47 ceiling. The committed floor predates the dunker-dive landing; the
  regen diff is the missing accepted-drift record (`npm run noisefloor`).

## Citation

Rows cite these files as `findings/<name>.md` on branch
`review/optimization-audit`, per the register's citation convention. The
full narrative review (16 sections, verdict through prioritized
recommendations) lives outside the repo with the review thread; this branch
carries the raw findings the rows need.
