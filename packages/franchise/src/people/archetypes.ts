/**
 * people/archetypes.ts - the franchise archetype catalog. OWNER: genesis
 * task (draft realism wave). NEW in this wave.
 *
 * Design law (docs/FRANCHISE.md section 5, owner brief): a generated
 * player is a basketball IDENTITY first and a bag of dials second. Every
 * player draws one archetype; the archetype supplies a full attribute
 * template (what the identity CAN do), a full tendency template (what it
 * WANTS to do), a physical build bias, and position eligibility. Levels
 * then move together under a single quality shift, so a star rim runner
 * and a fringe rim runner share a shape and differ in class. Noise is
 * bounded and split into a per-group draw plus a per-dial draw, so group
 * structure (the identity) survives mutation while individual dials still
 * vary. Signature negatives are protected by absolute caps: a rim-running
 * big can never roll a live three-ball, whatever the dice say.
 *
 * Fifteen archetypes cover the modern positional spectrum. Templates are
 * authored on the same 0-100 scale as @hoopsh/data's calibrated builders
 * and at a comparable center of mass, so the W59 quality recentering keeps
 * meaning: quality ~60 stays a rotation-grade profile out of the box.
 *
 * Determinism: every draw flows through the caller's Rng with a FIXED
 * draw count per helper (selection 1, body 5, identity 1 per group + 1 per
 * attribute + 1 per tendency). Gaussian noise is clamped to +-2 sd so a
 * single tail draw can never break an identity.
 */
import { clamp } from '@hoopsh/engine';
import type { Attributes, Position, Rng, Tendencies } from '@hoopsh/engine';
import { ATTR_KEYS, TEND_KEYS } from '@hoopsh/data';
import type { AttrGroup, FrPlayer } from '../types.js';
import { ATTR_GROUPS } from './dev.js';

// ---------------------------------------------------------------------------
// vocabulary

/** Archetype ids: string union by runtime law (no enums under type stripping). */
export type ArchetypeId =
  | 'helioCreator' | 'floorGeneral' | 'pullUpSniper' | 'poaPest' | 'comboScorer'
  | 'slasher' | 'threeAndDWing' | 'connectorWing' | 'wingStopper' | 'pointForward'
  | 'rimRunnerBig' | 'stretchBig' | 'postHub' | 'glassEater' | 'switchBig';

/** Physical build bias relative to the positional body band. */
export interface BodyBias {
  /** inches added to the position's mean height. FEEL per archetype. */
  heightBias: number;
  /** inches added to the wingspan-over-height delta mean. FEEL per archetype. */
  wingBias: number;
  /** pounds added to the height-implied weight. FEEL per archetype. */
  weightBias: number;
}

export interface Archetype {
  id: ArchetypeId;
  /** dry role phrase for player cards and scouting memos */
  label: string;
  /** position eligibility weights; absent position = never plays there */
  pos: Partial<Record<Position, number>>;
  /** attribute template at the archetype's own anchor level (0-100) */
  attr: Attributes;
  /** tendency template; appetite, never quality-shifted */
  tend: Tendencies;
  /**
   * Noise multiplier per attribute group. FEEL: groups where the same
   * identity honestly varies in the real league (a shot creator's defense
   * spans matador to solid) get > 1; identity cores stay at 1.
   */
  groupSpread: Partial<Record<AttrGroup, number>>;
  /** absolute ceilings on signature-negative dials, applied after all rolls */
  caps: Partial<Record<keyof Attributes, number>>;
  /** absolute ceilings on signature-negative tendencies */
  tendCaps: Partial<Record<keyof Tendencies, number>>;
  body: BodyBias;
  /**
   * How strongly star-grade quality pulls toward this identity, -1..1.
   * FEEL: the modern league's stars are creators, hubs and jumbo initiators;
   * pests, glue men and pure glass eaters top out as role players.
   */
  starAffinity: number;
  /**
   * International pipeline multiplier on selection weight. FEEL, kept mild
   * (0.8-1.4): the euro pipeline ships more skill bigs and connectors,
   * fewer point-of-attack burners. A nudge, never a stereotype gate.
   */
  intlWeight: number;
}

// ---------------------------------------------------------------------------
// selection and sampling constants (module scope, provenance-tagged)

const AFFINITY_PIVOT = 55;   // CAL: quality where star affinity is neutral (the generated-league center of mass)
const AFFINITY_SCALE = 20;   // FEEL: quality points per e-fold of affinity tilt; 80-quality tilts a +0.9 archetype ~3x
const NOISE_CLAMP_SDS = 2;   // FEEL: bounded gaussian - identity survives the dice by construction
const GROUP_NOISE_SHARE = 0.55; // FEEL: share of mutation sd drawn once per group (moves the group together)
const ATTR_NOISE_SHARE = 0.75;  // FEEL: share drawn per dial; 0.55^2 + 0.75^2 ~ 0.87 of the legacy per-dial variance
export const QUALITY_GAIN = 0.8; // FEEL: how far quality drags the whole profile; below 1 so archetype shape dominates
const RATING_LO = 1;         // FEEL: generated dials avoid the absolute 0 rail
const RATING_HI = 99;        // FEEL: 99 is the unambiguous best (ROSTERS.md); generation never mints a 100

// ---------------------------------------------------------------------------
// positional body bands
//
// REAL-ish: modern-league positional averages (PG ~6'2.5" / 188 cm, C
// ~7'0" / 211 cm) with clamps well inside the engine's 60-96 validation
// bounds. Weight bases are the matching positional averages in pounds.

interface BodyBand {
  hMean: number; hSd: number; hLo: number; hHi: number;
  /** weight at the position's mean height, pounds */
  wBase: number;
}

export const BODY_BANDS: Record<Position, BodyBand> = {
  PG: { hMean: 74.5, hSd: 1.8, hLo: 70, hHi: 79, wBase: 190 },
  SG: { hMean: 77.0, hSd: 1.6, hLo: 73, hHi: 81, wBase: 205 },
  SF: { hMean: 79.5, hSd: 1.5, hLo: 76, hHi: 83, wBase: 220 },
  PF: { hMean: 81.5, hSd: 1.5, hLo: 78, hHi: 85, wBase: 235 },
  C: { hMean: 83.5, hSd: 1.7, hLo: 80, hHi: 89, wBase: 252 },
};

const LB_PER_INCH = 6;       // REAL-ish: taller frames carry ~6 lb per extra inch across the league
const WEIGHT_SD = 9;         // FEEL: build variance at a given height (wiry vs sturdy)
const WEIGHT_LO = 160;       // FEEL: lighter than any modern pro
const WEIGHT_HI = 310;       // FEEL: heavier than any modern rotation player
const WING_DELTA_MEAN = 4.5; // REAL-ish: league wingspan exceeds height by ~4-5 inches (11-12 cm) on average
const WING_DELTA_SD = 1.8;   // FEEL: even-wingspan guards to condor arms
const WING_DELTA_LO = -1;    // FEEL: negative ape index is rare and never extreme (genesis suite pins height - 1)
const WING_DELTA_HI = 7;     // FEEL: the ordinary condor tail before the freak roll
const WING_FREAK_P = 0.03;   // REAL-ish: combine freaks (+8 in and beyond) are a few percent of the league
const WING_FREAK_LO = 1.5;   // FEEL: freak bonus range, inches
const WING_FREAK_HI = 3.5;   // FEEL: total delta caps at +10.5 in (~+27 cm), the edge of recorded reality
const HEIGHT_ARCH_SD_MULT = 1; // FEEL: archetypes bias the mean, not the spread, in v1

// ---------------------------------------------------------------------------
// the catalog

function A(
  id: ArchetypeId, label: string, pos: Archetype['pos'],
  attr: Attributes, tend: Tendencies,
  extra: {
    groupSpread?: Archetype['groupSpread'];
    caps?: Archetype['caps'];
    tendCaps?: Archetype['tendCaps'];
    body?: Partial<BodyBias>;
    starAffinity?: number;
    intlWeight?: number;
  },
): Archetype {
  return {
    id, label, pos, attr, tend,
    groupSpread: extra.groupSpread ?? {},
    caps: extra.caps ?? {},
    tendCaps: extra.tendCaps ?? {},
    body: { heightBias: 0, wingBias: 0, weightBias: 0, ...extra.body },
    starAffinity: extra.starAffinity ?? 0,
    intlWeight: extra.intlWeight ?? 1,
  };
}

/**
 * All fifteen archetypes. Templates are FEEL profiles authored against the
 * attribute glossary in engine model/player.ts; each header comment names
 * the 2-3 dials that define the identity. Anchor levels are computed at
 * module load (anchorOf), never hand-copied.
 */
export const ARCHETYPES: readonly Archetype[] = [
  // ------------------------------------------------------------- guards
  A('helioCreator', 'heliocentric shot creator', { PG: 3, SG: 1 },
    // identity: ballHandle 86 + passVision 82 + usage 82 - the offense IS him
    { speed: 75, accel: 79, strength: 53, vertical: 67, lateral: 63, stamina: 76,
      finishing: 74, midRange: 72, three: 70, freeThrow: 80, drawFoul: 74,
      ballHandle: 86, passAcc: 78, passVision: 82,
      perimeterD: 53, interiorD: 35, steal: 55, block: 23, contestSkill: 47,
      offReb: 25, defReb: 45, boxout: 31, decisions: 72, consistency: 64 },
    { shotRim: 52, shotMid: 38, shotThree: 62, pullUp: 76, drive: 74, passOut: 52,
      iso: 62, post: 8, offBallMotion: 38, crashOffReb: 14, gambleSteal: 38,
      foulAggr: 32, pushPace: 56, usage: 82 },
    { groupSpread: { defense: 1.2 }, body: { heightBias: 0.5 }, starAffinity: 0.9, intlWeight: 0.9 }),

  A('floorGeneral', 'floor general', { PG: 4 },
    // identity: passVision 88 + passAcc 86 + decisions 82 - playmaking IS the game
    { speed: 68, accel: 70, strength: 50, vertical: 56, lateral: 64, stamina: 73,
      finishing: 58, midRange: 60, three: 60, freeThrow: 76, drawFoul: 50,
      ballHandle: 80, passAcc: 86, passVision: 88,
      perimeterD: 58, interiorD: 32, steal: 60, block: 19, contestSkill: 50,
      offReb: 21, defReb: 42, boxout: 29, decisions: 82, consistency: 68 },
    { shotRim: 40, shotMid: 36, shotThree: 52, pullUp: 44, drive: 56, passOut: 78,
      iso: 22, post: 6, offBallMotion: 36, crashOffReb: 10, gambleSteal: 42,
      foulAggr: 28, pushPace: 62, usage: 56 },
    { starAffinity: 0.25, intlWeight: 1.1 }),

  A('pullUpSniper', 'pull-up sniper', { PG: 1.5, SG: 2.5 },
    // identity: three 84 + pullUp 84 + freeThrow 86 - shooting off the bounce
    { speed: 72, accel: 76, strength: 48, vertical: 62, lateral: 60, stamina: 74,
      finishing: 62, midRange: 78, three: 84, freeThrow: 86, drawFoul: 58,
      ballHandle: 74, passAcc: 64, passVision: 60,
      perimeterD: 50, interiorD: 30, steal: 50, block: 19, contestSkill: 46,
      offReb: 21, defReb: 40, boxout: 27, decisions: 64, consistency: 66 },
    { shotRim: 30, shotMid: 44, shotThree: 80, pullUp: 84, drive: 44, passOut: 44,
      iso: 46, post: 4, offBallMotion: 66, crashOffReb: 10, gambleSteal: 34,
      foulAggr: 28, pushPace: 54, usage: 68 },
    { body: { wingBias: -0.5, weightBias: -5 }, starAffinity: 0.35 }),

  A('poaPest', 'point-of-attack pest', { PG: 2, SG: 2 },
    // identity: perimeterD 84 + lateral 86 + steal 82 - lives in the handler's chest
    { speed: 80, accel: 84, strength: 52, vertical: 66, lateral: 86, stamina: 82,
      finishing: 54, midRange: 46, three: 56, freeThrow: 68, drawFoul: 46,
      ballHandle: 62, passAcc: 60, passVision: 56,
      perimeterD: 84, interiorD: 38, steal: 82, block: 26, contestSkill: 70,
      offReb: 25, defReb: 44, boxout: 33, decisions: 64, consistency: 60 },
    { shotRim: 40, shotMid: 22, shotThree: 52, pullUp: 26, drive: 44, passOut: 62,
      iso: 12, post: 4, offBallMotion: 52, crashOffReb: 16, gambleSteal: 74,
      foulAggr: 56, pushPace: 58, usage: 30 },
    { caps: { three: 78 }, body: { heightBias: -1, wingBias: 1.2 }, starAffinity: -0.35, intlWeight: 0.8 }),

  A('comboScorer', 'combo scorer', { PG: 1.5, SG: 2.5 },
    // identity: the whole scoring group ~70 with middling feel - buckets, few reads
    { speed: 74, accel: 76, strength: 52, vertical: 70, lateral: 60, stamina: 74,
      finishing: 72, midRange: 70, three: 68, freeThrow: 76, drawFoul: 64,
      ballHandle: 72, passAcc: 60, passVision: 56,
      perimeterD: 50, interiorD: 32, steal: 50, block: 21, contestSkill: 46,
      offReb: 25, defReb: 42, boxout: 29, decisions: 58, consistency: 58 },
    { shotRim: 48, shotMid: 40, shotThree: 58, pullUp: 62, drive: 62, passOut: 38,
      iso: 48, post: 6, offBallMotion: 50, crashOffReb: 14, gambleSteal: 36,
      foulAggr: 32, pushPace: 56, usage: 70 },
    { groupSpread: { defense: 1.15 }, starAffinity: 0.3 }),

  // ------------------------------------------------------------- wings
  A('slasher', 'downhill slasher', { SG: 2, SF: 2 },
    // identity: finishing 82 + drawFoul 78 + drive 84 - rim pressure, thin jumper
    { speed: 80, accel: 82, strength: 62, vertical: 80, lateral: 64, stamina: 76,
      finishing: 82, midRange: 54, three: 44, freeThrow: 64, drawFoul: 78,
      ballHandle: 68, passAcc: 56, passVision: 54,
      perimeterD: 56, interiorD: 42, steal: 54, block: 36, contestSkill: 48,
      offReb: 37, defReb: 50, boxout: 37, decisions: 56, consistency: 56 },
    { shotRim: 74, shotMid: 24, shotThree: 26, pullUp: 22, drive: 84, passOut: 40,
      iso: 40, post: 10, offBallMotion: 60, crashOffReb: 34, gambleSteal: 40,
      foulAggr: 40, pushPace: 62, usage: 62 },
    { caps: { three: 66 }, body: { wingBias: 0.8, weightBias: 5 }, starAffinity: 0.3, intlWeight: 0.85 }),

  A('threeAndDWing', '3-and-D wing', { SG: 1.5, SF: 2.5 },
    // identity: three 76 (catch and shoot) + perimeterD 78 + contestSkill 72
    { speed: 70, accel: 68, strength: 62, vertical: 66, lateral: 72, stamina: 78,
      finishing: 62, midRange: 54, three: 76, freeThrow: 76, drawFoul: 44,
      ballHandle: 48, passAcc: 54, passVision: 50,
      perimeterD: 78, interiorD: 50, steal: 62, block: 40, contestSkill: 72,
      offReb: 31, defReb: 54, boxout: 44, decisions: 66, consistency: 64 },
    { shotRim: 34, shotMid: 16, shotThree: 78, pullUp: 18, drive: 34, passOut: 60,
      iso: 8, post: 6, offBallMotion: 68, crashOffReb: 20, gambleSteal: 44,
      foulAggr: 38, pushPace: 48, usage: 34 },
    { body: { wingBias: 0.8 }, starAffinity: 0 }),

  A('connectorWing', 'connector wing', { SG: 1, SF: 2, PF: 1 },
    // identity: decisions 76 + passVision 70 on a wing frame - the glue
    { speed: 66, accel: 64, strength: 60, vertical: 60, lateral: 64, stamina: 74,
      finishing: 62, midRange: 58, three: 64, freeThrow: 72, drawFoul: 48,
      ballHandle: 60, passAcc: 70, passVision: 70,
      perimeterD: 64, interiorD: 48, steal: 56, block: 34, contestSkill: 60,
      offReb: 31, defReb: 56, boxout: 45, decisions: 76, consistency: 66 },
    { shotRim: 42, shotMid: 26, shotThree: 60, pullUp: 22, drive: 44, passOut: 74,
      iso: 6, post: 8, offBallMotion: 62, crashOffReb: 20, gambleSteal: 36,
      foulAggr: 30, pushPace: 52, usage: 36 },
    { starAffinity: -0.3, intlWeight: 1.25 }),

  A('wingStopper', 'wing stopper', { SF: 2, PF: 1 },
    // identity: perimeterD 86 + contestSkill 78 + lateral 78 - guards 1 through 4
    { speed: 72, accel: 70, strength: 68, vertical: 70, lateral: 78, stamina: 80,
      finishing: 56, midRange: 46, three: 52, freeThrow: 62, drawFoul: 42,
      ballHandle: 46, passAcc: 50, passVision: 46,
      perimeterD: 86, interiorD: 58, steal: 68, block: 50, contestSkill: 78,
      offReb: 35, defReb: 56, boxout: 48, decisions: 62, consistency: 60 },
    { shotRim: 44, shotMid: 16, shotThree: 46, pullUp: 12, drive: 36, passOut: 64,
      iso: 6, post: 8, offBallMotion: 54, crashOffReb: 26, gambleSteal: 52,
      foulAggr: 48, pushPace: 50, usage: 24 },
    { caps: { three: 72 }, body: { wingBias: 1.5, weightBias: 5 }, starAffinity: -0.4 }),

  A('pointForward', 'point forward', { SF: 2, PF: 1.5 },
    // identity: passVision 80 + ballHandle 72 at forward size - jumbo initiator
    { speed: 66, accel: 64, strength: 64, vertical: 62, lateral: 62, stamina: 74,
      finishing: 68, midRange: 60, three: 58, freeThrow: 72, drawFoul: 58,
      ballHandle: 72, passAcc: 76, passVision: 80,
      perimeterD: 56, interiorD: 50, steal: 52, block: 36, contestSkill: 52,
      offReb: 33, defReb: 58, boxout: 46, decisions: 74, consistency: 64 },
    { shotRim: 50, shotMid: 30, shotThree: 46, pullUp: 34, drive: 58, passOut: 72,
      iso: 26, post: 18, offBallMotion: 42, crashOffReb: 18, gambleSteal: 34,
      foulAggr: 32, pushPace: 54, usage: 62 },
    { body: { heightBias: 0.5 }, starAffinity: 0.5, intlWeight: 1.3 }),

  // ------------------------------------------------------------- bigs
  A('rimRunnerBig', 'rim-running big', { PF: 1, C: 3 },
    // identity: finishing 86 + vertical 84 + three 14 capped - lob threat, zero range
    { speed: 62, accel: 60, strength: 78, vertical: 84, lateral: 52, stamina: 72,
      finishing: 86, midRange: 30, three: 14, freeThrow: 52, drawFoul: 60,
      ballHandle: 27, passAcc: 46, passVision: 44,
      perimeterD: 40, interiorD: 72, steal: 38, block: 74, contestSkill: 62,
      offReb: 78, defReb: 76, boxout: 68, decisions: 56, consistency: 60 },
    { shotRim: 88, shotMid: 6, shotThree: 2, pullUp: 2, drive: 16, passOut: 52,
      iso: 4, post: 26, offBallMotion: 56, crashOffReb: 72, gambleSteal: 24,
      foulAggr: 46, pushPace: 46, usage: 30 },
    { caps: { three: 45, midRange: 60 }, tendCaps: { shotThree: 12, pullUp: 15 },
      body: { weightBias: 6, wingBias: 1 }, starAffinity: 0 }),

  A('stretchBig', 'stretch big', { PF: 2, C: 2 },
    // identity: three 74 + freeThrow 80 on a big frame; soft interior presence
    { speed: 58, accel: 56, strength: 66, vertical: 60, lateral: 52, stamina: 70,
      finishing: 64, midRange: 68, three: 74, freeThrow: 80, drawFoul: 44,
      ballHandle: 42, passAcc: 56, passVision: 52,
      perimeterD: 44, interiorD: 56, steal: 36, block: 48, contestSkill: 54,
      offReb: 41, defReb: 62, boxout: 52, decisions: 64, consistency: 62 },
    { shotRim: 36, shotMid: 26, shotThree: 72, pullUp: 14, drive: 22, passOut: 60,
      iso: 8, post: 16, offBallMotion: 48, crashOffReb: 26, gambleSteal: 24,
      foulAggr: 34, pushPace: 46, usage: 40 },
    { body: { weightBias: -8, wingBias: -0.5 }, starAffinity: 0.1, intlWeight: 1.4 }),

  A('postHub', 'post hub', { PF: 1.5, C: 2 },
    // identity: post 74 + passVision 74 + strength 86 - the offense routes through the block
    { speed: 52, accel: 50, strength: 86, vertical: 58, lateral: 46, stamina: 68,
      finishing: 78, midRange: 66, three: 28, freeThrow: 66, drawFoul: 70,
      ballHandle: 40, passAcc: 68, passVision: 74,
      perimeterD: 36, interiorD: 68, steal: 36, block: 54, contestSkill: 58,
      offReb: 64, defReb: 72, boxout: 70, decisions: 70, consistency: 64 },
    { shotRim: 66, shotMid: 34, shotThree: 12, pullUp: 6, drive: 14, passOut: 66,
      iso: 22, post: 74, offBallMotion: 30, crashOffReb: 48, gambleSteal: 22,
      foulAggr: 42, pushPace: 36, usage: 58 },
    { caps: { three: 58 }, tendCaps: { shotThree: 35 },
      body: { weightBias: 12, wingBias: 0.5 }, starAffinity: 0.5, intlWeight: 1.4 }),

  A('glassEater', 'glass eater', { PF: 2, C: 2 },
    // identity: offReb 88 + boxout 84 + crashOffReb 86 - possessions from the glass
    { speed: 56, accel: 54, strength: 84, vertical: 72, lateral: 48, stamina: 74,
      finishing: 70, midRange: 34, three: 12, freeThrow: 50, drawFoul: 54,
      ballHandle: 25, passAcc: 44, passVision: 42,
      perimeterD: 38, interiorD: 70, steal: 38, block: 60, contestSkill: 58,
      offReb: 88, defReb: 84, boxout: 84, decisions: 54, consistency: 60 },
    { shotRim: 82, shotMid: 8, shotThree: 2, pullUp: 2, drive: 10, passOut: 56,
      iso: 4, post: 30, offBallMotion: 40, crashOffReb: 86, gambleSteal: 24,
      foulAggr: 52, pushPace: 40, usage: 26 },
    { caps: { three: 40, midRange: 58 }, tendCaps: { shotThree: 10 },
      body: { weightBias: 10, wingBias: 1.2 }, starAffinity: -0.6 }),

  A('switchBig', 'switch big', { PF: 2, C: 1.5 },
    // identity: lateral 74 + perimeterD 70 + block 72 on a big - guards all five
    { speed: 66, accel: 64, strength: 70, vertical: 74, lateral: 74, stamina: 76,
      finishing: 70, midRange: 48, three: 46, freeThrow: 60, drawFoul: 48,
      ballHandle: 42, passAcc: 52, passVision: 50,
      perimeterD: 70, interiorD: 74, steal: 54, block: 72, contestSkill: 72,
      offReb: 56, defReb: 68, boxout: 58, decisions: 62, consistency: 60 },
    { shotRim: 64, shotMid: 12, shotThree: 30, pullUp: 6, drive: 20, passOut: 60,
      iso: 4, post: 16, offBallMotion: 48, crashOffReb: 44, gambleSteal: 38,
      foulAggr: 44, pushPace: 50, usage: 28 },
    { caps: { three: 68 }, body: { weightBias: -4, wingBias: 1.5 }, starAffinity: 0.2, intlWeight: 1.1 }),
];

/** Catalog lookup by id; built once at module load. */
const BY_ID = new Map<ArchetypeId, Archetype>(ARCHETYPES.map((a) => [a.id, a]));

export function archetypeById(id: ArchetypeId): Archetype {
  const a = BY_ID.get(id);
  if (!a) throw new Error(`archetypes: unknown archetype '${id}'`);
  return a;
}

/**
 * Plain attribute mean of a template: the quality the archetype expresses
 * out of the box. Fixed ATTR_KEYS order keeps float sums bit-stable.
 * Computed, never hand-copied, so rebalancing a template can not go stale.
 */
export function anchorOf(arch: Archetype): number {
  let sum = 0;
  for (const k of ATTR_KEYS) sum += arch.attr[k];
  return sum / ATTR_KEYS.length;
}

/** Anchor cache keyed by id (module-load probe, same doctrine as the old catalog). */
const ANCHORS = new Map<ArchetypeId, number>(ARCHETYPES.map((a) => [a.id, anchorOf(a)]));

// ---------------------------------------------------------------------------
// selection

export type Pipeline = 'domestic' | 'international';

/**
 * Draw one archetype for a position. Weights: position eligibility x star
 * affinity tilt (quality-conditioned) x pipeline multiplier. Exactly ONE
 * rng draw. Positions are drawn by the caller first (uniform, the league's
 * long-run positional balance guarantee), so this only shapes WHO plays
 * the position at a given quality.
 */
export function pickArchetype(rng: Rng, pos: Position, quality: number, pipeline: Pipeline): Archetype {
  const cands: Archetype[] = [];
  const weights: number[] = [];
  for (const a of ARCHETYPES) {
    const pw = a.pos[pos];
    if (!pw) continue;
    const tilt = Math.exp(a.starAffinity * (quality - AFFINITY_PIVOT) / AFFINITY_SCALE);
    const pipe = pipeline === 'international' ? a.intlWeight : 1;
    cands.push(a);
    weights.push(pw * tilt * pipe);
  }
  if (cands.length === 0) throw new Error(`archetypes: no archetype eligible at ${pos}`);
  return cands[rng.weighted(weights)]!;
}

// ---------------------------------------------------------------------------
// sampling

/** Gaussian draw clamped to +-NOISE_CLAMP_SDS: bounded noise by construction. */
function boundedGaussian(rng: Rng, sd: number): number {
  const raw = rng.gaussian(0, sd);
  return clamp(raw, -NOISE_CLAMP_SDS * sd, NOISE_CLAMP_SDS * sd);
}

/** Round + clamp a generated rating into the working 1-99 band. */
function clampRating(x: number): number {
  return Math.round(clamp(x, RATING_LO, RATING_HI));
}

/** Which group a dial belongs to; built once from the ATTR_GROUPS contract. */
const GROUP_OF: Record<keyof Attributes, AttrGroup> = (() => {
  const out = {} as Record<keyof Attributes, AttrGroup>;
  for (const g of Object.keys(ATTR_GROUPS) as AttrGroup[]) {
    for (const k of ATTR_GROUPS[g]) out[k] = g;
  }
  return out;
})();

/** Stable group order for the group-noise pass (PotentialProfile declaration order). */
const GROUP_ORDER: readonly AttrGroup[] = ['phys', 'scoring', 'playmaking', 'defense', 'rebounding', 'mental'];

/**
 * Sample a full identity (attributes + tendencies) from an archetype at a
 * quality target. The template moves as one block under the quality shift
 * (identity is the profile's internal ratios, not its level); noise is one
 * bounded group draw plus one bounded per-dial draw; caps land last and
 * are absolute. Tendencies are appetite: mutated, capped, never shifted.
 *
 * Draw order fixed: 6 group draws, 24 attribute draws, 14 tendency draws.
 */
export function sampleIdentity(
  rng: Rng, arch: Archetype, quality: number, mutationSd: number,
): { attr: Attributes; tend: Tendencies } {
  const shift = (quality - (ANCHORS.get(arch.id) ?? anchorOf(arch))) * QUALITY_GAIN;

  const groupNoise = {} as Record<AttrGroup, number>;
  for (const g of GROUP_ORDER) {
    const spread = arch.groupSpread[g] ?? 1;
    groupNoise[g] = boundedGaussian(rng, mutationSd * GROUP_NOISE_SHARE * spread);
  }

  const attr = {} as Attributes;
  for (const k of ATTR_KEYS) {
    const noise = boundedGaussian(rng, mutationSd * ATTR_NOISE_SHARE);
    attr[k] = clampRating(arch.attr[k] + shift + groupNoise[GROUP_OF[k]] + noise);
  }
  for (const [k, cap] of Object.entries(arch.caps) as Array<[keyof Attributes, number]>) {
    attr[k] = Math.min(attr[k], cap);
  }

  const tend = {} as Tendencies;
  for (const k of TEND_KEYS) {
    tend[k] = clampRating(arch.tend[k] + boundedGaussian(rng, mutationSd));
  }
  for (const [k, cap] of Object.entries(arch.tendCaps) as Array<[keyof Tendencies, number]>) {
    tend[k] = Math.min(tend[k], cap);
  }

  return { attr, tend };
}

/**
 * Sample a body from the positional band plus the archetype's build bias.
 * Weight tracks height (REAL-ish 6 lb per inch); wingspan rides over
 * height with a rare freak tail. Draw order fixed: height, weight, wing
 * base, freak chance, freak size (the freak draws happen every call so the
 * pattern never varies).
 */
export function sampleBody(
  rng: Rng, pos: Position, arch: Archetype,
): { heightIn: number; weightLb: number; wingspanIn: number } {
  const band = BODY_BANDS[pos];
  const heightIn = Math.round(clamp(
    rng.gaussian(band.hMean + arch.body.heightBias, band.hSd * HEIGHT_ARCH_SD_MULT),
    band.hLo, band.hHi,
  ));
  const weightLb = Math.round(clamp(
    band.wBase + (heightIn - band.hMean) * LB_PER_INCH + arch.body.weightBias + rng.gaussian(0, WEIGHT_SD),
    WEIGHT_LO, WEIGHT_HI,
  ));
  let delta = clamp(
    rng.gaussian(WING_DELTA_MEAN + arch.body.wingBias, WING_DELTA_SD),
    WING_DELTA_LO, WING_DELTA_HI,
  );
  // freak roll: both draws happen unconditionally (fixed draw pattern)
  const freak = rng.float() < WING_FREAK_P;
  const freakSize = rng.range(WING_FREAK_LO, WING_FREAK_HI);
  if (freak) delta += freakSize;
  const wingspanIn = Math.round(heightIn + delta);
  return { heightIn, weightLb, wingspanIn };
}

// ---------------------------------------------------------------------------
// the stamp
//
// FrPlayer.archetype is proposed as an OPTIONAL field in the types.ts
// integration patch (people/INTEGRATION-gen.md). Until that patch lands,
// the stamp writes through a local structural extension so this module
// compiles against the frozen types.ts either way. The field serializes
// with the player (plain string), so determinism hashes carry it.

interface ArchetypeCarrier { archetype?: ArchetypeId; }

/** Record which archetype a player was generated from. */
export function stampArchetype(p: FrPlayer, id: ArchetypeId): void {
  (p as FrPlayer & ArchetypeCarrier).archetype = id;
}

/** The archetype a player was generated from; null for pre-wave saves. */
export function archetypeOf(p: FrPlayer): ArchetypeId | null {
  const v = (p as FrPlayer & ArchetypeCarrier).archetype;
  return v ?? null;
}

/** Display label for a player's archetype; empty string when unstamped. */
export function archetypeLabelOf(p: FrPlayer): string {
  const id = archetypeOf(p);
  return id ? archetypeById(id).label : '';
}
