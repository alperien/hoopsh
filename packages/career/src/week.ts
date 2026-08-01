/**
 * week.ts - the pre-NBA week resolution: allocation effects, the energy
 * economy, weekly training, my injuries, circuit game days, and the
 * weekly system updates (recruiting, stock, phone). tick.ts routes here
 * for every non-NBA phase; this file computes one week and explains
 * every consequence into the event log (docs/CAREER.md pillar 2).
 *
 * Streams (career.seed root): 'career-train:<year>:<week>' weekly
 * training landings (reserved; the pity timer below is deterministic);
 * 'career-injury:<gameId>' my post-game hazard - keyed by GAME, not
 * (year, week), because both games of a doubleheader week sharing one
 * draw halved my effective hazard (measured felt-loop defect).
 *
 * THE CARD IS STICKY (felt-loop fix): resolveWeek captures the week's
 * card ONCE (nextApproach if dialed, else the standing approach), the
 * engine simulates every one of my games with it, and EVERY grade of the
 * week is judged against that same card (trust.ts updateAfterGame takes
 * it explicitly). At week's end a dialed card FOLDS INTO career.approach
 * and nextApproach clears: the card persists until changed. Dialing is
 * setting your game, not burning a one-night token that silently reverts
 * to neutral 50s (the old semantics, measured grading adherence 0/100
 * alternating all season). playingHurt never persists week to week,
 * and in shipped v1 it is unreachable while listed: circuit
 * availability (circuits.ts meListed) and the NBA gameday healthyPool
 * sit a listed player without consulting the card, so the playingHurt
 * branches below fire only for a healthy player who sets the flag
 * (C17 in docs/CAREER.md, issue #84).
 *
 * TRAINING PITY TIMER (felt-loop fix): weekly gains are small
 * (params.week.trainingGainBase), and the old probabilistic +1 landings
 * at p ~0.15/slot produced measured 10+ week droughts on the default
 * plan. Expected progress now BANKS per attribute group
 * (career.trainingBank, absent = empty for old saves) and a whole point
 * lands DETERMINISTICALLY when a group's bank reaches 1.0 ('extra work
 * paid: +1 scoring'), so with one extraWork slot the visible tick lands
 * at least every ceil(1/rate) weeks and the season-scale rate is exactly
 * the calibrated truth. Zero rng: the pity timer cannot be streaky.
 *
 * ENERGY ON THE FLOOR: below params.week.energyLegsFloor my game-night
 * attributes take the linear applyLegs debuff (approach.ts, applied in
 * the circuits ME projection), so a grind week is paid in that week's
 * box scores, not only in a rare hazard multiplier.
 */
import { clamp } from '@hoopsh/engine';
import type { FrPlayer, GameRecord, SimulateJobs } from '@hoopsh/franchise';
import { distributeGrowth, groupMean } from '@hoopsh/franchise';
import { streamRng } from '@hoopsh/franchise';
import type { AttrGroup } from '@hoopsh/franchise';
import type { CareerState, WeekDigest, WeekSlotId } from './types.js';
import { applyCircuitResults, circuitWeekJobs, seedBracket } from './circuits.js';
import { updateAfterGame } from './trust.js';
import { buildPrograms, updateRecruiting } from './recruiting.js';
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
 * The pity timer's whole mechanism: bank a slot's expected gain for its
 * group and land whole points DETERMINISTICALLY when the bank crosses
 * 1.0 (module header). A finished group (mean at ceiling) banks nothing;
 * a landing that overshoots the ceiling spends the bank anyway (the
 * shortfall is a ceiling fact, not saved progress). devReason, when
 * given, also writes the devLog (the extraWork path's existing record).
 */
function accrueTraining(
  career: CareerState, me: FrPlayer,
  group: AttrGroup, gain: number, label: string, devReason?: string,
): void {
  const ceiling = me.potential[group];
  if (groupMean(me.attr, group) >= ceiling) return;
  const bank = career.trainingBank ?? (career.trainingBank = {});
  const banked = (bank[group] ?? 0) + Math.max(0, gain);
  const whole = Math.floor(banked);
  // 6-decimal snap: repeated float adds must never stall a bank at 0.999...
  bank[group] = Math.round((banked - whole) * 1e6) / 1e6;
  if (whole < 1) return;
  const applied = distributeGrowth(me.attr, group, ceiling, whole);
  if (applied <= 0) return;
  pushEvent(career, 'dev', `${label} paid: +${applied} ${group}`, applied);
  if (devReason) {
    me.devLog.push({
      date: { season: career.clock.year, day: career.clock.week },
      deltas: { [group]: applied },
      reasons: [devReason],
    });
  }
}

/**
 * Resolve the allocation: energy, training banking (pity timer), wear
 * trim, morale. Exported for tick's NBA phase, which runs the same
 * allocation around league game days.
 */
export function resolveAllocation(career: CareerState): void {
  const me = career.players[career.me] ?? career.league.players[career.me];
  if (!me) throw new Error('career/week: my player is missing from both pools');
  const p = career.params.week;

  // the body recovers on its own first (sleep exists), then practice is paid
  let energy = career.energy + p.weekBaseRecovery - p.energyCost.practice;

  for (const slot of career.weekPlan.slots) {
    energy += slotEnergy(career, slot);
    if (slot === 'extraWork') {
      // expected weekly rate, scaled by staff quality on the same
      // 50-centered line the GM game uses, banked toward the focus group
      const staff = coachDevFor(career);
      const staffF = 1 + ((staff - 50) / 50) * 0.35; // FEEL: mirrors dev.coachFactorAt100's slope
      accrueTraining(career, me, career.weekPlan.focus, p.trainingGainBase * staffF,
        'extra work', 'extra work in the gym');
    } else if (slot === 'film') {
      accrueTraining(career, me, 'mental', p.filmGainBase, 'film study');
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

/**
 * My post-game injury roll: the franchise hazard (people/injury.ts
 * hazardFor's exact factor forms: age, proneness, wear, each floored at
 * 0.25), energy-scaled. Streamed per GAME ('career-injury:<gameId>'):
 * the old (year, week) key gave both games of a doubleheader one shared
 * draw, halving effective hazard (measured felt-loop defect). The wear
 * term was also missing here while franchise players paid it - a career
 * odometer now prices the same risk.
 */
function rollMyInjury(career: CareerState, myMinutes: number, gameId: string, playingHurt: boolean): void {
  const me = career.players[career.me] ?? career.league.players[career.me]!;
  if (me.health.injury) return; // already listed
  const inj = career.league.params.injury; // the league's calibrated hazard table
  const age = career.clock.year - me.bornSeason;
  let hazard = inj.basePer36 * (myMinutes / 36);
  if (age > 28) hazard *= 1 + inj.ageFactorPerYearOver28 * (age - 28);
  hazard *= Math.max(0.25, 1 + ((me.health.proneness - 50) / 50) * (inj.pronenessFactorAt100 - 1));
  hazard *= Math.max(0.25, 1 + ((me.health.wear - 50) / 50) * (inj.wearFactorAt100 - 1));
  if (career.energy < career.params.week.energyFloorInjuryRisk) {
    hazard *= career.params.week.energyLowHazardMult; // tired bodies break (the week economy's teeth)
  }
  if (playingHurt) return; // playing hurt wears, it does not re-roll (wear handled at grading)

  const rng = streamRng(career.seed, 'career-injury', gameId);
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

  // THE WEEK'S CARD, captured once before any sim (module header): the
  // projection (circuitWeekJobs) reads the same nextApproach ?? approach,
  // so what the engine simulates is exactly what every grade judges
  const cardUsed = career.nextApproach ?? { ...career.approach };

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
          updateAfterGame(career, record, cardUsed);
          if (played) {
            career.energy = clamp(career.energy - career.params.week.gameEnergyCost, 0, 100);
            if (cardUsed.playingHurt || me.health.injury) {
              // gutting it out compounds the odometer through the real model
              me.health.wear += career.params.trust.playHurtWearMult * 0.5; // FEEL 0.5 base per hurt game
            }
            rollMyInjury(career, myLine.min, record.id, cardUsed.playingHurt === true);
          }
        }
      }
    }
  }

  // the regular slate done means the bracket seeds (the postseason is
  // part of the season; foldSeason archives only at the final horn)
  if (career.circuit && !career.circuit.complete
    && career.circuit.bracket.length === 0
    && career.circuit.schedule.length > 0
    && career.circuit.schedule.every(g => career.circuit!.results[g.id])) {
    seedBracket(career, streamRng(career.seed, 'career-bracket', career.clock.year));
    pushEvent(career, 'phase', 'the regular season is done; the bracket is set');
  }

  // weekly system pulses; the recruiting board builds itself the first
  // time anyone looks (creation leaves programs to this seam)
  if (career.clock.phase === 'hs' && career.recruiting && career.recruiting.programs.length === 0) {
    career.recruiting.programs = buildPrograms(career, streamRng(career.seed, 'career-recruit-programs'));
  }
  updateRecruiting(career);
  updateStock(career);
  const msgs = generatePhone(career);
  for (const m of msgs) {
    if (!career.phone.some(x => x.id === m.id)) {
      career.phone.push(m);
      digest.messages.push(m.id);
    }
  }

  // THE CARD IS STICKY (module header): a dialed card becomes the
  // standing card at week's end - it persists until changed. playingHurt
  // is deliberately dropped: gutting it out is re-decided each week.
  if (career.nextApproach) {
    const n = career.nextApproach;
    career.approach = {
      assertiveness: n.assertiveness, range: n.range, motor: n.motor,
      defense: n.defense, playmaking: n.playmaking,
    };
    career.nextApproach = null;
  }

  digest.events = career.events.slice(eventsBefore).map(e => e.id);
  digest.energy = career.energy;
  return digest;
}
