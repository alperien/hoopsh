/**
 * week.ts - the pre-NBA week resolution: allocation effects, the energy
 * economy, weekly training, my injuries, circuit game days, and the
 * weekly system updates (recruiting, stock, phone). tick.ts routes here
 * for every non-NBA phase; this file computes one week and explains
 * every consequence into the event log (docs/CAREER.md pillar 2).
 *
 * Streams (career.seed root): 'career-train:<year>:<week>' weekly
 * training landings; 'career-injury:<year>:<week>' my post-game hazard.
 *
 * Training design note: weekly gains are small (params.week
 * .trainingGainBase); instead of fractional bookkeeping they LAND
 * probabilistically as whole points at the expected rate, so progress is
 * visible and legible when it happens ('extra work paid: +1 scoring')
 * and zero-noise when it does not. The RPG number goes up some weeks;
 * the season-scale rate is the calibrated truth.
 */
import { clamp } from '@hoopsh/engine';
import type { GameRecord, SimulateJobs } from '@hoopsh/franchise';
import { distributeGrowth, groupMean } from '@hoopsh/franchise';
import { streamRng } from '@hoopsh/franchise';
import type { AttrGroup } from '@hoopsh/franchise';
import type { CareerState, WeekDigest, WeekSlotId } from './types.js';
import { applyCircuitResults, circuitWeekJobs } from './circuits.js';
import { updateAfterGame } from './trust.js';
import { updateRecruiting } from './recruiting.js';
import { updateStock } from './stock.js';
import { generatePhone } from './phone.js';

/** Staff development quality by phase: the program teaches (FEEL table). */
export function coachDevFor(career: CareerState): number {
  switch (career.clock.phase) {
    case 'hs': return 42;      // FEEL: a good HS staff teaches habits, not craft
    case 'college': {
      // the program you signed with teaches at its coachDev
      const offer = career.recruiting?.offers.find(o => o.id === career.recruiting?.committedTo);
      return offer?.coachDev ?? 52; // FEEL default: a mid-tier program (fixture path)
    }
    case 'euro': return 64;    // FEEL: the doc's bet: Europe teaches best if you survive it
    case 'nbl': return 56;
    case 'china': return 40;   // FEEL: the money years are not a classroom
    default: return 50;
  }
}

function pushEvent(career: CareerState, kind: CareerState['events'][number]['kind'], reason: string, delta?: number): void {
  career.events.push({
    id: `ev-${kind}-${career.clock.year}w${career.clock.week}-${career.events.length}`,
    clock: { ...career.clock },
    kind,
    reason,
    ...(delta !== undefined ? { delta } : {}),
  });
}

/** Energy cost/restore for one slot (rest and life restore). */
function slotEnergy(career: CareerState, slot: WeekSlotId): number {
  return -career.params.week.energyCost[slot];
}

/**
 * Resolve the allocation: energy, training landings, wear trim, morale.
 * Exported for tick's NBA phase, which runs the same allocation around
 * league game days.
 */
export function resolveAllocation(career: CareerState): void {
  const me = career.players[career.me] ?? career.league.players[career.me];
  if (!me) throw new Error('career/week: my player is missing from both pools');
  const p = career.params.week;
  const rng = streamRng(career.seed, 'career-train', career.clock.year, career.clock.week);

  // practice is mandatory and paid first
  let energy = career.energy - p.energyCost.practice;

  for (const slot of career.weekPlan.slots) {
    energy += slotEnergy(career, slot);
    if (slot === 'extraWork') {
      // probabilistic integer landing at the expected weekly rate, scaled
      // by staff quality on the same 50-centered line the GM game uses
      const staff = coachDevFor(career);
      const staffF = 1 + ((staff - 50) / 50) * 0.35; // FEEL: mirrors dev.coachFactorAt100's slope
      const gain = p.trainingGainBase * staffF;
      const focus = career.weekPlan.focus;
      const ceiling = me.potential[focus];
      if (groupMean(me.attr, focus) < ceiling && rng.chance(clamp(gain, 0, 1))) {
        const applied = distributeGrowth(me.attr, focus, ceiling, 1);
        if (applied > 0) {
          pushEvent(career, 'dev', `extra work paid: +${applied} ${focus}`, applied);
          me.devLog.push({
            date: { season: career.clock.year, day: career.clock.week },
            deltas: { [focus]: applied },
            reasons: ['extra work in the gym'],
          });
        }
      }
    } else if (slot === 'film') {
      const ceiling = me.potential.mental;
      if (groupMean(me.attr, 'mental') < ceiling && rng.chance(clamp(p.filmGainBase, 0, 1))) {
        const applied = distributeGrowth(me.attr, 'mental', ceiling, 1);
        if (applied > 0) pushEvent(career, 'dev', `film study paid: +${applied} mental`, applied);
      }
    } else if (slot === 'body') {
      const before = me.health.wear;
      me.health.wear = Math.max(0, Math.round((me.health.wear - p.bodyWearTrim) * 100) / 100);
      if (me.health.wear < before) pushEvent(career, 'energy', 'body work: the legs feel younger', -(before - me.health.wear));
    } else if (slot === 'life') {
      me.morale = clamp(me.morale + p.lifeMoraleGain, 0, 100);
    }
  }

  career.energy = clamp(Math.round(energy), 0, 100);
  if (career.energy < p.energyFloorInjuryRisk) {
    pushEvent(career, 'energy', `running on empty (${career.energy}): the body is one bad landing from trouble`);
  }
}

/** My post-game injury roll: the franchise hazard, energy-scaled. */
function rollMyInjury(career: CareerState, myMinutes: number, gameId: string): void {
  const me = career.players[career.me] ?? career.league.players[career.me]!;
  if (me.health.injury) return; // already listed
  const inj = career.league.params.injury; // the league's calibrated hazard table
  const age = career.clock.year - me.bornSeason;
  let hazard = inj.basePer36 * (myMinutes / 36);
  if (age > 28) hazard *= 1 + inj.ageFactorPerYearOver28 * (age - 28);
  hazard *= 1 + ((me.health.proneness - 50) / 50) * (inj.pronenessFactorAt100 - 1);
  if (career.energy < career.params.week.energyFloorInjuryRisk) {
    hazard *= career.params.week.energyLowHazardMult; // tired bodies break (the week economy's teeth)
  }
  if (career.nextApproach?.playingHurt) return; // playing hurt wears, it does not re-roll (wear handled at grading)

  const rng = streamRng(career.seed, 'career-injury', career.clock.year, career.clock.week);
  if (!rng.chance(clamp(hazard, 0, 0.5))) return;

  // severity and time out ride the same franchise tables
  const sevRoll = rng.float();
  const mix = inj.severityMix;
  const sevIdx = sevRoll < mix[0] ? 0 : sevRoll < mix[0] + mix[1] ? 1 : sevRoll < mix[0] + mix[1] + mix[2] ? 2 : 3;
  const severities = ['minor', 'moderate', 'major', 'seasonEnding'] as const;
  const [lo, hi] = inj.outDaysBySeverity[sevIdx]!;
  const outDays = lo + rng.int(hi - lo + 1);
  const labels = ['a rolled ankle', 'a hamstring strain', 'a stress reaction in the foot', 'a torn ACL'];
  me.health.injury = {
    kind: ['ankle-sprain', 'hamstring-strain', 'foot-stress', 'acl-tear'][sevIdx]!,
    label: labels[sevIdx]!,
    severity: severities[sevIdx]!,
    gameId,
    startedOn: { season: career.clock.year, day: career.clock.week },
    outDays,
    remainingDays: outDays,
  };
  me.health.wear += inj.wearBySeverity[sevIdx]!;
  me.health.history.push(me.health.injury);
  pushEvent(career, 'injury', `${me.health.injury.label}: out about ${Math.max(1, Math.round(outDays / 7))} weeks`, -outDays);
}

/**
 * Resolve one pre-NBA week: allocation, my recovery clock, circuit games
 * through the provided sim (engine-real), grading, injuries, recruiting,
 * stock, and the phone. Mutates; returns the digest.
 */
export async function resolveWeek(career: CareerState, sim: SimulateJobs): Promise<WeekDigest> {
  const digest: WeekDigest = {
    clock: { ...career.clock },
    gamesPlayed: [],
    messages: [],
    events: [],
    energy: career.energy,
  };
  const eventsBefore = career.events.length;
  const me = career.players[career.me] ?? career.league.players[career.me]!;

  // recovery clock: a week is seven days off the sentence
  if (me.health.injury) {
    me.health.injury.remainingDays -= 7;
    if (me.health.injury.remainingDays <= 0) {
      pushEvent(career, 'injury', `cleared to play: ${me.health.injury.label} healed`);
      me.health.injury = null;
    }
  }

  resolveAllocation(career);

  // circuit game days (engine-real, my games carry full events)
  if (career.circuit && !career.circuit.complete) {
    const jobs = circuitWeekJobs(career, career.clock.week);
    if (jobs.length > 0) {
      const results = await sim(jobs);
      applyCircuitResults(career, results);
      const myTeamId = career.circuit.teams[career.circuit.myTeamIdx]!.id;
      for (const r of results) {
        const record = career.circuit.results[r.gameId];
        if (!record) continue;
        digest.gamesPlayed.push(r.gameId);
        if (record.home === myTeamId || record.away === myTeamId) {
          const myLine = record.lines.find(l => l.playerId === career.me);
          const played = myLine && myLine.min > 0;
          updateAfterGame(career, record);
          if (played) {
            career.energy = clamp(career.energy - career.params.week.gameEnergyCost, 0, 100);
            if (career.nextApproach?.playingHurt || me.health.injury) {
              // gutting it out compounds the odometer through the real model
              me.health.wear += career.params.trust.playHurtWearMult * 0.5; // FEEL 0.5 base per hurt game
            }
            rollMyInjury(career, myLine.min, record.id);
          }
        }
      }
    }
  }

  // weekly system pulses (INERT stubs stay quiet mid-wave)
  updateRecruiting(career);
  updateStock(career);
  const msgs = generatePhone(career);
  for (const m of msgs) {
    if (!career.phone.some(x => x.id === m.id)) {
      career.phone.push(m);
      digest.messages.push(m.id);
    }
  }

  digest.events = career.events.slice(eventsBefore).map(e => e.id);
  digest.energy = career.energy;
  return digest;
}
