/**
 * Fold a hoopsh event stream into a box score.
 *
 * The folding philosophy, and why it matters: this module NEVER estimates a
 * number it could instead derive exactly from the event stream (core/events.ts
 * §1.3 of AGENTS.md — events are the only contract). Concretely:
 *   - minutes come from lineup timelines (game_start + substitution events
 *     tell us exactly who was on the floor every second — see accrueMinutes);
 *   - possessions come from possession_end events (one authoritative count
 *     per possession, guarded upstream by sim/possession.ts so it can never
 *     double-fire — see PossessionEndEvent's doc comment);
 *   - plus-minus comes from score deltas while a five-man unit is on the
 *     floor (see scorePoints), not from any lineup-level bookkeeping the
 *     engine keeps internally.
 * A box score built this way is bit-for-bit reconstructible from the event
 * stream alone, which is exactly what the invariant suite
 * (packages/engine/test/invariants.test.ts) checks against adversarial games.
 * If a number here can't be justified by "which events fired," it doesn't
 * belong in this file — that's a sign the missing information belongs in
 * the event stream instead (AGENTS.md §1.3), not that this module should
 * start guessing.
 *
 * Known rough edge (documented, not silently patched — see AGENTS.md §7):
 * `fastbreakPts` only accumulates from made field goals inside a possession
 * that opened in transition; free throws scored inside that same possession
 * are NOT added to it (see the 'free_throw' case). So a shooting foul drawn
 * on a fast break undercounts that possession's fastbreak points by the FT
 * makes. Left as-is here rather than "fixed" during a docs-only pass.
 */

import type { GameEvent, ShotEvent, Team, TeamSide } from '@hoopsh/engine';

/**
 * Made/attempted shot counts split by court zone, per player. Zones mirror
 * `geometry/court.ts`'s shot-zone classification exactly (each `shot` event
 * carries the zone the engine already assigned) — this module doesn't
 * re-derive "which zone was that shot in" from coordinates, it just folds
 * the zone label the event already stamped.
 */
export interface ZoneLine {
  rim: { m: number; a: number };
  paint: { m: number; a: number };
  mid: { m: number; a: number };
  three: { m: number; a: number };
}

/** One player's full box-score line for the game. `min` is display-rounded to 0.1 (see the rounding note in boxScore); every counting stat is an exact fold of the events that named this player. */
export interface PlayerLine {
  id: string;
  name: string;
  team: TeamSide;
  min: number;
  pts: number;
  fgm: number;
  fga: number;
  tpm: number;
  tpa: number;
  ftm: number;
  fta: number;
  orb: number;
  drb: number;
  trb: number;
  ast: number;
  stl: number;
  blk: number;
  tov: number;
  pf: number;
  plusMinus: number;
  zones: ZoneLine;
}

/** One team's game totals. `poss` is the possession_end count (see boxScore); `fastbreakPts` follows the convention documented at the 'shot' case in boxScore — it does not include free throws. `timeouts` counts `timeout` events — emitted by the endgame layer, which is ON by default (`GameConfig.endgame ?? true`, sim/game.ts), so a default-config stream DOES carry them; only an explicit `endgame: false` legacy game folds 0 here. */
export interface TeamTotals {
  side: TeamSide;
  teamId: string;
  pts: number;
  fgm: number;
  fga: number;
  tpm: number;
  tpa: number;
  ftm: number;
  fta: number;
  orb: number;
  drb: number;
  trb: number;
  ast: number;
  stl: number;
  blk: number;
  tov: number;
  pf: number;
  poss: number;
  fastbreakPts: number;
  timeouts: number;
}

export interface BoxScoreOptions {
  /**
   * Regulation-minutes basis for the pace number: pace = possessions per
   * team per this many minutes of game clock. Defaults to 48, the NBA
   * convention every existing caller was built on. League-aware callers
   * must pass the league's own regulation length (rules.periods ×
   * rules.periodMinutes — 40 for NCAA) or a regulation college game at a
   * real ~68 poss/40 would REPORT pace ≈ 81.6 and every pace band
   * comparison would silently mix conventions (data/ncaa/README.md §5's
   * pace-normalization warning).
   */
  paceMinutes?: number;
}

export interface BoxScore {
  players: PlayerLine[];
  teams: [TeamTotals, TeamTotals];
  finalScore: [number, number];
  /** possessions per team per `paceMinutes` (default 48) equivalent — see BoxScoreOptions */
  pace: number;
  periods: number;
  shotEvents: ShotEvent[];
}

function emptyZones(): ZoneLine {
  return {
    rim: { m: 0, a: 0 },
    paint: { m: 0, a: 0 },
    mid: { m: 0, a: 0 },
    three: { m: 0, a: 0 }
  };
}

/**
 * Fold one game's event stream into a full box score.
 *
 * Single forward pass over `events` (they arrive in emission order, which is
 * chronological on both time axes — see core/events.ts). Each event type
 * updates exactly the counters it's authoritative for; nothing here looks
 * ahead or reconstructs state the events didn't already carry.
 *
 * Case -> what it mutates (the fold's full write map; every case is also
 * preceded by accrueMinutes, which writes minutes for the on-floor lineup):
 *   game_start / substitution   the onCourt lineup sets
 *   period_start                nothing
 *   period_end                  periods
 *   possession_start            the transitionPoss flag
 *   possession_end              totals.poss (the ONLY poss increment)
 *   shot                        lines+totals fga/fgm/tpa/tpm/pts/ast/blk,
 *                               zones, fastbreakPts; plus-minus via scorePoints
 *   free_throw                  lines+totals fta/ftm/pts; plus-minus
 *                               (never fastbreakPts — see the shot-case note)
 *   rebound                     lines+totals orb/drb/trb (deadBall rows: nothing)
 *   turnover                    lines+totals tov, the thief's stl
 *   foul                        lines+totals pf
 *   timeout                     totals.timeouts (team-level only)
 */
export function boxScore(events: GameEvent[], teams: [Team, Team], opts: BoxScoreOptions = {}): BoxScore {
  const lines = new Map<string, PlayerLine>();
  for (const side of [0, 1] as TeamSide[]) {
    for (const p of teams[side].players) {
      lines.set(p.id, {
        id: p.id, name: p.name, team: side,
        min: 0, pts: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0,
        orb: 0, drb: 0, trb: 0, ast: 0, stl: 0, blk: 0, tov: 0, pf: 0,
        plusMinus: 0, zones: emptyZones()
      });
    }
  }
  const totals: [TeamTotals, TeamTotals] = [0, 1].map((side) => ({
    side: side as TeamSide,
    teamId: teams[side as TeamSide].id,
    pts: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0,
    orb: 0, drb: 0, trb: 0, ast: 0, stl: 0, blk: 0, tov: 0, pf: 0,
    poss: 0, fastbreakPts: 0, timeouts: 0
  })) as [TeamTotals, TeamTotals];

  const onCourt: [Set<string>, Set<string>] = [new Set(), new Set()];
  let lastT = 0;
  let finalScore: [number, number] = [0, 0];
  let periods = 0;
  const shotEvents: ShotEvent[] = [];
  // Whether team `side`'s CURRENT possession started off a live turnover of
  // the ball (steal / live-ball rebound) rather than a dead-ball inbound.
  // Set once per possession_start, read on every made shot/FT inside that
  // possession — see the fastbreakPts convention note at the shot case below.
  let transitionPoss: [boolean, boolean] = [false, false];

  /**
   * Credit every player currently on the floor with the elapsed time since
   * the last event, in-place before processing the event at `t`.
   *
   * Keys on `t` (game-clock time), never `wt` (replay/wall-clock time) — see
   * core/events.ts and AGENTS.md §1.5. `t` freezes during whistles and stops
   * dead at the horn, which is exactly what "minutes played" means; `wt` keeps
   * advancing through free-throw routines and dead-ball stoppages, so folding
   * on `wt` would inflate every player's minutes by the game's total stoppage
   * time. This is the box score's half of the two-time-axis discipline the
   * engine enforces on the other side (movement.ts#advanceClock is the only
   * writer of `t`) — mixing the axes here would reintroduce the same class of
   * bug the engine guards against, just in stats instead of gameplay.
   *
   * Called once per event, before that event's own side effects, so the floor
   * lineup used for the elapsed slice is always the one that was on the court
   * DURING that slice (post-substitution processing would double-count into
   * the wrong players).
   */
  const accrueMinutes = (t: number): void => {
    const dt = t - lastT;
    if (dt > 0) {
      for (const side of [0, 1] as TeamSide[]) {
        for (const id of onCourt[side]) {
          const line = lines.get(id);
          if (line) line.min += dt;
        }
      }
    }
    lastT = t;
  };

  /**
   * Attribute `pts` scored by `side` to every player of both teams currently
   * on the floor: +pts for the scoring team's five, -pts for the other five.
   * This is the entire plus-minus model — no lineup-level running total is
   * kept anywhere else, so a player's plusMinus is exactly "net score while
   * I personally was on the court," derived the same way a scorer's table
   * would compute it by hand. The invariant suite checks this sums to zero
   * league-wide and equals final margin × 5 per team (score is zero-sum by
   * construction: one side's + is the other's -).
   */
  const scorePoints = (side: TeamSide, pts: number): void => {
    totals[side].pts += pts;
    for (const id of onCourt[side]) lines.get(id)!.plusMinus += pts;
    for (const id of onCourt[side === 0 ? 1 : 0]) lines.get(id)!.plusMinus -= pts;
  };

  for (const e of events) {
    accrueMinutes(e.t);
    finalScore = e.score;
    switch (e.type) {
      case 'game_start': {
        onCourt[0] = new Set(e.home.lineup);
        onCourt[1] = new Set(e.away.lineup);
        break;
      }
      case 'substitution': {
        for (const id of e.out) onCourt[e.team].delete(id);
        for (const id of e.in) onCourt[e.team].add(id);
        break;
      }
      case 'period_start': break;
      case 'period_end': periods += 1; break;
      case 'possession_start': {
        // A possession counts as "transition" for fastbreak-point purposes
        // when it began off a live turnover of the ball — a steal (opponent
        // loses it mid-dribble/pass, we're already moving) or a live-ball
        // defensive rebound (no dead-ball reset, offense can outrun the
        // defense getting back) — as opposed to a 'tip' or dead-ball 'inbound'
        // where the defense has time to set. This flag stays true for the
        // WHOLE possession it opens, not just the immediate transition look;
        // see the fastbreakPts convention note in the 'shot' case below.
        transitionPoss[e.team] = e.kind === 'steal' || e.kind === 'live_rebound';
        break;
      }
      case 'possession_end': {
        // The only place poss increments — one authoritative count per
        // possession, matching PossessionEndEvent's fire-exactly-once
        // guarantee (sim/possession.ts endPossession guards this upstream).
        totals[e.team].poss += 1;
        break;
      }
      case 'shot': {
        shotEvents.push(e);
        const line = lines.get(e.shooter)!;
        // Official scoring rule (NBA scorer's convention — the same one every
        // real reference line this repo calibrates against is built on): a
        // missed shot on which a shooting foul was called charges NO
        // field-goal attempt — the trip to the line replaces the attempt in
        // the book. An and-one (made basket plus the foul) charges FGA and
        // FGM as normal. The engine emits the shot event either way
        // (sim/shooting.ts — the attempt happened on the floor and shot
        // charts/play-by-play need it, which is why shotEvents above keeps
        // every event); only the box-score counting rule filters here. The
        // zone attempt is skipped in lockstep so zone a/m sums stay equal to
        // fga/fgm (the consistency suite pins that identity). blockedBy
        // still credits the blocker below — the engine can roll a block and
        // a foul on the same miss, and the block really happened.
        const chargeAttempt = e.made || !e.foul;
        if (chargeAttempt) {
          line.fga += 1;
          totals[e.team].fga += 1;
          line.zones[e.zone].a += 1;
          if (e.three) { line.tpa += 1; totals[e.team].tpa += 1; }
        }
        if (e.made) {
          line.fgm += 1;
          totals[e.team].fgm += 1;
          line.zones[e.zone].m += 1;
          line.pts += e.points;
          if (e.three) { line.tpm += 1; totals[e.team].tpm += 1; }
          scorePoints(e.team, e.points);
          // CONVENTION, not a bug: fastbreakPts credits the made SHOT'S points
          // whenever the possession it belongs to opened in transition
          // (transitionPoss[team] was set true back at possession_start),
          // even if this particular shot came after the initial burst of
          // speed settled into a normal half-court look. hoopsh attributes
          // "fastbreak points" to the possession's origin (steal / live
          // rebound) rather than re-detecting transition tempo shot-by-shot.
          // NOTE: free throws are NOT folded into fastbreakPts even when they
          // happen inside a transitionPoss possession — see the free_throw
          // case below, which updates pts/ftm but never touches fastbreakPts.
          // That asymmetry (makes count, and-one/shooting-foul FTs from the
          // same possession don't) is a real gap in this convention, not
          // something intentionally chosen — see the file-level note for why
          // it's called out rather than silently patched.
          if (transitionPoss[e.team]) totals[e.team].fastbreakPts += e.points;
          if (e.assist) {
            const passer = lines.get(e.assist);
            if (passer) { passer.ast += 1; totals[e.team].ast += 1; }
          }
        }
        if (e.blockedBy) {
          const blocker = lines.get(e.blockedBy);
          if (blocker) {
            blocker.blk += 1;
            totals[blocker.team].blk += 1;
          }
        }
        break;
      }
      case 'free_throw': {
        // Free throws never touch fastbreakPts (see the file-header note) —
        // only points/ftm and plus-minus, same accounting as any other made
        // point, just without the zones/fga bookkeeping a field-goal attempt
        // carries (FTs aren't shots from a court zone).
        const line = lines.get(e.shooter)!;
        line.fta += 1;
        totals[e.team].fta += 1;
        if (e.made) {
          line.ftm += 1;
          totals[e.team].ftm += 1;
          line.pts += 1;
          scorePoints(e.team, 1);
        }
        break;
      }
      case 'rebound': {
        // Dead-ball formality rebounds (missed non-final FT) are excluded
        // from ALL rebound totals — official-scoring convention; they exist
        // for play-by-play fidelity only (core/events.ts ReboundEvent).
        if (e.deadBall) break;
        // Team totals count every real rebound; the player line exists only
        // when an individual secured it. A playerless event is a TEAM
        // rebound (dead carom awarded to a side) — the board happened and
        // belongs in the team's ORB/DRB/TRB, but nobody's line gets credit,
        // exactly like an official box score.
        if (e.offensive) totals[e.team].orb += 1;
        else totals[e.team].drb += 1;
        totals[e.team].trb += 1;
        if (e.player) {
          const line = lines.get(e.player)!;
          if (e.offensive) line.orb += 1;
          else line.drb += 1;
          line.trb += 1;
        }
        break;
      }
      case 'turnover': {
        const line = lines.get(e.player)!;
        line.tov += 1;
        totals[e.team].tov += 1;
        if (e.stolenBy) {
          const thief = lines.get(e.stolenBy);
          if (thief) {
            thief.stl += 1;
            totals[thief.team].stl += 1;
          }
        }
        break;
      }
      case 'foul': {
        // Technical fouls are not personal fouls in a real box score; pf
        // counts personals only (the tech's cost is the opponent's technical
        // FT, which the free_throw case above already credits like any other
        // attempt). The engine stamps a tech's counts as unchanged snapshots
        // for the same reason (core/events.ts FoulKind).
        if (e.kind === 'technical') break;
        const line = lines.get(e.on)!;
        line.pf += 1;
        totals[e.team].pf += 1;
        break;
      }
      case 'timeout': {
        // team-level only — a timeout belongs to no player's line. Folding
        // it here (rather than the default arm) keeps the event visible in
        // the box the same way a real one lists team timeouts used.
        totals[e.team].timeouts += 1;
        break;
      }
      // The officiating vocabulary folds to nothing here, on purpose. Each
      // case is explicit (not defaulted) so the convention is stated:
      case 'jump_ball':
        // a jump ball is possession plumbing, not a counting stat; the
        // rebound/possession events around it carry all the box weight
        break;
      case 'violation':
        // def goaltending's points ride the made shot event (a normal FGM to
        // the shooter, real scoring convention); a kicked ball changes no
        // total. The violation row is play-by-play texture only.
        break;
      case 'replay_review':
        // pure stoppage theater; reviews never touch a box score
        break;
      default: break;
    }
  }

  // Display rounding: minutes are folded in exact seconds (`line.min` above
  // is a running seconds total) and only quantized to 0.1-minute granularity
  // here, once, at the end — matching how a broadcast box score prints
  // minutes. SUM-PRESERVING per team (largest-remainder): floor every line
  // to tenths, then hand the remaining tenths of the team's own rounded
  // total to the largest fractional remainders (ties broken by fold order,
  // which is event order — deterministic). The old independent
  // nearest-rounding drifted the team sum by up to ±0.05 min PER PLAYER WHO
  // LOGGED MINUTES — that's ±0.4-0.5 for a real 8-10 man rotation, not the
  // ±0.3 a prior comment derived from "five players", and ~1 game in 740
  // actually crossed the invariant suite's 0.3-minute conservation
  // tolerance with zero engine change (audit M-21). Now the displayed team
  // sum equals the team's true minutes rounded to one tenth (|error| <=
  // 0.05 min, quantization of the total itself), so the invariant holds by
  // construction. Cost, stated honestly: two players with identical seconds
  // can display 0.1 min apart when the remainder runs out between them —
  // the pre-rounding seconds still sum exactly, nothing is re-estimated.
  for (const side of [0, 1] as const) {
    const sideLines = [...lines.values()].filter((l) => l.team === side);
    const tenths = sideLines.map((l) => (l.min / 60) * 10);
    const floors = tenths.map(Math.floor);
    let extra = Math.round(tenths.reduce((s, x) => s + x, 0)) - floors.reduce((s, x) => s + x, 0);
    const byFrac = tenths
      .map((x, i) => ({ i, frac: x - floors[i]! }))
      .sort((a, b) => b.frac - a.frac || a.i - b.i);
    for (let k = 0; k < byFrac.length && extra > 0; k++, extra--) floors[byFrac[k]!.i]! += 1;
    sideLines.forEach((l, i) => { l.min = floors[i]! / 10; });
  }

  const totalPoss = totals[0].poss + totals[1].poss;
  const gameMinutes = Math.max(1, lastT / 60);
  // Pace, in the standard sense: possessions per team per regulation-length
  // equivalent game (opts.paceMinutes — default 48, the NBA convention; an
  // NCAA caller passes 40). totalPoss/2 gives ONE team's raw possession
  // count (both teams get essentially the same number of possessions per
  // game, off by at most 1 depending who has the ball at the horn — hence
  // averaging via the sum rather than picking totals[0] or totals[1]
  // directly), then scaled from actual gameMinutes up/down to that basis so
  // a game that went to overtime is still comparable to a
  // regulation-length one. `Math.max(1, …)` guards against a division by
  // zero if this were ever called on a zero-length/empty event stream.
  const pace = (totalPoss / 2) * ((opts.paceMinutes ?? 48) / gameMinutes);

  return {
    players: [...lines.values()],
    teams: totals,
    finalScore,
    pace: Math.round(pace * 10) / 10,
    periods,
    shotEvents
  };
}

// ---------------------------------------------------------------- derived
//
// Standard basketball-analytics formulas, applied uniformly whether the
// caller passes team totals or (for the percentage stats) a single player's
// line — both shapes satisfy the minimal structural types below. Each guards
// its own zero-attempt case so an 0-for-0 shooter/team reads as 0% rather
// than NaN (silent NaN propagation into a league-average report is exactly
// the kind of bug this module exists to prevent — see the file header).

export function fgPct(t: { fgm: number; fga: number }): number {
  return t.fga === 0 ? 0 : t.fgm / t.fga;
}

export function tpPct(t: { tpm: number; tpa: number }): number {
  return t.tpa === 0 ? 0 : t.tpm / t.tpa;
}

export function ftPct(t: { ftm: number; fta: number }): number {
  return t.fta === 0 ? 0 : t.ftm / t.fta;
}

/**
 * True shooting percentage: points per "true shot attempt," where a true
 * shot attempt weights free throws at 0.44 attempts instead of 1. REAL —
 * 0.44 is the standard basketball-analytics constant approximating how many
 * FT trips-of-two (or and-one/three-shot fouls) correspond to a single shot
 * attempt-equivalent league-wide; it is not tuned by this codebase, just
 * borrowed from how TS% is defined everywhere else in the sport. The `2 *`
 * in the denominator converts the true-attempts count into the same
 * points-per-shot scale as points itself (a "worth 2 points" normalization),
 * so TS% reads as a percentage comparable to FG%/eFG% rather than points per
 * attempt.
 */
export function tsPct(t: { pts: number; fga: number; fta: number }): number {
  const denom = 2 * (t.fga + 0.44 * t.fta);
  return denom === 0 ? 0 : t.pts / denom;
}

/**
 * Effective field-goal percentage: FG% adjusted so a made three counts as
 * 1.5 makes instead of 1, because it's worth 1.5× the points of a two. The
 * `0.5 * t.tpm` bonus is exactly that extra half-make credit — REAL, the
 * standard eFG% definition, not a hoopsh-specific tuning.
 */
export function efgPct(t: { fgm: number; tpm: number; fga: number }): number {
  return t.fga === 0 ? 0 : (t.fgm + 0.5 * t.tpm) / t.fga;
}

/** Offensive rating: points scored per 100 possessions — the standard efficiency measure, decoupled from pace so a fast team and a slow team can be compared on "how good were they with the ball" alone. */
export function ortg(t: TeamTotals): number {
  return t.poss === 0 ? 0 : (t.pts / t.poss) * 100;
}

/**
 * Offensive rebound percentage for a side, given both team totals: own
 * offensive boards over the total number of DEFENSIVE-rebound opportunities
 * that were up for grabs, own-ORB + opp-DRB (every missed defended shot ends
 * in exactly one of those two outcomes on the boxscore, ignoring the rarer
 * live-ball scramble outcomes tracked elsewhere in the event stream). This
 * is why the function needs BOTH sides' totals rather than just `own` —
 * ORB% is a share of a contested pool, not own.orb over own.fga.
 */
export function orbPct(own: TeamTotals, opp: TeamTotals): number {
  const denom = own.orb + opp.drb;
  return denom === 0 ? 0 : own.orb / denom;
}
