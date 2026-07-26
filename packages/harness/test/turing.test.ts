/**
 * Dry bbref-register renderer tests (turing.ts renderEvent): the exact shot
 * grammar the blind Turing protocol shows judges. Pinned against real
 * basketball-reference phrasing (the six-game reference corpus):
 *   "makes 2-pt layup from 3 ft" / "misses 3-pt jump shot from 26 ft" /
 *   "makes 2-pt dunk at rim (assist by X)" / "makes 2-pt hook shot from 7 ft"
 * — every vocabulary variant, plus the "at rim" measurement phrase (a
 * baseline protocolFix: the renderer previously lacked it entirely).
 */

import { describe, expect, it } from 'vitest';
import type { GameEvent } from '@hoopsh/engine';
import { renderEvent } from '../src/turing.js';

const name = (id: string): string => (id === 'sh' ? 'A. Carver' : 'B. Whitfield');
const springy = () => ({ vertical: 92, finishing: 88 });
const grounded = () => ({ vertical: 48, finishing: 60 });

const base = { t: 100, wt: 120, period: 2, clock: 400, score: [20, 18] as [number, number] };
const shot = (over: Record<string, unknown>): GameEvent =>
  ({
    type: 'shot', team: 0, shooter: 'sh', x: 10, y: 25, distFt: 2, zone: 'rim',
    three: false, moveType: 'drive', contest: 0.3, made: true, points: 2, ...over, ...base
  } as GameEvent);

describe('turing dry renderer: bbref shot grammar', () => {
  it('renders every 2-pt vocabulary variant', () => {
    expect(renderEvent(shot({ distFt: 3.2 }), name, grounded))
      .toBe('A. Carver makes 2-pt layup from 3 ft');
    expect(renderEvent(shot({ distFt: 1.1 }), name, springy))
      .toBe('A. Carver makes 2-pt dunk from 1 ft');
    expect(renderEvent(shot({ distFt: 0.4 }), name, springy))
      .toBe('A. Carver makes 2-pt dunk at rim');
    expect(renderEvent(shot({ distFt: 7, zone: 'paint', moveType: 'post' }), name, grounded))
      .toBe('A. Carver makes 2-pt hook shot from 7 ft');
    expect(renderEvent(shot({ distFt: 0.8, moveType: 'putback' }), name, grounded))
      .toBe('A. Carver makes 2-pt tip-in from 1 ft');
    expect(renderEvent(shot({ distFt: 16.4, zone: 'mid', moveType: 'pull_up' }), name, grounded))
      .toBe('A. Carver makes 2-pt jump shot from 16 ft');
  });

  it('a short paint jumper stays a jump shot only when self-created (the 5-8 ft monotony tell)', () => {
    expect(renderEvent(shot({ distFt: 5, zone: 'paint', moveType: 'drive', made: false }), name, grounded))
      .toBe('A. Carver misses 2-pt layup from 5 ft');
    expect(renderEvent(shot({ distFt: 5, zone: 'paint', moveType: 'pull_up', made: false }), name, grounded))
      .toBe('A. Carver misses 2-pt jump shot from 5 ft');
  });

  it('threes are 3-pt jump shots with assist/block tails intact', () => {
    expect(renderEvent(shot({ distFt: 25.7, zone: 'three', three: true, points: 3, moveType: 'catch_shoot', assist: 'p2' }), name, grounded))
      .toBe('A. Carver makes 3-pt jump shot from 26 ft (assist by B. Whitfield)');
    expect(renderEvent(shot({ distFt: 24.2, zone: 'three', three: true, points: 0, made: false, moveType: 'pull_up', blockedBy: 'p2' }), name, grounded))
      .toBe('A. Carver misses 3-pt jump shot from 24 ft (block by B. Whitfield)');
  });

  it('a miss is never a dunk — failed slams read as missed layups', () => {
    expect(renderEvent(shot({ distFt: 1.0, made: false, points: 0 }), name, springy))
      .toBe('A. Carver misses 2-pt layup from 1 ft');
  });

  it('renders without a traits lookup (falls back to grounded finishes)', () => {
    expect(renderEvent(shot({ distFt: 1.0 }), name))
      .toBe('A. Carver makes 2-pt layup from 1 ft');
  });

  it('shot-clock violations are TEAM turnovers, like bbref (never charged to a player)', () => {
    const tov = { type: 'turnover', team: 0, player: 'sh', kind: 'shot_clock', ...base } as GameEvent;
    expect(renderEvent(tov, name)).toBe('Turnover by Team (shot clock)');
    const bad = { type: 'turnover', team: 0, player: 'sh', kind: 'bad_pass', stolenBy: 'p2', ...base } as GameEvent;
    expect(renderEvent(bad, name)).toBe('Turnover by A. Carver (bad pass; steal by B. Whitfield)');
  });

  it('team rebounds read exactly like bbref: "rebound by Team"', () => {
    const teamDef = { type: 'rebound', team: 1, offensive: false, x: 30, y: 10, ...base } as GameEvent;
    expect(renderEvent(teamDef, name)).toBe('Defensive rebound by Team');
    const ftFormality = { type: 'rebound', team: 0, offensive: true, deadBall: true, x: 5, y: 25, ...base } as GameEvent;
    expect(renderEvent(ftFormality, name)).toBe('Offensive rebound by Team');
    const player = { type: 'rebound', team: 0, player: 'sh', offensive: true, x: 5, y: 25, ...base } as GameEvent;
    expect(renderEvent(player, name)).toBe('Offensive rebound by A. Carver');
  });
});
