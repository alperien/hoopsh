import { describe, expect, it } from 'vitest';
import { simulateGame, type GameEvent } from '@hoopsh/engine';
import { sampleMatchup } from '@hoopsh/data';
import { buildBroadcastScript, generatePlayByPlay, makeLookup, TemplateColorProvider } from '@hoopsh/narration';

describe('narration', () => {
  const { home, away } = sampleMatchup();
  const result = simulateGame({ seed: 'pbp-1', home, away, collectFrames: false });

  it('renders play-by-play for a full game without gaps or crashes', () => {
    const pbp = generatePlayByPlay(result.events, [home, away], { seed: 'pbp-1' });
    expect(pbp.length).toBeGreaterThan(200);
    // EVERY made shot surfaces in the full-game PBP: each made-shot register
    // in renderShot names the shooter, so there must be a line at the shot's
    // own timestamp carrying his last name. The old check here was
    // `pbp.length > madeShots` — a broadcast that never mentioned a single
    // made basket passed it (surviving mutant, b9-F5; the per-event kill
    // lived only in shotcall.test's single-event cases).
    const lk = makeLookup([home, away]);
    const madeShots = result.events.filter((e) => e.type === 'shot' && e.made);
    expect(madeShots.length).toBeGreaterThan(0); // vacuity floor
    for (const e of madeShots) {
      if (e.type !== 'shot') continue; // narrow for the type system
      const named = pbp.some((l) => l.t === e.t && l.text.includes(lk.last(e.shooter)));
      expect(named).toBe(true);
    }
    for (const l of pbp) {
      expect(l.text.length).toBeGreaterThan(4);
      expect(l.text).not.toContain('undefined');
    }
  });

  it('is deterministic for a fixed seed', () => {
    const a = generatePlayByPlay(result.events, [home, away], { seed: 'x' });
    const b = generatePlayByPlay(result.events, [home, away], { seed: 'x' });
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
  });

  it('a charge narrates as ONE line, not two (off_foul turnover + offensive foul pair)', () => {
    // The engine represents one charge as two consecutive events (a turnover
    // of kind 'off_foul' followed by a foul of kind 'offensive' — see
    // core/events.ts TurnoverKind). Both switch cases used to render a full
    // sentence, so every charge produced two adjacent lines for one whistle.
    const base = { t: 100, wt: 120, period: 1, clock: 500, score: [10, 8] as [number, number] };
    const charge = [
      { type: 'turnover', team: 0, player: 'brk-mercer', kind: 'off_foul', ...base },
      {
        type: 'foul', team: 0, on: 'brk-mercer', kind: 'offensive',
        personalCount: 2, teamCountInPeriod: 3, inBonus: false, fouledOut: false, ...base
      }
    ] as GameEvent[];
    const lines = generatePlayByPlay(charge, [home, away], { seed: 'charge-1', includeMoments: false });
    expect(lines.length).toBe(1);
    expect(lines[0]!.text).toContain('Charge');

    // ...but game-state news the charge line doesn't carry (foul trouble,
    // a foul-out) still gets its own line.
    const chargeFoulOut = [
      charge[0]!,
      {
        type: 'foul', team: 0, on: 'brk-mercer', kind: 'offensive',
        personalCount: 6, teamCountInPeriod: 3, inBonus: false, fouledOut: true, ...base
      }
    ] as GameEvent[];
    const linesOut = generatePlayByPlay(chargeFoulOut, [home, away], { seed: 'charge-2', includeMoments: false });
    expect(linesOut.length).toBe(2);
    expect(linesOut[1]!.text).toContain('fouled out');
  });

  it('team rebounds narrate as out-of-bounds awards; FT formalities stay silent', () => {
    const base = { t: 100, wt: 120, period: 1, clock: 500, score: [10, 8] as [number, number] };
    const events = [
      { type: 'rebound', team: 1, offensive: false, x: 30, y: 10, ...base },
      { type: 'rebound', team: 0, offensive: true, x: 8, y: 25, ...base },
      { type: 'rebound', team: 0, offensive: true, deadBall: true, x: 5, y: 25, ...base }
    ] as GameEvent[];
    const lines = generatePlayByPlay(events, [home, away], { seed: 'treb-1', includeMoments: false });
    // two team-rebound lines; the dead-ball formality renders nothing
    expect(lines.length).toBe(2);
    for (const l of lines) {
      expect(l.text).not.toContain('undefined');
      expect(/out of bounds|out of play|retain|keep it|inbound|ball/i.test(l.text)).toBe(true);
    }
  });

  it('a one-and-one front end reads as a front end, never "(1 of 2)" (B6-4)', () => {
    const base = { t: 100, wt: 120, period: 2, clock: 400, score: [40, 38] as [number, number], team: 0 as const, shooter: 'brk-mercer', of: 2 };
    const events = [
      { type: 'free_throw', n: 1, made: false, oneAndOne: true, ...base },
      { type: 'free_throw', n: 1, made: true, oneAndOne: true, ...base },
      // the earned second attempt of a converted one-and-one still counts normally
      { type: 'free_throw', n: 2, made: true, oneAndOne: true, ...base }
    ] as GameEvent[];
    const lines = generatePlayByPlay(events, [home, away], { seed: 'oao-1', includeMoments: false });
    expect(lines[0]!.text).toContain('front end of the one-and-one');
    expect(lines[0]!.text).not.toContain('1 of 2');
    expect(lines[1]!.text).toContain('front end of the one-and-one');
    expect(lines[2]!.text).toContain('2 of 2');
  });

  it('run moments use the right article — "an 8-0 run", "a 12-0 run" (B6-7)', () => {
    const mk = (score: [number, number], t: number) => ({
      type: 'shot', team: 0, shooter: 'brk-mercer', x: 5, y: 25, distFt: 2, zone: 'rim',
      three: false, moveType: 'drive', contest: 0.3, made: true, points: 2,
      t, wt: t + 20, period: 1, clock: 700 - t, score
    });
    const events = Array.from({ length: 6 }, (_, i) => mk([2 * (i + 1), 0], 10 * (i + 1))) as GameEvent[];
    const lines = generatePlayByPlay(events, [home, away], { seed: 'run-1' });
    expect(lines.some((l) => l.text.includes('on an 8-0 run'))).toBe(true);
    expect(lines.some((l) => l.text.includes('on a 12-0 run'))).toBe(true);
    expect(lines.some((l) => l.text.includes('a 8-0'))).toBe(false);
  });

  it('clutch_start honors the ruleset period count — winning time is reachable in NCAA regulation (B6-1)', () => {
    // a non-scoring event inside the clutch window: final period, 2:30 left,
    // 2-point game (clutch is checked on every event, not just scores)
    const ev = [
      {
        type: 'rebound', team: 0, offensive: false, player: 'brk-mercer',
        x: 10, y: 20, t: 2250, wt: 2400, period: 2, clock: 150, score: [60, 58]
      }
    ] as GameEvent[];
    // default (4-period ruleset): period 2 is NOT the final period — silent
    const nba = generatePlayByPlay(ev, [home, away], { seed: 'clutch-1' });
    expect(nba.some((l) => l.text.includes('winning time'))).toBe(false);
    // halves ruleset (periods: 2): the same moment IS winning time
    const ncaa = generatePlayByPlay(ev, [home, away], { seed: 'clutch-1', periods: 2 });
    expect(ncaa.some((l) => l.text.includes('winning time'))).toBe(true);
  });

  it('formatScript labels overtime as OT, honoring a forwarded period count (B6-2/B6-6)', async () => {
    const otEvent = [
      {
        type: 'period_start', period: 5, t: 2880, wt: 3000, clock: 300, score: [100, 100]
      }
    ] as GameEvent[];
    const cues = await buildBroadcastScript(otEvent, [home, away], new TemplateColorProvider(), { seed: 'ot-1' });
    const { formatScript } = await import('../src/broadcast.js');
    expect(formatScript(cues)).toContain('[OT ');
    // and a halves ruleset's first overtime (period 3) labels OT, not Q3
    const halfOt = [{ ...otEvent[0]!, period: 3 }] as GameEvent[];
    const cues2 = await buildBroadcastScript(halfOt, [home, away], new TemplateColorProvider(), { seed: 'ot-2', periods: 2 });
    expect(formatScript(cues2, 2)).toContain('[OT ');
    expect(formatScript(cues2, 2)).not.toContain('[Q3');
  });

  it('broadcast script merges pbp and color voices in time order', async () => {
    const cues = await buildBroadcastScript(result.events, [home, away], new TemplateColorProvider(), { seed: 'pbp-1' });
    expect(cues.some((c) => c.speaker === 'color')).toBe(true);
    for (let i = 1; i < cues.length; i++) {
      expect(cues[i]!.t).toBeGreaterThanOrEqual(cues[i - 1]!.t);
    }
  });
});
