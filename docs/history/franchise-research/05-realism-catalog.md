# Realism Failure Catalog for a Multi-Season NBA Franchise Sim

Compiled 2026-07-31. Purpose: source-backed targets for acceptance tests.
Provenance tags: [P] = verified primary (read directly from source), [S] = secondary (journalism/blog/forum aggregation), [I] = inferred/derived by this report.
Where sources disagree, both numbers are kept.

## A. Realism failures documented in sim communities

A1. League-wide stat drift over long sims. OOTP's auto-adjusting League Total Modifiers cause multi-decade drift/oscillation because each year's recalibration chases small-sample noise ("auto calc LTM is the devil", OOTP forums, https://forums.ootpdevelopments.com/showthread.php?p=3931423) [S]. Fictional-league BABIP creeps .280 -> .305 over seasons regardless of settings, killing sub-3.00 ERAs (https://forums.ootpdevelopments.com/showthread.php?p=4951062) [S].

A2. Initial-cohort anomaly. The randomly generated founding player pool differs statistically from players generated later; league totals are "out of whack the first few years"; community fix is to sim 20 years and delete history before starting (same BABIP thread, reply by Dutch Alexander) [S]. Acceptance test: year-1 league averages must match year-20 within noise.

A3. Star/score inflation from rating or badge creep. NBA 2K20+ MyLeague: "9 stars averaging 30+, Luka averaging 36 in back-to-back seasons. Games finishing 164-144"; cause identified as badges stacking on ratings (Operation Sports, https://forums.operationsports.com/forums/forum/basketball/nba-2k-basketball/900643-myleague-scoring-is-inflated-is-there-a-fix) [S]. Real anchor: only 2-4 players average 30+ PPG in a typical modern season (B-R leaderboards) [S].

A4. Minutes/workload distributions wrong. Basketball GM's fatigue rework was needed because good players played too few minutes and depth too many (ZenGM blog, https://zengm.com/blog/2020/07/game-sim-realism/, PR https://github.com/zengm-games/zengm/pull/273) [P]. 2K historic-era sims give stars only ~29 MPG so Hakeem/Robinson average ~16 PPG (https://forums.operationsports.com/forums/forum/basketball/nba-2k-basketball/927028-jordan-era-sim-stats) [S]. OOTP: pitchers at 140 pitches, everyone at ~700 AB (https://forums.ootpdevelopments.com/showthread.php?t=314737) [S].

A5. Trade AI exploitable by fleecing. Documented BBGM exploits, each patched: (a) AI valued its future picks using its PRE-trade roster, so you could gut a contender and also take its (now-lottery) picks cheap (https://zengm.com/blog/2023/01/ai-draft-pick-valuation/, PRs 434/439) [P]; (b) sign-free-agents-then-flip-for-picks churn, fixed by a 15-game trade embargo on new acquisitions (https://zengm.com/blog/2014/02/new-improved-trade-ai/) [P]; (c) AI ignored injuries on incoming players [P, same post]; (d) AI accepted bad contracts alongside releasable (zero-value) players (PR 434 discussion) [P]; (e) a hard "max 2 picks per trade" cap used for years as an anti-fleece bandaid, replaced by escalating reluctance in 2025 (https://zengm.com/blog/2025/08/ai-draft-pick-trade-limit/) [P].

A6. Too many blowouts / wrong margin-of-victory distribution. BBGM added score-margin-dependent effort (magnitude ~ home-court advantage per 10 pts of margin) because pure-rating sim produced too many blowouts (https://zengm.com/blog/2020/07/game-sim-realism/) [P].

A7. Shot-profile percentages off vs reality. BBGM PR 272: rim FG% under-weighted height, low-post FG% too high, mid-range FG% too low, exposed by plotting sim vs NBA 2006-2019 percentages by location (https://github.com/zengm-games/zengm/pull/272) [P].

A8. Long-horizon player-generation decay (Football Manager). In 15-30 year saves: regens spawn with skewed attributes (mental attrs like concentration stuck ~5), height distribution shrinks ("tiny goalkeepers"), few high-workrate players; AI squads age, hoard un-played wonderkids, converge on one tactic; "if you play long enough you will eventually win because the AI is just bad at everything" (VideoGamer roundup of FM24 complaints, https://www.videogamer.com/features/these-annoying-bugs-are-ruining-long-term-football-m/) [S]. Perceived regen-quality decline threads: https://fm-base.co.uk/threads/crappy-regens-quality-in-decline.112009/ [S].

A9. League leaders implausible. 2K16 sims: league FTA leader ~6.5/g vs real 9-10; PER leader ~25 vs real 29-30 (https://forums.operationsports.com/forums/forum/basketball/nba-2k-basketball/796573-question-about-simulated-stats) [S].

A10. AI asset valuation feels wrong in the other direction too: BBGM AI demanding 3 firsts + a star to move up 2 draft slots — overcorrection against fleecing reads as unrealistic (gmgames.org BBGM review, https://gmgames.org/2020/03/06/stanners-review-of-basketball-gm-so-many-features-packed-in-to-one-game-2020/) [S].

Gap: no direct complaint thread on award-voting realism was captured this pass; award sanity is covered indirectly via leaderboard checks (C2).

## B. Real NBA statistical regularities (targets)

### B1. League averages, per team per game (Basketball-Reference league averages page, https://www.basketball-reference.com/leagues/NBA_stats_per_game.html, crawled 2026-07-31) [P]
| Season | PTS | Pace | ORtg | eFG% | TOV% | ORB% | FT/FGA | FGA | 3PA | FG% | 3P% | FT% | TS% |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 2023-24 | 114.2 | 98.5 | 115.3 | .547 | 12.1 | 24.2 | .192 | 88.9 | 35.1 | .474 | .366 | .784 | .580 |
| 2024-25 | 113.8 | 98.8 | 114.5 | .543 | 12.6 | 25.2 | .189 | 89.2 | 37.6 | .467 | .360 | .780 | .576 |
| 2025-26 | 115.6 | 99.4 | 115.7 | .546 | 12.7 | 26.0 | .206 | 89.1 | 37.0 | .471 | .360 | .783 | .581 |
Era context [P, same table]: 2015-16 pace 95.8 / 3PA 24.1 / PTS 102.7; 2011-12 pace 91.3 / 3PA 18.4 / PTS 96.3. 3PA rate roughly doubled 2012->2025; a sim spanning eras needs era-aware norms or explicit stationarity.

### B2. Aging curves
- Peak overall: ~27, decline after 30 (Frontiers 2025 KAN study of 2,786 player-seasons 2019-24 citing consensus, https://www.frontiersin.org/journals/sports-and-active-living/articles/10.3389/fspor.2025.1693433/full) [P]. Bryant Univ. empirical paper: prime 27-31, decline after 32 (https://digitalcommons.bryant.edu/cgi/viewcontent.cgi?article=1223&context=eeb) [P]. Mean All-Star age 26.5, mean MVP age 27.9 (UW CSE163 analysis, https://courses.cs.washington.edu/courses/cse163/21su/files/project/archive/nba.pdf) [S].
- Bayesian latent-factor aging model on full NBA history: Bilalic et al. 2019, Behavior Research Methods (https://link.springer.com/article/10.3758/s13428-018-1183-8) — development and decline rates differ by player; decline rate depends on acquisition phase [P, abstract].
- Skill-specific: Nylon Calculus (2019) fit separate aging curves for rim-attempt frequency (explosiveness proxy, declines earliest), rim accuracy, 3P frequency, and 3P accuracy (shooting holds up latest); also quantifies ACL/Achilles hits to each (https://fansided.com/2019/07/01/nylon-calculus-predicting-injury-recovery-klay-durant/) [S]. Test: athleticism-driven stats should peak ~24-26, shooting/playmaking ~28-31.

### B3. Career length
- Median career ~4.5 years, Kaplan-Meier over 4,374 players 1946-2019 (AUEB survival-analysis thesis, https://www.pyxida.aueb.gr/items/0e8c521c-7b30-482e-a797-027bdc4c2a3c) [P, abstract]. Debut age is the strongest determinant (later debut => shorter career) [P].
- Drafted players who stick: of 1999-2006 draftees with a 2nd-year game, 48.5% lasted 10+ seasons; for 2013-14 draftees only 33.8% (Springer IJDSA 2025, https://link.springer.com/article/10.1007/s41060-025-00821-z) [P].
- By draft slot: top-5 picks average ~13-14 career years; longevity falls to ~pick 30 then flattens (Bayesian spline study of 1978-1998 drafts, https://archives.rpd-online.com/article/download/v28-n3-miguel-milan-soares-etal/2746-14000-1-PB.pdf) [P].
- Disagreement to keep: mean career for 1980-2005 draftees who played >=1 game modeled at ~6.8-8.25 seasons (Pizarro Milian 2025, https://doi.org/10.1111/ssqu.70089) vs 4.5-year median for all players ever — the gap is draft-cohort selection and mean-vs-median [I].

### B4. Season-to-season stat stability (what should be sticky vs noisy)
- FT%: ~98% of between-player variance is skill; last season explains ~70% of next season's variance (r ~ .84) (The Power Rank, 2014-2020 data, https://thepowerrank.com/2020/07/28/predictability-vs-skill-in-sports-analytics-3-point-shooting/) [S].
- 3P%: last season explains only ~14.5% of next season's variance (r ~ .38); 5-season sample still only ~24%; ~750 3PA needed before signal outweighs noise; realistic true-talent range ~30-43%, league mean ~36%, essentially nobody sustains 50% (same source; Engelmann, https://jeremiasengelmann.substack.com/p/how-to-accurately-predict-nba-player) [S].
- Player rate stats across role changes, y2y r (B-R blog, 1974+, n=1036): ORB% .932, AST-rate .905, FT-rate (FTA/FGA) .802, TOV-rate .724, TS% .627 (https://www.basketball-reference.com/blog/index69a1.html?p=7220) [P].
- Team-level four factors y2y r (since 1973-74): ORB% .72-.79, TOV% ~.70, eFG% ~.66-.69, FTr ~.62-.63; team 2FG% .63 vs 3FG% .43; opponent 3FG% only .22 — 3P defense is mostly noise (https://www.basketball-reference.com/blog/index8e05.html?p=3475) [P].
- Convenience reliability table (uncorroborated, use as sanity band only): PPG .85, APG .82, RPG .80, usage .80, TOV .70, BLK .65, FG% .60, STL .55, 3P% .50, FT% .85 (datafield.dev basketball-analytics ch.22) [S, weak].

### B5. Injury base rates
- All injuries+illness: 17.80 per 1000 athlete game-exposures; median severity 3 games missed (IQR 0-6); severity mix 33% slight / 26% minor / 26% moderate / 15% severe; top body parts per 1000 AGEs: ankle 2.57, knee 2.44, groin/hip/thigh 1.99 (2008-2019 public data, https://journals.sagepub.com/doi/10.1177/23259671211004094) [P].
- Only ~34-39% of all reported injuries cause a missed game; game-loss injury rate ~6.2 per 10,000 player-minutes in regular season, 2.8 in playoffs (NBA EMR study 2013-14 to 2018-19, https://journals.sagepub.com/doi/10.1177/19417381241258482) [P].
- Ankle sprain (most common injury): 25.8% of player-seasons include one; 56% cause zero missed games; median 2 games missed when any; 80% lateral; prior sprain => 1.41x recurrence (2013-14 to 2016-17, https://sage.cnpereading.com/doi/10.1177/0363546519864678) [P].
- 17-year trainer-reported mix: lateral ankle sprain 13.2% of injuries, patellofemoral inflammation 11.9%, lumbar strain 7.9%, hamstring strain 3.3%; patellofemoral causes the most total games missed (https://pmc.ncbi.nlm.nih.gov/articles/PMC3445097/) [P].
- Severe injuries: ACL — return-to-play 84-98%, mean RTP now ~370 days (~11-12 months), first season back shows reduced minutes/efficiency, near-baseline by season 2. Achilles rupture — RTP only ~70-72%, persistent performance decline, significantly shortened careers (synthesis with citations incl. https://journals.sagepub.com/doi/10.1177/0363546515623028, https://journals.sagepub.com/doi/10.1177/0363546513490659) [S over P abstracts].
- Rough derived target: ~65 game-exposures x 17.8/1000 x ~3-4 games ≈ 4-5 games missed per player-season from injury on average, heavy-tailed [I].

### B6. Team win distribution, titles, upsets
- SD of team wins: 30-season average ~12.9 wins (82-game schedule); 2010-11 was 13.7 (SI, 2011, https://www.si.com/nba/2011/09/07/nba-parity) [S]. NBA has persistently the highest relative SD of the four US majors, largely inherent to basketball's many scoring events (MPRA paper, https://mpra.ub.uni-muenchen.de/43088/1/MPRA_paper_43088.pdf) [P]. Test: simulated seasons with wins SD chronically <10 or >16 are off.
- Best regular-season record wins the title: 37 of 78 seasons (~47%) all-time (SportsOrca, https://sportsorca.com/nba/nba-new-era-parity-60-win-rings/) [S] vs only 10 of ~31 seasons 1990-2021 (~32%) (Bruin Sports Analytics, https://www.bruinsportsanalytics.com/post/championship_win_shares) [S]. Keep both; recent era is less chalky.
- Champions by seed: 1-seeds won ~53 of ~79 titles (~67%); seeds 1-3 account for ~97.5%; lowest seeds to win: 1995 Rockets (6), 1969 Celtics (4) (landofbasketball.com via aggregation, https://www.landofbasketball.com/championships/champions_by_seed.htm) [S].
- 8-over-1 first-round upsets: 6 ever since the 16-team format began 1983-84 (1994 DEN, 1999 NYK, 2007 GSW, 2011 MEM, 2012 PHI, 2023 MIA) => 1-seeds win ~93% of round-1 series (https://www.nbcsportsboston.com/nba/nba-playoffs-8-seed-beat-1-seed/605390/) [S]; [I] on the ~93%.
- Cross-sport randomness benchmark: Lopez, Matthews & Baumer, Bayesian state-space on betting data — NBA has the largest talent dispersion and home advantage of the four leagues; its playoffs most reliably crown the best team (https://ecommons.luc.edu/cgi/viewcontent.cgi?article=1025&context=math_facpubs) [P].

### B7. Draft value and bust rates (RotoWire study of all 688 first-rounders 2000-2022, from Basketball-Reference data, https://www.rotowire.com/basketball/article/nba-draft-pick-value-what-every-first-round-pick-is-really-worth-pick-by-pick-119204) [S]
- All-Star rate: pick 1 = 69.6%; picks 1-3 = 52%; picks 21-30 = 5.3%.
- Bust rate (negative career VORP over >=50 games): first round average 32%.
- Slot noise is real: pick 8 produced zero All-Stars in 23 drafts; pick 3 has out-produced pick 2.
- Value decays steeply picks 1-10, then flattens (Arizona thesis using prime-5yr PER/WS, https://repository.arizona.edu/bitstream/handle/10150/651330/azu_etd_hr_2020_0130_sip1_m.pdf) [P]; curves differ wildly by metric/aggregation — mean vs median especially (Wharton, https://wsb.wharton.upenn.edu/wp-content/uploads/2024/12/NBA_draft_curves-6.pdf) [P]. Test: expected career WS by pick should be convex-decreasing with high variance, not a clean monotone ladder per-draft.

### B8. Contract structure (2024-25 CBA 101, official NBA doc, https://cms.nba.com/wp-content/uploads/sites/4/2024/11/2024-25-CBA-101.pdf) [P]
- Max first-year salary by years of service: 0-6 YOS = 25% of cap; 7-9 = 30%; 10+ = 35%. Rose Rule lets a 4-YOS player reach 30%; Designated Veteran ("supermax") lets 7-9 YOS reach 35% (own team only). Floor: 105% of prior salary can exceed tier.
- Raises: up to 8% of first-year salary with Bird rights, 5% otherwise (Sportsnet explainer, https://www.sportsnet.ca/nba/article/nba-free-agency-faq-salary-cap-bird-rights-moratorium-and-more/) [S].
- 2024-25 exceptions [P]: Non-taxpayer MLE $12.822M/4yr; Taxpayer MLE $5.168M/2yr; Room MLE $7.983M/3yr; Bi-annual $4.668M/2yr; minimum-salary scale by YOS (Exhibit C; ~$1.16M rookie min to ~$3.3M 10+ vet min [S]). 2024-25 cap $140.588M [S].
- Distributional implication [I]: a realistic cap sheet has 0-2 players at 25-35% of cap, a middle class clustered near MLE ($5-13M), and roughly a third of the roster at minimums — sims whose salary histograms are uniform or normal read as fake.

## C. What stat-literate players check FIRST on a sim's output
Ranked from the Operation Sports MyLeague-audit threads (https://forums.operationsports.com/forums/forum/basketball/nba-2k-basketball/813334-myleague-simmed-stats/page6; .../796573; .../927028) [S] plus BBGM dev practice (plots of sim vs NBA distributions in PRs 272/273) [P]:
1. League-average table vs real: pace, ORtg/DRtg, FG%, 3P%, fouls/g, rebounds/g. One OS poster's explicit checklist "in order of importance": pace, defensive efficiency, team fouls, rebound percentages — 2K17's pace 98.6 and DRtg 103.4 were called out against real 95.8/106.4.
2. League leaders / leaderboards: scoring leader ~30-35 PPG (not 40+, not 25); count of 30+ PPG players (2-4, not 9); FTA leader ~9-10/g; PER leader ~28-31.
3. Minutes distributions: leaders ~36-38 MPG; stars not sub-30 (Jordan-era thread); rotation ~9-10 players.
4. Box scores / game scores: totals distribution (164-144 is a red flag), blowout frequency, margin-of-victory spread (BBGM tuned this explicitly).
5. Standings: wins SD ~12-13, frequency of 65+/70-win and sub-15-win teams.
6. Shooting-split sanity: FG% by location, 3PA rate matching the era, FT/FGA.
7. Multi-decade only: drift of all of the above, career leaderboards vs real records, retirement ages, draft-class quality stability (OOTP/FM threads above).

## D. Highest-leverage acceptance tests [I, derived from all above]
1. 20-season hands-off sim: league PTS/pace/eFG%/3PA-rate/TOV%/ORB% each stay within ~±3% of targets with no monotonic drift; season 1 == season 20 statistically.
2. Star density: 30+ PPG scorers in [1,5]; scoring title in [30,37] PPG in modern-norm settings.
3. Wins SD in [10.5, 15]; a 70+ win team <= ~1 per decade; best-record team wins title ~30-50% of sims.
4. 1-seeds win ~90-95% of first-round series; champion seed distribution ~2/3 1-seeds, seeds 1-3 >= 95%.
5. Aging: population peak age 26-28; shooting ages better than athleticism; median career ~4.5 yrs; top-5 picks mean ~13 yrs.
6. Stickiness: y2y r(FT%) >> r(3P%) (~.84 vs ~.38); ORB%/AST-rate most stable player rates.
7. Injuries: ~4-5 games missed per player-season mean, heavy tail; ankle sprain most common (~26% of players/season, median 2 games); ACL ~1 season, Achilles worse with permanent decline and elevated retirement.
8. Trade AI: re-run the documented BBGM exploit scripts (gut-a-contender-and-take-picks; sign-and-flip; injured-player dump; bad-contract dump) — all must fail.
