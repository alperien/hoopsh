/**
 * The fitter's two-sided dunk-gate inversion (REGISTER W65): a season line
 * carrying real dunk volume must produce a vertical whose athlete blend
 * (0.6·vertical + 0.4·finishing, narration shotcall's DUNK_ATHLETE_SCORE
 * geometry) lands on the correct side of the 74 gate. Pure analytic-layer
 * units — no simulation, no refinement, deterministic.
 *
 * The three regimes:
 *   >= 0.3 dunks/g  — a real dunker; the blend must CLEAR the gate, with
 *                     volume-scaled margin (blend >= 76 + min(6, dunks·4)
 *                     unless the template already sat higher).
 *   <  0.15 dunks/g — a real non-dunker; the blend must stay UNDER 74 even
 *                     when a 90s finishing package would otherwise carry it
 *                     over (the false-dunk failure the ceiling exists for).
 *   0.15..0.3       — the boundary zone; the template+BLK nudge stands.
 *   absent          — pre-landing lines fit exactly as before.
 */
import { describe, expect, it } from 'vitest';
import { analyticFit, type SeasonLine } from '../src/fit-roster.js';

const GATE = 74;
const blend = (fit: ReturnType<typeof analyticFit>): number =>
  0.6 * fit.player.attr.vertical + 0.4 * fit.player.attr.finishing;

/** a plausible interior big: high rim diet, real finishing */
const big = (over?: Partial<SeasonLine>): SeasonLine => ({
  name: 'Test Big', pos: 'C', heightIn: 84, weightLb: 250, mpg: 28,
  pts: 14, reb: 9, ast: 2, stl: 0.6, blk: 1.8, tov: 1.8,
  fga: 10, fgPct: 0.62, tpa: 0.2, tpPct: 0.25, fta: 4, ftPct: 0.7,
  orb: 3, pf: 2.5,
  shotZones: { rimShare2: 0.75, midShare2: 0.05 },
  ...over
});

/** a finishing-heavy guard whose blend would false-dunk without the ceiling */
const guard = (over?: Partial<SeasonLine>): SeasonLine => ({
  name: 'Test Guard', pos: 'SG', heightIn: 75, weightLb: 190, mpg: 30,
  pts: 18, reb: 3, ast: 3, stl: 1.0, blk: 0.2, tov: 2.0,
  fga: 14, fgPct: 0.5, tpa: 6, tpPct: 0.38, fta: 4, ftPct: 0.88,
  orb: 0.5, pf: 2.0,
  shotZones: { rimShare2: 0.55, midShare2: 0.15 },
  ...over
});

describe('the dunk-gate inversion (fit-roster.ts vertical)', () => {
  it('a real dunker clears the gate, and heavier dunk diets clear it by more', () => {
    const low = analyticFit(big({ dunks: 0.3 }));
    const high = analyticFit(big({ dunks: 2.5 }));
    expect(blend(low)).toBeGreaterThanOrEqual(GATE + 2 - 1e-9);
    expect(blend(high)).toBeGreaterThanOrEqual(GATE + 2 + 6 - 1e-9); // margin caps at +6
    expect(high.player.attr.vertical).toBeGreaterThanOrEqual(low.player.attr.vertical);
    expect(high.player.attr.vertical).toBeLessThanOrEqual(97); // the fitter's own cap
  });

  it('the inversion is exact against the fitted finishing: blend = 76 + min(6, dunks*4) at the floor', () => {
    const fit = analyticFit(big({ dunks: 1.0 }));
    // floor-active case (the template big does not reach 80 on BLK alone).
    // The fitter rounds every dial to an integer, which can cost the blend
    // up to 0.6 of the analytic target — the +2 gate margin inside the
    // inversion exists precisely so rounding can never drop a dunker back
    // under 74. Assert the target within that documented epsilon.
    const target = 76 + Math.min(6, 1.0 * 4);
    expect(blend(fit)).toBeGreaterThanOrEqual(target - 0.61);
    expect(blend(fit)).toBeLessThanOrEqual(target + 4); // template can only push it a little past
    expect(blend(fit)).toBeGreaterThan(GATE); // and the gate itself is never in doubt
  });

  it('a real non-dunker stays under the gate even when the template blend would carry him over', () => {
    // the control proves the premise: WITHOUT the dunk field this exact
    // line blends over the gate (template vertical + finishing package),
    // so the booth would call his scramble layups dunks
    const control = analyticFit(guard());
    expect(blend(control)).toBeGreaterThanOrEqual(GATE);
    // the ceiling pulls the 0.05/g real non-dunker back under it
    const fit = analyticFit(guard({ dunks: 0.05 }));
    expect(blend(fit)).toBeLessThan(GATE);
  });

  it('the ceiling never produces a degenerate vertical', () => {
    // an absurdly high finishing inversion input: ceiling floors at 25
    const fit = analyticFit(guard({ fgPct: 0.75, dunks: 0.0, shotZones: { rimShare2: 0.9, midShare2: 0.02 } }));
    expect(fit.player.attr.vertical).toBeGreaterThanOrEqual(25);
  });

  it('the boundary zone and the absent field both leave the template fit untouched', () => {
    const noField = analyticFit(big());
    const boundary = analyticFit(big({ dunks: 0.2 }));
    expect(boundary.player.attr.vertical).toBe(noField.player.attr.vertical);
  });

  it('the provenance report names the inversion where it fires and the zone where it does not', () => {
    const dunker = analyticFit(big({ dunks: 1.5 }));
    const zone = analyticFit(big({ dunks: 0.2 }));
    const vRow = (f: typeof dunker) => f.sources.find((s) => s.dial === 'vertical');
    expect(vRow(dunker)?.detail).toContain('dunk-gate inversion');
    expect(vRow(zone)?.detail).toContain('boundary zone');
  });
});
