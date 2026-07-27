# data/ncaa — NCAA men's D-I research foundation

Research document for calibrating hoopsh to NCAA men's Division I basketball.
Same provenance-first contract as `data/nba/README.md`: every number carries a
source and a grade. Nothing here is wired into the engine — these are
proposals for the orchestrator (see `acceptance-bands.json` and §6).

Access date for all sources: **2026-07-27**. Season notation: "2025" = the
2024-25 season (KenPom convention) unless written as "2024-25".

Provenance grades:

- **A** — published multi-season data with methodology (NCAA rulebook/press
  releases, official court diagram, KenPom trends, Sports-Reference, B-R).
- **B** — credible published analysis (single-season tables, analytics blogs
  with described method, articles quoting primary data).
- **C** — thin, derived, or estimated by us (derivation shown inline).

Raw source data snapshots live in `sources/`:

| file | contents | grade |
|---|---|---|
| `sources/kenpom-trends.json` | KenPom D-I trends (tempo, efficiency, four factors, shares) 2015-2026 | A |
| `sources/sports-reference-cbb-game-averages.json` | D-I per-team per-game averages 2015-16 → 2025-26 | A |
| `sources/basketball-reference-nba-averages.json` | NBA league averages 2021-22 → 2025-26 (comparison baseline) | A |

---

## 1. Rule differences (NCAA men vs NBA) and rulepack verification

Primary sources:

- Official NCAA court diagram, 2025-26: <https://ncaaorg.s3.amazonaws.com/championships/sports/basketball/rules/common/PRXBB_CourtDiagram.pdf> (grade A)
- NCAA/NFHS Major Basketball Rules Differences (official NCAA document, 2022-23 edition): <https://ncaaorg.s3.amazonaws.com/championships/sports/basketball/rules/common/2022-23PRXBB_MajorRulesDifferences.pdf> (grade A)
- 2025-26 and 2026-27 Men's Basketball Rules Changes (official): <https://ncaaorg.s3.amazonaws.com/championships/sports/basketball/rules/men/2025-26PRMBB_RulesChanges.pdf> (grade A)
- NCAA.org, "Panel approves changes to enhance the flow of the game in men's basketball" (June 10, 2025): <https://www.ncaa.org/media-center-panel-approves-changes-to-enhance-the-flow-of-the-game-in-mens-basketball/> (grade A)
- Rule-change seasons (30-second clock 2015-16; 20-second offensive-rebound reset and FIBA-distance arc 2019-20): NCAA announcements via <https://www.ncaa.com/news/basketball-men/article/2015-06-08/ncaa-changes-shot-clock-30-seconds-makes-other-changes-game> and <https://nsga.org/news/ncaa-mens-and-womens-basketball-rule-changes-for-2019-20/> (grade A/B)

### 1.1 Verification of `packages/engine/src/rules/rulepack.ts` NCAA pack

| field | rulepack value | current NCAA men's rule | verdict |
|---|---|---|---|
| `periods` / `periodMinutes` | 2 × 20 | Two 20-minute halves. Men still play halves in 2025-26; the June 2025 PROP release only recommends a D-I working group on a future move to quarters. (Women play 4×10 quarters since 2015-16 — this pack is men-only.) | ✅ correct |
| `otMinutes` | 5 | Five-minute extra periods | ✅ correct |
| `shotClockSec` | 30 | 30 seconds (since 2015-16; was 35 from 1993-94, 45 before) | ✅ correct |
| `shotClockOffRebSec` | 20 | 20-second reset on an offensive rebound (since 2019-20) | ✅ correct, but incomplete — see finding R3 |
| `foulOutAt` | 5 | Five personal fouls disqualify | ✅ correct |
| `courtLengthFt` × `courtWidthFt` | 94 × 50 | 94' × 50' | ✅ correct |
| `three.arcRadiusFt` | 22.15 | 22'1¾" = 22.146 ft (since 2019-20 in D-I) | ✅ correct (0.004 ft rounding) |
| `three.cornerDistFt` | 21.65 | 21'7⅞" = 21.656 ft to the outside edge from basket center; the straight line is 40⅛" from the sideline | ✅ correct (0.006 ft rounding) |
| `three.cornerBreakFt` | 9.85 | straight segment runs 9'10⅜" = 9.865 ft from the end line before the arc begins | ✅ ~correct (0.015 ft; cosmetic) |
| `ftLineFt` | 19 | FT line 15' from the backboard plane; backboard 4' from the end line → 19' | ✅ correct |
| `rimInsetFt` | 5.25 | same geometry as NBA | ✅ correct |
| `teamFoulBonusAt` | 7 | Bonus does start at the 7th team foul per half… | ⚠️ see finding R1 |
| `bonusFreeThrows` | 2 (inherited from NBA) | …but fouls 7-9 award a **one-and-one**, not two shots; the flat double bonus starts at the **10th** team foul | ❌ **WRONG — finding R1** |
| `keyWidthFt` | 16 (inherited via `...NBA` spread) | NCAA lane is **12 ft** wide | ❌ **WRONG — finding R2** (field is documented UNWIRED, but the league value is still wrong) |

### 1.2 Concrete rulepack findings (bugs / gaps)

**R1 — The bonus is modeled wrong (the biggest rules bug).**
NCAA men: one-and-one on team fouls 7-9 of a half (make the first FT to earn
the second; miss the front end and the ball is live), and two shots from the
10th team foul on. Source: NCAA/NFHS Major Rules Differences (grade A):
"One-and-One Bonus: on the seventh team foul … Double Bonus: on the 10th team
foul … Team fouls reset: end of the first half." The rulepack's own comment at
`bonusFreeThrows` ("not the older one-and-one variant some of these leagues
have used historically") is **factually wrong for NCAA men — one-and-one is
the current rule**, not a historical one. Modeling impact at FT% ≈ 71%: a
one-and-one trip is worth ~0.71 + 0.71² ≈ 1.21 pts with a ~29% chance of a
live-ball rebound on the front end; a flat two-shot trip is worth ~1.42 pts
with no front-end rebound. The current pack therefore overpays early-bonus
trips by ~0.2 pts each and deletes a real class of rebound scrambles.
(Note: NCAA **women** eliminated the one-and-one — 2 shots at the 5th foul of
each quarter — so the flat rule the engine implements is the *women's* shape,
not the men's.)

**R2 — `keyWidthFt` should be 12, not 16.** Official court diagram: the NCAA
lane is 12' wide (NBA 16'). The field is declared UNWIRED (shot zoning is
rim-distance based), so this has no sim effect today, but the pack ships a
wrong league constant and will silently mislead whoever wires lane geometry
for post play.

**R3 — Shot-clock reset semantics are broader than "offensive rebound".**
NCAA men also reset to 20 seconds (or the time remaining, whichever is
GREATER) on a defensive foul or violation with play resuming in the
frontcourt, and to 20 on frontcourt throw-ins (Major Rules Differences doc,
grade A). The engine only models the off-reb reset. Effect: real NCAA teams
in the bonus get slightly shorter average clocks after non-shooting fouls
than the engine would give them (engine presumably grants a fresh 30 or keeps
running clock). Low priority, but it is a real divergence.

**R4 — Team fouls must carry from the second half into overtime.**
`sim/possession.ts:422` resets `teamFoulsPeriod` at every period boundary.
For NCAA (periods = halves) regulation is handled correctly, but NCAA carries
second-half team fouls into OT (fouls reset only at the *end of the first
half* per the Major Rules Differences doc). An NCAA OT in the engine would
incorrectly start with a clean foul slate — OTs are exactly where real
college games live at the FT line. Also note the NBA's own OT bonus threshold
differs (not this pack's problem, but the reset code is league-blind).

**R5 — Missing-rule inventory (engine models none of these; list for the
league-expansion milestone, not necessarily to build):**

- 10-second backcourt count (NBA: 8 seconds). Engine models no backcourt count.
- Closely-guarded 5-second count **while holding** (men's; the dribbling
  count was removed). No NBA equivalent.
- Alternating-possession arrow on held balls/jump situations (NBA re-jumps).
- No defensive three-seconds in NCAA (the NBA rule is what outlaws true zone
  camping); engine has no D3S model either, so paradoxically the engine is
  already "NCAA-legal" here — the gap is that its defensive AI never *uses*
  the freedom (see §4 zone).
- Timeouts: men get three 60s + two 30s (non-media games); one 60s + three
  30s in media-timeout games. Engine models no timeouts.
- Restricted arc is 4 ft in both leagues (NCAA men moved to 4 ft; diagram
  marks it MEN ONLY). Engine's charge model (`foul.chargePerDrive`) has no
  spatial component; fine at current fidelity.
- Coach's challenge / replay (new 2025-26): out of sim scope.
- Continuous-motion difference (2025-26 liberalization): absorbed by
  `shot.andOneFoulMult`-style calibration, not structure.

### 1.3 Structural rule deltas that DO flow through the sim

| dimension | NBA | NCAA men | sim surface |
|---|---|---|---|
| game length | 48 min (4×12) | 40 min (2×20) | rulepack ✅; all per-game bands must be restated (§5) |
| shot clock | 24 / 14 | 30 / 20 | rulepack ✅; possession-length distribution, `decide.continuation*` re-fit (§6) |
| bonus | 5th team foul/period (flat 2; last 2:00 rule) | 1-and-1 at 7, double at 10, per half, carries to OT | **needs new rulepack fields + FT logic (R1/R4)** |
| foul-out | 6 of 48 min (12.5% of game per foul) | 5 of 40 min (identical 12.5%… but college fouls happen ~30% more often per minute — see §2) | `foulOutAt` ✅; foul-trouble sub logic pressure is much higher in NCAA |
| 3-pt line | 23.75/22.0 ft | 22.146/21.656 ft | rulepack ✅; shot EV geometry already adapts |
| lane | 16 ft | 12 ft | rulepack value wrong (R2), unwired |
| zone defense | de-facto outlawed (defensive 3 sec) | fully legal, used regularly | engine has no zone concept at all (§4) |

---

## 2. Statistical differences (all per-possession or per-40 — never raw per-game vs NBA per-game)

Core numbers. NCAA columns from KenPom D-I trends (grade A; raw D-I averages,
possession-based, multi-season) and Sports-Reference CBB game averages (grade
A). NBA columns from Basketball-Reference league averages (grade A). NCAA
"recent range" = 2019-2026 seasons unless noted; NBA range = 2021-22 → 2025-26.

| metric | NCAA D-I (recent range) | NBA (recent range) | delta, like-for-like |
|---|---|---|---|
| Tempo (poss/40 min) | **67.9-69.4** (2025: 68.0, 2026: 68.3) | 79.8-83.6 poss/40-equiv (pace 95.8-100.3 poss/48 × 40/48) | NBA plays ~**18-21% more possessions per minute** |
| Possessions per game | ~68 (40 min) | ~99 (48 min) | never compare per-game raw |
| Offensive efficiency (pts/100) | **100.8-108.5** (2025: 106.2, 2026: 108.5) | 110.6-115.7 (2025: 114.5, 2026: 115.7) | NCAA scores ~**7-9 pts/100 fewer** |
| Points per game per team | 70.1-75.9 (2024-25: 73.9) | 105.6-115.6 (2024-25: 113.8) | consequence of both rows above |
| FG% | 43.8-45.2% | 46.1-47.5% | ~2.5 pp lower |
| eFG% | 49.6-51.4% | 53.2-54.7% | ~3.5 pp lower |
| 2P% | 49.4-51.7% | ~54-56% (derived: (FGM−3PM)/(FGA−3PA), grade C) | ~4 pp lower |
| 3P% | **33.3-34.5%** (extremely stable) | 34.8-36.6% | ~2 pp lower |
| FT% | **70.4-72.5%** | 77.5-78.4% | ~**6 pp lower** — the widest skill gap of any shooting split |
| 3PA share of FGA | **37.3-39.5%** (2026: 39.5%) | 39.2-42.2% (2024-25: 42.2%) | shares are surprisingly close; college trails by only ~2-3 pp |
| FT rate (FTA/FGA) | **30.3-35.0** (2025: 33.0, 2026: 35.0) | 24.3-26.6 (derived FTA/FGA from B-R per-game, grade C-from-A) | college draws ~**30-35% more FTs per shot** |
| TOV% (TO/poss) | **16.7-18.9%** (2025: 17.2, 2026: 16.7) | ~14.0-14.6% (derived TOV/poss; B-R's TOV% column, different denominator, reads 12.1-12.8) | ~**20% more turnovers per possession** |
| ORB% | **28.0-30.6%** (2025: 29.8, 2026: 30.6) | 22.2-26.0% (2024-25: 25.2) | college offenses rebound ~**4-5 pp more** of their misses |
| Assisted share of FGM (AST/FGM) | **50.7-52.6%** (KenPom A%; SR per-game gives 52.5% for 2024-25) | 60.7-63.6% (derived AST/FGM from B-R per-game, grade C-from-A) | college is far LESS assisted by the box-score ratio |
| Steal% (STL/poss) | 8.6-9.7% (2025: 9.7) | ~8.3% (derived 8.2 stl / 98.8 poss, grade C) | slightly more steals per possession |
| Block% (of opp 2PA) | 8.8-9.5% | ~9.5% (derived 4.9 blk / 51.6 2PA, grade C) | essentially equal per 2PA |
| Fouls per game | 16.6-17.8 (in 40 min) → **~24-26 per 100 poss** (derived) | 18.6-20.0 (in 48 min) → ~19-20 per 100 poss (derived) | ~**25-30% more fouls per possession** |
| Average player height | 76.8-77.4 in (KenPom avg_hgt) | ~78.5-79 in (B-R Ht column 6'6"-6'7") | ~2 inches shorter |

Reconciliation note (grade C, derivation): SR per-game and KenPom cross-check
cleanly — e.g. 2024-25: TOV 11.8/g ÷ 68.0 poss = 17.4% vs KenPom TO% 17.2;
3PA share 22.9/58.5 = 39.1% vs KenPom 39.1; FTA/FGA 19.2/58.5 = 0.328 vs
KenPom FT-rate 33.0. The small residuals are population differences
(SR excludes transitional schools; KenPom includes only D-I vs D-I games).

Key modeling implications:

1. **Pace is the biggest single delta and it is NOT the shot clock alone.**
   The clock is 25% longer (30 vs 24) but possessions/min are ~20% fewer —
   college teams walk it up, run more of the clock, and get fewer transition
   possessions. In SimParams terms this is `decide.*` patience and
   `move.*`/transition behavior, not just `shotClockSec`.
2. **Efficiency gap is concentrated in FT% (−6pp), 2P% (−4pp), TOV (+20%)**
   — not in 3P% (−2pp) or shot selection (3PA share nearly NBA-like).
3. **The offensive glass is a real stylistic difference** (28-30% vs 22-26%):
   college teams crash; NBA teams concede to protect transition defense.
4. **Whistles: college basketball is much foulier per possession**, and the
   one-and-one changes the value of each whistle (R1).
5. **Assisted share**: hoopsh's `astdShare` metric is literally AST/FGM
   (`packages/harness/src/aggregate.ts` finalize). On that same definition
   college sits ~50-53% vs the NBA's ~61-64% — college creates more of its
   makes off the dribble/offensive boards and fewer off the catch, despite
   running more set plays (assists require makes; college misses more of the
   catch-and-shoot looks it creates).

---

## 3. Talent distribution — why NBA-tight bands break

The NBA is a talent-compressed league of 30 rosters drawn from the best ~450
players on earth; D-I is 364+ rosters spanning future NBA lottery picks to
sub-6-foot walk-ons. Quantified:

| spread measure | NCAA D-I (2024-25) | NBA (2024-25) | source/grade |
|---|---|---|---|
| Best team net rating (per 100, schedule-adjusted) | Duke **+39.29** AdjEM (highest of the KenPom era, since 2002) | OKC **+12.8** | KenPom 2025 table + Duke Wire summary <https://dukewire.usatoday.com/story/sports/college/duke/mens-basketball/2025/04/08/college-basketball-kenpom-rankings-duke-cooper-flagg-best-teams-ever/82992390007/>; B-R/NBA.com via StatMuse — grade A/B |
| Worst team net rating | Arkansas-Pine Bluff **−25.94** (#363 of captured table; the true #364-365 sits at or below this) | Washington **−12.33** | same — grade B (bottom row captured from KenPom table snapshot) |
| Full spread | **~65+ pts/100** | **~25 pts/100** | derived — grade C |
| Tempo spread across teams | **59.4 to 75.3 poss/40** (Drake slowest, Alabama fastest — ±12% around the mean) | ~95.8-103.4 poss/48 (±4% around the mean) | KenPom 2025 AdjT column (grade A snapshot); B-R (grade A) |
| Typical winning margins | 20-30+ pt blowouts routine (2024-25 Duke won 22 games by 20+, 10 by 30+) | double-digit wins notable; 30+ rare | Duke Wire (grade B) |

Implications for a sim calibrated on NBA-tight bands:

- hoopsh's rating curves (`model/derived.ts`, n(rating) ∈ [−1,+1]) were fit
  so that rating 50 = NBA league average. NCAA rosters CANNOT be expressed by
  reusing the NBA rating scale's occupied band — a median D-I player is far
  below any NBA rotation player, and the D-I *interquartile* range is wider
  than the NBA's entire range. Either the NCAA roster generator must occupy
  a much wider, lower band of the existing 0-100 scale (probably right), or
  the league gets its own rating→skill mapping (dangerous — breaks the
  cross-league meaning of a rating).
- League-average acceptance bands stay meaningful (they're league-wide
  means), but **any band validated on matchup competitiveness (margin
  distributions, win% spreads) must be league-specific**: a 40-point college
  blowout is in-distribution, and a KenPom-#1-vs-#364 matchup implies a
  ~60-point expected margin on a neutral floor.
- Home-court matters more: D-I home win% 57.5-61% recent seasons (KenPom
  trends, grade A) vs NBA ~54-55% (grade C recollection — flagged, not
  sourced; do not wire without sourcing).

---

## 4. Style of play

- **Zone defense is a real, league-legal share of possessions.** NCAA has no
  defensive three-second rule, and programs (Syracuse's 2-3 most famously)
  play zone as an identity; in 2019-20 seven D-I teams played zone on >75% of
  possessions (Synergy data via Three-Man-Weave, grade B:
  <https://www.three-man-weave.com/3mw/zonal-shift-part-1>). Zone usage has
  been **declining** league-wide since the mid-2010s (same source, with
  Synergy year-over-year data), but remains categorically more common than
  the NBA's near-zero. We could NOT source a current single number for
  "% of all D-I possessions played against zone" — the 3MW charts show the
  trend but the text states no national average (see §7). Order-of-magnitude
  estimate: ~10% D-I vs low single digits NBA (grade C, estimate).
  **Engine impact: hoopsh has no zone concept at all** — its defensive AI
  (`ai.guardDist*`, sag/help/deny model) is man-to-man only. An NCAA pack
  without zone will systematically misprice heavy-zone opponents but can
  still hit league-average bands (zone teams are a minority).
- **More set plays / less isolation.** College offenses are more
  action-scripted; the NBA leans harder on high-usage creators. Synergy play
  type data (via Three-Man-Weave Part 2, grade B) shows D-I play-type mix
  with spot-ups the largest bucket. We could not source a clean
  NBA-vs-NCAA isolation-frequency pair (see §7); directionally lower
  `ai.isoCallShare`, higher `ai.pnrRatePerTick`-adjacent action rates.
- **Shot-clock effects**: 30 vs 24 seconds plus lower skill = longer average
  possessions and more late-clock heaves; KenPom average possession length
  runs ~17-18s in college (grade C — commonly cited on KenPom pages we could
  not access; flagged) vs ~14.5s NBA (grade C). The engine's
  `decide.continuationCurve` normalizes by `shotClockSec` so the SHAPE
  partially transfers, but the level (`continuationMax` in expected points)
  must drop to college efficiency (~1.06 pts/poss league average).
- **Tournament vs regular season** (KenPom via The Athletic 2019, grade B:
  <https://www.nytimes.com/athletic/887992/2019/03/26/kenpom-assessing-how-ncaa-tournament-games-differ-from-the-regular-season/>;
  kenpom.com blog "Tourney scoring up, pace down"): tournament efficiency
  usually dips (shooting drops against better defenses), FTA decrease
  (officials swallow whistles), pace is team-dependent with a mild slow
  bias. No pace rule change — don't bake tournament effects into league
  bands; treat March as a context modifier if the sim ever models it.
- **Experience/continuity**: KenPom trends tracks roster continuity —
  33.7% (2025) and 24.9% (2026), down from ~50% pre-transfer-portal era
  (grade A). Not a sim parameter today; matters for any dynasty/roster mode.

---

## 5. Proposed acceptance bands

See **`acceptance-bands.json`** (same `Band` shape as
`packages/harness/src/bands.ts` `NBA_BANDS`, plus `source`/`grade`/`basis`
fields per band). Summary of the proposal, per team per GAME (40 minutes):

| metric | NBA band | proposed NCAA band | basis (see JSON for full provenance) |
|---|---|---|---|
| pace | 95-103.5 poss/48 | **66-71 poss/40** | KenPom tempo 67.9-69.4 (2019-26) + margin |
| pts | 105-122 | **69-79** | SR 70.1-75.9 (2019-26) + margin |
| fga | 84-92 | **55-61** | SR 57.7-58.8 |
| fgPct | .44-.495 | **.43-.465** | SR 43.8-45.2% |
| tpaShare | .33-.45 | **.34-.42** | KenPom 37.3-39.5% |
| tpPct | .335-.385 | **.32-.355** | KenPom/SR 33.3-34.5% |
| fta | 18-27 | **17-23** | SR 17.5-20.5 |
| ftPct | .74-.805 | **.69-.735** | KenPom/SR 70.4-72.5% |
| orbPct | .20-.30 | **.27-.32** | KenPom 28.0-30.6% |
| trb | 40-47 | **33-38** | SR 34.8-35.5 |
| ast | 22-30 | **12-15.5** | SR 13.1-14.1 |
| stl | 6-9.5 | **5.5-8** | SR 6.2-6.8 |
| blk | 3.5-6.5 | **2.8-4.2** | SR 3.2-3.4 |
| tov | 11.5-15.5 | **10.5-14** | SR 11.5-13.2 (2019-26) |
| pf | 16-22.5 | **15.5-19.5** | SR 16.6-17.8 (2019-26) |
| ortg | 106-121 | **100-110** | KenPom efficiency 100.8-108.5 (2020-26) |
| astdShare | .54-.62 | **.48-.56** | KenPom A% 50.7-52.6, SR AST/FGM 52.5% |

**Pace normalization warning (wiring hazard):** `packages/stats/src/box.ts`
computes `pace = (totalPoss/2) × (48/gameMinutes)` — a hardcoded 48-minute
basis. A regulation NCAA game at the real ~68 poss/40 would REPORT pace ≈
81.6 on the current pipeline. The proposed band is stated in the real-world
convention (poss/40, lo 66/hi 71); the JSON also carries
`paceOn48MinBasis: [79.2, 85.2]` so the orchestrator can either (a) make the
normalization rulepack-aware (recommended: normalize to
`periods × periodMinutes`), or (b) wire the 48-basis numbers. Do not mix the
two.

Band-width philosophy: mirrors `NBA_BANDS` — wide enough to absorb 2019-2026
era variation (including the 2026 uptick: efficiency 108.5, FT-rate 35), tight
enough that an engine still playing NBA-style ball fails loudly: NBA-average
pace (83+ poss/40-equiv), ORtg (114+), FT% (78) and astdShare (60%+) all land
outside their NCAA bands.

---

## 6. What the engine would need (`--league ncaa`)

### 6.1 Rulepack changes (structural)

1. **Bonus structure fields** (fixes R1): e.g.
   `bonusRule: 'flat' | 'oneAndOne'`, `oneAndOneFrom: 7`, `doubleBonusFrom:
   10` (NBA: `flat` at 5). Requires new FT-sequencing logic in
   `sim/fouls.ts` (front-end miss → live rebound) — today
   `bonusFreeThrows: 2` is consumed as a fixed count by
   `sim/passing.ts attemptReachIn` and `sim/possession.ts tickScramble`.
2. **Team-foul reset scope** (fixes R4): a flag like
   `teamFoulsCarryToOT: true` (NCAA) so `sim/possession.ts:422` skips the
   reset entering OT; NBA keeps per-period reset (its own OT threshold nuance
   is out of scope here).
3. **`keyWidthFt: 12`** (fixes R2) — one-line data fix, no behavior.
4. Optional/low-priority: shot-clock reset-to-20 on frontcourt dead balls
   (R3); `backcourtSec: 10` if a backcourt count ever lands.
5. Fix the `bonusFreeThrows` doc comment (it misstates the NCAA men's rule).

### 6.2 SimParams that need NCAA-specific values (names from `packages/engine/src/sim/params.ts`)

Ordered by the calibration order in `bands.ts` (pace → shot mix → efficiency
→ fouls/rebounds/turnovers → differentiation):

- **Pace/patience**: `decide.continuationMax` (college continuation value is
  much lower — league ~1.06 pts/poss vs NBA ~1.145), `decide.continuationCurve`,
  `decide.urgencySec` (30s clock scales the normalized curve automatically,
  but the late-clock cliff should be re-fit), `decide.transitionBonus` and
  `decide.tempoScale` / `move.transitionMaxSec` (college has FEWER
  possessions/min — transition appetite down), `decide.intervalSec`
  (slower re-reads; more deliberate), `ai.holdAdvance` / `ai.holdHalfcourt`.
- **Shot mix**: `decide.threeAppetite` (college 3PA share 37-39% vs NBA 42% —
  small cut, NOT a big one), `ai.threeApptScale`, `ai.pullUpBias` (college
  takes fewer self-created pull-ups; assisted-3 economy), `ai.isoCallShare`
  ↓, `ai.postCallShare` ↑ (more back-to-basket), `ai.pnrRatePerTick`
  (college runs more scripted actions per possession).
- **Efficiency**: `shot.baseRim`, `shot.basePaint`, `shot.baseMid`,
  `shot.baseThree` (all down: 2P% −4pp, 3P% −2pp at league level — though
  most of this SHOULD come from roster ratings, not bases; decide the split
  deliberately — see 6.4), `shot.ftBasePct` (college league FT% 70.4-72.5 vs
  NBA 78: at the current `ftBasePct: 0.69` + swing, an NCAA-rated population
  needs the base re-centered or the roster ratings do it), `shot.passQualityCenter`
  (league-typical delivery is worse), `decide.temperature` ↑ (more bad
  decisions — the "IQ dial" is the cleanest talent-width knob the params
  expose).
- **Fouls/FT volume**: `foul.shootRim/shootPaint/shootMid/shootThree` ↑
  (FT rate 0.33 vs 0.24), `foul.reachInPerSec` ↑, `foul.looseBallPerReb` ↑,
  `foul.chargePerDrive` ↑ (college takes more charges; grade C directional).
- **Rebounding**: `reb.offWeightMult` ↑ (ORB% 28-30 vs 22-26 — college
  crashes; also `ai.crashBase`/`ai.crashTendScale` ↑ and
  `ai.defCrashFarChance` re-fit).
- **Turnovers**: `pass.riskBase` ↑ (TOV/poss +20%), `pass.skillCoef`
  re-fit against the wider skill spread, `foul.stripBase`/`attackReachInMult`
  interplay re-verified (live-ball vs dead-ball TO split: college steal% 9.7
  vs NBA 8.3 per poss says live-ball share is higher → `pass.stealShare` ↑).
- **Assists**: the `ai.assistWindowSec`/`assistMaxDribbles*` bookkeeping can
  stay (scorekeeping definition is shared), but `astdShare` lands ~10pp lower
  via the mix shifts above; don't chase it with the bookkeeping knobs.
- **Rotations**: `sub.tiredThreshold`, `sub.benchTiredBonus`,
  `sub.rotationLeash*` — college starters play ~28-33 of 40 minutes with
  deeper situational benches, and 5-foul trouble (in a foulier game) forces
  earlier hooks. `sub.crunchClockSec: 300` already reads "final period",
  which is the second half for `periods: 2` — verify the crunch window
  semantics rather than assuming.
- **Not params**: zone defense (no knob exists — new mechanics), one-and-one
  (rulepack + fouls.ts logic), roster generation (the single biggest lever:
  rating distributions, height distribution ~2in shorter, wider spread).

### 6.3 Harness changes

- League-aware pace normalization in `packages/stats/src/box.ts` (§5 warning).
- `NCAA_BANDS` wired the same way `NBA_BANDS` is (`metric` keys already match
  `LeagueAverages` — the proposal reuses them 1:1).
- Sweep objective must load league bands + league rulepack + league param
  overlay together — a sweep that mixes NBA bands with the NCAA rulepack is
  meaningless.

### 6.4 A `--league ncaa` calibration workflow (proposal)

1. **Freeze rosters first.** Build an NCAA roster generator (wider, lower,
   younger: ratings band, height −2in, FT skill distribution) and pin its
   seed corpus before any param fitting — otherwise params absorb roster
   error (the repo already learned this: "the shooting calibration absorbs
   kinematics errors", params.ts).
2. **Decide the ratings-vs-params split explicitly**: league deltas that are
   TALENT (FT%, 2P%, TOV skill) should come from rosters on the shared 0-100
   scale; deltas that are ENVIRONMENT (clock, bonus, pace norms, crash
   tendencies, action mix) come from a `ncaaParams` overlay via
   `withParams(overrides)` — the era-pack mechanism params.ts already
   documents (`decide.threeAppetite` is the worked example).
3. **Land rulepack structure (6.1) before sweeping** — the one-and-one
   changes FTA/pts coupling, so sweeping before it lands calibrates to a
   wrong target.
4. **Sweep against `NCAA_BANDS`** in the standard order (pace → shot mix →
   efficiency → fouls/reb/tov → differentiation), NCAA rulepack loaded,
   NBA sweep untouched.
5. **Regression-guard both leagues**: every future mechanics change runs both
   band sets; an NCAA-only fix that breaks NBA bands is a param-overlay
   candidate, not a mechanics change.
6. **Holdout**: fit on 2022-2025, hold out 2025-26 (efficiency 108.5 /
   FT-rate 35.0 / 3PA-share 39.5 — the most modern, hardest-to-hit season),
   mirroring the season protocol in `data/nba/README.md`.

---

## 7. What we could not source (honesty ledger)

- **KenPom's paywalled pages**: kenpom.com/trends.php now requires a
  subscription (verified 2026-07-27); we recovered the full trends table from
  the hoopR package's reference documentation (kp_trends example output) and
  cross-checked it against Sports-Reference per-game data. If the project
  wants first-party provenance, a $25/yr KenPom subscription + their API is
  the clean path.
- **National zone-defense possession share**: no published current number
  found; Synergy licenses the data and public articles show trends, not
  levels (3MW charts). Our "~10% D-I vs low-single-digit NBA" is grade C.
- **Isolation/play-type frequency NBA-vs-NCAA pair**: Synergy-licensed;
  directional claims only.
- **Average possession length (17-18s NCAA / ~14.5s NBA)**: widely cited,
  couldn't reach a primary page — grade C, flagged inline.
- **NBA home win% (~54-55%)**: grade C recollection, flagged inline in §3.
- **The true #364-365 KenPom bottom teams for 2025**: our table snapshot
  captured through #363 (Arkansas-Pine Bluff −25.94); the absolute floor may
  be 1-3 points lower. Does not change the ~65-point-spread conclusion.
- **Women's game**: deliberately out of scope (the pack is `NCAA (men)`), but
  noted: 4×10 quarters, 2-shot bonus at 5 fouls/quarter, no one-and-one — a
  future `ncaa-w` pack is a different structure, not a re-tune.
