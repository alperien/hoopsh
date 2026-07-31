/**
 * career-acceptance.ts - `npm run gm:career-acceptance`: whole careers
 * lived by scripted pilots, then judged (docs/CAREER.md, Build plan).
 * Runs OUTSIDE the test glob: several careers from a created seventeen-
 * year-old through the draft into NBA seasons and out the far end is
 * real minutes of engine time. Two tiers of verdicts:
 *
 *   GATES  (exit 1 on failure):
 *     - careers complete their scripted arcs without throwing
 *     - THE REACTING-WORLD INVARIANT: the role clocks never reach
 *       reactGames unanswered (sustained production always moves the
 *       job; docs/CAREER.md pillar 1, the flagship gate)
 *     - the explained-consequence lint: every event, grade, and ledger
 *       row carries its reason
 *     - determinism: the same seed and the same choices replay to a
 *       byte-identical career
 *
 *   BANDS  (reported PASS/MISS, never fatal): draft outcomes track
 *     creation quality; the boredom audit (content per week, phone
 *     volume, zero-event streaks); the energy economy holds off the
 *     floor; career shapes by phase.
 *
 *   npm run gm:career-acceptance -- --careers 3 --seed cacc-1 --workers 3 --nbaSeasons 2
 */
import {
  advanceCareerWeek, applyChoice, createCareer,
} from '@hoopsh/career';
import type { ApproachCard, CareerState, CreationSpec, PresetId } from '@hoopsh/career';
import { makeWorkerPool } from './runner.js';

function flag(name: string, fallback: string): string {
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 && process.argv[idx + 1] ? process.argv[idx + 1]! : fallback;
}

const CAREERS = Number(flag('careers', '3'));
const SEED = flag('seed', 'career-acc-1');
const WORKERS = Number(flag('workers', '3'));
const NBA_SEASONS = Number(flag('nbaSeasons', '2'));
const MAX_WEEKS = Number(flag('maxWeeks', '700'));

interface Pilot {
  name: string;
  preset: PresetId;
  budget: Record<string, number>;
  signatures: [string, string];
  approach: ApproachCard;
  plan: { slots: string[]; focus: string };
  declareAfterCollegeSeasons: number;
}

/** Three lives: the anointed, the solid, the unwanted. */
const PILOTS: Pilot[] = [
  {
    name: 'phenom-aggressive',
    preset: 'phenom',
    budget: { phys: 30, scoring: 30, playmaking: 25, defense: 30, rebounding: 20, mental: 25 },
    signatures: ['movement-shooter', 'downhill'],
    approach: { assertiveness: 68, range: 62, motor: 58, defense: 52, playmaking: 48 },
    plan: { slots: ['extraWork', 'body', 'rest'], focus: 'scoring' },
    declareAfterCollegeSeasons: 1,
  },
  {
    name: 'fourstar-balanced',
    preset: 'fourstar',
    budget: { phys: 20, scoring: 24, playmaking: 20, defense: 22, rebounding: 10, mental: 14 },
    signatures: ['three-and-d', 'glue'],
    approach: { assertiveness: 52, range: 55, motor: 55, defense: 58, playmaking: 50 },
    plan: { slots: ['extraWork', 'film', 'rest'], focus: 'defense' },
    declareAfterCollegeSeasons: 2,
  },
  {
    name: 'walkon-grinder',
    preset: 'walkon',
    budget: { phys: 12, scoring: 12, playmaking: 10, defense: 12, rebounding: 6, mental: 8 },
    signatures: ['glue', 'rim-runner'],
    approach: { assertiveness: 45, range: 48, motor: 66, defense: 60, playmaking: 50 },
    plan: { slots: ['extraWork', 'film', 'body'], focus: 'defense' },
    declareAfterCollegeSeasons: 4,
  },
];

interface CareerReport {
  pilot: string;
  seed: string;
  finalPhase: string;
  years: number;
  draft: string;                 // 'r1p5' | 'undrafted'
  pick: number | null;
  hsPpg: number;
  lastPrePpg: number;
  events: number;
  phone: number;
  maxZeroEventStreak: number;
  meanEventsPerWeek: number;
  inSeasonEnergyMin: number;
  pinnedWeeksPct: number;
  earnings: number;
  honors: number;
  invariantBreaches: number;
  lintFailures: number;
  crashed: string | null;
}

function specFor(pilot: Pilot, i: number): CreationSpec {
  return {
    firstName: 'Acceptance', lastName: `${pilot.name}-${i}`,
    nationality: 'us', birthplace: 'Dayton, Ohio',
    pos: 'SG', heightIn: 77, weightLb: 196,
    background: 'aau', preset: pilot.preset,
    budget: pilot.budget, signatures: pilot.signatures,
  } as unknown as CreationSpec;
}

function ppgFrom(career: CareerState, kind: string): number {
  const rows = career.circuitHistory.filter(h => h.kind === kind);
  const last = rows[rows.length - 1];
  if (!last || last.myLine.gp === 0) return 0;
  return Math.round((last.myLine.pts / last.myLine.gp) * 10) / 10;
}

/** Drive one whole career on a fixed script; judge as it goes. */
async function runCareer(pilot: Pilot, i: number, sim: Parameters<typeof advanceCareerWeek>[1]): Promise<CareerReport> {
  const seed = `${SEED}:${pilot.name}:${i}`;
  const report: CareerReport = {
    pilot: pilot.name, seed, finalPhase: 'hs', years: 0, draft: 'undrafted', pick: null,
    hsPpg: 0, lastPrePpg: 0, events: 0, phone: 0,
    maxZeroEventStreak: 0, meanEventsPerWeek: 0, inSeasonEnergyMin: 100, pinnedWeeksPct: 0,
    earnings: 0, honors: 0, invariantBreaches: 0, lintFailures: 0, crashed: null,
  };
  let career: CareerState;
  try {
    career = createCareer({ seed, spec: specFor(pilot, i) });
  } catch (err) {
    report.crashed = `createCareer: ${(err as Error).message}`;
    return report;
  }
  applyChoice(career, { kind: 'setWeekPlan', plan: pilot.plan as never });

  const startYear = career.clock.year;
  let weeks = 0;
  let zeroStreak = 0;
  let inSeasonWeeks = 0;
  let pinnedWeeks = 0;
  let nbaWeeksLived = 0;
  let retiredYearsLived = 0;

  try {
    while (weeks < MAX_WEEKS) {
      weeks += 1;
      const phase = career.clock.phase;
      if (phase === 'retired' && retiredYearsLived >= 5) break;

      // the script's standing decisions: a sane player rests a drained
      // body (the band then measures the design, not script stubbornness)
      if (career.energy < 35 && phase !== 'retired') {
        applyChoice(career, { kind: 'setWeekPlan', plan: { slots: ['rest', 'rest', 'life'], focus: pilot.plan.focus } as never });
      } else {
        applyChoice(career, { kind: 'setWeekPlan', plan: pilot.plan as never });
      }
      if (career.circuit && !career.circuit.complete) {
        applyChoice(career, { kind: 'setApproach', card: pilot.approach });
      }
      if (phase === 'college' && career.clock.week === 0
        && career.circuitHistory.filter(h => h.kind === 'college').length >= pilot.declareAfterCollegeSeasons) {
        applyChoice(career, { kind: 'declareDraft' });
      }
      if (phase === 'draftPrep' && career.stock?.workoutInvites.length) {
        for (const t of [...career.stock.workoutInvites]) {
          applyChoice(career, { kind: 'attendWorkout', teamId: t });
        }
      }
      if (phase === 'nba' && nbaWeeksLived >= NBA_SEASONS * 52) {
        const r = applyChoice(career, { kind: 'retire' });
        if (r.ok) continue; // the retired loop finishes the story
      }

      const eventsBefore = career.events.length;
      const inSeason = Boolean(career.circuit && !career.circuit.complete) || phase === 'nba';
      const digest = await advanceCareerWeek(career, sim);

      // the boredom audit's raw material
      const newEvents = career.events.length - eventsBefore + digest.messages.length;
      if (newEvents === 0 && phase !== 'retired') {
        zeroStreak += 1;
        report.maxZeroEventStreak = Math.max(report.maxZeroEventStreak, zeroStreak);
      } else {
        zeroStreak = 0;
      }
      if (inSeason) {
        inSeasonWeeks += 1;
        report.inSeasonEnergyMin = Math.min(report.inSeasonEnergyMin, career.energy);
        if (career.energy === 0) pinnedWeeks += 1;
      }
      if (phase === 'nba') nbaWeeksLived += 1;
      if (phase === 'retired') retiredYearsLived += 1; // one advance = one retired year

      // THE INVARIANT, live: the clocks must never sit at reactGames
      const t = career.params.trust;
      if (career.coach.roleClock.above >= t.reactGames || career.coach.roleClock.below >= t.reactGames) {
        report.invariantBreaches += 1;
      }
    }
  } catch (err) {
    report.crashed = `week ${weeks} (${career.clock.phase}): ${(err as Error).message}`;
  }

  // the explained-consequence lint over the whole record
  for (const e of career.events) {
    if (!e.reason || e.reason.trim() === '') report.lintFailures += 1;
  }
  for (const g of career.coach.grades) {
    if (!g.note || g.note.trim() === '') report.lintFailures += 1;
  }
  for (const l of career.ledger) {
    if (!l.label || l.label.trim() === '') report.lintFailures += 1;
  }

  const drafted = career.events.find(e => e.kind === 'transaction' && e.reason.startsWith('drafted:'));
  if (drafted) {
    const m = drafted.reason.match(/round (\d), pick (\d+)/);
    if (m) {
      report.pick = (Number(m[1]) - 1) * 30 + Number(m[2]);
      report.draft = `r${m[1]}p${m[2]}`;
    }
  }
  report.finalPhase = career.clock.phase;
  report.years = career.clock.year - startYear;
  report.hsPpg = ppgFrom(career, 'hs');
  report.lastPrePpg = ppgFrom(career, 'college') || ppgFrom(career, 'euro') || ppgFrom(career, 'nbl') || report.hsPpg;
  report.events = career.events.length;
  report.phone = career.phone.length;
  report.meanEventsPerWeek = Math.round(((career.events.length + career.phone.length) / Math.max(1, weeks)) * 100) / 100;
  report.pinnedWeeksPct = inSeasonWeeks ? Math.round((pinnedWeeks / inSeasonWeeks) * 1000) / 10 : 0;
  report.earnings = career.ledger.reduce((s, e) => s + e.amount, 0);
  report.honors = career.events.filter(e => e.kind === 'honor').length;
  return report;
}

/** The determinism gate: 40 identical scripted weeks, twice, byte-equal. */
async function determinismGate(sim: Parameters<typeof advanceCareerWeek>[1]): Promise<string | null> {
  const snap = async (): Promise<string> => {
    const career = createCareer({ seed: `${SEED}:det`, spec: specFor(PILOTS[1]!, 99) });
    applyChoice(career, { kind: 'setWeekPlan', plan: PILOTS[1]!.plan as never });
    for (let w = 0; w < 40; w++) {
      if (career.circuit && !career.circuit.complete) {
        applyChoice(career, { kind: 'setApproach', card: PILOTS[1]!.approach });
      }
      await advanceCareerWeek(career, sim);
    }
    return JSON.stringify(career);
  };
  const a = await snap();
  const b = await snap();
  if (a === b) return null;
  // locate the first divergence for the report
  let at = 0;
  while (at < Math.min(a.length, b.length) && a[at] === b[at]) at++;
  return `states diverge at char ${at}: ...${a.slice(Math.max(0, at - 60), at + 40)}... vs ...${b.slice(Math.max(0, at - 60), at + 40)}...`;
}

async function main(): Promise<void> {
  console.log(`gm:career-acceptance — ${CAREERS} careers, seed ${SEED}, ${WORKERS} workers, ${NBA_SEASONS} NBA seasons`);
  const started = Date.now();
  const pool = makeWorkerPool({ workers: WORKERS });
  const gateFailures: string[] = [];

  // GATE: determinism first (everything else is noise if it fails)
  const det = await determinismGate(pool);
  if (det) gateFailures.push(`determinism: ${det}`);
  console.log(`determinism: ${det ? 'FAIL' : 'ok'} (${Math.round((Date.now() - started) / 1000)}s)`);

  const reports: CareerReport[] = [];
  for (let i = 0; i < CAREERS; i++) {
    const pilot = PILOTS[i % PILOTS.length]!;
    const t0 = Date.now();
    const r = await runCareer(pilot, i, pool);
    reports.push(r);
    console.log(`career ${i + 1}/${CAREERS} ${pilot.name}: ${r.finalPhase} after ${r.years}y, `
      + `draft ${r.draft}, hs ${r.hsPpg} ppg, events ${r.events}, ${Math.round((Date.now() - t0) / 1000)}s`
      + (r.crashed ? ` CRASH: ${r.crashed}` : ''));
  }

  // GATES over the fleet
  for (const r of reports) {
    if (r.crashed) gateFailures.push(`${r.pilot}: crashed: ${r.crashed}`);
    if (r.invariantBreaches > 0) gateFailures.push(`${r.pilot}: reacting-world invariant breached ${r.invariantBreaches}x (role clock sat at reactGames)`);
    if (r.lintFailures > 0) gateFailures.push(`${r.pilot}: ${r.lintFailures} unexplained consequences (empty reasons)`);
    if (r.finalPhase === 'hs' || r.finalPhase === 'college') gateFailures.push(`${r.pilot}: career stalled in ${r.finalPhase}`);
  }

  // BANDS
  const bands: Array<[string, boolean, string]> = [];
  const byPreset = (p: string) => reports.filter(r => r.pilot.startsWith(p) && r.pick !== null).map(r => r.pick!);
  const phenomPicks = byPreset('phenom');
  const walkonPicks = byPreset('walkon');
  if (phenomPicks.length && walkonPicks.length) {
    const ordered = Math.min(...phenomPicks) < Math.max(...walkonPicks);
    bands.push(['draft tracks creation quality (phenom above walkon)', ordered,
      `phenom best ${Math.min(...phenomPicks)}, walkon worst ${Math.max(...walkonPicks)}`]);
  } else {
    bands.push(['draft tracks creation quality', phenomPicks.length > 0,
      `phenom picks [${phenomPicks.join(', ')}], walkon [${walkonPicks.join(', ') || 'undrafted'}] (an undrafted walkon is itself in-band)`]);
  }
  for (const r of reports) {
    bands.push([`${r.pilot}: content pulse (>= 0.8 items/week)`, r.meanEventsPerWeek >= 0.8, `${r.meanEventsPerWeek}/week`]);
    bands.push([`${r.pilot}: zero-event streak <= 4 weeks`, r.maxZeroEventStreak <= 4, `${r.maxZeroEventStreak} weeks`]);
    bands.push([`${r.pilot}: energy floor holds (pinned < 20% of season)`, r.pinnedWeeksPct < 20, `${r.pinnedWeeksPct}% pinned, min ${r.inSeasonEnergyMin}`]);
    bands.push([`${r.pilot}: phone volume sane (20 to 400 lifetime)`, r.phone >= 20 && r.phone <= 400, `${r.phone} messages`]);
  }

  console.log('\n=== career report ===');
  for (const r of reports) {
    console.log(`  ${r.pilot}: ${r.draft.padEnd(10)} hs ${String(r.hsPpg).padStart(5)} ppg | last pre-NBA ${String(r.lastPrePpg).padStart(5)} ppg | `
      + `$${(r.earnings / 1e6).toFixed(1)}m | honors ${r.honors} | ${r.finalPhase}`);
  }
  console.log('\n=== bands ===');
  for (const [name, pass, detail] of bands) {
    console.log(`  ${pass ? 'PASS' : 'MISS'}  ${name} (${detail})`);
  }
  console.log('\n=== gates ===');
  if (gateFailures.length === 0) {
    console.log('  all gates hold');
  } else {
    for (const g of gateFailures) console.log(`  FAIL  ${g}`);
    process.exitCode = 1;
  }
  console.log(`\n${Math.round((Date.now() - started) / 1000)}s total`);
  process.exit(process.exitCode ?? 0);
}

main().catch(err => {
  console.error('career-acceptance crashed:', err);
  process.exit(1);
});
