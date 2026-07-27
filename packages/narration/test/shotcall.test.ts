/**
 * Shot-call vocabulary tests — every variant the classifier can emit, pinned
 * against hand-built shot events (the Turing baseline's shot-type-monotony
 * tell: sub-8ft attempts must NOT all read "jump shot").
 */

import { describe, expect, it } from 'vitest';
import { simulateGame, type GameEvent } from '@hoopsh/engine';
import { sampleMatchup } from '@hoopsh/data';
import { distPhrase, generatePlayByPlay, shotCall, type ShotLike } from '@hoopsh/narration';

const springy = { vertical: 90, finishing: 90 };
const grounded = { vertical: 45, finishing: 60 };

const shot = (over: Partial<ShotLike>): ShotLike => ({
  zone: 'rim', distFt: 2, moveType: 'drive', three: false, made: true, ...over
});

describe('shotCall classifier', () => {
  it('threes and heaves are always jump shots', () => {
    expect(shotCall(shot({ zone: 'three', three: true, distFt: 25, moveType: 'catch_shoot' }), springy)).toBe('jump shot');
    expect(shotCall(shot({ moveType: 'heave', zone: 'three', three: true, distFt: 60 }), springy)).toBe('jump shot');
  });

  it('a point-blank make by a springy finisher is a dunk; grounded finishers lay it in', () => {
    expect(shotCall(shot({ distFt: 1.2 }), springy)).toBe('dunk');
    expect(shotCall(shot({ distFt: 1.2 }), grounded)).toBe('layup');
    // the AI's "pull_up" label at point-blank range is just a gather — still a dunk
    expect(shotCall(shot({ distFt: 1.8, moveType: 'pull_up' }), springy)).toBe('dunk');
  });

  it('misses are never dunks (a failed slam is scored a missed layup)', () => {
    expect(shotCall(shot({ distFt: 1.2, made: false }), springy)).toBe('layup');
  });

  it('without shooter traits the classifier stays conservative (layup, not dunk)', () => {
    expect(shotCall(shot({ distFt: 1.2 }))).toBe('layup');
  });

  it('a point-blank putback tap is a tip-in', () => {
    expect(shotCall(shot({ distFt: 1.0, moveType: 'putback' }), grounded)).toBe('tip-in');
    // a gathered putback from further out is a layup
    expect(shotCall(shot({ distFt: 4.5, zone: 'paint', moveType: 'putback' }), grounded)).toBe('layup');
  });

  it('post moves in hook range are hook shots; a deep post move is a jumper', () => {
    expect(shotCall(shot({ distFt: 7, zone: 'paint', moveType: 'post' }), grounded)).toBe('hook shot');
    expect(shotCall(shot({ distFt: 3.5, zone: 'rim', moveType: 'post' }), grounded)).toBe('hook shot');
    expect(shotCall(shot({ distFt: 16, zone: 'mid', moveType: 'post' }), grounded)).toBe('jump shot');
    // a true drop step at the rim is a finish, not a hook
    expect(shotCall(shot({ distFt: 2, moveType: 'post' }), grounded)).toBe('layup');
  });

  it('rim-zone attempts are always rim finishes, never jump shots', () => {
    for (const moveType of ['drive', 'catch_shoot', 'pull_up', 'putback', 'post', 'cut_finish'] as const) {
      const call = shotCall(shot({ distFt: 3, moveType, made: false }), springy);
      expect(call === 'layup' || call === 'hook shot' || call === 'tip-in').toBe(true);
    }
  });

  it('short paint finishes read by creation: a 5-ft drive is a layup, a 5-ft pull-up is a jumper', () => {
    expect(shotCall(shot({ distFt: 5, zone: 'paint', moveType: 'drive' }), grounded)).toBe('layup');
    expect(shotCall(shot({ distFt: 5, zone: 'paint', moveType: 'pull_up' }), grounded)).toBe('jump shot');
    expect(shotCall(shot({ distFt: 5, zone: 'paint', moveType: 'catch_shoot' }), grounded)).toBe('layup');
    expect(shotCall(shot({ distFt: 9, zone: 'paint', moveType: 'drive' }), grounded)).toBe('jump shot');
  });

  it('distPhrase prints bbref measurement grammar ("at rim", never "from 0 ft")', () => {
    expect(distPhrase(0.3)).toBe('at rim');
    expect(distPhrase(1.2)).toBe('from 1 ft');
    expect(distPhrase(25.6)).toBe('from 26 ft');
  });
});

describe('broadcast play-by-play renders the full shot vocabulary', () => {
  const { home, away } = sampleMatchup();
  // pick real roster ids so lookup/traits resolve; force traits via distFt/move
  const shooter = home.players[0]!.id;
  const base = { t: 30, wt: 40, period: 1, clock: 600, score: [2, 0] as [number, number] };
  const mkShot = (over: Record<string, unknown>): GameEvent =>
    ({
      type: 'shot', team: 0, shooter, x: 10, y: 25, distFt: 2, zone: 'rim',
      three: false, moveType: 'drive', contest: 0.3, made: true, points: 2, ...over, ...base
    } as GameEvent);

  const cases: [string, GameEvent, RegExp][] = [
    ['tip-in', mkShot({ moveType: 'putback', distFt: 1 }), /tip-in/],
    ['hook', mkShot({ moveType: 'post', distFt: 7, zone: 'paint' }), /hook/],
    ['layup', mkShot({ moveType: 'drive', distFt: 3 }), /layup/],
    ['floater', mkShot({ moveType: 'pull_up', distFt: 8, zone: 'paint' }), /floater/],
    ['putback layup', mkShot({ moveType: 'putback', distFt: 4, zone: 'paint' }), /putback/],
    ['mid-range jumper', mkShot({ moveType: 'pull_up', distFt: 16, zone: 'mid' }), /jumper/]
  ];

  for (const [label, ev, pattern] of cases) {
    it(`renders a ${label}`, () => {
      const lines = generatePlayByPlay([ev], [home, away], { seed: 'call-1', includeMoments: false });
      expect(lines.length).toBe(1);
      expect(pattern.test(lines[0]!.text)).toBe(true);
    });
  }

  it('renders a dunk for a springy finisher when one exists on the roster', () => {
    // find any player with dunk-grade athleticism; every sample roster has some
    const dunker = [...home.players, ...away.players]
      .find((p) => 0.6 * p.attr.vertical + 0.4 * p.attr.finishing >= 74);
    expect(dunker !== undefined).toBe(true);
    const team = home.players.includes(dunker!) ? 0 : 1;
    const ev = mkShot({ shooter: dunker!.id, team, distFt: 1, moveType: 'drive' });
    const lines = generatePlayByPlay([ev], [home, away], { seed: 'call-2', includeMoments: false });
    expect(/dunk|slam|throws it down|hammer/.test(lines[0]!.text.toLowerCase())).toBe(true);
  });

  it('a full simulated game renders every line without vocabulary gaps', () => {
    const r = simulateGame({ seed: 'call-game-1', home, away, collectFrames: false });
    const pbp = generatePlayByPlay(r.events, [home, away], { seed: 'call-game-1' });
    for (const l of pbp) {
      expect(l.text).not.toContain('undefined');
      expect(l.text).not.toContain('NaN');
    }
  });
});
