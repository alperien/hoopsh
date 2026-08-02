/**
 * Id-space suite: the two-id-spaces invariant across the career/franchise
 * seam (issue #83; optimization audit, findings/career-circuits.md HIGH).
 *
 * The collapse this pins: enterDraftClass moves me (p9000) and the rival
 * (p9001) into league.players, lifting the league's scanned watermark to
 * 9001. Franchise generateDraftClass continues the 'p' sequence from a
 * league-only scan (people/gen.ts), so the first post-entry class minted
 * p9002..: the exact ids of my retained HS teammates. Every later abroad
 * build re-poisoned the next class the same way. The fix mints
 * circuit kids in the career-local 'c' alphabet (circuits.ts#nextIdSeq),
 * an id shape the league's scan structurally cannot produce, so the maps
 * stay disjoint with no watermark to maintain and no timing window.
 *
 * COMPUTE BUDGET: one real creation, two circuit builds, two draft
 * classes; no engine games. Built once at module load, asserted many.
 */
import { describe, expect, it } from 'vitest';
import { generateDraftClass, streamRng } from '@hoopsh/franchise';
import type { AttrGroup } from '@hoopsh/franchise';
import { createCareer } from '../src/creation.js';
import { buildCircuit } from '../src/circuits.js';
import { enterDraftClass } from '../src/stock.js';
import type { CreationSpec } from '../src/types.js';

/** Fourstar budget summing to exactly 110 (creation.test.ts's shape). */
const BUDGET: Record<AttrGroup, number> = {
  phys: 20, scoring: 22, playmaking: 16, defense: 22, rebounding: 15, mental: 15,
};

const SPEC: CreationSpec = {
  firstName: 'Dario',
  lastName: 'Kettles',
  nationality: 'us',
  birthplace: 'Toledo, Ohio',
  pos: 'SG',
  heightIn: 77,
  weightLb: 200,
  background: 'aau',
  preset: 'fourstar',
  budget: BUDGET,
  signatures: ['movement-shooter', 'three-and-d'],
};

const inter = (a: Record<string, unknown>, b: Record<string, unknown>): string[] =>
  Object.keys(a).filter((k) => b[k] !== undefined);

// --- built once, in career order: create, HS circuit, entry, the next
// league class, the abroad binding, a euro rebuild, the class after that.
const CAREER = createCareer({ seed: 'idspace-83', spec: SPEC });
const YEAR = CAREER.clock.year;

const HS = buildCircuit(CAREER, 'hs', streamRng(CAREER.seed, 'career-circuit', YEAR, 'hs'));
CAREER.circuit = HS;
const HS_ROSTER_TOTAL = HS.teams.reduce((n, t) => n + t.roster.length, 0);
const HS_KIDS = Object.keys(CAREER.players).filter((id) => id !== CAREER.me && id !== CAREER.rivalId);
const PRE_ENTRY_ME_HOME = CAREER.players[CAREER.me] !== undefined;

enterDraftClass(CAREER);
const CLASS1 = generateDraftClass(CAREER.league, CAREER.league.season + 1);
const INTER_AFTER_CLASS1 = inter(CAREER.players, CAREER.league.players);
const CLASS1_STOMPS = CLASS1.filter((p) => CAREER.players[p.id] !== undefined);

// the descent: an abroad phase holds me as one object in BOTH maps
// (nbabridge.ts#applyAbroadOffer's dual-pool binding, the documented trap)
CAREER.players[CAREER.me] = CAREER.league.players[CAREER.me]!;
const EURO = buildCircuit(CAREER, 'euro', streamRng(CAREER.seed, 'career-circuit', YEAR + 4, 'euro'));
const KNOWN = new Set([...HS_KIDS, CAREER.me]);
const EURO_KIDS = Object.keys(CAREER.players).filter((id) => !KNOWN.has(id));
const EURO_KIDS_IN_LEAGUE = EURO_KIDS.filter((id) => CAREER.league.players[id] !== undefined);

const CLASS2 = generateDraftClass(CAREER.league, CAREER.league.season + 2);
const CLASS2_STOMPS = CLASS2.filter((p) => CAREER.players[p.id] !== undefined);
const INTER_AFTER_CLASS2 = inter(CAREER.players, CAREER.league.players);

describe('career-local id alphabet (issue #83)', () => {
  it('me and the rival are the only career-born p ids, at the entry pair zone', () => {
    expect(CAREER.me).toBe('p9000');
    expect(CAREER.rivalId).toBe('p9001');
    expect(PRE_ENTRY_ME_HOME).toBe(true);
  });

  it('every circuit kid mints in the c alphabet, never in the league sequence', () => {
    expect(HS_KIDS.length).toBe(HS_ROSTER_TOTAL - 2); // every roster slot but me and the rival is a minted kid
    const offAlphabet = [...HS_KIDS, ...EURO_KIDS].filter((id) => !/^c\d{4,}$/.test(id));
    expect(offAlphabet).toEqual([]);
  });
});

describe('the standard path: draft entry, then the next league class', () => {
  it('entry moves me and the rival into league.players under their own ids', () => {
    expect(CAREER.league.players[CAREER.me]).toBeTruthy();
    expect(CAREER.league.players[CAREER.rivalId]).toBeTruthy();
  });

  it('the first post-entry class continues the p sequence into free space', () => {
    // p9002 was the first stomped teammate id in the filed finding; with
    // kids in the c alphabet it is exactly where the league resumes
    expect(CLASS1[0]!.id).toBe('p9002');
  });

  it('the first post-entry class mints no retained career id', () => {
    expect(CLASS1_STOMPS).toEqual([]);
  });

  it('the two maps hold disjoint key sets after the class lands', () => {
    expect(INTER_AFTER_CLASS1).toEqual([]);
  });
});

describe('the abroad rebuild: the re-poison direction', () => {
  it('a post-entry euro build mints kids disjoint from league.players', () => {
    expect(EURO_KIDS.length).toBeGreaterThan(0);
    expect(EURO_KIDS_IN_LEAGUE).toEqual([]);
  });

  it('the euro build extends the c sequence without reusing an HS id', () => {
    // a reused key would silently overwrite its kid: conservation of map
    // size is the cheapest witness that every mint was fresh
    expect(Object.keys(CAREER.players).length).toBe(HS_KIDS.length + EURO_KIDS.length + 1); // + me, the dual-pool binding
  });

  it('the class after the euro build mints no retained career id', () => {
    expect(CLASS2_STOMPS).toEqual([]);
  });

  it('the maps stay disjoint except me, the documented abroad binding', () => {
    expect(INTER_AFTER_CLASS2).toEqual([CAREER.me]);
  });
});
