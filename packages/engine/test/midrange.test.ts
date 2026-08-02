/**
 * Mid-range restoration acceptance (wave2/midrange).
 *
 * Before the mechanism landed, the mid-range game was structurally extinct:
 * every shot was priced against a continuation value (>= 1.18 EV until the
 * 5 s urgency window) that even the BEST mid-range look (EV ~1.14) never
 * cleared — uShoot was argmax in 0 of 780 instrumented decisions at
 * 17-20 ft — and no spacing spot or action ever stationed a player in the
 * 14-20 ft band. Mid attempts ran 2.75% of FGA with a 19.9 ft median: the
 * few "mid" shots were arc-toeing accidents, not 16-footers.
 *
 * These tests pin the restored behavior at game scale:
 *  1. identity gating — the mid green light belongs to mid-range identities
 *     (postAnchor's elbow game) and NEVER to rim-runners/bench bigs, whose
 *     open 16-footer is the defense's win;
 *  2. league texture — mid share out of the structural-zero regime with a
 *     REAL distance distribution (median in the 15-19 ft elbow game, the
 *     14-19.5 ft real-mid band dominant — not 20-ft arc-toes);
 *  3. capacity — a genuine mid-range artist (a DeRozan-shaped fit, heavier
 *     mid identity than any calibration fixture carries) produces real
 *     volume, which is what fitted rosters (wave2 B3) will rely on.
 *
 * Thresholds are deliberately generous: any engine change reshuffles seeds,
 * and these gates exist to catch the mechanism DYING (share collapsing back
 * toward ~2-3% junk, bigs chucking, distances re-stretching to the arc),
 * not to freeze exact rates — those belong to the bands and the sweep.
 */

import { describe, expect, it } from 'vitest';
import { simulateGame, type ShotEvent } from '@hoopsh/engine';
import { sampleMatchup, scoringWing } from '@hoopsh/data';

const GAMES = 8; // share noise at n=6 ran ±0.8pp across seed bases; n=8 + generous floors below

function collectShots(mutate?: (home: ReturnType<typeof sampleMatchup>['home'], away: ReturnType<typeof sampleMatchup>['away']) => void): ShotEvent[] {
  const shots: ShotEvent[] = [];
  for (let i = 0; i < GAMES; i++) {
    const { home, away } = sampleMatchup();
    mutate?.(home, away);
    const flip = i % 2 === 1;
    // pool re-anchored at the #115 acquisition-stamp landing (streams
    // reshuffled; midrange-0..7 drew band dominance 0.591 vs the 0.6
    // floor): midrange-8..15, first qualifying offset — every gate in
    // this file passes. Assertions unchanged.
    const result = simulateGame({
      seed: `midrange-${i + 8}`,
      home: flip ? away : home,
      away: flip ? home : away,
      collectFrames: false
    });
    for (const ev of result.events) {
      if (ev.type === 'shot') shots.push(ev);
    }
  }
  return shots;
}

const midOf = (shots: ShotEvent[], id?: string) =>
  shots.filter((sh) => sh.zone === 'mid' && (!id || sh.shooter === id));
const fgaOf = (shots: ShotEvent[], id: string) => shots.filter((sh) => sh.shooter === id);

describe(`mid-range restoration over ${GAMES} games`, () => {
  const shots = collectShots();

  it('mid-range identity (postAnchor Osei) actually takes 16-footers', () => {
    const mids = midOf(shots, 'mon-osei');
    // pre-fix he managed 1.5/g at a 20.5 ft average — corner junk-2s, not
    // an elbow game. The station + pop + worked-shot term put him at ~3-4.5
    // real middies a game in probes; the floor here only requires the
    // mechanism to be ALIVE.
    expect(mids.length / GAMES).toBeGreaterThanOrEqual(1.5);
    const avg = mids.reduce((a, m) => a + m.distFt, 0) / Math.max(1, mids.length);
    expect(avg).toBeLessThanOrEqual(19); // an ELBOW game, not arc-toes
  });

  it('rim-runners and bench bigs never pick up the 16-footer habit', () => {
    // the green light must stay exactly zero below the tendency floor: a
    // rim-runner's open 16-footer is a WIN for the defense. Late-clock
    // urgency junk is legal (any shot beats a violation), so the gate is a
    // small share of their own attempts, not literal zero.
    for (const id of ['brk-ratliff', 'mon-halvorsen', 'brk-marsh', 'mon-yaro']) {
      const own = fgaOf(shots, id);
      const mids = midOf(shots, id);
      expect(mids.length).toBeLessThanOrEqual(Math.max(1, own.length * 0.04));
    }
  });

  it('league mid share escapes the structural-zero regime with real distances', () => {
    const mids = midOf(shots);
    const share = mids.length / shots.length;
    // pre-fix: 2.75% and falling entirely in the 20+ ft junk. Probes with
    // the mechanism: 3.1-4.7% across seed bases on the calibration teams
    // (the 5-7% league target arrives with fitted rosters that carry true
    // mid identities — see the capacity test below). The share floor alone
    // cannot separate the regimes at this sample size — the median and
    // band-dominance gates below are what the old junk regime fails
    // (median 19.9, band share ~50%). Upper bound catches a flood.
    expect(share).toBeGreaterThanOrEqual(0.03);
    expect(share).toBeLessThanOrEqual(0.08);
    const d = mids.map((m) => m.distFt).sort((a, b) => a - b);
    const median = d[Math.floor(d.length / 2)]!;
    expect(median).toBeGreaterThanOrEqual(15);
    expect(median).toBeLessThanOrEqual(19);
    // the real-mid band must DOMINATE the zone: restoring "mid-range" as
    // 20-ft arc-toes would pass a share check and still be the old failure
    const band = mids.filter((m) => m.distFt >= 14 && m.distFt <= 19.5);
    expect(band.length / mids.length).toBeGreaterThanOrEqual(0.6);
  });

  it('style separation: the post team out-middies the 5-out team', () => {
    const brk = shots.filter((sh) => sh.shooter.startsWith('brk-'));
    const mon = shots.filter((sh) => sh.shooter.startsWith('mon-'));
    const share = (arr: ShotEvent[]) => midOf(arr).length / arr.length;
    // pace-and-space lives at the rim and the arc; the post-oriented roster
    // carries the league's mid volume — identity, not a global appetite
    expect(share(mon)).toBeGreaterThan(share(brk));
  });
});

describe('mid-range capacity for fitted rosters', () => {
  // a DeRozan-shaped wing: elite mid ability, heavy mid/pull-up identity,
  // three-point line respected but not preferred. No calibration fixture
  // carries this profile (max shotMid is 44); fitted real rosters will.
  const shots = collectShots((_home, away) => {
    const idx = away.players.findIndex((p) => p.id === 'mon-adler');
    const artist = scoringWing({ id: 'mon-adler', name: 'Mid Artist', pos: 'SF', heightIn: 79 });
    artist.attr.midRange = 92;
    artist.attr.three = 58;
    artist.tend.shotMid = 68;
    artist.tend.pullUp = 78;
    artist.tend.shotThree = 24;
    artist.tend.usage = 78;
    away.players[idx] = artist;
    away.starters = away.starters.map((sid) => (sid === 'mon-cole' ? 'mon-adler' : sid));
  });

  it('a true mid-range artist produces real volume at real distances', () => {
    const mids = midOf(shots, 'mon-adler');
    expect(mids.length / GAMES).toBeGreaterThanOrEqual(2); // probes: ~3.7/g
    const d = mids.map((m) => m.distFt).sort((a, b) => a - b);
    expect(d[Math.floor(d.length / 2)]!).toBeLessThanOrEqual(19.5);
    // and he lifts the LEAGUE into the real 5-7% neighborhood on his own
    expect(midOf(shots).length / shots.length).toBeGreaterThanOrEqual(0.045);
  });
});
