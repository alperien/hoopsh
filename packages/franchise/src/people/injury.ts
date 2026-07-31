/**
 * people/injury.ts - the injury model. OWNER: people task.
 *
 * Hazard rolls run POST-GAME on real minutes played (register F2,
 * docs/FRANCHISE.md §13): no mid-game exits in v1; the news attributes
 * each injury to the game it happened in via gameId. Practice and off-day
 * injuries are OUT of the model by design (rolls happen only for played
 * game records; lift when the day loop grows an off-day tick worth the
 * noise). Calibration target: params.injury comments (research 05 B5:
 * ankle sprains most common, most injuries minor, heavy tail).
 *
 * Randomness: stream 'injury:<season>:<day>' (rng.ts registry), one
 * stream per league day shared by that day's games, consumed in the
 * caller's record order (the schedule is ordered by (day, id), so the
 * fold order is stable). One uniform draw per healthy player-line; extra
 * draws only on a hit, so a quiet night costs one roll per player.
 */
import type { Rng } from '@hoopsh/engine';
import type { FranchiseParams } from '../params.js';
import type { GameRecord, Injury, InjurySeverity, League } from '../types.js';
import { streamRng } from '../rng.js';

/** Severity order matching params.injury.severityMix / outDaysBySeverity / wearBySeverity indexes. */
export const SEVERITY_ORDER: readonly InjurySeverity[] = ['minor', 'moderate', 'major', 'seasonEnding'];

export interface InjuryKindDef {
  /** catalog key stored on Injury.kind */
  kind: string;
  /** display label; '%s' is replaced by the rolled side for sided parts */
  label: string;
  bodyPart: string;
  /** left/right applies (an ankle has a side, back spasms do not) */
  sided: boolean;
  /** severities this kind can express; majors exist ONLY behind major/seasonEnding rolls */
  severities: readonly InjurySeverity[];
  /** relative frequency within a severity draw */
  weight: number;
}

/**
 * The injury catalog. Weights are REAL-ish where sourced from the
 * research 05 B5 trainer-reported mix (lateral ankle sprain 13.2% of all
 * injuries, patellofemoral knee inflammation 11.9%, lumbar strain 7.9%,
 * hamstring strain 3.3%); the unsourced soft-tissue entries are
 * FEEL-weighted to fill the plausible remainder. Severity is rolled FIRST
 * (params.injury.severityMix), then the kind is sampled among entries
 * consistent with it, so a bad night can never inflate a day-to-day
 * sprain into a torn ACL.
 */
export const INJURY_CATALOG: readonly InjuryKindDef[] = [
  { kind: 'ankle-sprain', label: 'sprained %s ankle', bodyPart: 'ankle', sided: true, severities: ['minor', 'moderate'], weight: 13 },
  { kind: 'knee-soreness', label: '%s knee soreness', bodyPart: 'knee', sided: true, severities: ['minor'], weight: 12 },
  { kind: 'back-spasms', label: 'back spasms', bodyPart: 'back', sided: false, severities: ['minor', 'moderate'], weight: 8 },
  { kind: 'hamstring-strain', label: 'strained %s hamstring', bodyPart: 'hamstring', sided: true, severities: ['minor', 'moderate'], weight: 5 },
  { kind: 'calf-strain', label: 'strained %s calf', bodyPart: 'calf', sided: true, severities: ['minor', 'moderate'], weight: 4 }, // FEEL
  { kind: 'groin-strain', label: 'groin strain', bodyPart: 'groin', sided: false, severities: ['minor', 'moderate'], weight: 4 }, // FEEL
  { kind: 'quad-contusion', label: '%s quad contusion', bodyPart: 'quad', sided: true, severities: ['minor'], weight: 4 }, // FEEL: the knee-to-thigh charge collision
  { kind: 'shoulder-sprain', label: 'sprained %s shoulder', bodyPart: 'shoulder', sided: true, severities: ['minor', 'moderate'], weight: 3 }, // FEEL
  { kind: 'wrist-sprain', label: 'sprained %s wrist', bodyPart: 'wrist', sided: true, severities: ['minor', 'moderate'], weight: 3 }, // FEEL: the fall on an outstretched hand
  { kind: 'hip-flexor', label: 'strained %s hip flexor', bodyPart: 'hip', sided: true, severities: ['minor', 'moderate'], weight: 3 }, // FEEL
  { kind: 'foot-soreness', label: '%s foot soreness', bodyPart: 'foot', sided: true, severities: ['minor'], weight: 3 }, // FEEL: big-man load complaint
  { kind: 'concussion', label: 'concussion', bodyPart: 'head', sided: false, severities: ['minor', 'moderate'], weight: 2 }, // FEEL: protocol-managed, uncommon
  // The majors. Only reachable through the major/seasonEnding severity
  // rolls (3% + 9% of hits by default), which is what keeps them news.
  { kind: 'meniscus-tear', label: 'torn %s meniscus', bodyPart: 'knee', sided: true, severities: ['major'], weight: 3 }, // FEEL: the most survivable knee surgery
  { kind: 'foot-fracture', label: 'fractured %s foot', bodyPart: 'foot', sided: true, severities: ['major'], weight: 2 }, // FEEL
  { kind: 'acl-tear', label: 'torn %s ACL', bodyPart: 'knee', sided: true, severities: ['seasonEnding'], weight: 3 }, // research 05 B5: RTP ~370 days, near-baseline by season 2
  { kind: 'achilles-rupture', label: 'ruptured %s Achilles', bodyPart: 'achilles', sided: true, severities: ['seasonEnding'], weight: 2 }, // research 05 B5: the worst one; careers shorten after it
];

/**
 * Pure post-game injury hazard for one player-game: the probability any
 * injury is charged to this player for these minutes. Exported so tests
 * (and a medical-staff UI) can hit the math directly.
 *
 * p = basePer36 * (min/36) * ageFactor * pronenessFactor * wearFactor.
 */
export function hazardFor(
  params: FranchiseParams,
  x: { min: number; age: number; proneness: number; wear: number },
): number {
  const inj = params.injury;
  // Exposure scales with floor time: basePer36 is calibrated per 36
  // minutes played (a full starter night).
  const exposure = inj.basePer36 * (x.min / 36);
  // 28: the age soft tissue stops forgiving; hazard compounds per year
  // past it (params.injury.ageFactorPerYearOver28).
  const ageF = 1 + inj.ageFactorPerYearOver28 * Math.max(0, x.age - 28);
  // Body factors run through 1.0 at the 50 rating midpoint up to the
  // calibrated multiplier at 100. Floored at 0.25 (FEEL): nobody is
  // injury-proof, however sturdy the frame.
  const proneF = Math.max(0.25, 1 + ((x.proneness - 50) / 50) * (inj.pronenessFactorAt100 - 1));
  const wearF = Math.max(0.25, 1 + ((x.wear - 50) / 50) * (inj.wearFactorAt100 - 1));
  // 0.95 ceiling (FEEL): a probability guard, not a behavioral lever.
  return Math.min(0.95, Math.max(0, exposure * ageF * proneF * wearF));
}

/**
 * Roll injuries for the day's completed games. Called by the spine in the
 * evening fold, after results land and before news. Mutates the hit
 * players (health.injury set, history appended, wear added) and returns
 * the new injuries for the news desk. Players already injured never
 * re-roll (they did not play; a stale line for an injured player is a
 * caller bug this guard absorbs).
 */
export function rollPostGameInjuries(league: League, records: GameRecord[]): Injury[] {
  const inj = league.params.injury;
  const out: Injury[] = [];
  // One stream per league day: two games on the same night draw from the
  // same sequence in record order instead of re-deriving (and therefore
  // repeating) the day's rolls.
  const rngByDay = new Map<number, Rng>();

  for (const record of records) {
    let rng = rngByDay.get(record.date.day);
    if (!rng) {
      rng = streamRng(league.seed, 'injury', record.date.season, record.date.day);
      rngByDay.set(record.date.day, rng);
    }
    for (const line of record.lines) {
      if (line.min <= 0) continue; // DNP: no exposure, no roll
      const player = league.players[line.playerId];
      if (!player || player.status === 'retired') continue;
      if (player.health.injury) continue; // already out: cannot re-roll while hurt

      const age = record.date.season - player.bornSeason;
      const p = hazardFor(league.params, {
        min: line.min,
        age,
        proneness: player.health.proneness,
        wear: player.health.wear,
      });
      if (!rng.chance(p)) continue;

      const sevIdx = rng.weighted(inj.severityMix);
      const severity = SEVERITY_ORDER[sevIdx]!;
      const pool = INJURY_CATALOG.filter((k) => k.severities.includes(severity));
      const def = pool[rng.weighted(pool.map((k) => k.weight))]!;
      const side = def.sided ? rng.pick(['left', 'right'] as const) : null;
      const [lo, hi] = inj.outDaysBySeverity[sevIdx]!;
      const outDays = lo + rng.int(hi - lo + 1); // uniform across the severity band, inclusive

      const injury: Injury = {
        kind: def.kind,
        label: side ? def.label.replace('%s', side) : def.label,
        severity,
        gameId: record.id, // narrative attribution (register F2)
        startedOn: { season: record.date.season, day: record.date.day },
        outDays,
        remainingDays: outDays,
      };
      player.health.injury = injury;
      player.health.history.push(injury); // career log grows at assignment; recovery only clears the active slot
      player.health.wear = Math.min(100, player.health.wear + inj.wearBySeverity[sevIdx]!);
      out.push(injury);
    }
  }
  return out;
}

/**
 * Morning tick: advance every active recovery one calendar day and clear
 * the healed. Called by the spine at the top of each day, before games
 * are planned. Mutates health; returns the cleared player ids (sorted by
 * construction) so the day digest can report returns.
 */
export function advanceRecoveries(league: League): string[] {
  const cleared: string[] = [];
  for (const id of Object.keys(league.players).sort()) {
    const player = league.players[id]!;
    const injury = player.health.injury;
    if (!injury) continue;
    injury.remainingDays = Math.max(0, injury.remainingDays - 1);
    if (injury.remainingDays > 0) continue;
    // History normally already holds this injury (appended at assignment);
    // the guard covers injuries hand-set by tests or imports.
    if (!player.health.history.includes(injury)) player.health.history.push(injury);
    player.health.injury = null;
    cleared.push(id);
  }
  return cleared;
}
