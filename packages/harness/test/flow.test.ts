/**
 * Game-flow gates — the "arcs like basketball" tier (see harness/src/flow.ts
 * for the doctrine and data/nba/flow-reference.json for reference provenance).
 *
 * Ratchet policy (house convention): only metrics the engine CURRENTLY holds
 * are enforced, at generous first-pass widths sized for this test's small n
 * (they tighten once a proper noise-floor pass measures their sampling
 * spread). Metrics with KNOWN gaps stay in flow.ts's report and are NOT
 * gated here — gating them would just paint the suite red on documented
 * debt. The known gaps and where they wait:
 *   putback rate ~60% vs real ~33%     -> putback economy (REFACTOR.md D-register)
 *   steal->score 13% vs real ~29%      -> transition conversion (M4 adjacent)
 *   runs >=10-0 ~1.0 vs real ~1.8      -> momentum/consistency (STAGED attr, M4)
 *   clutch FT share ~20% vs real 35%+  -> endgame layer: no intentional fouling (M4)
 *   flat quarter profile               -> fatigue-arc/endgame pacing (M4)
 *
 * What IS gated below is real signal: leads that change hands, ties, 8-0
 * runs, droughts, and-one frequency, possession-length center, second-chance
 * share — a sim whose games stop trading runs or whose possessions all take
 * 20 seconds fails here even while every season-average band still passes.
 */

import { describe, expect, it } from 'vitest';
import { measureFlow } from '../src/flow.js';

const GAMES = 12; // speed tier; npm run flow owns precision at 48+

describe(`game-flow gates over ${GAMES} games`, () => {
  const m = measureFlow(GAMES, 'flowgate');

  it('the lead changes hands like a real game (not a wire-to-wire league)', () => {
    expect(m.leadChanges).toBeGreaterThanOrEqual(3);
    expect(m.leadChanges).toBeLessThanOrEqual(13);
  });

  it('games pass through ties at a real rate', () => {
    expect(m.ties).toBeGreaterThanOrEqual(2);
    expect(m.ties).toBeLessThanOrEqual(10);
  });

  it('teams trade 8-0 runs at a real per-game rate', () => {
    expect(m.runs8).toBeGreaterThanOrEqual(1.5);
    expect(m.runs8).toBeLessThanOrEqual(5.5);
  });

  it('scoring droughts exist and stay in the real range', () => {
    expect(m.maxDroughtSec).toBeGreaterThanOrEqual(120);
    expect(m.maxDroughtSec).toBeLessThanOrEqual(480);
  });

  it('largest lead lands in the real range (games separate, but not absurdly)', () => {
    expect(m.largestLead).toBeGreaterThanOrEqual(10);
    expect(m.largestLead).toBeLessThanOrEqual(30);
  });

  it('and-ones happen at the real per-game rate', () => {
    expect(m.andOnes).toBeGreaterThanOrEqual(2);
    expect(m.andOnes).toBeLessThanOrEqual(9);
  });

  it('median possession length sits in the real window', () => {
    expect(m.possP50).toBeGreaterThanOrEqual(9);
    expect(m.possP50).toBeLessThanOrEqual(17);
  });

  it('second-chance possessions occur at a plausible share', () => {
    expect(m.secondChanceShare).toBeGreaterThanOrEqual(0.06);
    expect(m.secondChanceShare).toBeLessThanOrEqual(0.28);
  });

  it('blown 10-point Q4 leads are possible but rare (comebacks exist, chaos does not)', () => {
    expect(m.comebackRate).toBeGreaterThanOrEqual(0);
    expect(m.comebackRate).toBeLessThanOrEqual(0.25);
  });
});
