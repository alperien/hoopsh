import { describe, expect, it } from 'vitest';
import { simulateGame, type GameEvent } from '@hoopsh/engine';
import { sampleMatchup } from '@hoopsh/data';
import { buildBroadcastScript, ContextTracker, formatScript, generatePlayByPlay, makeLookup, TemplateColorProvider } from '@hoopsh/narration';
import { SEED_PINS } from './seed-pins.gen.js';

describe('narration', () => {
  const { home, away } = sampleMatchup();
  // The probe-game anchor lives in ./seed-pins.gen.ts (issue #50). Last
  // hand re-scout was at the rules landing: the old pbp-1 stream diverged
  // to a wire-to-wire blowout with ZERO lead changes, starving the M-37
  // narrative-moment probe; its replacement was a 4-point game with ~10
  // lead flips. If the M-37 floor trips after an rng-order change, run
  // the re-anchor helper named in seed-pins.gen.ts.
  const result = simulateGame({ seed: SEED_PINS.pbpGame.seed, home, away, collectFrames: false });

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

  it('every made-shot template carries the and-one call when present (L-30)', () => {
    const mk = (three: boolean, i: number): unknown => ({
      type: 'shot', team: 0, shooter: 'brk-mercer', x: three ? 47 : 5, y: 25,
      distFt: three ? 25 : 2, zone: three ? 'three' : 'rim', three,
      moveType: three ? 'catch_shoot' : 'drive', contest: 0.3, made: true,
      points: three ? 3 : 2, foul: { by: 'opp-1', ftAwarded: 1, andOne: true },
      t: 10 * (i + 1), wt: 10 * (i + 1) + 5, period: 1, clock: 720 - 10 * i,
      score: [2 * (i + 1), 0]
    });
    // 16 and-one twos and 16 and-one threes: the seeded pool cycles through
    // every template variant across that many draws — two variants used to
    // drop the call entirely
    const twos = Array.from({ length: 16 }, (_, i) => mk(false, i)) as GameEvent[];
    const threes = Array.from({ length: 16 }, (_, i) => mk(true, i)) as GameEvent[];
    for (const events of [twos, threes]) {
      const lines = generatePlayByPlay(events, [home, away], { seed: 'l30', includeMoments: false });
      expect(lines.length).toBe(16);
      for (const l of lines) expect(l.text).toContain('AND the foul!');
      // pool coverage: at least 3 distinct bodies seen, not one lucky variant
      expect(new Set(lines.map((l) => l.text)).size).toBeGreaterThanOrEqual(3);
    }
    // and a plain make never claims a foul
    const clean = twos.map((e) => ({ ...(e as object), foul: undefined })) as GameEvent[];
    const cleanLines = generatePlayByPlay(clean, [home, away], { seed: 'l30', includeMoments: false });
    for (const l of cleanLines) expect(l.text).not.toContain('AND the foul');
  });

  it('clutch line matches the possession arithmetic of the margin (M-40)', () => {
    // clutch fires at margins up to 6, but margins 4-6 are a TWO-possession
    // game — the old line claimed "one-possession territory" for those too
    const mk = (score: [number, number]): GameEvent[] => [{
      type: 'rebound', team: 0, offensive: false, player: 'brk-mercer',
      x: 10, y: 20, t: 2650, wt: 2800, period: 4, clock: 150, score
    }] as GameEvent[];
    const one = generatePlayByPlay(mk([80, 78]), [home, away], { seed: 'm40' });
    expect(one.some((l) => l.text.includes('one-possession territory'))).toBe(true);
    const two = generatePlayByPlay(mk([80, 75]), [home, away], { seed: 'm40' });
    expect(two.some((l) => l.text.includes('a two-possession game'))).toBe(true);
    expect(two.some((l) => l.text.includes('one-possession'))).toBe(false);
  });

  it('halves rulesets narrate halves, not quarters (M-39)', async () => {
    const events = [
      { type: 'period_end', period: 1, t: 1200, wt: 1300, clock: 0, score: [40, 38] },
      { type: 'period_start', period: 2, t: 1201, wt: 1400, clock: 1200, score: [40, 38] }
    ] as GameEvent[];
    // periods: 2 (halves ruleset): prose says halves...
    const halves = generatePlayByPlay(events, [home, away], { seed: 'm39', periods: 2 });
    expect(halves[0]!.text).toContain('the end of the 1st half');
    expect(halves[1]!.text).toContain('2nd half under way');
    for (const l of halves) {
      expect(l.text).not.toContain('Q1');
      expect(l.text).not.toContain('Q2');
    }
    // ...and the script bracket uses the compact H label
    const cues = await buildBroadcastScript(events, [home, away], new TemplateColorProvider(), { seed: 'm39', periods: 2 });
    const script = formatScript(cues, 2);
    expect(script).toContain('[H1 ');
    expect(script).toContain('[H2 ');
    expect(script).not.toContain('[Q');
    // default 4-period rulesets keep the Q register
    const nba = generatePlayByPlay(events, [home, away], { seed: 'm39' });
    expect(nba[0]!.text).toContain('end of Q1');
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

  it('whitespace-padded names never render "undefined." or an empty actor (M-38)', () => {
    const padHome = structuredClone(home);
    const padAway = structuredClone(away);
    // trailing pad (old code: last name became '', an empty actor), leading
    // pad on a cross-roster collision (old code: initial from parts[0] ''
    // rendered "undefined. Vance"), and a padded mononym (guard must hold)
    padHome.players[0]!.name = ' Marcus Vance ';
    padAway.players[0]!.name = ' Eli  Vance';
    padHome.players[1]!.name = ' Cher ';
    const lk = makeLookup([padHome, padAway]);
    expect(lk.last(padHome.players[0]!.id)).toBe('M. Vance');
    expect(lk.last(padAway.players[0]!.id)).toBe('E. Vance');
    expect(lk.last(padHome.players[1]!.id)).toBe('Cher');
    expect(lk.name(padHome.players[0]!.id)).toBe('Marcus Vance');

    // and a rendered line stays clean end to end
    const shot = [{
      type: 'shot', team: 0, shooter: padHome.players[0]!.id, x: 5, y: 25, distFt: 2,
      zone: 'rim', three: false, moveType: 'drive', contest: 0.3, made: true, points: 2,
      t: 30, wt: 40, period: 1, clock: 690, score: [2, 0]
    }] as GameEvent[];
    const lines = generatePlayByPlay(shot, [padHome, padAway], { seed: 'm38' });
    expect(lines[0]!.text).toContain('M. Vance');
    expect(lines[0]!.text).not.toContain('undefined');
  });

  it('every milestone line states the true running total at that moment, over multiple seeds (H-08)', () => {
    // Independent probe fold: made shots + made free throws, nothing else.
    // Each player's total is recomputed straight from the raw events, the
    // 20/30/40/50 crossings located, and the rendered milestone line must
    // state EXACTLY that post-basket total — the old rendering stripped the
    // bar out of `detail` ("20+ points" -> "up to 20") and was wrong on
    // every crossing basket that overshot the bar (~half of all lines).
    let milestonesSeen = 0;
    for (const seed of ['pbp-1', 'h08-a', 'h08-b', 'h08-c']) {
      const res = seed === 'pbp-1' ? result : simulateGame({ seed, home, away, collectFrames: false });
      const lk = makeLookup([home, away]);
      const totals = new Map<string, number>();
      const barHit = new Map<string, number>();
      const expected: string[] = [];
      for (const e of res.events) {
        const scored =
          e.type === 'shot' && e.made ? { id: e.shooter, pts: e.points } :
          e.type === 'free_throw' && e.made ? { id: e.shooter, pts: 1 } :
          null;
        if (!scored) continue;
        const post = (totals.get(scored.id) ?? 0) + scored.pts;
        totals.set(scored.id, post);
        for (const bar of [20, 30, 40, 50]) {
          if (post >= bar && (barHit.get(scored.id) ?? 0) < bar) {
            barHit.set(scored.id, bar);
            expected.push(`${lk.name(scored.id)} is up to ${post} points tonight.`);
          }
        }
      }
      const lines = generatePlayByPlay(res.events, [home, away], { seed })
        .filter((l) => l.kind === 'moment' && l.text.includes('points tonight'))
        .map((l) => l.text);
      expect(lines).toEqual(expected);
      milestonesSeen += expected.length;
    }
    expect(milestonesSeen).toBeGreaterThanOrEqual(4); // vacuity floor across the seed set
  });

  it('broadcast script merges pbp and color voices in time order', async () => {
    const cues = await buildBroadcastScript(result.events, [home, away], new TemplateColorProvider(), { seed: 'pbp-1' });
    expect(cues.some((c) => c.speaker === 'color')).toBe(true);
    for (let i = 1; i < cues.length; i++) {
      expect(cues[i]!.t).toBeGreaterThanOrEqual(cues[i - 1]!.t);
    }
  });

  it('broadcast carries every narrative moment — lead changes and ties are narrated (M-37)', async () => {
    // The pipeline used to pass includeMoments: false while the color
    // provider deliberately deferred lead_change/tie to pbp's renderer, so
    // those beats (~12/game) were narrated by NOBODY. Probe: fold the same
    // events through a fresh tracker and demand a pbp-voice cue per beat.
    const cues = await buildBroadcastScript(result.events, [home, away], new TemplateColorProvider(), { seed: 'pbp-1' });
    const tracker = new ContextTracker(4);
    let leadOrTie = 0;
    for (const e of result.events) {
      for (const m of tracker.update(e)) {
        if (m.kind === 'lead_change' || m.kind === 'tie') leadOrTie++;
      }
    }
    expect(leadOrTie).toBeGreaterThan(0); // vacuity floor for the probe seed
    const leadCues = cues.filter((c) =>
      c.speaker === 'pbp' && (c.text.includes('take the lead.') || c.text.includes("We're tied at")));
    expect(leadCues.length).toBe(leadOrTie);
    // ...and nothing else got dropped on the way in: the broadcast's pbp
    // voice carries the full pbp feed, moment lines included
    const pbp = generatePlayByPlay(result.events, [home, away], { seed: 'pbp-1' });
    expect(cues.filter((c) => c.speaker === 'pbp').length).toBe(pbp.length);
  });
});
