# Basketball GM (BBGM) Community Research — what players love, hate, and request

Researched 2026-07-31. Sources: r/BasketballGM (fetched via redlib mirror safereddit.com; canonical URLs given as reddit.com permalinks), zengm.com blog, GitHub (zengm-games/zengm), HN Algolia, review sites.
Provenance tags: [P] = verified against primary source (page fetched and read), [S] = reported by secondary source, [I] = inferred by me.

## Context / scale
- BBGM is by Jeremy Scheff ("dumbmatter"). Repo is now zengm-games/zengm (460 stars, 209 total issues) — dumbmatter/basketball-gm and dumbmatter/gm-games redirect there. [P] https://api.github.com/repos/dumbmatter/gm-games
- BBGM became the dev's full-time job in Jan 2021 (1.2k upvotes, top-2 post all time). [P] https://reddit.com/r/BasketballGM/comments/l7xxq7/
- Dev's own count (Nov 2024): "Tens of thousands of users." A fan post claims "millions of users" — treat as hyperbole. [P] https://reddit.com/r/BasketballGM/comments/1gtihaj/ ; [P] https://reddit.com/r/BasketballGM/comments/1f9umra/
- Subreddit ~36k members. [S] https://gummysearch.com/r/BasketballGM/
- 2026: dev says BBGM is "more popular and more profitable than 2021" but feels besieged by "vibecoded" web sports sims; defines his niche as "a free, web-based game that has a lot of features." [P] https://zengm.com/blog/2026/06/vibecoded-games/ (HN thread, 67 pts: https://news.ycombinator.com/item?id=48508021)

## Q1. What players praise
1. Free, browser-based, no install/signup, no microtransactions; "best GM game outside of 2k, and even surpasses 2k." [P reviews] https://gmgames.org/basketball-gm/user-reviews/ ; [P] https://reddit.com/r/BasketballGM/comments/orihf2/ ("This game should not be better than NBA 2k21. But it is. By a wide margin", 482 pts)
2. Sim speed / "one more season" loop. Users run 200–3000+ season leagues; one simmed to year 10,000. [P] https://reddit.com/r/BasketballGM/comments/sbt2dv/ ; https://reddit.com/r/BasketballGM/comments/88kvkr/ ; nihilism thread (203 pts) about 200+ season saves: https://reddit.com/r/BasketballGM/comments/1otibmo/
3. Customization: God Mode, custom rosters (alexnoob real-player files), settable league rules; open source moddability. [P] https://zengm.com/blog/2020/07/game-sim-realism/ ; https://zengm.com/blog/2022/11/game-sim-settings/ ; [S] gamebrain.co/game/basketball-gm
4. Dev responsiveness is a core part of the product's reputation. "u/dumbmatter appreciation post" (636 pts): "consistently updates it... takes the time to reply to individual comments." "In less than a day, Dumbmatter took my idea and made it a reality" (411 pts). [P] https://reddit.com/r/BasketballGM/comments/1f9umra/ ; https://reddit.com/r/BasketballGM/comments/iaj99j/
5. History/records/"frivolities" (league lore, GOAT lists, family trees) are a beloved end-game: "I love this game... because I can enjoy that frivolities feature." [P] https://reddit.com/r/BasketballGM/comments/1otibmo/
6. Randomness itself is defended by part of the community as realistic+challenging: "what I like about this game is randomness and fact that young players actually often don't progress — far more realistic than 2k." [P] https://reddit.com/r/BasketballGM/comments/k8lzvb/

## Q2. Complaints and most-requested features
### Player development randomness (the #1 emotional pain point)
- #3 post all time (1152 pts) is a meme: "How it is when none of your rookies improve for 5 years straight." Also "Me seeing my entire team regress after spending the last 2 hours in off-season" (454), "I'm one more bust away from deleting the league" (426), "Worst feeling is when your generational prospect ends up being mid." [P] https://reddit.com/r/BasketballGM/comments/i30jpv/ ; /imkcxn/ ; /se3onh/ ; /1j0a96z/
- Specific complaint: forced early aging — "player regression is my biggest gripe... you have to trade players when they hit 26 when in reality stars are just hitting their peak." [P] https://reddit.com/r/BasketballGM/comments/1ltqkll/ ; GitHub issue "Players' peak years are too early": https://github.com/zengm-games/zengm/issues/229
- Review-site echo: "players randomly drop 5 ratings out of nowhere... happens to nearly the entire team"; "rating progression system stinks." [S] https://gmgames.org/basketball-gm/user-reviews/
- Potential (pot) swings feel meaningless: "-15 potential on my 4th overall pick, wtf." [P] https://reddit.com/r/BasketballGM/comments/1t2ajtd/ (via enmlounge mirror)

### Trade AI (both too exploitable AND too stingy — dual complaint)
- Meme (651 pts): "AI seeing your 77 ovr star in trade negotiations" (AI undervalues user's stars). [P] https://reddit.com/r/BasketballGM/comments/j1af3a/
- "After hundreds of trades fleecing the AI, they finally got me" (125 pts) — fleecing is normalized vocabulary. [P] https://reddit.com/r/BasketballGM/comments/lxwg6t/
- Detailed critique in "A Dozen Updates I'd like to see" (219 pts): "The current trade engine is extremely frustrating. It can be too eager (contract dumps, giving up on old All-NBA players) and too stingy (number 3 pick for 5+10 this year and next year's first? NEVER!)". [P] https://reddit.com/r/BasketballGM/comments/rcsdp1/
- Real-life Luka trade memed as impossible in BBGM (810 + 807 pts, Feb 2025) — AI won't trade superstars. [P] https://reddit.com/r/BasketballGM/comments/1ifsi50/
- Anti-exploit patch became its own complaint: a 2-picks-per-trade cap was added to stop cheesing, users found it tedious ("cycling 80% of my roster three times per off-season to work around the limit"); lifting it (Aug 2025) was celebrated — top comment (127 pts): "I CANNOT WAIT TO ROB SOMEONE OF THEIR ENTIRE DRAFT." [P] https://reddit.com/r/BasketballGM/comments/1mu49hb/ and /1ltqkll/
- Game too easy overall; win-loop is replicable (tank → hoard picks → sign star FA → flip youth for high-WS vets, repeat): detailed user critique, dev replied "valid points, but the stuff I wrote about is higher priority." [P] https://reddit.com/r/BasketballGM/comments/1gtihaj/

### Immersion / news / narrative
- News feed "feels pretty sparse... no real game recaps, injury storylines, or ongoing league drama"; wants owner/board personas and front-office friction (2026, "Can we get these features in the future?"). [P] https://reddit.com/r/BasketballGM/comments/1un9qye/
- Users bolt on LLMs for immersion: Claude-generated 10–25 page season reports, ChatGPT beat writers, NotebookLM podcasts about their league. One notes the constraint: client-side determinism/cost blocks native AI narrative. [P] same thread + https://reddit.com/r/BasketballGM/comments/1fulrpw/ ; /11bf2s1/
- Record-broken notifications requested (all-time points record passes silently); dev: "good idea, just requires a bit of work to do without slowing things down too much." [P] https://reddit.com/r/BasketballGM/comments/1gtihaj/

### Missing structures (most-requested concrete features)
- Coaches/staff with identities: requested repeatedly (2020–2026) but community is split — top comment in the coaching thread: "I don't think adding coaching would add much outside of more busywork." [P] https://reddit.com/r/BasketballGM/comments/k8lzvb/ ; /1n5xr03/ ; /gs05ao/ ; /1un9qye/
- G-League / minor league + Summer League ("would be AMAZING for further immersion... a feature folks could just sim past"). [P] https://reddit.com/r/BasketballGM/comments/1u730q4/ ; /1n5xr03/
- Free agency realism: bid-based FA (vs user-first-dibs), restricted free agency ("I hate when my young star decides he doesn't want to re-sign when in reality he would have no choice"), trade deadline, contract extensions before expiry, MLE/cap exceptions ("Free agency is irrelevant for teams over the cap right now"). [P] https://reddit.com/r/BasketballGM/comments/rcsdp1/ ; /ehc7oh/ ; /gs05ao/ ; /1gtihaj/ ; GitHub: rookie contracts https://github.com/zengm-games/zengm/issues/372
- Scouting reports / imperfect draft info: "Give us a scouting report" (rcsdp1); dev agrees conceptually — busts/steals should come from scouting uncertainty, not crazy progs (see Q3).
- Finances: small-market money too punishing ("Impossible to make money in a mid to small market. By year 3 you're destined to be fired") [S gmgames reviews]; owner should tolerate losses when winning + auto-manage ticket prices [P /gs05ao/].
- Save-data loss (browser storage) is a recurring complaint on review sites; the FAQ has a long apologia. [S] gamebrain.co ; [P] https://basketball-gm.com/faq/
- GitHub issues are NOT where feature demand lives: max thumbs-up on any issue is ~6; requests flow through Reddit/Discord. [P] GitHub search, sort=reactions. [I] Implication: Reddit is the demand signal, not the tracker.

## Q3. Developer's stated design tradeoffs
- Speed is a first-class feature with measured payoff: BBGM 4.0 (2017) made simming ~10x faster; completed seasons +90% in a week, avg session length DOWN 3 min — users simmed more in less time. [P] https://zengm.com/blog/2017/04/making-a-game-10x-faster-changes-how-people-play-it/
- Anti-micromanagement principle (2020 mood redesign): "I don't want it to be essential to micromanage this stuff. If you want to ignore player moods, you probably can get away with it." Mood affects ONLY contract negotiation: "There is no 'team chemistry' or 'player is upset so he plays worse'... yet :)". [P] https://zengm.com/blog/2020/09/player-mood/
- Fun/annoyance beats difficulty: capped superstar re-sign fickleness (2024): "This does make the game easier... But it also makes it less annoying. So I think that's a good tradeoff." [P] https://zengm.com/blog/2024/06/superstar-fickleness/
- Local-browser storage = free & unlimited but accepts data-loss risk; "it's all tradeoffs." [P] https://basketball-gm.com/faq/
- Caution about core changes at scale: "if tens of thousands of people are enjoying the game in its current state, I better be real sure a change to the core is actually good... little problems piling up over the years." Nov 2024 roadmap admits: progs too uniform and too jumpy; young players prog too much; peak age too early; rookies too weak; not enough specialists/weird players; big men & defensive specialists underrated; stats should match 2024 NBA. [P] https://reddit.com/r/BasketballGM/comments/1gtihaj/
- On draft busts: "IRL busts and steals happen not because of insanely good/bad progs, but because a player was just better/worse than scouts thought... there should probably be more scouting uncertainty for draft prospects" (Dec 2021). [P] https://reddit.com/r/BasketballGM/comments/rr0rzw/
- Sim realism improvements only when they don't slow play: 2020 realism PRs framed as "If you play through seasons quickly you won't even notice this stuff." Rubber-band score-margin factor added because "more blowouts in BBGM... is no fun" — explicitly tuned so overall win% unchanged. [P] https://zengm.com/blog/2020/07/game-sim-realism/
- Dev's economic self-analysis: nobody competed with BBGM for years because it wasn't rational to ("any new entrant has to win users from me"); AI coding changed that calculus. [P] https://zengm.com/blog/2026/06/vibecoded-games/

## Q4. "Shallow / box-score-only" sim criticisms
- Dev himself admitted play-by-play was historically weak: pre-2019 "every possession was exactly the same length. And there was no end of game strategy" [P] https://zengm.com/blog/2019/11/game-simulation-ovr-beta/ ; 2023 game-clock rewrite fixed "strange and unrealistic things" [P] https://zengm.com/blog/2023/12/basketball-game-clock-rewrite/
- "The Problem with BBGM Rosters: Why the Sim Doesn't Feel Like Real Basketball" (Jul 2025, 35 pts): superstars (Curry/Jokic/Luka) undervalued and sim stats don't match real output; raw athletes outperform skill/IQ stars. Caveats: post was suspected ChatGPT-written and partially rebutted; commenters note these are core-engine issues, and most sim realism complaints attach to REAL-player leagues (fake-player users report not caring). [P] https://reddit.com/r/BasketballGM/comments/1ltqkll/
- Live-sim lacks star logic in clutch: "frustrating to see some random bench player huck up a buzzer-beater while your stars watch" + request for Clutch rating (42 pts). [P] https://reddit.com/r/BasketballGM/comments/1caj1iu/
- Meta drift: big men shoot too many 3s ("a star center with 80+ inside scoring taking six 3s a game at 30%"); too many players play all 82 games (100+ vs NBA's ~21 in 2018-19). [P] https://reddit.com/r/BasketballGM/comments/ehc7oh/ ; echoed 2025: https://reddit.com/r/BasketballGM/comments/1jqt25y/
- Format limitation accepted: "The only problem is no graphics. If you don't mind a text and numbers basketball sim this game is perfect." vs OOTP/FM: "not the same as those, but the best you'll get for a basketball sim that's still supported. Everything else is either worse or dead." [P] https://reddit.com/r/BasketballGM/comments/1jqt25y/
- Playoff upsets feel too common to some (sarcastic memes both ways, 350–351 pts). [P] https://reddit.com/r/BasketballGM/comments/ip6rac/ ; /1ihs94y/

## Q5. "Dream sim" posts (design-relevant wishlists)
- "A Dozen Updates I'd like to see in BasketballGM" (219 pts, Dec 2021, by engine contributor): trade engine overhaul, bid-based free agency, scouting reports, NBA-data-calibrated balance ("use NBA stats so it feels right instead of a vague notion"), guardrail: "any feature that adds micromanagement should be treated with extreme skepticism." [P] https://reddit.com/r/BasketballGM/comments/rcsdp1/
- "Can we get these features in the future?" (2026): coaching/staff identities so "teams develop recognizable playstyles," in-season narrative & media layer, owner/board pressure. [P] https://reddit.com/r/BasketballGM/comments/1un9qye/
- FM-envy is explicit: "Would you like to someday make it as deep and immersive as Football Manager?... Football Manager makes it much harder [to repeat-win]." [P] https://reddit.com/r/BasketballGM/comments/1gtihaj/
- Era evolution: "I wish league conditions would continue to change over time" — trends per decade so post-2020 play doesn't go stagnant. [P] https://reddit.com/r/BasketballGM/comments/jdp7zw/
- Competitor positioning confirms the gaps: "Basketball Dynasty" launched in r/BasketballGM (June 2026) selling exactly: honest trade valuations with counter-offers ("most GM games let you fleece the AI"), imperfect scouting, owner expectations/firing. NOTE: promotional/interested party, and the sub then banned unpermitted game promotion (554-pt mod post). [P] https://reddit.com/r/BasketballGM/comments/1tvuq94/ (via enmlounge) ; ban: /1v8xd4z/
- Pro Basketball Manager 2026 (FM-style match engine, paid) engaged the sub without hostility — appetite exists for deeper paid sims. [P] https://reddit.com/r/BasketballGM/comments/1nv5vot/

## Dead ends / could not establish
- Reddit itself blocks all anonymous access (curl, Exa crawl, and Browserbase incl. residential proxy all got "blocked by network policy"); all Reddit content verified via redlib mirror (safereddit.com) and enmlounge.com — mirror fidelity assumed but not independently verified.
- No substantive Hacker News discussion of BBGM's game design found; HN threads touching ZenGM (Faces.js 493 pts, vibecoded-games 67 pts) discuss tech/AI, not sim design. Algolia search "basketball gm"/"basketball-gm.com" returned no dedicated high-comment thread.
- GitHub issue reactions are too sparse (max ~6) to rank feature demand; could not locate a public dev roadmap page (zengm.com/roadmap = 404).
- Could not verify exact current user counts (dev says "tens of thousands", 2024) or revenue.
- Page 2+ of all-time top posts partially captured; rankings beyond ~#50 not enumerated.
- The July 2025 "Problem with BBGM Rosters" post's claims about real-player stat mismatch were not independently quantified (no one posted sim-vs-NBA stat tables in the thread).
