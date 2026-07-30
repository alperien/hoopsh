/**
 * Spec-derived tests for geometry/court.ts under multiple rule packs.
 * geometry.test.ts pins NBA classification from the low-x rim only; this file
 * covers what it leaves open: makeCourt's rim placement, the high-x rim
 * mirror, the exact corner-break boundary, NCAA/EuroLeague three-point
 * geometry (rulepack data, not code — rulepack.ts:1-16), and the documented
 * spacingSpots layout. Existing pack-constant rows are pinned by
 * ncaa-rules.test.ts and are deliberately NOT re-asserted here — packs are
 * read as inputs. All coordinates sit on a quarter-foot grid (or are derived
 * from pack fields by exact-in-IEEE subtractions) so `toBe` holds without a
 * float-tolerance matcher.
 */
import { describe, expect, it } from 'vitest';
import {
  EUROLEAGUE, NBA, NCAA, classifyShot, makeCourt, type RulePack, type V2
} from '@hoopsh/engine';
import { spacingSpots } from '../src/geometry/court.js';

describe('makeCourt derives everything from pack data', () => {
  // spec: geometry/court.ts:17-23 + 33-53 — rims are fixed in world space at
  // (rimInsetFt, width/2) and (length - rimInsetFt, width/2); midX/centerY
  // are the court center. NBA numbers are REAL rule-book facts
  // (rulepack.ts:117-121: 94x50 ft court, 5.25 ft rim inset) and pinnable.
  it('NBA: rims sit 5.25 ft inside each baseline on the center line', () => {
    const court = makeCourt(NBA);
    expect(court.length).toBe(94);
    expect(court.width).toBe(50);
    expect(court.midX).toBe(47);
    expect(court.centerY).toBe(25);
    expect(court.rims[0]).toEqual({ x: 5.25, y: 25 });
    expect(court.rims[1]).toEqual({ x: 88.75, y: 25 });
    // the documented orientation: rims[0] is ALWAYS the low-x basket
    expect(court.rims[0].x).toBeLessThan(court.rims[1].x);
  });

  it('EuroLeague: the smaller FIBA floor moves both rims accordingly', () => {
    // read the FIBA dimensions off the pack rather than re-pinning them
    // (pack rows are ncaa-rules.test.ts territory)
    const court = makeCourt(EUROLEAGUE);
    expect(court.length).toBe(EUROLEAGUE.courtLengthFt);
    expect(court.width).toBe(EUROLEAGUE.courtWidthFt);
    expect(court.centerY).toBe(EUROLEAGUE.courtWidthFt / 2);
    expect(court.rims[0].x).toBe(EUROLEAGUE.rimInsetFt);
    expect(court.rims[1].x).toBe(EUROLEAGUE.courtLengthFt - EUROLEAGUE.rimInsetFt);
  });

  it('a custom pack is data, not code: an 80-ft rec court repositions the rims', () => {
    // spec: rulepack.ts:1-4 ("Custom leagues are just JSON") — no code path
    // switches on pack id, so a never-shipped court length must work.
    const rec: RulePack = { ...NBA, id: 'rec-80', name: 'Rec 80', courtLengthFt: 80 };
    const court = makeCourt(rec);
    expect(court.midX).toBe(40);
    expect(court.rims[0]).toEqual({ x: 5.25, y: 25 });
    expect(court.rims[1]).toEqual({ x: 74.75, y: 25 }); // 80 - 5.25 ft inset
  });
});

describe('NBA corner-vs-arc branch at the exact break (rims[0])', () => {
  // spec: geometry/court.ts:61-92 — within cornerBreakFt (14 ft NBA) of the
  // baseline, three-ness is a pure LATERAL check (>= cornerDistFt, 22 ft);
  // beyond the break it switches to the radial arcRadiusFt (23.75 ft) check.
  // The points below straddle the seam where the two rules disagree, which
  // is what makes each side of the boundary falsifiable.
  const court = makeCourt(NBA);
  const rim = court.rims[0];

  it('exactly ON the break, exactly ON the corner line: a three (both bounds inclusive)', () => {
    // 14 ft from the baseline, 22 ft lateral: radially this is only
    // ~23.68 ft (inside the 23.75 arc), so ONLY the corner rule makes it a
    // three — a `<` slip on the break or a `>` slip on the line goes red here
    const loc = classifyShot(NBA, court, rim, { x: 14, y: 3 });
    expect(loc.three).toBe(true);
    expect(loc.zone).toBe('three');
  });

  it('on the break but a tenth inside the corner line: a two', () => {
    // same 14 ft from baseline, lateral 21.9 ft < 22 ft corner line
    const loc = classifyShot(NBA, court, rim, { x: 14, y: 3.1 });
    expect(loc.three).toBe(false);
    expect(loc.zone).toBe('mid');
  });

  it('a tenth past the break the ARC takes over: same lateral 22 ft is now a two', () => {
    // 14.1 ft from baseline switches to the radial rule: hypot(8.85, 22)
    // ~ 23.71 ft < 23.75 ft arc -> two, even though the lateral distance
    // still clears the corner line
    const loc = classifyShot(NBA, court, rim, { x: 14.1, y: 3 });
    expect(loc.three).toBe(false);
  });
});

describe('non-three zone boundaries and distFt', () => {
  // spec: geometry/court.ts:94-106 — zones split by raw rim distance:
  // <= 4 ft 'rim' (point-blank), <= 14 ft 'paint', else 'mid'; distFt is the
  // euclidean rim distance. geometry.test.ts probes one interior point per
  // zone; the boundaries themselves live here.
  const court = makeCourt(NBA);
  const rim = court.rims[0];
  const straightOn = (distFt: number): V2 => ({ x: rim.x + distFt, y: court.centerY });

  it('exactly 4 ft is still the rim zone, a quarter-foot more is paint', () => {
    expect(classifyShot(NBA, court, rim, straightOn(4)).zone).toBe('rim');
    expect(classifyShot(NBA, court, rim, straightOn(4.25)).zone).toBe('paint');
  });

  it('exactly 14 ft is still paint, a quarter-foot more is mid', () => {
    expect(classifyShot(NBA, court, rim, straightOn(14)).zone).toBe('paint');
    expect(classifyShot(NBA, court, rim, straightOn(14.25)).zone).toBe('mid');
  });

  it('distFt reports the euclidean rim distance', () => {
    expect(classifyShot(NBA, court, rim, straightOn(4)).distFt).toBe(4);
    // 3-4-5 triangle off the rim: exact under IEEE
    expect(classifyShot(NBA, court, rim, { x: rim.x + 3, y: court.centerY + 4 }).distFt).toBe(5);
  });
});

describe('the high-x rim mirrors the low-x rim exactly', () => {
  // spec: geometry/court.ts:82-84 — distFromBaseline flips to
  // (court.length - p.x) for the high-x rim. No existing test classifies
  // from rims[1]; a sign/mirror slip would misclassify every second-half
  // corner three for whichever team attacks high-x.
  const court = makeCourt(NBA);
  const [rimLo, rimHi] = court.rims;

  // (dx toward midcourt, dy off the center line) — every NBA case class:
  // ATB three, long two, corner three both sides, break boundary, rim,
  // paint, mid. Quarter-foot grid keeps both sides bit-identical.
  const cases: Array<[number, number]> = [
    [24, 0], [23, 0], [2.75, 22.5], [2.75, -22.5], [22, 0], [8.75, 22],
    [2, 0], [9, 0], [17, 0]
  ];

  it('classification (three, zone, distFt) is identical from either end', () => {
    for (const [dx, dy] of cases) {
      const lo = classifyShot(NBA, court, rimLo, { x: rimLo.x + dx, y: court.centerY + dy });
      const hi = classifyShot(NBA, court, rimHi, { x: rimHi.x - dx, y: court.centerY + dy });
      expect(hi.three).toBe(lo.three);
      expect(hi.zone).toBe(lo.zone);
      expect(hi.distFt).toBe(lo.distFt);
    }
  });

  it('sanity: the mirrored corner three really is a three from the high-x rim', () => {
    // the case a broken mirror is most likely to flip: deep corner, where
    // distFromBaseline read as p.x would be ~86 ft and force the arc rule
    const loc = classifyShot(NBA, court, rimHi, { x: rimHi.x - 2.75, y: court.centerY - 22.5 });
    expect(loc.three).toBe(true);
  });
});

describe('NCAA pack: shorter arc, much shallower corner break', () => {
  // spec: geometry/court.ts:82-92 (the branch reads rules.three.*) +
  // rulepack.ts:161-164 — NCAA men: 22.15 ft arc, 21.65 ft corner line,
  // 9.85 ft break (NBA: 23.75 / 22 / 14). Same court footprint as the NBA,
  // so any classification difference below is PURELY pack data.
  const ncaaCourt = makeCourt(NCAA);
  const nbaCourt = makeCourt(NBA);
  const rimN = ncaaCourt.rims[0];
  const rimB = nbaCourt.rims[0];

  it('a 22.5-ft straight-on shot is a three under NCAA, a long two under NBA', () => {
    const pN: V2 = { x: rimN.x + 22.5, y: ncaaCourt.centerY };
    expect(classifyShot(NCAA, ncaaCourt, rimN, pN).three).toBe(true); // 22.5 >= 22.15 arc
    expect(classifyShot(NBA, nbaCourt, rimB, pN).three).toBe(false); // 22.5 < 23.75 arc
    expect(classifyShot(NBA, nbaCourt, rimB, pN).zone).toBe('mid');
  });

  it('12 ft off the baseline the packs use DIFFERENT rules for the same spot', () => {
    // 12 ft from baseline, 21.7 ft lateral (radially ~22.73 ft from the rim):
    //  - NBA: still corner territory (12 <= 14) -> lateral 21.7 < 22 -> two
    //  - NCAA: past its 9.85 ft break -> arc rule -> 22.73 >= 22.15 -> three
    // One spot, opposite calls, purely because the break moved.
    const p: V2 = { x: 12, y: 3.3 };
    expect(classifyShot(NBA, nbaCourt, rimB, p).three).toBe(false);
    expect(classifyShot(NCAA, ncaaCourt, rimN, p).three).toBe(true);
  });

  it('inside 9.85 ft NCAA still plays the straight corner line', () => {
    // 8 ft from baseline, 21.7 ft lateral: radially only ~21.87 ft — INSIDE
    // the 22.15 arc — so this three exists only because the corner rule is
    // live in the shallow region
    expect(classifyShot(NCAA, ncaaCourt, rimN, { x: 8, y: 3.3 }).three).toBe(true);
    // a tenth inside the 21.65 ft corner line: back to a two
    const inside = classifyShot(NCAA, ncaaCourt, rimN, { x: 8, y: 3.4 });
    expect(inside.three).toBe(false);
    expect(inside.zone).toBe('mid');
  });
});

describe('EuroLeague pack: FIBA geometry on the FIBA floor (high-x rim)', () => {
  // spec: rulepack.ts:196-211 (28m x 15m court, 5.15 ft inset, same
  // 22.15/21.65/9.85 three-point line as NCAA) + court.ts:82-92. Classifying
  // from rims[1] exercises the mirror on a court whose length is NOT 94 ft.
  const court = makeCourt(EUROLEAGUE);
  const rim = court.rims[1];

  it('a 22.25-ft straight-on shot: three under FIBA arc, two under NBA arc', () => {
    const p: V2 = { x: rim.x - 22.25, y: court.centerY };
    expect(classifyShot(EUROLEAGUE, court, rim, p).three).toBe(true); // 22.25 >= 22.15
    // same distance from the NBA rim on the NBA floor: a long two
    const nbaCourt = makeCourt(NBA);
    const pNba: V2 = { x: nbaCourt.rims[0].x + 22.25, y: nbaCourt.centerY };
    expect(classifyShot(NBA, nbaCourt, nbaCourt.rims[0], pNba).three).toBe(false);
  });

  it('a straight-on 22-footer stays a two: the arc is 22.15 ft, not shorter', () => {
    const loc = classifyShot(EUROLEAGUE, court, rim, { x: rim.x - 22, y: court.centerY });
    expect(loc.three).toBe(false);
    expect(loc.zone).toBe('mid');
  });

  it('the shallow FIBA corner works from the high-x end', () => {
    // 8 ft from the HIGH-x baseline (inside the 9.85 ft break), 21.7 ft
    // lateral >= the 21.65 ft corner line -> three, though radially ~21.89 ft
    // sits inside the 22.15 arc. Mirror + pack data in one shot.
    const p: V2 = { x: court.length - 8, y: court.centerY - 21.7 };
    expect(classifyShot(EUROLEAGUE, court, rim, p).three).toBe(true);
  });
});

describe('spacingSpots — the documented 5-out halfcourt template', () => {
  // spec: geometry/court.ts:109-149 — 11 named REAL basketball spots:
  // top/wings behind the arc, corners just INSIDE the corner line (the
  // documented junk-corner-2, court.ts:174 D3 note), elbows on the canonical
  // 16-footer, dunker a step outside the lane. Asserted for BOTH rims since
  // the layout mirrors through `dir` (court.ts:153).
  const court = makeCourt(NBA);

  it('ships exactly the 11 documented spot keys', () => {
    const keys = spacingSpots(court, court.rims[0]).map((s) => s.key).sort();
    expect(keys).toEqual([
      'corner_l', 'corner_r', 'dunker', 'elbow_l', 'elbow_r',
      'post_l', 'post_r', 'short_roll', 'top', 'wing_l', 'wing_r'
    ]);
  });

  for (const rimIdx of [0, 1] as const) {
    describe(`attacking rims[${rimIdx}]`, () => {
      const rim = court.rims[rimIdx];
      const spots = new Map(spacingSpots(court, rim).map((s) => [s.key, s.pos]));
      const at = (key: string) => classifyShot(NBA, court, rim, spots.get(key)!);

      it('top and both wings are three-point spots', () => {
        // top: 26 ft out, deliberately beyond the 23.75 ft arc so the
        // primary handler starts as a three-point threat (court.ts:122-126)
        expect(at('top').three).toBe(true);
        expect(at('wing_l').three).toBe(true);
        expect(at('wing_r').three).toBe(true);
      });

      it('corners sit just INSIDE the 22 ft line: mid-range twos by design', () => {
        // 21.5 ft lateral vs the 22 ft corner line — the documented
        // junk-corner-2 trade-off (court.ts:130-133, 167-174)
        for (const key of ['corner_l', 'corner_r']) {
          const loc = at(key);
          expect(loc.three).toBe(false);
          expect(loc.zone).toBe('mid');
        }
      });

      it('elbows are the canonical 16-footer: dx 14 / dy 8 exactly, ~16.1 ft out', () => {
        // spec: court.ts:180-188 — "dx 14 puts the spot sqrt(14² + 8²) ≈
        // 16.1 ft from the rim, the canonical 16-footer (was dx 16 ≈ 17.9 ft
        // while the spots sat unconsumed; the mid-pop supply line made the
        // distance load-bearing)". The former 14-19.5 band ADMITTED that
        // exact documented regression (17.9 ft sits inside it) — it only
        // died via an incidental seed coupling downstream. Pin the spot
        // itself: one step up-court of the 13.75 ft FT line (ftLineFt 19 −
        // rimInsetFt 5.25) on the ±8 ft lane line, so 19.25/74.75 in world
        // x, and a distance band that excludes 17.9.
        const elbowX = rimIdx === 0 ? 19.25 : 74.75; // rim.x ± 14
        expect(spots.get('elbow_l')).toEqual({ x: elbowX, y: 17 }); // cy - 8
        expect(spots.get('elbow_r')).toEqual({ x: elbowX, y: 33 }); // cy + 8
        for (const key of ['elbow_l', 'elbow_r']) {
          const loc = at(key);
          expect(loc.distFt).toBeGreaterThan(16); // sqrt(260) ~ 16.12
          expect(loc.distFt).toBeLessThan(16.25); // dx 16 -> 17.89 dies HERE
          expect(loc.zone).toBe('mid');
        }
      });

      it('the dunker spot hovers ~9.9 ft out in the paint, clear of the drive lane', () => {
        // court.ts:134-141 — 4 ft up-court, 9 ft lateral: a lob threat a
        // step outside the lane, not the textbook baseline spot
        const loc = at('dunker');
        expect(loc.distFt).toBeGreaterThan(9);
        expect(loc.distFt).toBeLessThan(10.5);
        expect(loc.zone).toBe('paint');
      });
    });
  }
});
