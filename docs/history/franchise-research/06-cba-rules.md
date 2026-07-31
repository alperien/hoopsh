# NBA CBA (2023 Agreement) & League Operations — Reference Spec for Sim League Office
Compiled 2026-07-31. All dollar figures labeled by season; they reset every July 1.
Provenance tags: [P] = verified primary (league release / official doc / dedicated data page), [S] = secondary (reputable cap media: Hoops Rumors, Spotrac, RealGM, ESPN), [I] = inferred/arithmetic-consistent but not directly sourced.
Note on cbafaq.com: Larry Coon retired in 2024-25 and never published a full 2023-CBA edition; the site is frozen (http://www.cbafaq.com/salarycap.htm). Best current substitutes: Hoops Rumors glossary, cbaguide.com, NBA "CBA 101" (https://cms.nba.com/wp-content/uploads/sites/4/2024/11/2024-25-CBA-101.pdf), 2023 CBA summary (https://ak-static.cms.nba.com/wp-content/uploads/sites/4/2023/06/2023-CBA-Summary.pdf).

## 1. Cap / Tax / Apron Lines
| Season | Cap | Floor (90%) | Tax line | 1st apron | 2nd apron |
|---|---|---|---|---|---|
| 2024-25 | $140,588,000 | $126,529,000 | $170,814,000 | $178,132,000 | $188,931,000 |
| 2025-26 | $154,647,000 | $139,182,000 | $187,895,000 | $195,945,000 | $207,824,000 |
| 2026-27 | $164,961,000 | $148,465,000 | $200,428,000 | $209,015,000 | $221,686,000 |
- 2026-27 [P]: league release June 30, 2026 (https://www.spotrac.com/news/_/id/3413/nba-officially-sets-2026-27-salary-cap-at-164961-million ; https://www.hoopsrumors.com/2026/06/salary-cap-tax-line-set-for-2026-27-nba-season.html). 2025-26/2024-25 [S]: same annual release cycle, figures per Hoops Rumors/Spotrac archives.
- How set [P]: cap = (44.74% of projected BRI − projected player benefits) / 30. Tax line = 53.51% of BRI variant; in practice tax ≈ 121.5% of cap, rounded to nearest $1k (HR tax glossary). 1st apron = tax + ~$7M base (2023-24), 2nd apron = tax + ~$17.5M base, both indexed to cap growth. (https://cms.nba.com/wp-content/uploads/sites/4/2024/11/2024-25-CBA-101.pdf)
- Growth bounds [P/S]: cap can rise at most 10% per year (2025-26 rose exactly the 10% max: $140.588M -> $154.647M despite new TV money). Cap cannot decrease year-over-year; several outlets also report a 3% minimum annual rise — UNRESOLVED between 0%/3% floor, rarely binding. Sim rule: clamp growth to [0-3%, 10%].
- 2027-28 projection [S]: ~+5.5% -> ~$174M (league guidance via B/R Pincus, June 2026).
- Floor: teams must reach 90% of cap by start of regular season or pay shortfall to league and lose full tax-distribution share [S, HR 2026-27 article].
- Escrow/BRI split [S]: players receive ~51% of BRI; 10% of player salaries withheld in escrow to true up.

## 2. Maximum Contracts
Max starting salary = % of cap by years of service (YOS) [P: 2026-27 release]:
| YOS | % cap | 2024-25 | 2025-26 | 2026-27 |
|---|---|---|---|---|
| 0-6 | 25% | $35,147,000 | $38,661,750 | $41,240,250 |
| 7-9 | 30% | $42,176,400 | $46,394,100 | $49,488,300 |
| 10+ | 35% | $49,205,800 | $54,126,450 | $57,736,350 |
(2024-25/2025-26 = cap x %, arithmetic-exact [I/S].)
- Raises: 8% of year-1 salary per year re-signing with Bird rights; 5% with another team. Lengths: 5 years own team (Bird), 4 years otherwise. [S]
- A player's max is also at least 105% of his previous salary (relevant for stars whose old max exceeds new tier) [S].
- Designated Veteran ("supermax") [S: https://www.hoopsrumors.com/2023/05/hoops-rumors-glossary-designated-veteran-contract.html]: 35% tier before 10 YOS. Eligibility: 7-8 YOS when signing extension (8-9 as FA re-signing); must be on team that drafted him or traded during first 4 years; criteria = All-NBA (any of 3 teams) in most recent season or 2 of last 3, OR DPOY most recent or 2 of last 3, OR MVP in any of last 3. Award eligibility now requires 65 games played [S]. DVE can total 6 seasons including remaining year(s); max 2 designated vets per team via extension.
- Rose Rule (Designated Rookie): 5th-year extension off rookie deal can start at up to 30% of cap (instead of 25%) if same All-NBA/MVP/DPOY criteria met [S].

## 3. Rookie Scale
- Structure: 4-year contracts — years 1-2 guaranteed, years 3 and 4 team options (exercised ~Oct 31 one year in advance). First-rounders may sign 80-120% of scale; virtually all sign at 120% [P: RealGM https://basketball.realgm.com/nba/info/rookie_scale].
- 2026-27 scale (year-1 base, sign at 120% for actual salary) [P]: #1 $12.29M (120% = $14.75M), #5 $8.06M, #10 $5.35M, #15 $4.14M, #20 $3.25M, #25 $2.65M, #30 $2.44M. Year 2 ≈ +5%; year 3 option ≈ +5%; year-4 option raise over year 3 varies by pick from 26.1% (#1) to 80.5% (#30). Scale table amounts move with the cap each July.
- Restricted free agency after year 4 via qualifying offer (QO). QO = year-4 salary x pick-specific bump (40.0% at #1 up to 60.0% at #30) [P: RealGM], adjusted by "starter criteria" (see §11).
- Rookie scale extensions: window from end of July moratorium after 3rd season until 6:00pm ET day before 4th-season opener; up to 5 new seasons (years 5-9); can be max ("max allowable" deals common) or fixed amounts [S: RealGM CBA Encyclopedia, cbaguide.com/transactions/extensions/].

## 4. Minimum Salaries, 10-Days, Two-Ways, Exhibit 10
Minimums by YOS, new one-year deals [P: https://www.hoopsrumors.com/2026/07/nba-minimum-salaries-for-2026-27.html; 2025-26 col = 2026-27 / 1.0667, matches archived figures [I/S]]:
| YOS | 2025-26 | 2026-27 |
|---|---|---|
| 0 | $1,272,870 | $1,357,763 |
| 1 | $2,048,494 | $2,185,116 |
| 2 | $2,296,271 | $2,449,421 |
| 3 | $2,378,870 | $2,537,526 |
| 4 | $2,461,463 | $2,625,627 |
| 5 | $2,667,947 | $2,845,883 |
| 6 | $2,874,436 | $3,066,143 |
| 7 | $3,080,921 | $3,286,399 |
| 8 | $3,287,409 | $3,506,659 |
| 9 | $3,303,774 | $3,524,115 |
| 10+ | $3,634,153 | $3,876,529 |
- Vet-min reimbursement: 1-year minimum deals for 3+ YOS players hit the cap/tax only at the 2-YOS rate ($2,449,421 in 2026-27); league pays the difference. One-year deals only [P/S: HR].
- Minimum Salary Exception: always available (unless hard-capped), contracts up to 2 years, unlimited count [S].
- 10-day contracts [S: HR glossary]: signable starting Jan 5; prorated minimum by days/season-days; max two 10-days per player per team per season, then must sign rest-of-season deal.
- Two-way contracts [P/S: HR two-way glossary + 2025-26 active-limits post]: 3 slots per team (don't count vs cap or 15-man limit). Eligibility: fewer than 4 YOS. Salary = 50% of rookie minimum ($678,882 in 2026-27), prorated if signed in-season; full guarantee if on roster through Jan 7; up to $91,000 (2026-27) guaranteeable at signing ("two-way protection amount"). Active for max 50 NBA games (prorated if signed late); team limited to 90 total two-way active games while carrying <15 standard players ("under-15" rule). NOT playoff-eligible; must convert to standard contract to exceed limits/play playoffs. Two-way signing deadline is early March [S].
- Exhibit 10 [S]: one-year, non-guaranteed minimum deal; optional bonus $5k-$91k (2026-27 max; $85.3k in 2025-26) paid if waived and spends 60 days with team's G League affiliate; convertible to two-way before season starts.

## 5. Cap Exceptions (amounts move with cap each July)
| Exception | 2025-26 | 2026-27 | Max yrs | Raises | Hard-cap trigger |
|---|---|---|---|---|---|
| Non-taxpayer MLE | $14,104,000 | $15,044,000 | 4 | 5% | Using > taxpayer portion hard-caps at 1st apron |
| Taxpayer MLE | $5,685,000 | $6,064,000 | 2 | 5% | Using any MLE portion hard-caps at 2nd apron |
| Room exception | $8,781,000 | $9,366,000 | 3 | 5% | none (team already used cap room) |
| Bi-Annual (BAE) | $5,134,000 | $5,477,000 | 2 | 5% | 1st apron; usable only every other year |
2026-27 [P: league release via HR/Spotrac]; 2025-26 [S, cap-ratio exact]. Non-taxpayer MLE can now also be used to acquire players via trade/waiver claim (2023 CBA change; triggers 1st-apron hard cap) [P: HR].
- Bird family (free agency exceptions to exceed cap for own FAs) [S; cbafaq legacy definitions still accurate]:
  - Full Bird (3 seasons w/o being waived/changing teams as FA; rights travel in trades): up to max, 5 years, 8% raises.
  - Early Bird (2 seasons): up to greater of 175% of prior salary or 105% of prior-season league-average salary ($15,235,500 ceiling for 2026-27 [P]); min 2 years, max 4, 8% raises.
  - Non-Bird (1 season): up to 120% of prior salary or 120% of minimum; max 4 years, 5% raises.
- Cap holds: unsigned FAs count against cap at % of prior salary until renounced/signed (e.g., 190%/150% bands by salary level; rookie 1st-round holds = 120% of scale) — simplified; exact hold % table varies by Bird status and salary vs league average [I - capture if needed].

## 6. Trade Rules
Salary matching for simultaneous trades (team below both aprons) [P: HR 2026-27 article]:
- Outgoing up to ~$7.5M-base band: take back up to 200% of outgoing + $250k.
- Middle band: outgoing + "expanded TPE amount" ($9,096,000 in 2026-27; $7.5M base in 2023-24, indexed to cap).
- Large salaries: 125% of outgoing + $250k.
(Effective rule: incoming ≤ max of the three formulas; bands indexed to cap growth [I: arithmetic 7.5M x cap ratio = 9.096M exact].)
- First-apron teams (or trades that would put them over): cannot use expanded TPE — taking back >100% of outgoing hard-caps at 1st apron; so apron teams match at ≤100% [P: HR]. Also hard-capped at 1st apron by: acquiring via sign-and-trade, using pre-offseason TPEs, MLE via trade/claim, signing a bought-out player whose pre-waiver salary exceeded the NT-MLE (in-season) [P: HR].
- Second-apron teams: cannot aggregate 2+ player salaries in one deal, cannot send cash in trades, cannot take back salary via a signed-and-traded player; doing any of these hard-caps at 2nd apron [P: HR].
- Cash in trades: per-league-year limits for sent AND received separately — $8,495,000 each in 2026-27 [P]; ~$7,958,000 in 2025-26 [I: indexed from $7.0M 2023-24 base].
- Sign-and-trade: acquiring team hard-capped at 1st apron; contract min 3 seasons (yr 1 guaranteed), max 4; base year compensation (outgoing salary counts at 50%) applies to Bird re-signs with >20% raise by over-cap teams — simplified [S].
- Recently signed players: offseason FA signings untradeable until Dec 15 or 3 months after signing (later of); Jan 15 for players re-signed via Bird/Early Bird with raise >20% by an over-the-cap team [S: HR special-eligibility-dates].
- Draft picks: tradeable up to 7 drafts out. Stepien rule: cannot be left without a first-round pick in any two consecutive future drafts [S]. Protections (top-N, rolls to future year or converts) and pick swaps ("more/less favorable of") are contractual and common [S].
- Second-apron pick penalty: finish a season above 2nd apron -> your 1st-round pick 7 years out is "frozen" (untradeable); if above the 2nd apron in 2 of the following 4 seasons (3 of 5 total), that pick is moved to #30 overall [P/S: 2023 CBA summary; HR tax-aprons glossary].
- Trade deadline: the Thursday ~10 days before the All-Star Game, 3:00pm ET (Feb 5, 2026 last season) [S]. Trades resume after the Finals/new league year for the offseason.
- Non-simultaneous TPEs: trading a player for less salary creates a TPE usable for 1 year (using a prior-offseason TPE now triggers 1st-apron hard cap) [P: HR].

## 7. Luxury Tax Math
[P/S: https://www.hoopsrumors.com/2024/11/hoops-rumors-glossary-luxury-tax-penalties-4.html]
- Computed on team salary on final day of regular season (with bonus true-ups). Bracket width = $5M in 2023-24, indexed to cap growth ($5,168,000 in 2024-25; scale by cap ratio each season).
- Rates through 2024-25 (per $ over line, by bracket): 1.50 / 1.75 / 2.50 / 3.25, then +0.50 per additional bracket. Repeater: +1.00 to each.
- Rates from 2025-26 on (current): standard 1.00 / 1.25 / 3.50 / 4.75, then +0.50 per bracket; repeater 3.00 / 3.25 / 5.50 / 6.75, then +0.50 per bracket.
- Repeater = paid tax in at least 3 of the previous 4 seasons.
- Distribution: up to 50% of tax receipts distributed evenly to non-taxpaying teams; remainder for "league purposes" [S].
- Second apron consequences (besides hard-cap triggers in §6): frozen 7th-year-out first (§6); no MLE at all; cannot sign buyout-market players above NT-MLE pre-waiver salary (1st apron rule, applies a fortiori) [P/S].

## 8. Roster Rules
[S: https://www.hoopsrumors.com/2023/08/hoops-rumors-glossary-nba-roster-limits-2.html; cbaguide.com/eligibility/rosters/]
- Regular season: max 15 standard contracts + 3 two-way = 18. Must carry ≥14 standard; may dip to 13 (or 12) for max 2 consecutive weeks at a time and 28 total days per season. Offseason limit: 21.
- Game night: 12-15 active (two-ways activatable within their 50-game limit); minimum 8 in uniform; rest inactive. (Pre-2017 "13 active" rule is obsolete.)
- G League assignment: players on standard contracts with 0-2 YOS can be assigned unilaterally, unlimited times; 3+ YOS require player consent (and NBPA notice/consent) [S]. Two-way players move freely per team discretion within active-game limits.

## 9. Draft
- 2 rounds x 30 = 60 picks (can be fewer if picks forfeited by penalty — e.g., 58 in 2024/2025 drafts) [S].
- Lottery (since 2019): 14 non-playoff teams; 1,000 of 1,001 four-ball combinations assigned. Top 4 picks drawn; seeds then follow inverse record. #1-pick odds by seed (worst record = seed 1): 14.0, 14.0, 14.0, 12.5, 10.5, 9.0, 7.5, 6.0, 4.5, 3.0, 2.0, 1.5, 1.0, 0.5 (%) [P/S: nba.com/lottery; HR draft-lottery glossary]. Worst team can fall no lower than 5th. Ties: odds averaged, coin flip for order.
- Eligibility [S]: must turn 19 in the draft calendar year and (US players) be one NBA season removed from HS graduation class; internationals eligible at 19; auto-eligible at 22 / after pro contract elsewhere.
- Second-round picks: no scale. Signed via cap room, minimum exception, or the Second-Round Pick Exception (new in 2023 CBA): allows 3- or 4-year deals up to roughly minimum-level salaries (yrs 1-2 at min, modest bumps after) without using MLE/room — simplified [S: 2023 CBA summary].
- Draft rights hold if unsigned; internationals can be stashed. Rookie scale amounts published per draft class each July [P: RealGM].

## 10. Schedule & Competition Formats
- 82 games: 16 vs division (4 x 4 opponents), 36 vs non-division conference (4 games vs 6 teams, 3 games vs 4 teams — the 3-game set rotates on a 5-year cycle), 30 vs other conference (2 x 15). 41 home / 41 away [S: nbastuffer schedule guide].
- Back-to-backs: league average ~13-15 per team per season in recent years, down from ~19 in mid-2010s [S/I: trend widely reported; exact per-season average varies].
- NBA Cup (in-season tournament, since 2023-24) [P: nba.com/news/nba-cup-101]: all 30 teams; 6 groups of 5 (3 per conference, drawn from record-based pots); 4 group games (2 home/2 away) on Cup nights (Tue/Fri, Nov); 6 group winners + 1 wild card per conference -> 8-team single-elimination; QFs at home sites, semis + final in Las Vegas; every Cup game counts in regular-season record EXCEPT the final (finalists play an 83rd game). Prize pool per player for knockout teams.
- Play-in (since 2020-21): seeds 7-10 per conference. 7 hosts 8 (winner = 7-seed); 9 hosts 10 (loser out); loser of 7/8 hosts winner of 9/10 for the 8-seed [S: nba.com].
- Playoffs: 16 teams, 8 per conference, fixed bracket (no reseeding), all rounds best-of-7 in 2-2-1-1-1 format; home-court to better record [S].

## 11. Free Agency Calendar (dates are the modern fixed pattern)
[P: NBA release quoted at https://www.blazersedge.com/nba-news-rumors/113970/nba-sets-salary-cap-for-2026-27-season]
- June 29, 5:00pm ET: QO tender deadline (makes pending FA restricted).
- June 30, 6:00pm ET: FA negotiations open. July 1, 12:01am ET: new league year, new cap in effect.
- Moratorium: until July 6, 12:00pm ET — deals agreed but not signable (exceptions: rookie scale, two-way, minimum deals ≤2 yrs, accepting QOs).
- RFA offer sheets: 2-day match window (before noon ET -> match by 11:59pm next day; after noon -> by 11:59pm of second day) [S: cbaguide RFA]. Player may instead accept his QO (1 year, then unrestricted; no-trade consent that year).
- QO amount: scale-based for 1st-rounders (§3) with starter-criteria adjustment: ≥41 starts or ≥2,000 minutes (or 2-season average) raises/lowers QO for late/early picks respectively — simplified [S].
- Extensions: veteran extensions signable from 2nd anniversary of signing (3rd for some renegotiated deals); first extension year up to 140% of final-year salary OR 140% of estimated average salary ($21,228,200 start ceiling for below-average earners in 2026-27), whichever greater; extensions cover up to 5 total seasons (6 for Designated Veteran); 8% raises [P/S: HR 2026-27 article; cbaguide extensions]. Extend-and-trade limited (6 months post-trade wait; smaller limits) — simplified [S].
- Season-long signing rules: two-way deadline early March; playoff-eligibility waiver deadline March 1 (must be waived by then to appear in another team's playoffs) [S].

## 12. Waivers & Stretch Provision
[S: https://www.hoopsrumors.com/2024/06/hoops-rumors-glossary-waivers-4.html ; https://www.hoopsrumors.com/2024/08/hoops-rumors-glossary-stretch-provision-3.html]
- Waivers: 48-hour claim window (excluding certain days). Claim priority = worst record first (current-season record once enough games played; prior season early). Claiming team assumes the contract (needs cap room, exception, or claim-capable minimum). Unclaimed -> player becomes FA; team still pays remaining guarantee (dead money).
- Set-off: if a waived player signs elsewhere, original team's obligation reduced by a formula share of new salary above a 1-YOS-minimum baseline — simplified [S].
- Stretch provision: remaining guaranteed salary may be spread over (2 x remaining years) + 1 seasons. Waived July 1-Aug 31: current season counts as a remaining year. Waived Sept 1 or later: current-season cap hit unchanged; only future years stretch over (2 x remaining-future-years) + 1.
- 2023 CBA limit: cannot stretch if it would push a team's aggregate stretched/waived dead money above 15% of the cap in any season [S].
- 2025-26 example anchor: bracket/exception proration rules unchanged; stretch math is season-agnostic.

## Appendix A: Hard-Cap Trigger Quick Table (2023 CBA, current rules)
[P: itemized in league-release coverage, https://www.hoopsrumors.com/2026/06/salary-cap-tax-line-set-for-2026-27-nba-season.html]
| Action | Team hard-capped at |
|---|---|
| Acquire player via sign-and-trade | 1st apron |
| Sign player using more than taxpayer-MLE portion of MLE | 1st apron |
| Sign or acquire player using Bi-Annual Exception | 1st apron |
| Use MLE to absorb player via trade or waiver claim | 1st apron |
| Take back >100% of outgoing salary in a trade (expanded TPE) | 1st apron |
| Use a TPE generated before the current offseason | 1st apron |
| Sign a player waived in-season whose pre-waiver salary > NT-MLE | 1st apron |
| Use ANY portion of the MLE (i.e., taxpayer MLE) | 2nd apron |
| Aggregate 2+ player salaries in a trade | 2nd apron |
| Send out cash in a trade | 2nd apron |
| Take back salary using a signed-and-traded player | 2nd apron |
Hard cap = team salary may not exceed that apron for the rest of the league year. Teams that avoid all triggers have NO hard cap (soft-cap system).

## Appendix B: Exception amounts, 2024-25 (for historical seasons)
[S: July 2024 league release as covered by Hoops Rumors/Spotrac]
- Non-taxpayer MLE $12,822,000; Taxpayer MLE $5,168,000; Room exception $8,006,000; BAE $4,681,000.
- Two-way salary $578,577; min salary 0 YOS $1,157,153; 10+ YOS $3,303,771.
- These are cap-ratio consistent with the 2025-26/2026-27 tables above (x1.10, x1.0667) [I].

## Appendix C: Simplifications flagged (verify against CBA text before hardcoding)
1. Cap-growth floor: 0% vs 3% minimum unresolved (§1) — model 10% ceiling as firm.
2. Cap-hold percentage table (§5) not compiled — needed only if sim models offseason cap-room timing precisely.
3. QO starter-criteria adjustments (§11) simplified — exact remap (e.g., pick 10-30 meeting criteria gets 21st-pick QO level) omitted.
4. Base-year compensation and extend-and-trade windows (§6, §11) simplified.
5. Set-off formula (§12): exact = 50% of (new salary − 1-YOS minimum), off the remaining obligation — stated loosely above.
6. Second-Round Pick Exception salary bands (§9) simplified to "roughly minimum-level."
7. Active-list bounds "12-15" (§8): sources describe both 12-13 legacy and up-to-15 modern practice; league ops today effectively allow 15 in uniform incl. two-ways within limits.

## Cross-check anchors (for sim validation)
- 2026-27: cap $164.961M; 25% max $41,240,250 = exactly 0.25 x cap. Tax $200.428M = 121.5% of cap (rounded). NT-MLE $15.044M ≈ 9.12% of cap. [P]
- Exceptions/minimums/cash/TPE bands all scale with cap ratio year-over-year (verified 2025-26 -> 2026-27 at +6.669%). [I]
- Estimated average salary 2026-27: $15,163,000 [P: HR].
