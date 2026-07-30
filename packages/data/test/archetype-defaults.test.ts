/**
 * Archetype builders (data/src/archetypes.ts): structural validity + the
 * documented signature dials.
 *
 * Two spec sources, cited per test: the per-archetype doc comments in
 * archetypes.ts (each names "the 2-3 ratings that most define that type")
 * and the catalog table in docs/ROSTERS.md ("The archetype catalog",
 * signature-dials column). The engine-side suite
 * (packages/engine/test/archetypes.test.ts) checks BEHAVIOR at season scale;
 * this file checks the fixtures themselves: every builder yields a
 * schema-valid player, and the identity dials those behavior tests hinge on
 * hold their documented values. Ratings here are hand-authored identity
 * anchors (docs/ROSTERS.md: "the calibrated reference points for what
 * numbers *mean*"), not SWEPT optimizer output — pinning them is the point:
 * archetypes.ts's own header warns a rating tweak "can silently change what
 * a passing archetype test means".
 *
 * Zero sims.
 */
import { describe, expect, it } from 'vitest';
import {
  ATTR_KEYS, benchBig, benchScorer, comboGuard, eliteShooter, floorGeneral,
  glueForward, HEIGHT_MAX_IN, HEIGHT_MIN_IN, POSITIONS, postAnchor,
  RATING_MAX, RATING_MIN, rimRunner, scoringWing, stretchBig, TEND_KEYS,
  threeAndD, toTeamPack, validateTeamPack
} from '@hoopsh/data';
import type { Player, Team } from '@hoopsh/engine';

// every builder in the catalog (docs/ROSTERS.md lists exactly these eleven)
const BUILDERS: [string, (who: { id: string; name: string }) => Player][] = [
  ['eliteShooter', eliteShooter], ['rimRunner', rimRunner],
  ['floorGeneral', floorGeneral], ['threeAndD', threeAndD],
  ['scoringWing', scoringWing], ['postAnchor', postAnchor],
  ['comboGuard', comboGuard], ['glueForward', glueForward],
  ['benchBig', benchBig], ['benchScorer', benchScorer],
  ['stretchBig', stretchBig]
];

describe('archetypes are schema-valid players', () => {
  it('every builder fills every attribute and tendency key with a 0-100 rating (archetypes.ts header: "All ratings are 0-100")', () => {
    // spec: archetypes.ts:14-18 — full Player via engine defaults, ratings
    // on the schema.ts scale; a key outside [0,100] or missing would make
    // the archetype-built packs below invalid
    for (const [name, fn] of BUILDERS) {
      const p = fn({ id: `arch-${name}`, name: `Arch ${name}` });
      expect(p.id).toBe(`arch-${name}`);
      expect(p.name).toBe(`Arch ${name}`);
      expect(POSITIONS).toContain(p.pos);
      expect(p.heightIn).toBeGreaterThanOrEqual(HEIGHT_MIN_IN);
      expect(p.heightIn).toBeLessThanOrEqual(HEIGHT_MAX_IN);
      expect(Number.isFinite(p.weightLb)).toBe(true);
      for (const k of ATTR_KEYS) {
        expect(p.attr[k]).toBeGreaterThanOrEqual(RATING_MIN);
        expect(p.attr[k]).toBeLessThanOrEqual(RATING_MAX);
      }
      for (const k of TEND_KEYS) {
        expect(p.tend[k]).toBeGreaterThanOrEqual(RATING_MIN);
        expect(p.tend[k]).toBeLessThanOrEqual(RATING_MAX);
      }
    }
  });

  it('a full-archetype roster passes validateTeamPack (schema.ts MIN_PLAYERS=8; the builders are the sanctioned roster-assembly kit)', () => {
    // spec: archetypes.ts header — "reusable ratings profiles for tests,
    // fixtures, and quick roster assembly"; assembling a pack from them must
    // satisfy the same schema hand-edited packs do
    const players = BUILDERS.map(([name, fn]) => fn({ id: `arch-${name}`, name: `Arch ${name}` }));
    const team: Team = {
      id: 'archetypes',
      name: 'Archetype XI',
      abbrev: 'ARC',
      players,
      starters: players.slice(0, 5).map((p) => p.id),
      tactics: { pace: 50, threeBias: 50, helpAggr: 50 }
    };
    expect(validateTeamPack(JSON.parse(JSON.stringify(toTeamPack(team))))).toEqual([]);
  });

  it('builders honor Named overrides and default the documented body (eliteShooter: PG 6\'2" 185, archetypes.ts:44-46; ROSTERS.md body column)', () => {
    const dflt = eliteShooter({ id: 'e1', name: 'Dee Fault' });
    expect(dflt.pos).toBe('PG');
    expect(dflt.heightIn).toBe(74);
    expect(dflt.weightLb).toBe(185);
    // `...who` spreads AFTER the body defaults — caller overrides win
    const custom = eliteShooter({ id: 'e2', name: 'Oh Verride', pos: 'SG', heightIn: 76, weightLb: 200 });
    expect(custom.pos).toBe('SG');
    expect(custom.heightIn).toBe(76);
    expect(custom.weightLb).toBe(200);
  });
});

describe('documented signature dials (docs/ROSTERS.md catalog table + archetypes.ts doc comments)', () => {
  it('eliteShooter: three 99, offBallMotion 90, pullUp 82 — "the unambiguous best three-point shooter in any roster"', () => {
    const p = eliteShooter({ id: 'a', name: 'A' });
    expect(p.attr.three).toBe(99);
    expect(p.tend.offBallMotion).toBe(90);
    expect(p.tend.pullUp).toBe(82);
  });

  it('floorGeneral: passVision 98, passAcc 97, decisions 95 — "THE passing archetype in the file"', () => {
    const p = floorGeneral({ id: 'a', name: 'A' });
    expect(p.attr.passVision).toBe(98);
    expect(p.attr.passAcc).toBe(97);
    expect(p.attr.decisions).toBe(95);
  });

  it('rimRunner: finishing 94, offReb 92, block 90, and shotThree tendency 1 — never shoots threes', () => {
    const p = rimRunner({ id: 'a', name: 'A' });
    expect(p.attr.finishing).toBe(94);
    expect(p.attr.offReb).toBe(92);
    expect(p.attr.block).toBe(90);
    expect(p.tend.shotThree).toBe(1);
  });

  it('threeAndD: perimeterD 90, three 82, pullUp 12 — spot-up shooter, lockdown wing', () => {
    const p = threeAndD({ id: 'a', name: 'A' });
    expect(p.attr.perimeterD).toBe(90);
    expect(p.attr.three).toBe(82);
    expect(p.tend.pullUp).toBe(12);
  });

  it('scoringWing: finishing 88, drawFoul 82 (highest in the file), iso 78', () => {
    const p = scoringWing({ id: 'a', name: 'A' });
    expect(p.attr.finishing).toBe(88);
    expect(p.attr.drawFoul).toBe(82);
    expect(p.tend.iso).toBe(78);
  });

  it('postAnchor: strength 90, post tendency 78 (highest post in the file), midRange 74 (the "soft touch")', () => {
    const p = postAnchor({ id: 'a', name: 'A' });
    expect(p.attr.strength).toBe(90);
    expect(p.tend.post).toBe(78);
    expect(p.attr.midRange).toBe(74);
  });

  it('stretchBig: three 76, shotThree 78, interiorD 84 — plays in space, not the paint', () => {
    const p = stretchBig({ id: 'a', name: 'A' });
    expect(p.attr.three).toBe(76);
    expect(p.tend.shotThree).toBe(78);
    expect(p.attr.interiorD).toBe(84);
  });

  it('benchScorer: pullUp 68, three 78, decisions 54 — the documented microwave trade-off', () => {
    const p = benchScorer({ id: 'a', name: 'A' });
    expect(p.tend.pullUp).toBe(68);
    expect(p.attr.three).toBe(78);
    expect(p.attr.decisions).toBe(54);
  });

  it('benchBig: boxout 82, block 78, three 8 — energy reserve, a tier below rimRunner by design', () => {
    const p = benchBig({ id: 'a', name: 'A' });
    expect(p.attr.boxout).toBe(82);
    expect(p.attr.block).toBe(78);
    expect(p.attr.three).toBe(8);
    // archetypes.ts:289-293 — "same rough shape (paint-bound big), clearly a
    // tier below": rimRunner's ceiling dials must stay strictly above
    const rr = rimRunner({ id: 'b', name: 'B' });
    expect(rr.attr.finishing).toBeGreaterThan(p.attr.finishing);
    expect(rr.attr.vertical).toBeGreaterThan(p.attr.vertical);
  });

  it('glueForward: perimeterD 70 + interiorD 72 (versatile), three 58; comboGuard has no standout elite trait (no attribute above 80)', () => {
    const g = glueForward({ id: 'a', name: 'A' });
    expect(g.attr.perimeterD).toBe(70);
    expect(g.attr.interiorD).toBe(72);
    expect(g.attr.three).toBe(58);
    // comboGuard doc comment: "no standout elite trait (contrast with
    // floorGeneral's 95+ passing or eliteShooter's 99 three) — that
    // flatness IS the archetype"
    const c = comboGuard({ id: 'b', name: 'B' });
    for (const k of ATTR_KEYS) expect(c.attr[k]).toBeLessThanOrEqual(80);
  });

  it('the documented contrasts hold: self-created vs spot-up threes; above-the-rim vs back-to-basket (ROSTERS.md "Contrasts are deliberate")', () => {
    // pullUp 82 vs 12 — eliteShooter creates his own three, threeAndD never does
    expect(eliteShooter({ id: 'a', name: 'A' }).tend.pullUp)
      .toBeGreaterThan(threeAndD({ id: 'b', name: 'B' }).tend.pullUp);
    // midRange 28 vs 74 — rimRunner dunks, postAnchor shoots turnarounds
    expect(rimRunner({ id: 'c', name: 'C' }).attr.midRange)
      .toBeLessThan(postAnchor({ id: 'd', name: 'D' }).attr.midRange);
  });

  it('gravity split around the dunker-spot threshold: stretchBig pulls his defender out, rimRunner does not (archetypes.ts:69-74, 350-355)', () => {
    // spec: both doc comments compute gravity = 0.65*three/100 +
    // 0.35*shotThree/100 (the sim/resolve.ts formula they cite): stretchBig
    // "≈ 0.77 ... exceeds the 0.42 threshold in ai.ts#assignSpots so
    // defenses cannot park him at the dunker spot"; rimRunner "≈ 0.08, i.e.
    // ... a total non-threat beyond ~15 feet"
    const gravity = (p: Player): number => 0.65 * (p.attr.three / 100) + 0.35 * (p.tend.shotThree / 100);
    expect(gravity(stretchBig({ id: 'a', name: 'A' }))).toBeGreaterThan(0.42);
    expect(gravity(rimRunner({ id: 'b', name: 'B' }))).toBeLessThan(0.42);
  });
});
