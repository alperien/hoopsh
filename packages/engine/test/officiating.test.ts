/**
 * Officiating vocabulary (fdesign-officiating) — wiring suite, LIVE rates.
 *
 * The mechanism shipped staged-inert and went LIVE at the officiating fit
 * (ffit-officiating): params.officiating defaults now carry the
 * corpus-fitted rates, and the old dormancy pins retired in favor of a
 * fitted-value drift tripwire (below) plus the flow-harness rate gates
 * (npm run flowboard G2) as the behavioral acceptance. The emission and
 * consumer-chain pins here still run through withParams-FORCED rates (the
 * timeouts.test.ts idiom) so a small pool sees every family
 * deterministically regardless of where the fitted defaults sit.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  buildReplay, defaultParams, simulateGame,
  type FoulEvent, type FreeThrowEvent, type GameEvent, type GameResult,
  type JumpBallEvent, type TeamSide, type TurnoverEvent, type ViolationEvent
} from '@hoopsh/engine';
import { boxScore } from '@hoopsh/stats';
import { generatePlayByPlay } from '@hoopsh/narration';
import { sampleMatchup } from '@hoopsh/data';

// ---------------------------------------------------------------- the pools

/** every family forced hot enough that a small pool sees all of them */
const FORCED = {
  officiating: {
    heldBallPerScramble: 0.03,
    heldBallPerReach: 0.1,
    goaltendPerContestedInsideMiss: 0.05,
    goaltendPerPutback: 0.05,
    travelPerDriveSec: 0.02,
    travelPerPostSec: 0.02,
    techPerFoulWhistle: 0.05,
    takeRelabelHuntFouls: 1,
    takeHuntRateMult: 45,
    kickedPerPass: 0.006,
    reviewPerOOB: 0.3,
    reviewPerLateMake: 0.3,
    reviewPerPeriodEnd: 0.4
  }
};
const TAKE_WINDOW_SEC = defaultParams.officiating.takeWindowSec;

function pool(n: number, prefix: string, params?: object): GameResult[] {
  const out: GameResult[] = [];
  for (let i = 0; i < n; i++) {
    const { home, away } = sampleMatchup();
    const flip = i % 2 === 1;
    out.push(simulateGame({
      seed: `${prefix}-${i}`,
      home: flip ? away : home,
      away: flip ? home : away,
      collectFrames: false,
      ...(params ? { params } : {})
    }));
  }
  return out;
}

const forced = pool(8, 'off-live', FORCED);

// ------------------------------------------------------------------ helpers

const other = (side: TeamSide): TeamSide => (side === 0 ? 1 : 0);

type Ev<T extends GameEvent['type']> = Extract<GameEvent, { type: T }>;
const ofType = <T extends GameEvent['type']>(r: GameResult, t: T): Ev<T>[] =>
  r.events.filter((e): e is Ev<T> => e.type === t);

/** fold the on-court lineups through the event stream (invariants.test.ts pattern) */
function lineupAt(events: GameEvent[]): (idx: number) => [Set<string>, Set<string>] {
  const snapshots: [Set<string>, Set<string>][] = [];
  let current: [Set<string>, Set<string>] = [new Set(), new Set()];
  for (const e of events) {
    if (e.type === 'game_start') {
      current = [new Set(e.home.lineup), new Set(e.away.lineup)];
    } else if (e.type === 'substitution') {
      const next: [Set<string>, Set<string>] = [new Set(current[0]), new Set(current[1])];
      for (const id of e.out) next[e.team].delete(id);
      for (const id of e.in) next[e.team].add(id);
      current = next;
    }
    snapshots.push(current);
  }
  return (idx) => snapshots[idx]!;
}

/** team of the possession live at event index i (last possession_start at/before i) */
function possTeamAt(events: GameEvent[], idx: number): TeamSide | -1 {
  for (let i = idx; i >= 0; i--) {
    const e = events[i]!;
    if (e.type === 'possession_start') return e.team;
  }
  return -1;
}

// ---------------------------------------------------- fitted defaults (live)

describe('officiating fitted defaults (ffit-officiating)', () => {
  // The staged-inert dormancy pins retired at the fit flip (this suite's
  // header). These are their replacement: a drift tripwire on the fitted
  // values — the flow-harness rate gates (npm run flowboard G2) own the
  // behavioral acceptance; these pins only catch a silent default edit.
  it('every params.officiating rate ships at its corpus-fitted value', () => {
    const O = defaultParams.officiating;
    expect(O.heldBallPerScramble).toBe(0.0095);
    expect(O.heldBallPerReach).toBe(0.005);
    expect(O.goaltendPerContestedInsideMiss).toBe(0.0205);
    expect(O.goaltendPerPutback).toBe(0.024);
    expect(O.travelPerDriveSec).toBe(0.00265);
    expect(O.travelPerPostSec).toBe(0.0065);
    expect(O.techPerFoulWhistle).toBe(0.017);
    expect(O.takeRelabelHuntFouls).toBe(1);
    // the fit landed 0.09, rescaled 0.09 → 0.06728 at the FLOW landing to
    // hold take = reach × mult constant as organic reach rose (knot-combo §1)
    expect(O.takeHuntRateMult).toBe(0.06728);
    expect(O.kickedPerPass).toBe(0.00127);
    expect(O.reviewPerOOB).toBe(0.25);
    expect(O.reviewPerLateMake).toBe(0.085);
    expect(O.reviewPerPeriodEnd).toBe(0.09);
  });
});

// ------------------------------------------------------ emission (forced)

describe('officiating emission pins (forced rates)', () => {
  it('every family emits across the forced pool — no family stuck at zero', () => {
    const count = (pred: (e: GameEvent) => boolean): number =>
      forced.reduce((a, r) => a + r.events.filter(pred).length, 0);
    expect(count((e) => e.type === 'jump_ball')).toBeGreaterThan(0);
    expect(count((e) => e.type === 'violation' && e.kind === 'def_goaltend')).toBeGreaterThan(0);
    expect(count((e) => e.type === 'violation' && e.kind === 'kicked_ball')).toBeGreaterThan(0);
    expect(count((e) => e.type === 'turnover' && e.kind === 'travel')).toBeGreaterThan(0);
    expect(count((e) => e.type === 'turnover' && e.kind === 'off_goaltend')).toBeGreaterThan(0);
    expect(count((e) => e.type === 'foul' && e.kind === 'take')).toBeGreaterThan(0);
    expect(count((e) => e.type === 'foul' && e.kind === 'technical')).toBeGreaterThan(0);
    expect(count((e) => e.type === 'free_throw' && e.technical === true)).toBeGreaterThan(0);
    // all three review triggers represented (fdesign-officiating §6 gate shape)
    expect(count((e) => e.type === 'replay_review' && e.trigger === 'oob')).toBeGreaterThan(0);
    expect(count((e) => e.type === 'replay_review' && e.trigger === 'late_make')).toBeGreaterThan(0);
    expect(count((e) => e.type === 'replay_review' && e.trigger === 'period_end')).toBeGreaterThan(0);
    expect(count((e) => e.type === 'possession_end' && e.outcome === 'held_ball')).toBeGreaterThan(0);
  });

  it('def-goaltend adjacency: the violation rides a made shot — same t/wt, points already scored', () => {
    let seen = 0;
    for (const r of forced) {
      r.events.forEach((e, i) => {
        if (e.type !== 'violation' || e.kind !== 'def_goaltend') return;
        seen += 1;
        const prev = r.events[i - 1]!;
        expect(prev.type).toBe('shot');
        const shot = prev as Ev<'shot'>;
        expect(shot.made).toBe(true);
        expect(shot.points).toBe(2); // rim/paint gate; a goaltended make is a two
        expect(shot.zone === 'rim' || shot.zone === 'paint').toBe(true);
        expect(shot.blockedBy).toBeUndefined(); // independent of the block roll by design
        expect(shot.foul).toBeUndefined(); // the compound is skipped (documented simplification)
        expect(e.t).toBe(shot.t);
        expect(e.wt).toBe(shot.wt);
        expect(e.score).toEqual(shot.score); // the shot's stamp already includes the points
        expect(e.team).toBe(other(shot.team)); // the DEFENSE violates
        expect(e.player).toBe(shot.contestedBy); // the violator is the contesting defender
      });
    }
    expect(seen).toBeGreaterThan(0);
  });

  it('technical insertion: counts stamped not incremented, 1-of-1 technical FT, no possession flip', () => {
    let seen = 0;
    for (const r of forced) {
      const events = r.events;
      events.forEach((e, i) => {
        if (e.type !== 'foul' || e.kind !== 'technical') return;
        seen += 1;
        expect(e.fouledOut).toBe(false);
        // the trigger personal is the previous foul event (a foul-out
        // replacement substitution may sit between them): same fouler, and
        // the tech repeats his counts unchanged; a snapshot, not a bump
        let j = i - 1;
        while (j >= 0 && events[j]!.type !== 'foul') j--;
        expect(j).toBeGreaterThanOrEqual(0);
        const trigger = events[j] as FoulEvent;
        expect(trigger.kind === 'technical').toBe(false); // techs never chain
        expect(trigger.on).toBe(e.on);
        expect(trigger.t).toBe(e.t);
        expect(e.personalCount).toBe(trigger.personalCount);
        expect(e.teamCountInPeriod).toBe(trigger.teamCountInPeriod);
        // the very next free_throw is the technical single, shot by the
        // opposing side, with no possession boundary before it, except a
        // charge's own turnover close (the trigger personal was offensive:
        // emit order is turnover → foul → tech → possession_end → tech FT,
        // and that possession_end belongs to the charge, not the tech)
        let k = i + 1;
        while (k < events.length && events[k]!.type !== 'free_throw') {
          expect(events[k]!.type === 'possession_start').toBe(false);
          if (trigger.kind !== 'offensive') {
            expect(events[k]!.type === 'possession_end').toBe(false);
          }
          k++;
        }
        expect(k).toBeLessThan(events.length);
        const ft = events[k] as FreeThrowEvent;
        expect(ft.technical).toBe(true);
        expect(ft.n).toBe(1);
        expect(ft.of).toBe(1);
        expect(ft.team).toBe(other(e.team));
        // no rebound of any kind directly after a missed technical FT (the
        // ball is dead by rule; not even the formality row)
        if (!ft.made) expect(events[k + 1]?.type === 'rebound').toBe(false);
        // possession invariance: the team possessing at the whistle is the
        // team acting first after the tech FT (unless a legitimate
        // possession_end from the personal's own penalty intervenes)
        const possBefore = possTeamAt(events, i);
        for (let m = k + 1; m < events.length; m++) {
          const ev = events[m]!;
          if (ev.type === 'possession_start' || ev.type === 'possession_end') break;
          if (ev.type === 'shot' || ev.type === 'pass') {
            expect(ev.team).toBe(possBefore);
            break;
          }
        }
      });
    }
    expect(seen).toBeGreaterThan(0);
    // every tech begets exactly one technical FT; the counts match 1:1
    const techs = forced.reduce((a, r) => a + ofType(r, 'foul').filter((f) => f.kind === 'technical').length, 0);
    const techFTs = forced.reduce((a, r) => a + ofType(r, 'free_throw').filter((f) => f.technical === true).length, 0);
    expect(techFTs).toBe(techs);
  });

  it('take context: every take is the endgame hunt or a transition-window wrap-up', () => {
    let seen = 0;
    for (const r of forced) {
      const events = r.events;
      events.forEach((e, i) => {
        if (e.type !== 'foul' || e.kind !== 'take') return;
        seen += 1;
        // context A, the endgame foul game (relabeled hunt): final period
        // or OT, inside the hunt window (foulTrailMaxClockSec 35)
        const huntContext = e.period >= 4 && e.clock <= defaultParams.endgame.foulTrailMaxClockSec;
        // context B, the transition take: steal/live_rebound possession's
        // first takeWindowSec, never in the final 2:00
        let transitionContext = false;
        for (let j = i - 1; j >= 0; j--) {
          const ev = events[j]!;
          if (ev.type === 'possession_start') {
            transitionContext =
              (ev.kind === 'steal' || ev.kind === 'live_rebound') &&
              e.t - ev.t <= TAKE_WINDOW_SEC + 0.2 && // one tick of grace on the window edge
              !(e.period >= 4 && e.clock <= 120);
            break;
          }
        }
        expect(huntContext || transitionContext).toBe(true);
      });
    }
    expect(seen).toBeGreaterThan(0);
  });

  it('kicked balls and offense-won jumps continue the SAME possession', () => {
    let seenKicked = 0;
    let seenJumpKeep = 0;
    for (const r of forced) {
      const events = r.events;
      const checkContinuation = (i: number, keeper: TeamSide): void => {
        // the first possession-boundary event after the whistle must be the
        // retaining team's own eventual possession_end, never an immediate
        // possession_start (which would mean the whistle flipped the ball)
        for (let j = i + 1; j < events.length; j++) {
          const ev = events[j]!;
          if (ev.type === 'possession_start') {
            // a start before any end = the whistle flipped the ball: wrong
            expect(ev.type).toBe('possession_end');
          }
          if (ev.type === 'possession_end') {
            expect(ev.team).toBe(keeper);
            return;
          }
        }
      };
      events.forEach((e, i) => {
        if (e.type === 'violation' && e.kind === 'kicked_ball') {
          seenKicked += 1;
          checkContinuation(i, other(e.team)); // the offense (non-violating side) retains
        }
        if (e.type === 'jump_ball') {
          const poss = possTeamAt(events, i);
          if (e.winner === poss) {
            seenJumpKeep += 1;
            checkContinuation(i, e.winner);
          } else {
            // defense-won jump: an administered restart; the next
            // possession_start is a 'tip', never a transition kind
            const next = events.slice(i + 1).find((ev) => ev.type === 'possession_start');
            expect(next).toBeDefined();
            expect((next as Ev<'possession_start'>).kind).toBe('tip');
          }
        }
      });
    }
    expect(seenKicked).toBeGreaterThan(0);
    expect(seenJumpKeep).toBeGreaterThan(0);
  });

  it('held_ball possession ends carry no turnover and hand off to a tip', () => {
    let seen = 0;
    for (const r of forced) {
      const events = r.events;
      events.forEach((e, i) => {
        if (e.type !== 'possession_end' || e.outcome !== 'held_ball') return;
        seen += 1;
        // no turnover charged anywhere at this whistle (same t)
        const charged = events.some(
          (ev) => ev.type === 'turnover' && ev.t === e.t && ev.team === e.team
        );
        expect(charged).toBe(false);
        const next = events[i + 1]!;
        expect(next.type).toBe('possession_start');
        expect((next as Ev<'possession_start'>).kind).toBe('tip');
      });
    }
    expect(seen).toBeGreaterThan(0);
  });

  it('new-event actors are on-court and correctly sided; violation TOs never carry stolenBy', () => {
    for (const r of forced) {
      const at = lineupAt(r.events);
      const side = new Map<string, TeamSide>();
      for (const s of [0, 1] as TeamSide[]) for (const p of r.teams[s].players) side.set(p.id, s);
      r.events.forEach((e, idx) => {
        const on = at(idx);
        if (e.type === 'turnover' && (e.kind === 'travel' || e.kind === 'off_goaltend')) {
          expect((e as TurnoverEvent).stolenBy).toBeUndefined();
        }
        if (e.type === 'jump_ball') {
          const jb = e as JumpBallEvent;
          for (const id of jb.between) expect(on[side.get(id)!].has(id)).toBe(true);
          expect(on[jb.winner].has(jb.gainedBy)).toBe(true); // the tap stays on the winning side's floor
        }
        if (e.type === 'violation') {
          const v = e as ViolationEvent;
          if (v.player) {
            expect(side.get(v.player)).toBe(v.team);
            expect(on[v.team].has(v.player)).toBe(true);
          }
        }
        if (e.type === 'free_throw' && (e as FreeThrowEvent).technical) {
          expect(on[e.team].has(e.shooter)).toBe(true);
        }
      });
    }
  });
});

// -------------------------------------------------------- consumers (forced)

describe('officiating consumer chain (forced rates)', () => {
  it('box reconstruction stays exact: score, pf = non-technical fouls, tov includes violations', () => {
    for (const r of forced) {
      const box = boxScore(r.events, r.teams);
      // score reconstructible from events alone (the §1.3 contract)
      const recon: [number, number] = [0, 0];
      for (const e of r.events) {
        if (e.type === 'shot' && e.made) recon[e.team] += e.points;
        if (e.type === 'free_throw' && e.made) recon[e.team] += 1;
      }
      expect(recon).toEqual(r.finalScore);
      expect([box.teams[0].pts, box.teams[1].pts]).toEqual(r.finalScore);
      for (const s of [0, 1] as TeamSide[]) {
        // pf is now defined as NON-TECHNICAL fouls (real box convention)
        const personals = ofType(r, 'foul').filter((f) => f.team === s && f.kind !== 'technical').length;
        expect(box.teams[s].pf).toBe(personals);
        // travel/off_goaltend fold as ordinary TOVs to the player
        const tos = ofType(r, 'turnover').filter((t) => t.team === s).length;
        expect(box.teams[s].tov).toBe(tos);
        // technical FTs credit FTA/FTM like any other attempt
        const fta = ofType(r, 'free_throw').filter((f) => f.team === s).length;
        expect(box.teams[s].fta).toBe(fta);
        // nothing in the totals goes NaN under the new vocabulary
        for (const v of Object.values(box.teams[s])) {
          if (typeof v === 'number') expect(Number.isFinite(v)).toBe(true);
        }
      }
      // minutes conservation and plus-minus zero-sum survive forced streams
      const gameMin = box.periods <= 4 ? 48 : 48 + (box.periods - 4) * 5;
      for (const s of [0, 1] as TeamSide[]) {
        const mins = box.players.filter((p) => p.team === s).reduce((a, p) => a + p.min, 0);
        // 0.3 is the sub-granularity tolerance; the 1e-9 pad absorbs
        // accumulated float error in the Σmin fold — one landed stream drew
        // exactly 0.30000000000001137 (knot-combo test triage; a boundary
        // correction, the tolerance itself is unchanged)
        expect(Math.abs(mins - gameMin * 5)).toBeLessThanOrEqual(0.3 + 1e-9);
      }
      const pm = (s: TeamSide) =>
        box.players.filter((p) => p.team === s).reduce((a, p) => a + p.plusMinus, 0);
      expect(pm(0) + pm(1)).toBe(0);
    }
  });

  it('narration renders every officiating event — no silent rows, no "undefined"', () => {
    const r = forced[0]!;
    const lines = generatePlayByPlay(r.events, r.teams, { seed: r.seed, periods: 4 });
    for (const l of lines) expect(l.text.includes('undefined')).toBe(false);
    const all = lines.map((l) => l.text).join('\n');
    const expectIf = (present: boolean, re: RegExp): void => {
      if (present) expect(re.test(all)).toBe(true);
    };
    const has = (pred: (e: GameEvent) => boolean) => r.events.some(pred);
    expectIf(has((e) => e.type === 'jump_ball'), /held ball|jump ball|tie|tied up/i);
    expectIf(has((e) => e.type === 'violation' && e.kind === 'def_goaltend'), /goaltend/i);
    expectIf(has((e) => e.type === 'violation' && e.kind === 'kicked_ball'), /kicked ball/i);
    expectIf(has((e) => e.type === 'replay_review'), /monitor|review|stands|replay/i);
    expectIf(has((e) => e.type === 'turnover' && e.kind === 'travel'), /travel/i);
    expectIf(has((e) => e.type === 'turnover' && e.kind === 'off_goaltend'), /offensive goaltend|interference/i);
    expectIf(has((e) => e.type === 'foul' && e.kind === 'technical'), /technical|tech/i);
    expectIf(has((e) => e.type === 'foul' && e.kind === 'take'), /take foul|concedes|stop the run-out/i);
    expectIf(has((e) => e.type === 'free_throw' && e.technical === true), /technical/i);
  });

  it('replay v3 + viewer lockstep (DO-NOT #8): both version literals and the feed vocabulary', () => {
    // engine side: the artifact declares v3
    expect(buildReplay(forced[0]!).version).toBe(3);
    // viewer side: the standalone HTML was written against v3 and renders
    // the new vocabulary (string pins, the fix/replay-v2 discipline)
    const html = readFileSync(new URL('../../viewer/index.html', import.meta.url), 'utf8');
    expect(html.includes('KNOWN_REPLAY_VERSION = 3')).toBe(true);
    expect(html.includes("case 'jump_ball'")).toBe(true);
    expect(html.includes("case 'violation'")).toBe(true);
    expect(html.includes("case 'replay_review'")).toBe(true);
    expect(html.includes('traveling')).toBe(true);
    expect(html.includes('offensive goaltending')).toBe(true);
    expect(html.includes('technical')).toBe(true);
  });
});
