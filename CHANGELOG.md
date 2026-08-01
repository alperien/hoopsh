# Changelog

All notable changes to hoopsh are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[semantic versioning](https://semver.org/spec/v2.0.0.html). Dates are ISO 8601.

## [Unreleased]

Pass-volume increments 2 and 3 (REGISTER W74-W75) and the rim-supply
session (W76-W77), each plan-first with adversarial verifier gating and,
for the rim session, a primary-source audit of every reference number the
sim is compared against (findings/session7-plan*.md, session8-*.md).

Also in this window: the career fun wave, the dunker dive (REGISTER
W73), the franchise realism wave (W78-W79), and the core-nine
minutes-targets fix (W65).

### Franchise: late-transaction news (#122, issue #118)

- Draft night and the rollover logged transactions AFTER the day's news
  pulse had already run, so their stories existed in the desk but never
  printed: 60 draft selections produced 0 pick stories and 33
  retirements produced 0 retrospectives on the issue's probe (seed
  probe-draftnews, one fake-sim year). The three seams that create
  transactions past the pulse (the transitions block's draft branch, the
  paused draft's re-entry path, which skipped the pulse entirely, and
  the rollover's retirement loop) now run a second same-day desk pass.
  Story ids are deterministic per (day, ledger position) and appendNews
  guards by id, so the repeat is idempotent: every pre-existing item
  stays byte-identical and only the new stories land.
- A pick's rookie-deal signing row is the selection's mechanism, not its
  own story: the desk now skips it (the draft story carries the contract
  line), keeping draft night at one story per pick plus the real
  squeeze-waive coverage. No new rng streams; no new draws on existing
  streams; the engine untouched; the NewsItem shape unchanged, so saves
  and the replay format carry.
- Verified at the landing: 7 new gates (newsdesk.test.ts: an AI-run
  fake-sim year with a determinism twin, and a human-chair year through
  the draft pause so the re-entry path prints the war room's picks);
  full suite green (1619 tests, 1617 pass, 2 todo); engine fingerprint
  untouched (fingerprint-1: 1277 events, 115-126); fingerprint corpus
  28/28 byte-identical; the issue's probe re-run before and after (60/60
  pick stories, 33/33 retrospectives, all 1646 pre-existing news items
  byte-identical, additions confined to draft night and the rollover
  day).

### Franchise: phase-transition news (#117, issue #111)

- The news desk was silent between the finals and the draft: the title
  clincher existed only as a plain game recap, and lottery night wrote
  nothing. `media/moments.ts` now writes the calendar's loudest dates at
  their phase transitions in tick.ts: the championship story at the horn
  (series score, seed, regular-season record, banner count from the
  archives, the finals scoring leader folded from the results ledger),
  the lottery order the night it is drawn (movement framing, settled
  pick conveyance, the full first-round board, all 30 teams on the
  story's team filter), and a consensus draft preview (every room's
  perceived current-plus-ceiling blend through the draftai position
  lens, averaged, plus the public tape; a class one strength-sd off the
  mean gets an adjective).
- One new registered rng stream (`moments:<season>:<day>`); no new draws
  on any existing stream; the engine untouched. Reserved NewsType values
  `lottery`, `preview`, and `review` are produced for the first time;
  the NewsItem shape is unchanged, so saves and the replay format carry.
- Verified at the landing: 5 new gates (moments.test.ts, two fake-sim
  league years); full suite green (1611 tests, 1609 pass, 2 todo);
  engine fingerprint untouched (fingerprint-1: 1277 events, 115-126);
  fingerprint corpus 28/28 byte-identical; the issue's pt-gm1 repro
  re-run before and after (news page 0 bit-identical at the lottery and
  draft stops before; differing after, with every pre-existing item
  byte-unchanged).

### Unassisted-creation supply arc, increment 1 (#74, REGISTER W82)

- The transition carry, STAGED at `ai.transCarryScale: 0`: on a
  live-rebound/steal possession with the retreat beaten, a committed
  drive finish releases at the rim plane by construction instead of the
  behind-plane stop-out. The pre-diff probe on #74 localized the G11
  deficit to release geometry (beaten-break finishes at median 4.8 ft
  against the booth's 2.25 ft book boundary, 0-8% at the plane; plane
  releases convert at 59-67%), and branch instrumentation localized the
  artifact to the sprinting body's stopping distance. Same decides, same
  labels, same make model; the contest still reads off the body at
  release; dunk-class books through the booth's existing rule. One new
  knob (FEEL, hard-zero short-circuit checked first, heave-guard arming
  draw, knobs.ts range in the same PR); params-provenance pins
  re-baselined; off-state streams byte-identical.
- Amended pre-merge on the PR #75 Red Team probe (Lead ruling, four
  findings). F1: the carry's reach was uncapped up to the drive-label
  range and the frame ball rode the sliding body — fixed with
  `ai.transCarryGatherFt` (4.5 ft FEEL, the carry's own decide-time
  reach gate; SHAPE, deliberately not sweepable) plus the carried
  windup's honest ball path (decide-spot -> rim lerp; the release-tick
  frame-ball -> booking gap collapsed from p50 4.87 / max 9.95 ft to
  p50 0.51 / max 2.01). F2: the phase and commit gates pinned
  condition-by-condition on hand-built states (`carriesToRim` extracted
  as the seam; probe mutants verified red). F3: the arming-draw region
  pinned with exact stream checksums at an intermediate scale and the
  draw-free top (both probe mutants verified red; re-anchored to the
  landing dose at the dose commit). F4: the scout denominator defined —
  pool counts are per team-game (24 seeds = 48 team-games). The 0.5
  dose landing was reverted first (amendments precede dose selection);
  re-selection on the amended mechanism rides the re-run ladder.
- Dose re-landed at 0.5 on the amended mechanism: n=96 paired arms on
  two bases put the 0.5 astd purchase inside the priced window on each
  base independently with fgPct flat at every dose (the priced ceiling
  breach never materializes); 0.75 was declined — its pooled astd read
  sits on the window edge with the dose step disagreeing across bases.
  Goldens, provenance pin, F3 intermediate pins (re-anchored at the
  landing dose per the ruling), and the seed-anchored existence pins
  re-anchored per protocol, including one franchise-side pin
  (officials dir seeds) touched from an engine landing for the first
  time.

### Unassisted-creation supply arc, increment 2 (#86, REGISTER W84)

- The putback finish class: a gate-clearing rebounder (clearsDunkGate,
  the booth-mirror athlete gate extracted byte-identically from
  leakerOf) who secures the board inside the restricted area resolves
  the automatic putback as a rim-plane throw-down. The release moves
  to the plane through the #74 carryRim construction, the contest
  still reads off the body, and the make logit gains the one new knob,
  shot.putbackStrongLogit (FEEL, landed at 0.3, staged hard-zero
  checked first, knobs.ts range in the same commit). The class adds no
  rng draws at any knob value; a scale-0 override rebuilds all 28
  corpus entries byte-identical against the pre-flip corpus. Scoped to
  the automatic putback branch; the decide-layer putback keeps the
  generic logit in EV and resolution both. Crash and rebound
  positioning untouched: the mechanism changes how a secured putback
  resolves, never how often one happens (attempts flat, 1126 to 1120
  on the shared base).
- Booking rides the booth's own dunk rule, and the set claim is
  one-directional, restated pre-merge on the Red Team probe: every
  engine-strong make books dunk, and the booth's putback-dunk set is
  strictly larger at every knob value (the decide-layer sibling and
  the pre-existing 1.6-2.25 ft window book dunk without the class),
  with a booth relabel share of about 0.2 dunks per game at knob 0.
  dunkgate-sync.test.ts gains the putback branch of the mirror and the
  probe's three reorder pins.
- Measured at the landing: putback FG% 50.0 to 50.5 on the shared base
  (+0.9pp on the acceptance base), dunks +0.46 and +0.76 per game on
  the two n=96 bases (booking, as priced), flowboard G11 made dunks
  3.6 to 4.6 per game. The n=96 dose ladder that selected 0.3 does not
  survive its own exact supersets: pooled n=864 per arm, astd -0.04pp
  (se 0.16), fgPct +0.10pp (se 0.09), unassisted makes +0.05 per
  team-game (se 0.06), all consistent with zero. Increment 2 consumes
  approximately zero astd headroom; increment 3 prices against the
  same window. Bands 17/17 at the landed dose on every n=48, n=96, and
  n=288 read (batch n=24 at the head reads 15/17 on two high-side
  vintage edges, recorded as a property of n=24 pools); GAP/SELF
  confirm-flat at n=432 per arm, the GAP margin tail resolving as a
  draw artifact at n=1296. Tests 1599 / 1597 pass / 0 fail / 2 todo at
  the approved head; 17 of 28 corpus entries re-baked at the dose flip;
  fingerprint-1 itself coincidentally byte-identical (the class fired
  zero times on that stream).

### Franchise (the realism wave)

Four parallel lanes on the owner's realism brief, plus an integration
pass (#31). Lane specs live in docs/waves/realism/; register rows
W78-W79; the psyche bounds ride the owner-approved F1-A amendment in
docs/FRANCHISE.md.

- Names are identity-first: nationality and heritage roll before any
  name token, over a 59-identity namebank (10 region modules, 2,012
  first names, 2,103 surnames, weighted), so first name, surname, and
  birthplace always tell one story. US first names ride birth-decade
  era cohorts; suffixes, initial pairs, and hyphenated surnames arrive
  at real texture rates; diaspora arcs are registered per identity;
  staff draw from older cohorts via `personName`.
- Draft classes generate tier-first through a 15-archetype catalog:
  talent tier draws age (the lottery skews one-and-done, picks 45-60
  skew senior), templates shape attributes, tendencies, and bodies
  together (a rim-runner cannot roll a live three), measurables are
  position-real with freak-wingspan tails, and per-season class
  strength waves put loaded and weak drafts in the world. Recalibrated
  post-integration (REGISTER W79).
- Referee crews: 20 named three-man crews with persistent tendencies
  (tightness, home lean, consistency), assigned deterministically per
  game day. Influence flows only through legal pre-game inputs
  (tightness as a symmetric foul-param override capped at 10% relative,
  home lean as a capped rider on the existing HCA seam); no post-hoc
  stat edits. Crews stamp records, close recaps, and surface in both
  game centers.
- The psyche layer: per-player confidence (form-driven), per-team
  locker room chemistry (disposition compatibility, roster churn,
  winning trend; slow by design with hysteresis), and six lifestyles
  driving fatigue recovery, proneness drift, and rare news beats.
  On-court reach is bounded at the pre-degrade seam: confidence caps at
  1.5 attribute points, chemistry at 1.0, combined worst case 2.5.
  Chemistry also feeds development (0.95-1.05) and morale.
- Career surfaces follow the wave (#45): the Me screen head card
  carries the confidence meter and the lifestyle line (NBA years only;
  circuit years stay quiet), and every career NBA box closes with the
  officials crew line.
- Verified at the landing: 114 new tests across names, generation,
  archetypes, officials, and psyche; the full suite green on the merged
  tree; engine fingerprints 28/28 byte-identical (the engine untouched).

### Rim supply (session 8)

- Reference-data audit: every comparison target re-verified against its
  primary source — the Wayback tracking snapshots reproduce to four
  decimals, live basketball-reference matches the committed league
  averages 10/10, the 184-game play-by-play corpus matches live pages
  verbatim on sampled games with ESPN cross-checks, flow-reference
  reproduces 217/217 from the committed shards, and the 30 season files
  match independent outlets exactly. No fabricated numbers anywhere.
- The lob fusion was built, measured across four shape iterations, and
  FALSIFIED: the engine's ordinary catch-decide-windup path is its true
  one-motion finish, and every fusion variant released outside the dunk
  band (W76). Machinery stripped the same session.
- The transition leak-out works mechanically — made dunks 3.5 to 8.7 per
  game and rim share 11.0 to 14.8%, both in the G11 band for the first
  time — but is BLOCKED by assisted-rim saturation: every leak finish is
  assisted, and two sweep runs plus a directed probe show the band
  geometry cannot absorb it without eating the dive channel (W77). The
  wiring ships STAGED behind a per-possession dose dial; the flip waits
  on an unassisted-rim supply arc (the sharpened W64 prerequisite).
- New tests: leak-out pins (sabotage-verified) and the engine-booth
  dunk-gate mirror.

### Engine

- Concept 12, the pass-flight clock charge: the chooser now prices a
  receiver's shot at the clock he will CATCH with (the world has charged
  pass flight to the shot clock all along). Before the fix every measured
  shot-clock violation was a grenade catch — a pass arriving inside 1.5
  seconds; at the shipped get-off window (1.5 s) that class falls 91% and
  holder-side violations exist for the first time. Pass volume unchanged
  by this fix alone; buzzer-beater rates flat.
- `pass.riskBase` re-priced -3.6 → -3.75 (the W16/FLOW riskening partially
  reversed, measured safe only WITH the probe and concept 12 live). The
  deeper -3.82 dose met every band but spent 4.2 points of favorite-win at
  n=1080 and died at the pre-registered line — the shipped dose spends
  3.0. Sweep rails now encode both band-invisible walls ([-3.8, -3.7]).
- Sweep re-center at the landing (verify 40x3, 17/17): the added live
  possessions pressed REB and the efficiency ceilings; fifteen SWEPT dials
  absorbed them. riskBase itself untouched by the optimizer.

### Measured at the landing

- Texture passes/possession 1.61 -> ~1.85 (corpus 2.84-2.86): a fifth of
  the gap closed in one landing, ping-pong share flat.
- Out-of-sample rosters 13/17 -> 17/17 — all four registered marginals
  (FG%, 3PA share, BLK, assisted share) back in band.
- Player fidelity enforced misses 5 -> 2: Jokic's assists reached his
  fixture floor for the first time; the two remaining misses are
  pre-existing registered debt.
- Theta and assist-hierarchy identity preserved on both w19 cohorts at
  n=1080 per arm; the self-play theta delta rides a CI edge and is
  registered as a watch item.

### Career (the fun wave)

A four-critic design audit played the shipped career mode; this wave
fixes what it measured. At the landing: 1401 tests, 0 failures; the
28-seed fingerprint corpus byte-identical (the engine untouched); a
three-career acceptance fleet completes with the determinism,
reacting-world, and explained-consequence gates all holding.

- Production feeds perception: a role-relative, efficiency-weighted
  production index blends into the perceived read at 0.30, shared by
  draft stock and recruiting. Stock previously read attributes only, and
  in the bust test the reckless chucker out-drafted the disciplined
  control (pick 10 vs 17); the mock now converges to the real boards
  (residual 19 picks to 2) and the fleet drafts phenom 1, four-star 4,
  walk-on 13. Feed hygiene drops sub-3-pick noise events; recruiting
  interest staggers over 7-12 weeks.
- The felt loop: the week's approach card grades both games of a
  doubleheader and persists as the standing approach; before the fix the
  second game was judged against a card the player never set. Card
  voltage 22 to 32 (a 70 dial lands the old 95's effect); energy under
  40 debuffs attributes linearly and injuries stream per game with the
  wear factor; role pars scale to the circuit's scoring world, so
  promotions fire inside a high-school season (measured week 2-3,
  previously zero all year); minutes follow the role (5.7 to 25.6 a
  night across the ladder); training banks fractional progress and lands
  every 6-7 weeks with no droughts.
- The phone: ghost recruiters are gone (65 counterfeit letters to zero);
  commitment, the bracket, the final, draft night, and the NBA debut
  speak in the established voices with real numbers; milestone stories
  arrive bylined on the wire thread; promises have memory
  (`promiseGraceGames` consumed, grievances conducted by the agent).
  Phone choices previously measured byte-identical across answer/ignore
  arms, and the 32-week post-commitment void (two alternating noise
  strings, 25% of all events) is closed.
- Surfaces: draft night runs as a green room with a pick-by-pick reveal,
  the player's takeover card, the rival chip, and an undrafted variant;
  signing day is a staged in-game sequence instead of a window.confirm
  dialog; the week screen carries the role clock, the stock line, offer
  expiry, and calendar countdowns; The Office answers contracts, free
  agency, declare/return/agent/trade/retire; a Me screen exists. The
  second act had been engine-complete with no interactive surface.
- Ladder ends: at the franchise rung, sustained above-band production
  resets into belief instead of a clock that sits at `reactGames`
  forever; the first verification fleet failed exactly this, 25 times.
- The Amari critiques (#26): a second played career surfaced three
  plausibility holes, each closed with permanent tests. Draft boards
  carry a tape term: a prospect's real season rows price into every
  board, bounded so the scouted sheet dominates, and generated classes
  carry no rows and read exactly as before. The contract market prices
  decline: offers fall 8% a year past 28 (floored at 45%) and the last
  real season's form scales the paper 0.8 to 1.1. Each program calls
  once when its committable offer is inside two weeks of the lapse, and
  the advisor names the moment when three or more windows close at
  once.
- Registered, not gated: two boredom-band misses (zero-event streaks in
  one phenom corridor) remain as content work.

### Rim supply (session 6)

- The dunker dive (W64 increment 1, REGISTER W73): the dunker spot,
  excluded from cutting since the spot's introduction, now dives exactly
  when its ball-handler is mid-drive-commit (the dump-off timing),
  behind `ai.dunkerDiveScale` with a staged-0 short-circuit before any
  rng draw (byte-identity proven on the 28-seed corpus before the flip).
  Dose 8 seated league FG% exactly on the 49.5 band ceiling at n=48 and
  was rejected (the W26 ceiling-seat lesson); dose 6 landed: 17/17 bands
  (FG% 49.1), made dunks 3.2 per game (up 68% from 1.9), rim-possession
  share 9.0 to 10.6% at n=40, flowboard 10/13. The channel saturates
  near dose 8; the session-8 records above carry the successor channels.

### Fitting (real rosters)

- Minutes targets go to the mpg-ordered core nine and the tail plays
  untargeted fill (the roster fitter; REGISTER W65, the Hartenstein
  starvation). Targeting all twelve had structurally killed the engine's
  eager-return path (it swaps a behind-pace target in for an untargeted
  on-court body), and 240 game-minutes cannot hold twelve season
  averages (a real 12-man mpg column sums to ~290). Measured on OKC at
  n=12: Hartenstein 11.5 to 24.0 minutes (real 24.2), Dort 19.4 to 26.9
  (real 26.8), the core nine all within about a minute. Generated
  rosters do not pass through the fitter and are unchanged.
- The anti-overfit audit (#23, REGISTER W71-W72): probe pricing
  re-verified on three held-out cohorts (n=240 per arm) with theta flat
  and the pass buy intact; both out-of-sample band residuals attributed
  with a v0.2.0 control run. The fitted league measured FLAT (a 68-win
  team splits with a 22-win team, Spearman -0.14 over a 6-team probe)
  because defensive craft is box-invisible. The team-DRtg anchor
  ordered the fit teams at 0.83, failed a held-out 10-team panel at
  -0.56, and does not ship; the fitter carries the full rejection
  record. All 30 season files now ship sourced team ratings
  (ORtg/DRtg/pace/W-L) for an engine-side arc that can honestly consume
  them.

### Maintainability

- `sim/params.ts` split along its block seams (#36): eleven
  `params.<block>.ts` modules — the block's interface, calibrated defaults,
  and per-knob provenance map each — composed into the same flat `SimParams`.
  Pure refactor: serialization byte-identical, fingerprint corpus 28/28, not
  one value changed. Provenance (`REAL`/`SWEPT`/`FEEL`) is now machine-readable
  (`paramProvenance` + `params.provenance.ts`), and a new coverage test makes
  AGENTS.md DO-NOT rule 1 a checked property instead of an honor system.
- `verbatimModuleSyntax` is on in the root tsconfig (#80, issue #62):
  unmarked type-only imports and the other non-erasable syntax AGENTS.md 1.7
  bans now fail `npm run typecheck` instead of erroring at runtime under
  type stripping. The audit found zero violating sites; the diff is the flag
  plus its comment. Re-verified: fingerprint corpus 28/28 byte-identical,
  test counts identical (1542 tests, 1540 pass, 2 todo), typecheck green
  before and after.
- `packages/career/src/phone.ts` (2,025 lines) split along its banner
  seams (#87, issue #37): eight sibling `phone-*` modules, with
  `phone.ts` keeping the module header, `generatePhone`, and
  `applyPhoneChoice`. The public surface is unchanged and no import
  site outside the file changed. Pure refactor, proven byte-pure: an
  inverse check reconstructs the base file's bytes exactly from the
  nine files (1,943 moved lines, none duplicated). Re-verified:
  fingerprint corpus 28/28 byte-identical, test counts identical before
  and after.
- The seed-pin re-anchor helper (#88, issue #50):
  `harness/src/reanchor.ts` verifies the six rng-order-sensitive
  pinned test files (engine events, subs, timeouts, leakout; harness
  season; narration pbp) and, on `--write`, re-scouts and re-anchors
  them in one command. The W54/W56-class hand anchors are extracted
  byte-for-byte into a generated `seed-pins.gen.ts` per package test
  dir, assertions and floors untouched. Per-pin collapse
  discriminators refuse to launder a dead mechanism through lucky
  seeds: a late-Q4 spend on any scanned 0-cap arm, a leak flip that
  fails to double the staged arm, a mean home-win probability under
  0.65 across scanned bases, and exhausted scans all refuse with
  nothing written (all-or-nothing writes). Confirmation runs classify
  failing tests against a KNOWN_UNMANAGED registry
  (`--keep-unmanaged-red` keeps the re-anchor with exit 2), so rename
  drift is never tolerated by mistake. Proven on five worktree legs
  including the review's cap-collapse laundering mutant. Re-verified:
  zero tests added, counts identical both sides, fingerprint corpus
  28/28 byte-identical.

### Fixed

- Two career UI defects from photographing a played career (#22): the
  rail rendered the word "true" on every career screen (the two UI
  waves shipped different registerScreen conventions; renderNav now
  falls back to the title when nav is boolean), and the player's own
  box line was unreadable on the dark broadcast register (the my-row
  highlight there now carries an accent tint with readable ink).
- The types CI job is green on main again: two franchise test files carried
  strict tsc errors from the #31 merge, fixed with type-level changes that
  erase at runtime and touch no assertions (#53, issue #51). Re-verified:
  test counts identical before and after (1531 tests, 1529 pass, 2 todo),
  fingerprint corpus 28/28 byte-identical.
- Career and league saves are refused mid-run (409): both save routes now
  carry the sim.running guard every adjacent mutation already had, closing
  the torn mid-run save that permanently drifted career/league clock sync
  (#29). Re-verified: two new guard tests red on unfixed code and green on
  the fix, fingerprint corpus 28/28 byte-identical.
- Ring harvest keys on season rows, not the current team pointer: a ring
  now requires the player on the champion's roster in that season, ending
  pre-entry rings and restoring descent-phase earned rings (#32).
  Re-verified: two of four new epilogue tests red on unfixed code and green
  on the fix, fingerprint corpus 28/28 byte-identical.
- Team packs carrying `rotationMinutes` keys that match no player id are
  rejected at load: `validateTeamPack` checks each key against the pack's
  player ids, ending the silent acceptance behind the #39 dead-rotation-map
  incident class (85% self-play loss). roster:validate drops the orphaned
  rotation-unknown-id warning and moves its did-you-mean suggestion into
  the rejection explainer (#79, issue #60). Re-verified: test counts 1542
  to 1544 (the two new validation tests), fingerprint corpus 28/28
  byte-identical.
- The career acceptance fleet's reacting-world gate is rebuilt on an
  independent replay witness, closing the C1 tautology (#89, issue
  #41; REGISTER W83). The old gate re-read career.coach.roleClock,
  which trust.ts zeroes inside the same call that raises it, so it
  verified clock hygiene: a regression that kept the reset while
  dropping the role move stayed green. The witness
  (packages/app/src/role-response.ts) replays coach grades through the
  documented clock arithmetic with the ladder pinned locally, and
  demands the observable response at every mid-ladder firing: the role
  moves one rung and carries its ev-role- event with the matching
  delta. Mutant-proven: suppressing the promote branch's role
  assignment ran a nine-year career green under the old gate and fails
  the new one naming the missing move. No career public-surface
  change. Re-verified: 16 new unit tests in one suite (counts 1542 to
  1558), fingerprint corpus 28/28 byte-identical.
- enterDraftClass is a one-way door: a file the league owns is never
  re-entered (#90, issue #40). The tick.ts year-wrap guard now also
  requires that the league holds no file on the player, so Euro/NBL
  descent veterans stop re-entering draftPrep at year wrap and fall
  through to the age-40 retirement line, previously unreachable on
  those routes. enterDraftClass itself skips any id the league already
  owns, ending executeDraftSelection overwriting a veteran's draft
  record. Re-verified: red tests first on the unfixed tree in both
  commits (counts 1537 to 1540), fingerprint corpus 28/28
  byte-identical, three-career acceptance fleet exit 0.
- Retirement ends league presence: no ghost seasons (#92, issue #68).
  retireFromLeague guards on a live league file and calls the
  franchise's executeRetirement in the retire choice arm and the
  age-40 forced wrap, both before buildEpilogue, with an idempotent
  call at the top of the retired-phase advance so saves written before
  the fix self-heal. The award branch of harvestSeasonHonors is gated
  on a season row for the award season, mirroring the landed ring
  gate; pre-retirement honors survive. On unfixed code the ghost was
  demonstrated: 82 regular and 5 playoff games accrued in one
  retired-phase season, with a ghost award harvested. Re-verified:
  five new tests red on unfixed code (counts 1544 to 1550),
  fingerprint corpus 28/28 byte-identical, at-head career acceptance
  exit 0 twice.

### Docs

- docs: per-tier verification checklists on one page, docs/CHECKLISTS.md,
  linked from the README and the docs hub (#46, issue #38). Re-verified:
  fingerprint identical before and after, Bible regenerated in the same
  commit.
- docs(career): the mid-season-departure ring over-grant is registered
  as C16, closing the #32 review (#72). Season rows key on (season,
  teamId, type), so a player traded away from the eventual champion
  mid-season still receives a ring. The archive stores no roster, any
  season-row predicate approximates some corner, and the reachable
  tightening trades the over-grant for an under-grant on roster players
  who missed the playoffs, so the predicate is kept and the behavior is
  registered as a defensible reading of ring custom. The overclaiming
  comment in epilogue.ts is corrected, a TRAP comment at the predicate
  states the keying and the registration, and a fifth epilogue test
  pins the mid-season case (rows on both teams, exactly one ring).
  Re-verified: fingerprint corpus 28/28 byte-identical, sim
  fingerprint-1 identical before and after.
- docs(career): playing hurt is registered as unreachable in every
  phase (#93, issue #84; C17, REGISTER W67 item i). CAREER.md now
  states the shipped v1 behavior: a listed player always sits in both
  phases, and the card's playingHurt flag has effects only for a
  healthy player who sets it (the dulled sheet, the wear compound at
  grading, the skipped post-game injury re-roll). "Playing-hurt
  choices on the real wear model" leaves the v1 In list; the cut is
  registered as C17 and on W67, and the week.ts header comment is
  corrected to the same truth. Making the choice reachable is a
  mechanics-tier availability seam. Re-verified: sim fingerprint-1 and
  test counts identical before and after.
- docs: the transCarryGatherFt comment arithmetic is corrected to the
  W82 triple at both comment sites in params.ai.ts (#95, issue #85).
  The effective windup is 0.50 s on every released carry, the 0.45 s
  windupDrive param tick-quantized to the next 0.1 s boundary, so a
  16 ft/s sprint covers 8.0 ft and the 4.5 ft gate needs 9 ft/s; the
  stale sites said 0.45 s, 7.2 ft, and 10 ft/s. The value itself stays
  4.5. Re-verified: test counts, sim fingerprint-1, replay and pbp
  sha256, and the 28-seed corpus all identical before and after.
- docs: the game.ts windup comment distinguishes the parameter from
  the effective windup (#99, issue #97). One sentence added to the
  transition-carry stopping-distance comment: the 0.45 s is the
  windupDrive param; the effective windup is 0.50 s on every released
  carry, the param tick-quantized to the next 0.1 s boundary. The
  three sites (game.ts, the params.ai.ts pair from #95, the W82 row)
  now speak the same language, and the quantization mechanism is
  confirmed in code (tickHz 10, release on the first tick at or past
  releaseAt), closing the unknown #95 reported. Re-verified: test
  counts identical both sides, replay and pbp sha256 byte-identical,
  corpus 28/28.

## [0.3.0] - 2026-07-31

Ball movement, priced. The pass-volume probe (concept 8) is live for the
first time, the concede thrash is fixed, and the real-roster fits close
their biggest identity gaps. Measurement records in docs/REGISTER.md
W69-W70 and the W65 update (renumbered past the career landing rows W66-W68, which reached main first).

### Engine

- Concept 8 (probe culture) is LIVE at the B2 dose (swing 0.15, malus
  0.08) with the new pressure fade: the probe yields exactly where the
  game-state coupling expresses (`ai.probePressureFade`). Measured at
  n=360 per cohort on fitted rosters: +0.05 passes per possession, theta
  and the favorite's win rate preserved, and the acceptance bands read
  17/17 at n=48 — the assisted-share residual from 0.2.0 is back in band
  (54.1-54.2 vs the 54.0 floor), exactly the upstream-swing protection the
  probe's design predicted. The unpriced flip was re-measured destructive
  first; the fade is load-bearing.
- Field-state hysteresis on the concede band: a full floor with at most
  one starter inside the band stays conceded, ending the measured ten-body
  thrash cycle (five starters returned and re-benched within ten game
  seconds on a knife-edge margin). Sub-grammar volume moved another point
  toward the corpus.

### Fitting (real rosters)

- Starting fives come from basketball-reference games-started, not
  minutes; all 30 season files carry the column.
- `rosters:fit --calibrate-three N` closes the tendency-versus-EV loop in
  team context: SGA's simulated three-point volume went from 0.5 to 3.8
  attempts per game (real 4.4), Fox from 0.6 to 3.6 (real 5.5).
  Saturation cases are reported honestly as engine levers.

## [0.2.0] - 2026-07-31

The realism landing: three real NBA rules the packs had simplified away, a
real-roster data pipeline, and measured movement on the play-by-play
indistinguishability gates. Full measurement records in docs/REGISTER.md
W63-W65 (renumbered past the franchise landing rows W59-W62, which reached main first).

### Rules (engine)

- The NBA last-two-minute team-foul penalty (Rule 12B VII): in the final two
  minutes of each period the second window foul pays free throws. New
  RulePack fields `lateWindowSec` / `lateWindowFoulBonusAt`; NCAA and
  EuroLeague explicitly carry no such rule.
- The overtime bonus threshold: the NBA drops to 4 team fouls in OT
  (`teamFoulBonusAtOT`); carry-over leagues keep their regulation threshold.
- Made-basket clock stops per pack (`makeStopClockFinalSec` /
  `makeStopClockEarlySec`): NBA 120/60, NCAA 60/0, FIBA 120/0. The frozen
  clock legally opens the last-minute substitution windows real games have.
- `FoulEvent.inBonus` is now the standing penalty state and remains fully
  reconstructible from the event stream; the event-contract doc carries the
  derivation.
- Companion endgame fits: the foul-hunt window widened to 45 s (hunted grabs
  now pay), the bench-return floor to 420 s.

Measured at the landing (flowboard vs the 184-game corpus): sub-grammar gate
G8 passes all four metrics (live-ball post-make subs 0.00 to 1.75 per game
against a corpus 1.16); the Q4 free-throw climb mechanism exists (+5% to
+11-30% by seed base); Q4 stopped being the highest-scoring quarter.
Acceptance bands 16/17 at n=48 (assisted share 53.6% vs a 54% floor is the
registered residual); the golden fingerprint corpus was re-baselined as the
drift record.

### Real rosters (data + harness)

- New pipeline: `npm run nba:fetch-team` / `nba:parse-team` turn
  basketball-reference team-season pages into committed, provenance-stamped
  season-lines files. All 30 teams' 2025-26 season files ship in data/nba/.
- The roster fitter reads real dunk volume (`fg_dunk`) and inverts the dunk
  call's athlete gate from both sides: real dunkers clear it, real
  non-dunkers stay under it.
- Current Spurs and Thunder rosters fit and verified against their real
  per-game lines over simulated meetings; identity findings (slasher
  three-point volume, secondary-creator assists, double-big minutes) are
  registered with numbers.

### Fixed

- turing accepts its own documented flags; broadcast and flowboard reject
  unknown or valueless flags loudly; flowboard refuses `--games 0`.
- Overtime periods label as OT in the booth pipeline and saved play-by-play.
- The replay viewer no longer bricks after a degenerate replay drop.

## [0.1.0] - 2026-07-31

First tagged release. hoopsh is a deterministic 2D spatial basketball
simulation core: ten agents move on a real court at 10 Hz, and discrete
outcomes (shots, passes, fouls, rebounds) resolve through logistic probability
models fed by spatial context. The same seed produces a bit-identical game, so
a game is a file you can replay, diff, and share.

### Engine

- Deterministic tick engine on a seeded sfc32 Rng. The same seed gives
  bit-identical events and frames in Node and the browser, and the engine
  imports nothing (no npm packages, no Node built-ins).
- Spatial offense and defense: spacing, drives, kick-outs, cuts, closeouts,
  help rotations, box-outs, pick-and-roll, post-ups, dribble-handoffs, and
  isolation, all emergent from geometry and incentives rather than scripted.
- Shot windup with self-consistent shot selection: the model that resolves a
  shot is the model the AI uses to choose it, so decisions and outcomes cannot
  drift apart.
- Late-game management, on by default: timeouts, intentional fouling,
  hold-for-last, two-for-one, and clock burn. Setting `endgame: false` selects
  the byte-identical legacy path.
- Score-pressure coupling: trailing teams press up and decided games wind down
  through the benches.
- A game-wide timeout economy and an officiating vocabulary (jump balls,
  violations, replay reviews), carried by replay format v3.

### Consumers

- `@hoopsh/stats`: event streams fold into box scores, exact minutes and
  plus-minus, advanced stats, and shot charts. Box scores reconstruct from the
  event stream alone.
- `@hoopsh/narration`: template play-by-play with run and milestone awareness,
  a two-voice broadcast booth (see docs/BROADCAST.md), and an LLM
  color-commentary seam.
- `@hoopsh/data`: player and team schemas, validation, archetype builders, and
  sample packs.
- `packages/viewer`: a single-file 2D canvas replay viewer. Drag any replay
  JSON onto it.

### Harness and tooling

- Batch runner graded against NBA acceptance bands, an automated parameter
  sweep that re-centers the bands after mechanics changes, a throughput
  benchmark, and a golden fingerprint corpus of 28 seeds.
- A stateless season driver with standings and Monte-Carlo matchups (see
  docs/SEASON.md).
- An NCAA rule pack behind the harness `--league` flag (rule coverage partial).
- Roster tooling: schema generation, a scaffold wizard, a validator, and a
  stats-to-ratings fitter.
- A 184-game parsed NBA play-by-play corpus grounding the flow references,
  with its provenance recorded in data/nba/.

### Quality

- A permanent invariant suite derived from adversarial audit rounds, an
  adversarial-input fixture, and a CI pipeline that runs the test suite, the
  gated acceptance bands, the fingerprint corpus, a two-run determinism check,
  a strict typecheck, the same suite under real vitest, and a
  documentation-drift check.

[0.3.0]: https://github.com/alperien/hoopsh/releases/tag/v0.3.0
[0.2.0]: https://github.com/alperien/hoopsh/releases/tag/v0.2.0
[0.1.0]: https://github.com/alperien/hoopsh/releases/tag/v0.1.0
