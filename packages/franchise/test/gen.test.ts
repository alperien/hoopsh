/**
 * Generation suite (people/gen.ts) - the draft-realism calibration guards
 * from the realism wave brief, encoded as property tests over a shared
 * 20-class corpus (one league, twenty consecutive seasons; PLAYBOOK Recipe
 * F: build once, assert many). Everything is seeded, so every number
 * asserted here is deterministic.
 *
 * Guards covered: age-talent correlation (the top of a class is young, the
 * back end senior), archetype attribute coherence on TRUE players,
 * measurable distributions, class strength waves, determinism (byte-equal
 * classes), pipeline flavor, and the draft flow end to end.
 */
import { describe, expect, it } from 'vitest';
import { ATTR_KEYS } from '@hoopsh/data';
import type { Position } from '@hoopsh/engine';
import { createLeague } from '../src/genesis.js';
import {
  abilityMean, classStrengthFor, generateDraftClass, generatePlayer,
} from '../src/people/gen.js';
import { BODY_BANDS, archetypeOf, archetypeById } from '../src/people/archetypes.js';
import { aiSelect } from '../src/ai/draftai.js';
import { streamRng } from '../src/rng.js';
import type { FrPlayer, League } from '../src/types.js';

// ---------------------------------------------------------------------------
// the corpus: one league, twenty classes

interface ClassSample { season: number; players: FrPlayer[] }

function buildCorpus(): { league: League; classes: ClassSample[] } {
  const league = createLeague({ seed: 'gen-guard', userTeam: 'cas' });
  const classes: ClassSample[] = [];
  for (let s = 0; s < 20; s++) {
    const season = league.season + s;
    league.draftClass = []; // each season opens a fresh board
    classes.push({ season, players: generateDraftClass(league, season) });
  }
  return { league, classes };
}

const { league, classes } = buildCorpus();
const ageOf = (c: ClassSample, p: FrPlayer): number => c.season - p.bornSeason;
const mean = (xs: number[]): number => xs.reduce((s, x) => s + x, 0) / xs.length;

function groupMeanOf(p: FrPlayer, keys: readonly (keyof FrPlayer['attr'])[]): number {
  let sum = 0;
  for (const k of keys) sum += p.attr[k];
  return sum / keys.length;
}
const PLAY = ['ballHandle', 'passAcc', 'passVision'] as const;
const SCORE = ['finishing', 'midRange', 'three', 'freeThrow', 'drawFoul'] as const;

// ---------------------------------------------------------------------------
// determinism and back-compat

describe('determinism', () => {
  it('same seed, same class, byte-equal JSON', () => {
    const again = createLeague({ seed: 'gen-guard', userTeam: 'cas' });
    const cls = generateDraftClass(again, again.season);
    expect(JSON.stringify(cls)).toBe(JSON.stringify(classes[0]!.players));
  });

  it('the class strength wave lives on its own stream: reading it never disturbs a class', () => {
    const a = createLeague({ seed: 'wave-iso', userTeam: 'cas' });
    const waveBefore = classStrengthFor(a.seed, a.season, a.params);
    const cls = generateDraftClass(a, a.season);
    const waveAfter = classStrengthFor(a.seed, a.season, a.params);
    expect(waveBefore).toBe(waveAfter);
    const b = createLeague({ seed: 'wave-iso', userTeam: 'cas' });
    expect(JSON.stringify(generateDraftClass(b, b.season))).toBe(JSON.stringify(cls));
  });
});

describe('back-compat surface', () => {
  it('generatePlayer keeps its (rng, opts) shape for legacy callers, pipeline optional', () => {
    const rng = streamRng('legacy-call', 'x');
    const p = generatePlayer(rng, { age: 17, season: 2026, quality: 55, idSeq: 9001, params: league.params });
    expect(p.id).toBe('p9001');
    expect(p.status).toBe('freeAgent');
    expect(p.bornSeason).toBe(2026 - 17);
    for (const k of ATTR_KEYS) {
      expect(Number.isInteger(p.attr[k])).toBe(true);
      expect(p.attr[k]).toBeGreaterThanOrEqual(0);
      expect(p.attr[k]).toBeLessThanOrEqual(100);
    }
    expect(archetypeOf(p)).not.toBe(null); // every generated player carries his identity
  });

  it('generateDraftClass registers the pool on the league and returns it', () => {
    const c0 = classes[0]!;
    expect(c0.players.length).toBe(league.params.gen.draftPoolSize);
    for (const p of c0.players) {
      expect(league.players[p.id]).toBe(p);
      expect(p.status).toBe('draftEligible');
      expect(p.contract).toBe(null);
    }
  });
});

// ---------------------------------------------------------------------------
// guard 1: age-talent correlation

describe('age-talent correlation', () => {
  it('the top 10 by true overall run at least 1.2 years younger than picks 45-60, over 20 classes', () => {
    const topAges: number[] = [];
    const backAges: number[] = [];
    for (const c of classes) {
      const ranked = [...c.players].sort((a, b) => abilityMean(b) - abilityMean(a));
      topAges.push(...ranked.slice(0, 10).map((p) => ageOf(c, p)));
      backAges.push(...ranked.slice(44, 60).map((p) => ageOf(c, p)));
    }
    expect(mean(backAges) - mean(topAges)).toBeGreaterThanOrEqual(1.2);
    expect(mean(topAges)).toBeLessThan(20.1); // the top of a class is one-and-done country
  });

  it('ages stay inside the eligibility window and freshmen outnumber the senior tail', () => {
    // The tail is the TRUE four-year tail (age 23), not the whole 22+
    // bucket: real one-and-done-era classes run senior-heavy across the
    // full pool (25-30% freshmen vs 30-40% seniors among 60 picks) while
    // freshmen own the lottery. The lottery youth pin lives in the gap
    // guard above; this one keeps the 23 tail a tail (REGISTER W79).
    let freshmen = 0;
    let tail = 0;
    for (const c of classes) {
      for (const p of c.players) {
        const a = ageOf(c, p);
        expect(a).toBeGreaterThanOrEqual(19);
        expect(a).toBeLessThanOrEqual(23);
        if (a === 19) freshmen++;
        if (a === 23) tail++;
      }
    }
    expect(freshmen).toBeGreaterThan(tail * 2);
  });

  it('a generational teenager is possible and a superstar-ceiling senior is rare', () => {
    let teenStars = 0;
    let seniorStars = 0;
    for (const c of classes) {
      for (const p of c.players) {
        const ceil = (p.potential.scoring + p.potential.playmaking + p.potential.defense) / 3;
        if (ceil >= 70 && ageOf(c, p) === 19) teenStars++;
        if (ceil >= 70 && ageOf(c, p) >= 22) seniorStars++;
      }
    }
    expect(teenStars).toBeGreaterThan(0);
    expect(seniorStars).toBeLessThan(teenStars / 2);
  });

  it('young prospects carry wider ceiling cones, older prospects higher floors', () => {
    const head19: number[] = [];
    const head22: number[] = [];
    for (const c of classes) {
      for (const p of c.players) {
        const cur = (groupMeanOf(p, SCORE) + groupMeanOf(p, PLAY)) / 2;
        const ceil = (p.potential.scoring + p.potential.playmaking) / 2;
        if (ageOf(c, p) === 19) head19.push(ceil - cur);
        else if (ageOf(c, p) >= 22) head22.push(ceil - cur);
      }
    }
    expect(mean(head19)).toBeGreaterThan(mean(head22) + 3); // the gap IS the draft's gamble
  });
});

// ---------------------------------------------------------------------------
// guard 2: archetype coherence on true players

describe('archetype coherence', () => {
  it('stamps every prospect with a catalog identity', () => {
    for (const c of classes) {
      for (const p of c.players) {
        const id = archetypeOf(p);
        expect(id).not.toBe(null);
        expect(archetypeById(id!)).toBeTruthy();
      }
    }
  });

  it('paint bigs never roll a live three-ball, in skill or appetite', () => {
    let seen = 0;
    for (const c of classes) {
      for (const p of c.players) {
        const id = archetypeOf(p);
        if (id !== 'rimRunnerBig' && id !== 'glassEater') continue;
        seen++;
        expect(p.attr.three).toBeLessThanOrEqual(45);
        expect(p.tend.shotThree).toBeLessThanOrEqual(12);
      }
    }
    expect(seen).toBeGreaterThan(40); // the guard actually sampled a population
  });

  it('floor generals are playmakers first; heliocentric creators demand the ball', () => {
    let fg = 0;
    let fgCoherent = 0;
    const helioUsage: number[] = [];
    const pestUsage: number[] = [];
    for (const c of classes) {
      for (const p of c.players) {
        const id = archetypeOf(p);
        if (id === 'floorGeneral') {
          fg++;
          if (groupMeanOf(p, PLAY) > groupMeanOf(p, SCORE)) fgCoherent++;
        }
        if (id === 'helioCreator') helioUsage.push(p.tend.usage);
        if (id === 'poaPest') pestUsage.push(p.tend.usage);
      }
    }
    expect(fg).toBeGreaterThan(20);
    expect(fgCoherent / fg).toBeGreaterThanOrEqual(0.85);
    // same quality machinery, different identities: creators hunt, pests do not
    expect(mean(helioUsage)).toBeGreaterThan(mean(pestUsage) + 10);
  });

  it('usage tracks class standing: the top of the board demands the offense', () => {
    const topUsage: number[] = [];
    const backUsage: number[] = [];
    for (const c of classes) {
      const ranked = [...c.players].sort((a, b) => abilityMean(b) - abilityMean(a));
      topUsage.push(...ranked.slice(0, 10).map((p) => p.tend.usage));
      backUsage.push(...ranked.slice(44, 60).map((p) => p.tend.usage));
    }
    expect(mean(topUsage)).toBeGreaterThan(mean(backUsage) + 20);
  });
});

// ---------------------------------------------------------------------------
// guard 3: measurables

describe('measurables', () => {
  const byPos: Record<Position, FrPlayer[]> = { PG: [], SG: [], SF: [], PF: [], C: [] };
  for (const c of classes) for (const p of c.players) byPos[p.pos].push(p);

  it('position height means hold the real bands', () => {
    for (const pos of ['PG', 'SG', 'SF', 'PF', 'C'] as const) {
      const hs = byPos[pos].map((p) => p.heightIn);
      expect(Math.abs(mean(hs) - BODY_BANDS[pos].hMean)).toBeLessThan(1.2);
    }
  });

  it('keeps every body possible: height, weight and wingspan inside the envelope', () => {
    for (const c of classes) {
      for (const p of c.players) {
        expect(p.heightIn).toBeGreaterThanOrEqual(60);
        expect(p.heightIn).toBeLessThanOrEqual(96);
        expect(p.weightLb).toBeGreaterThanOrEqual(160);
        expect(p.weightLb).toBeLessThanOrEqual(310);
        const delta = p.wingspanIn - p.heightIn;
        expect(delta).toBeGreaterThanOrEqual(-1);
        expect(delta).toBeLessThanOrEqual(11);
      }
    }
  });

  it('wingspan rides over height at the real league delta, with a live freak tail', () => {
    const deltas = classes.flatMap((c) => c.players.map((p) => p.wingspanIn - p.heightIn));
    expect(mean(deltas)).toBeGreaterThan(3.5);
    expect(mean(deltas)).toBeLessThan(6.0);
    const freaks = deltas.filter((d) => d >= 8).length;
    expect(freaks).toBeGreaterThan(0);
    expect(freaks / deltas.length).toBeLessThan(0.1);
  });

  it('weight tracks height up the positional ladder', () => {
    const w = (pos: Position): number => mean(byPos[pos].map((p) => p.weightLb));
    expect(w('C')).toBeGreaterThan(w('PF'));
    expect(w('PF')).toBeGreaterThan(w('SF'));
    expect(w('SF')).toBeGreaterThan(w('SG'));
    expect(w('SG')).toBeGreaterThan(w('PG'));
  });
});

// ---------------------------------------------------------------------------
// guard 4: class strength waves

describe('class strength waves', () => {
  it('every season carries a bounded wave and twenty seasons actually vary', () => {
    const waves = classes.map((c) => classStrengthFor(league.seed, c.season, league.params));
    for (const w of waves) {
      expect(w).toBeGreaterThanOrEqual(0.85);
      expect(w).toBeLessThanOrEqual(1.15);
    }
    expect(Math.max(...waves) - Math.min(...waves)).toBeGreaterThan(0.05);
  });

  it('a loaded class outguns a weak one at the top', () => {
    const scored = classes.map((c) => ({
      wave: classStrengthFor(league.seed, c.season, league.params),
      top5: mean([...c.players].sort((a, b) => abilityMean(b) - abilityMean(a)).slice(0, 5).map(abilityMean)),
    })).sort((a, b) => a.wave - b.wave);
    const weak3 = mean(scored.slice(0, 3).map((s) => s.top5));
    const loaded3 = mean(scored.slice(-3).map((s) => s.top5));
    expect(loaded3).toBeGreaterThan(weak3);
  });
});

// ---------------------------------------------------------------------------
// guard 5: pipeline flavor

describe('international pipeline', () => {
  it('hits the exact quota every season and skews young', () => {
    const expected = Math.round(league.params.gen.draftPoolSize * league.params.gen.intlShare);
    const intlAges: number[] = [];
    for (const c of classes) {
      const intl = c.players.filter((p) => p.origin === 'international');
      expect(intl.length).toBe(expected);
      intlAges.push(...intl.map((p) => ageOf(c, p)));
    }
    expect(mean(intlAges)).toBeLessThan(20.6);
    expect(intlAges.filter((a) => a >= 22).length / intlAges.length).toBeLessThan(0.12);
  });

  it('ships more skill bigs through the euro pipeline, as a nudge', () => {
    const skill = new Set(['stretchBig', 'postHub', 'pointForward', 'connectorWing']);
    let intlSkill = 0; let intlN = 0; let domSkill = 0; let domN = 0;
    for (const c of classes) {
      for (const p of c.players) {
        const isSkill = skill.has(archetypeOf(p) ?? '');
        if (p.origin === 'international') { intlN++; if (isSkill) intlSkill++; }
        else { domN++; if (isSkill) domSkill++; }
      }
    }
    expect(intlSkill / intlN).toBeGreaterThan(domSkill / domN);
    expect(intlSkill / intlN).toBeLessThan((domSkill / domN) * 2); // a lean, never a stereotype
  });
});

// ---------------------------------------------------------------------------
// guard 6: the draft flow end to end

describe('draft flow', () => {
  it('the AI drafts 60 unique prospects off a generated board without a stumble', () => {
    const flow = createLeague({ seed: 'gen-flow', userTeam: 'cas' });
    const cls = generateDraftClass(flow, flow.season);
    const board = cls.map((p) => p.id);
    const teams = Object.keys(flow.teams).sort();
    const picked: string[] = [];
    for (let pick = 0; pick < 60; pick++) {
      const id = aiSelect(flow, teams[pick % teams.length]!, board);
      picked.push(id);
      board.splice(board.indexOf(id), 1);
    }
    expect(picked.length).toBe(60);
    expect(new Set(picked).size).toBe(60);
    // the board orders on perception, not the truth, but it still finds
    // real talent: drafted prospects outrank the undrafted residue
    const draftedOvr = mean(picked.map((id) => abilityMean(flow.players[id]!)));
    const residueOvr = mean(board.map((id) => abilityMean(flow.players[id]!)));
    expect(draftedOvr).toBeGreaterThan(residueOvr);
  });

  it('potential never dips below current ability and never leaves the scale', () => {
    for (const c of classes) {
      for (const p of c.players) {
        for (const g of ['phys', 'scoring', 'playmaking', 'defense', 'rebounding', 'mental'] as const) {
          expect(p.potential[g]).toBeLessThanOrEqual(100);
          expect(p.potential[g]).toBeGreaterThanOrEqual(Math.floor(groupMeanOf(p, gKeys(g))));
        }
      }
    }
  });
});

/** Attribute keys per potential group, mirroring the types.ts contract comments. */
function gKeys(g: 'phys' | 'scoring' | 'playmaking' | 'defense' | 'rebounding' | 'mental'): readonly (keyof FrPlayer['attr'])[] {
  switch (g) {
    case 'phys': return ['speed', 'accel', 'strength', 'vertical', 'lateral', 'stamina'];
    case 'scoring': return SCORE;
    case 'playmaking': return PLAY;
    case 'defense': return ['perimeterD', 'interiorD', 'steal', 'block', 'contestSkill'];
    case 'rebounding': return ['offReb', 'defReb', 'boxout'];
    case 'mental': return ['decisions', 'consistency'];
  }
}
