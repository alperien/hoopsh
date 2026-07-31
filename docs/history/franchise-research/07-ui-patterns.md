# 07 — Management-Sim UI Patterns: What Players Praise and Punish

Research scout findings for a text-first basketball franchise sim UI. Provenance tags: [P] verified primary (forum post, Steam review, dev blog, official doc read via search summary), [S] secondary (press/review coverage of player sentiment), [I] inferred from adjacent evidence.

## 1. Basketball GM: the speed benchmark

- Speed is the identity. BBGM 4.0's headline feature was "runs ridiculously faster... easily apply complex filters to tables" — perf and table filtering, not content. [P] https://zengm.com/blog/2017/04/basketball-gm-4-0-is-here/
- Reviews praise "fast, simple, and intelligent UI aimed at statheads": minimalist left-menu nav, collapsible sections, stats over graphics. [S] https://gmgames.org/basketball-gm/review/
- User reviews emphasize fast intuitive UI, lightweight clutter-free layout, cross-device saves, and a dev who ships community-requested features (via Reddit) for free. [P] https://gmgames.org/basketball-gm/user-reviews/
- Dark mode and mobile slide-in nav were added by user request; small-UI-polish releases are frequent and welcomed. [P] https://zengm.com/blog/2018/10/lots-of-small-ui-improvements/
- Core criticism (from the dev's own issue tracker): tables show TOO much undifferentiated data — "there is basically too much information," masking which ratings actually drive outcomes (e.g. Height drives rebounding). Requests: general multi-criterion filtering, customizable columns, clearer highlighting; the dev explicitly favors minimalism over decoration. [P] https://github.com/dumbmatter/basketball-gm/issues/149
- Two features closed decade-old request backlogs:
  - Compare Players (2024): select 2+ players; bio/ratings/stats/awards in one table, best value green / worst red; crucially, contextual entry links from award races, draft, and free agent pages. Requested since 2013. [P] https://zengm.com/blog/2024/03/compare-players/
  - Advanced Player Search (2024): combine columns from ratings + stats + contract in one filterable table across season ranges — "solves multiple feature requests that I've gotten many times over the years." [P] https://zengm.com/blog/2024/07/advanced-player-search/
- League-history play is a retention engine: Frivolities (Basketball-Reference-inspired toys — Most Games No Playoffs, Roster Continuity, Tragic Deaths, Biggest/Most Lopsided Trades, Best Without a Ring), mostly user-suggested. [P] https://zengm.com/blog/2019/05/frivolities/ , https://zengm.com/blog/2020/05/new-frivolities/ , https://zengm.com/blog/2020/11/trade-frivolities/
- Real-league mode ships 75 years of browsable history (stats, awards, brackets) — "every way you look at your league's data after playing 75 years... you can do with 75 years of real data." [P] https://zengm.com/blog/2021/04/historical-stats/
- Changelog confirms steady table-stakes accrual: sortable box-score columns, Player Graphs and Team Graphs (scatter any two stats), combined regular-season/playoff tables with toggle. [P] https://zengm.com/changelog/
- Shot charts ("hot spots red/yellow/green based on shot location data") sit in the long-term TODO — a recognized, still-unshipped gap. [P] https://github.com/zengm-games/zengm/blob/33f0f8b130075aa155322015ae402e68b646596c/TODO

## 2. OOTP: density loved, friction and churn resented

- Long-running complaints: UI called "cumbersome," "clunky," "emotionless," dated; hard to cancel/revert actions; too time-consuming versus sibling games (EHM/FHM). [P] https://forums.ootpdevelopments.com/showthread.php?t=244878
- Oldest complaint pattern (2007-era, still echoed): key info (stats/ratings/contracts) requires extra clicks and scrolling; users want consolidated displays — lineup screens with batting stats inline, player pages with name/age/stats/position together. [P] http://forums.ootpdevelopments.com/showthread.php?p=2150819
- OOTP 18 interface thread distills veteran asks: sticky/remembered sorting per screen, more hotkeys, back-button that actually exits profiles, dark skins with legible logos, one-click strategy changes. One user mocked up a card-based ESPN-style layout to fight information overload. [P] https://forums.ootpdevelopments.com/showthread.php?t=270190 (and page 9)
- OOTP 25 backlash: reworked rating bars called ugly and space-wasting; new color grading made adjacent ratings (60 vs 65, 70 vs 80) hard to distinguish; users asked for FM-style numeric-only display and user-configurable rating order/visibility. [P] https://forums.ootpdevelopments.com/showthread.php?p=5084413
- Redesign fatigue: users praise specific cleanups (chevrons removed, full-width top bar) but resent annual "fresh look" churn and decorative noise (dynamic right-side stripe, busy background vectors); want a toggle for simpler backgrounds. [P] https://forums.ootpdevelopments.com/showthread.php?t=310610
- The deep-save problem (OOTP 27 era): "the current interface is overwhelmed by the amount of data" in decades-long saves; wishlist = folders of saved custom views per save/era/league, shareable filter presets, recommended filters for newcomers, fewer keystrokes to answer questions. [P] https://forums.ootpdevelopments.com/showthread.php?t=369939
- What veterans love anyway: unmatched depth, analytics dashboards, and history/storyline tracking — the reason OOTP is "the deepest baseball sim." [S] https://www.nytimes.com/athletic/4339875/2023/03/24/out-of-the-park-baseball-24/
- Delight case: players discovering the GM History tab (top/bottom 10 trades of all time by WAR, top franchise players) reacted enthusiastically — cheap-to-build retrospective screens land well. [P] https://forums.operationsports.com/fofc/showthread.php?t=99521
- OOTP 26 changes: officially "Improved UI experience," Draft Central/Combine/Pipeline screens, Development Lab progress bars + midterm reports, dynamic live scoreboards. [P] https://www.ootpdevelopments.com/out-of-the-park-baseball-26/ Reviewer verdict: "usable UI," better dev/draft workflows, but unusable on Steam Deck handheld; wants bulk-action affordances (highlight age-ineligible players instead of manual list-keeping). [S] https://newbaseballmedia.com/out-of-the-park-baseball-ootp-26-review/ Community verdict on 26 overall: incremental, "MEH" for some, draft screens the standout. [P] https://forums.ootpdevelopments.com/showthread.php?t=361920

## 3. Football Manager: the clicks-per-action cautionary tale

- FM26 stated UI goals were "efficiency, familiarity, predictability": Portal home, tiles that open Cards, expanded Search, Bookmarks (6 default, up to 24), accessibility fixes. [P] https://www.footballmanager.com/fm26/features/fm26s-reimagined-user-interface
- Reception (Nov 2025 launch, after FM25's cancellation): Steam "Mostly Negative," briefly the 7th-worst-reviewed game on Steam; UI the single most-cited issue. Key quotes: "You have to click a lot more to get the info you need. Everything is separated into smaller widgets, when everything could have been on one screen like before"; "way too much stripped out... of the details and information that you had on FM24"; "visually impressive at first glance but really creates a clunky experience." Reviewers note the irony: an attempt to simplify made information HARDER to find. [S quoting P] https://www.pcgamer.com/games/sim/football-manager-26-launches-straight-into-a-relegation-battle-as-steam-reviews-plummet-to-mostly-negative-been-playing-since-1993-and-this-is-the-worst-one/ , https://www.eurogamer.net/football-manager-26-launches-on-steam-with-mostly-negative-reviews , https://opencritic.com/news/23225/despite-2-year-wait-football-manager-26-is-one-of-steams-worst-reviewed-games
- Counterpoint: some newcomers prefer FM26's UI + tutorial + FMPedia glossary ("easy to get into, not confusing unlike the previous game") — the old UI was itself an information-overload wall for new players. [P quoted in S] PC Gamer article above. Steam aggregate later softened to Recent: Mixed (52%) vs overall 36%. [P] https://store.steampowered.com/app/3551340/Football_Manager_26/
- FM25 was cancelled (Feb 2025) after delays; SI admitted it "would not achieve the standard required." [S quoting P] https://www.nme.com/news/gaming-news/football-manager-26-fans-slate-unbelievably-bad-new-game-3906171
- What custom skins fix (the community's revealed preferences, FM24 era):
  - Just Skin FM24: "Tabs everywhere!... to reduce the amount of clicks needed"; hidden-attributes reveal panel; "complete overhaul of most pages presenting you with more information in places lacklustre in the base skin." [P] https://sortitoutsi.net/content/63674/just-skin-fm24-beta
  - Tato24: fills "any dead spaces within each panel" with data; player profile sub-tabs avoid page loads; hover popups show role/foot/contract; staff comparison without visiting sub-sections. [S] https://www.passion4fm.com/football-manager-2024-tato24-dark-skin/
  - WTCS Gold: selector menus on player profile "to save clicks"; analytics pages with graphs. [S] https://www.passion4fm.com/football-manager-2024-wtcs-gold-skin-by-workthespace/
  - Statman24: analytics-first rebuild, stats/attributes/performance as coequal tabs. [P] https://footballmanagergraphics.com/files/file/481-statman24/
  - Pattern: every popular skin = MORE density, FEWER clicks, dark theme. None reduce information.
- FM26 initially blocked skins (Unity switch), amplifying anger; community FM Skin Builder and role-based modular skins ("Analyst," "Recruiter") emerged, and SI patched navigation (FM26.1.2) toward "faster access to information, contextual sorting, and reduced clicks." [S] https://www.operationsports.com/if-fm26s-ui-is-going-to-stay-this-way-at-least-let-us-mod-it/ , https://www.operationsports.com/new-fm26-skin-builder-tool-shows-whats-possible-for-ui-customization/ , https://fpfrance.com/en/football-manager-26-prepares-a-major-interface-overhaul-following-modders-breakthrough-on-its-main-weakness/
- Separate long-running FM complaint: forced repetitive interactions (press conferences/player chats) — tedium players delegate or skip; a warning against mandatory low-value dialogs. [P] https://community.sports-interactive.com/forums/topic/578796-does-anyone-actually-enjoy-the-media-and-player-interactions/ [S] https://fullerfm.com/2025/05/22/fm-logic-media-press-interactions/

## 4. Table stakes (called out when absent)

- Sortable tables + filters + customizable columns: BBGM's most-requested-then-celebrated features (Advanced Player Search, ColVis-style column show/hide in TODO). [P] links in §1. OOTP users beg for sticky sorting and saved views. [P] §2.
- Comparison tool: "very common feature request" for 11 years in BBGM before shipping. [P] https://zengm.com/blog/2024/03/compare-players/
- Career/league history browsing: BBGM historical leagues + frivolities; OOTP GM history tab delight; both franchises treat history-as-content. [P] §1, §2.
- Shot charts: in BBGM's TODO but unshipped; DDS reviews criticize missing stats/physical attribute differentiation; NBA 2K MyNBA threads focus on logic not data-browsing (2K's franchise UI is not the reference class). [P/I] §1 TODO; [S] https://steamcommunity.com/app/2198460/reviews/?browsefilter=toprated
- Smaller sims get punished for navigation friction: DDS "menu system criticisms suggest navigational friction remains" [S] https://www.operationsports.com/draft-day-sports-pro-basketball-2023-review-take-the-plunge/ ; Pro Basketball Manager praised when it shipped "significantly faster simulation (40x) with a redesigned UI." [P] https://store.steampowered.com/app/2328780/Pro_Basketball_Manager_2024/
- Bulk actions and guardrails: OOTP 26 reviewer asks for highlighting of age-ineligible minor leaguers to avoid manual list-keeping — dense sims need batch tooling. [S] https://newbaseballmedia.com/out-of-the-park-baseball-ootp-26-review/

## 5. Dense-UI patterns from Paradox (directly useful ones only)

- Configurable message/notification settings are among the most-demanded features in info-dense games: the CK3 "Message options" suggestion led all suggestions by a commanding margin for years; Paradox shipped granular message settings with the Roads to Power update (2024). [P] https://forum.paradoxplaza.com/forum/threads/the-case-for-message-settings.1564203/ [S] https://www.rockpapershotgun.com/wife-pestering-you-about-every-little-pregnancy-crusader-kings-3-will-soon-let-you-decide-which-messages-are-important
- Absence of an event feed makes the world feel dead: V3 player — "The wider world does not feel alive... Like living in a house with no windows or doors. I want my message feed." [P] https://forum.paradoxplaza.com/forum/threads/message-settings.1558354/
- Onboarding: Paradox's CK3 tutorial rework used progressive disclosure — original tutorial was 67 sequential info boxes; cut to ~1/3, revealing UI panels gradually. Lesson: keep density for veterans, gate the reveal for novices; don't strip the data. [P] https://www.gamedeveloper.com/design/deep-dive-refreshing-the-crusader-kings-iii-tutorial-mode-through-optimized-ux

## 6. Play-by-play / watch mode

- OOTP's model: per-game choice of Manage / Quick-Play / Watch (AI manages, you spectate); "no rule about which games you have to manage." [P] https://manuals.ootpdevelopments.com/index.php?man=ootp23&page=play_by_play_mode_playing_out_games , https://forums.ootpdevelopments.com/showthread.php?t=245508
- Actual behavior ("Do you Watch or Sim?" thread): a spectrum, with the dominant pattern = sim most of the regular season, watch/manage key moments (playoffs, tight races, rival series, debuts of trades/prospects). Notable workflows: text speed set to "instant" and skimmed (5-10 min/game); quick-sim to the 6th inning then go batter-by-batter for the endgame; pure-GM players who sim everything ("I'm the GM, I let the manager manage"). [P] https://forums.ootpdevelopments.com/showthread.php?t=212502
- Spoiler discipline matters: complaint that OOTP's webcast replay of past games shows CURRENT team records/stats on screen, spoiling the result you sat down to watch. [P] https://forums.operationsports.com/fofc/showthread.php?t=99521
- DDS: watching the 2D game vs simming produces identical results — watch is a replay; users accept this once told. [P] https://www.draftdaysports.com/board/viewtopic.php?f=266&t=29247 DDS 2023's praised upgrade was exactly presentation: 2D court + scorebox stats layout + bottom-left play-by-play recap. [S] https://gmgames.org/draft-day-sports-pro-basketball-2023/review/ DDS 2026 Steam review pans the watch mode's basketball logic (stop-motion movement, no double-teams/PnR, shot-clock inconsistencies) — a bad 2D view is worse than none. [P] https://steamcommunity.com/app/3914210/reviews/?browsefilter=toprated
- Hoop Land (96% positive on Steam, Early Access): core loop is "Play, spectate, or simulate each game"; a top review praises "how the Sim feature functions, able to jump in whenever or just skip the whole game" — fluid mid-game entry/exit is the loved mechanic. [P] https://store.steampowered.com/app/2453660/Hoop_Land/ , https://play.google.com/store/apps/details?id=com.koalitygame.hoopland&hl=en
- BBGM: markets "Play-by-play live box scores"; live sim can be paused and advanced play-by-play but takes no in-game input — a lightweight text ticker + updating box score is sufficient for its audience. [P] https://basketball-gm.com/ [S] https://www.youtube.com/watch?v=sLBxHgK0Kf8

## Synthesis: ranked dos and don'ts for a text-first basketball sim UI

DO (ranked):
1. Make speed the feature: instant page loads, instant sim, skimmable instant-text games (BBGM praise; PBM's "40x faster" praise).
2. Dense sortable/filterable tables with user-chosen columns, plus one cross-entity Advanced Search (ratings+stats+contract in one grid).
3. Contextual comparison links everywhere (award race -> compare top 5; draft -> compare prospects).
4. Persistent prefs: sticky sorts, saved/shareable custom views and filter presets per league (top OOTP veteran ask).
5. Treat history as content: career pages, franchise retrospectives, frivolity-style toys, lopsided-trade lists.
6. Watch mode as a spectrum: quick-sim / instant-text skim / play-by-play with 2D court + ticker + live box score; let users jump in/out mid-game; keep replays spoiler-free.
7. Configurable notification granularity (CK3 lesson) + progressive disclosure for onboarding instead of data removal.
8. Dark mode and numeric-first rating displays (with any color/bar view optional).

DON'T (ranked):
1. Don't add clicks or fragment one-screen info into widgets/cards (FM26's defining failure).
2. Don't strip detail to look modern — veterans read absence as betrayal; newbies can be served by disclosure, not deletion.
3. Don't encode meaning only in fine color gradients (OOTP 25 ratings-bar backlash).
4. Don't add decorative visual noise or churn the design language every release (OOTP thread fatigue).
5. Don't force repetitive low-value interactions (FM press-conference tedium).
6. Don't ship a 2D watch view whose on-court logic is visibly wrong (DDS 2026) — text credibility beats bad animation.
