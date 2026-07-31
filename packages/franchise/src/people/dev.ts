/**
 * people/dev.ts - player development and aging. OWNER: people task.
 *
 * Design law (docs/FRANCHISE.md §5; research 01 finding 1): development
 * legibility is the most-memed failure in the genre, so arcs here are
 * SMOOTH and EXPLAINED. Growth is earned (minutes actually played, coach
 * dev quality, work ethic) and bounded per review; every change lands in
 * the devLog with plain-language reasons a player card can print. Busts
 * come from scouting error (the gap between the scouted range and the
 * hidden ceiling), not from dice: the per-review random tail is small
 * (params.dev.noiseSd) and the one exception, the breakout season, is
 * rare, flagged, and named in the log. Decline is a deterministic curve
 * (applyAging), never a review roll.
 *
 * Randomness: stream 'dev:<season>:<playerId>' only (rng.ts registry).
 * One player's rolls never reshuffle another's. Both reviews of a season
 * share the stream; the offseason review consumes a breakout roll first,
 * so its draw sequence never mirrors the midseason one.
 */
import type { Attributes } from '@hoopsh/engine';
import type { AttrGroup, DevNote, FrPlayer, League, Season } from '../types.js';
import { streamRng } from '../rng.js';

/**
 * Attribute-group membership. Mirrors the PotentialProfile contract
 * comment in types.ts EXACTLY (6+5+3+5+3+2 = all 24 engine dials); the
 * grouping is frozen there, this is the runtime copy development math
 * iterates over.
 */
export const ATTR_GROUPS: Record<AttrGroup, ReadonlyArray<keyof Attributes>> = {
  phys: ['speed', 'accel', 'strength', 'vertical', 'lateral', 'stamina'],
  scoring: ['finishing', 'midRange', 'three', 'freeThrow', 'drawFoul'],
  playmaking: ['ballHandle', 'passAcc', 'passVision'],
  defense: ['perimeterD', 'interiorD', 'steal', 'block', 'contestSkill'],
  rebounding: ['offReb', 'defReb', 'boxout'],
  mental: ['decisions', 'consistency'],
};

/** Stable group iteration order (PotentialProfile declaration order). */
const GROUP_ORDER: readonly AttrGroup[] = ['phys', 'scoring', 'playmaking', 'defense', 'rebounding', 'mental'];

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

/** Mean of a player's dials in one attribute group (the group's current level, 0-100). */
export function groupMean(attr: Attributes, group: AttrGroup): number {
  const keys = ATTR_GROUPS[group];
  let sum = 0;
  for (const k of keys) sum += attr[k];
  return sum / keys.length;
}

/**
 * Regular-season totals for the named season, summed across trade stints
 * (a mid-season trade splits the season into two rows). Used as the
 * development minutes signal, the disposition role signal, and the
 * retirement fringe-role signal; exported for tests and siblings in this
 * module family.
 */
export function regularSeasonTotals(player: FrPlayer, season: Season): { min: number; gp: number } {
  let min = 0;
  let gp = 0;
  for (const row of player.seasons) {
    if (row.season === season && row.type === 'regular') {
      min += row.min;
      gp += row.gp;
    }
  }
  return { min, gp };
}

/** The devQuality of the coach whose team employs the player; null for free agents. */
function coachDevQualityFor(league: League, playerId: string): number | null {
  for (const tid of Object.keys(league.teams).sort()) {
    const team = league.teams[tid]!;
    if (team.roster.includes(playerId) || team.twoWay.includes(playerId)) return team.coach.devQuality;
  }
  return null;
}

/**
 * Spread a group's growth across its dials, weighted toward the dials
 * furthest below the group ceiling: development rounds off the rough
 * edges first (the raw athlete learns to shoot before his elite speed
 * gets faster). Integer writes only; the rounding remainder carries down
 * the group within this call so the group total survives rounding.
 * Returns the applied integer sum.
 */
function distributeGrowth(attr: Attributes, group: AttrGroup, ceiling: number, delta: number): number {
  const keys = ATTR_GROUPS[group];
  const weights: number[] = [];
  let total = 0;
  for (const k of keys) {
    const w = Math.max(0, ceiling - attr[k]); // dials at/above the ceiling never grow past it
    weights.push(w);
    total += w;
  }
  if (total <= 0) return 0;
  let carry = 0;
  let applied = 0;
  keys.forEach((k, i) => {
    const exact = delta * (weights[i]! / total) + carry;
    const step = Math.round(exact);
    carry = exact - step;
    const next = clamp(Math.round(attr[k] + step), 0, 100); // ratings are integer 0-100 by contract
    applied += next - attr[k];
    attr[k] = next;
  });
  return applied;
}

/**
 * Spread a group's decline across its dials proportional to current
 * value: erosion prunes the tallest dial first (a 90 speed has more to
 * lose than a 45 strength). FEEL weighting; same integer-write-with-carry
 * discipline as growth. Returns the applied (negative) integer sum.
 */
function distributeDecline(attr: Attributes, group: AttrGroup, decline: number): number {
  const keys = ATTR_GROUPS[group];
  const weights: number[] = [];
  let total = 0;
  for (const k of keys) {
    const w = Math.max(0, attr[k]);
    weights.push(w);
    total += w;
  }
  if (total <= 0) return 0;
  let carry = 0;
  let applied = 0;
  keys.forEach((k, i) => {
    const exact = -decline * (weights[i]! / total) + carry;
    const step = Math.round(exact);
    carry = exact - step;
    const next = clamp(Math.round(attr[k] + step), 0, 100);
    applied += next - attr[k];
    attr[k] = next;
  });
  return applied;
}

/**
 * Run a development review for every non-retired player. Called by the
 * spine twice per season (params.dev.reviewsPerSeason): at the all-star
 * break ('midseason') and at rollover ('offseason'). Mutates player
 * attributes, tend.usage, and devLog; touches nothing else.
 *
 * Growth per group = growthBase, scaled by review weight, minutes earned,
 * coach devQuality, work ethic, ceiling headroom, and the age gate, plus
 * small gaussian noise; bounded per group per review so arcs read smooth
 * (research 01 finding 1). Decline never happens here (applyAging owns it).
 */
export function runDevelopmentReview(league: League, when: 'midseason' | 'offseason'): void {
  const dev = league.params.dev;
  const peaks = league.params.aging.peakAge;
  // The offseason program is where structural gains land; the midseason
  // review is a practice-time checkpoint worth 40% of one. FEEL 0.40.
  const reviewScale = when === 'offseason' ? 1 : 0.40;

  for (const id of Object.keys(league.players).sort()) {
    const player = league.players[id]!;
    if (player.status === 'retired') continue;
    const rng = streamRng(league.seed, 'dev', league.season, id);
    const age = league.season - player.bornSeason;

    // Breakout roll: drawn at EVERY offseason review (and only honored for
    // players 24 and under, FEEL: the leap window; past it a summer
    // reshapes a role, not a career) so the offseason draw sequence
    // decorrelates from the midseason one on the shared per-season stream.
    let breakout = false;
    if (when === 'offseason') {
      const roll = rng.float();
      breakout = age <= 24 && roll < dev.breakoutRate;
    }

    // Minutes teach: linear from minutesFactorFloor at zero minutes to
    // minutesFactorCeil at a full starter workload (params.dev.minutesForCeil).
    const totals = regularSeasonTotals(player, league.season);
    const minutesF = dev.minutesFactorFloor
      + (dev.minutesFactorCeil - dev.minutesFactorFloor) * Math.min(1, totals.min / dev.minutesForCeil);

    // Staff quality: the line runs through 1.0 at a league-average staff
    // (rating 50) up to coachFactorAt100; below-average staffs land under
    // 1.0 on the same line. Free agents have no staff: neutral 1.0.
    const devQ = coachDevQualityFor(league, id);
    const coachF = devQ === null ? 1 : 1 + ((devQ - 50) / 50) * (dev.coachFactorAt100 - 1);
    // Work ethic on the same 50-centered line up to ethicFactorAt100.
    const ethicF = 1 + ((player.workEthic - 50) / 50) * (dev.ethicFactorAt100 - 1);

    const deltas: Partial<Record<AttrGroup, number>> = {};
    let skillGain = 0; // scoring + playmaking points applied, feeds the usage drift
    let gateFading = false;

    for (const group of GROUP_ORDER) {
      // Noise is drawn for every group unconditionally so the stream's
      // draw order is fixed no matter which gates fire below.
      const noise = rng.gaussian(0, dev.noiseSd);

      // Age gate: growth fades to zero across the 2 seasons after the
      // group peak (per spec; decline itself belongs to applyAging).
      const ageGate = clamp(1 - Math.max(0, age - peaks[group]) / 2, 0, 1);
      if (ageGate <= 0) continue;

      const mean = groupMean(player.attr, group);
      const ceiling = player.potential[group];
      const headroom = ceiling - mean;
      if (headroom <= 0) continue; // at the ceiling: development is done here

      // Approach slows near the ceiling: full rate with a standard young
      // player's headroom (12 points, the params.gen.ceilingHeadroomMean
      // anchor), tapering linearly as the gap closes. FEEL.
      const headroomF = Math.min(1, headroom / 12);

      const earned = dev.growthBase * reviewScale * minutesF * coachF * ethicF
        * (breakout ? 1.6 : 1); // FEEL 1.6: a breakout year, visible but not cartoonish
      // Gates multiply the noise too: a closed growth window does not
      // jitter upward, it is closed.
      let groupDelta = (earned + noise) * ageGate * headroomF;
      // Hard per-group cap of 6 points per review (FEEL): legible arcs,
      // never jumps (research 01 finding 1). Never past the ceiling.
      groupDelta = clamp(groupDelta, 0, Math.min(6, headroom));
      if (groupDelta <= 0) continue;
      if (ageGate < 1) gateFading = true;

      const applied = distributeGrowth(player.attr, group, ceiling, groupDelta);
      if (applied !== 0) {
        deltas[group] = applied;
        if (group === 'scoring' || group === 'playmaking') skillGain += applied;
      }
    }

    // One DevNote per player per review, always: the card explains quiet
    // reviews too ('held steady' beats silence for trust).
    const reasons: string[] = [];
    if (Object.keys(deltas).length > 0) {
      reasons.push(totals.min > 0 ? `earned ${Math.round(totals.min)} minutes` : 'practice reps only');
      if (devQ !== null) reasons.push(`devQuality ${devQ} staff`);
      // 70/30: notable-habit thresholds for the card copy only. FEEL.
      if (player.workEthic >= 70) reasons.push(`work ethic ${player.workEthic}: first one in the gym`);
      else if (player.workEthic <= 30) reasons.push(`work ethic ${player.workEthic}: habits slow the work`);
      if (breakout) reasons.push('breakout: took the leap this season');
      if (gateFading) reasons.push(`age ${age}: growth window closing`);
    } else {
      reasons.push(age > peaks.mental ? `age ${age}: holding what he has` : 'held steady');
    }
    // fresh date object per note: the log is persisted career state and
    // must never share mutable structure across players
    const note: DevNote = { date: { season: league.season, day: league.day }, deltas, reasons };
    player.devLog.push(note);

    // Earning shots follows earning skill: a player visibly leveling up in
    // the scoring/playmaking groups wants, and gets, more of the offense.
    // One usage point per qualifying review (thresholds FEEL: 3+ applied
    // skill points on an already above-average scorer, group mean 60+)
    // keeps identity stable. Shot-diet tendencies stay put on purpose: a
    // midrange operator does not become a three-point specialist because
    // he improved.
    if (skillGain >= 3 && groupMean(player.attr, 'scoring') >= 60) {
      player.tend.usage = clamp(Math.round(player.tend.usage + 1), 0, 100);
    }
  }
}

/**
 * Apply aging decline at season rollover (the spine calls this once per
 * rollover, before the offseason review). Mutates attributes, tend.usage,
 * and devLog. Deterministic on purpose: no rng, decline is a curve, not a
 * roll (dice-driven collapse is the exact failure research 01 flags).
 *
 * Per group past its peak age: decline = declineBase + declineAccelPerYear
 * per year past, scaled up by career wear, softened by elite work ethic.
 * phys declines fastest by construction of the peak ages (peakAge.phys is
 * the youngest), which is the researched order: athleticism goes first,
 * shooting and decision-making hold late (research 05 B2).
 */
export function applyAging(league: League): void {
  const aging = league.params.aging;

  for (const id of Object.keys(league.players).sort()) {
    const player = league.players[id]!;
    if (player.status === 'retired') continue;
    const age = league.season - player.bornSeason;
    const wear = player.health.wear;
    // Chronic wear accelerates the slide: 1.0 with a clean body up to
    // wearDeclineFactorAt100 at wear 100.
    const wearF = 1 + (wear / 100) * (aging.wearDeclineFactorAt100 - 1);
    // FEEL: pros who keep their bodies right age gracefully; work ethic
    // 70+ softens decline by 15%.
    const ethicSoften = player.workEthic >= 70 ? 0.85 : 1;

    const deltas: Partial<Record<AttrGroup, number>> = {};
    let totalDecline = 0;

    for (const group of GROUP_ORDER) {
      const yearsPast = age - aging.peakAge[group];
      if (yearsPast <= 0) continue;
      // BBIQ and shooting touch hold late (research 05 B2: decision-making
      // and 3P accuracy decline last of all skills): the mental group never
      // declines before 34. FEEL threshold.
      if (group === 'mental' && age < 34) continue;
      let decline = (aging.declineBase + aging.declineAccelPerYear * yearsPast) * wearF * ethicSoften;
      // 10-point per-group season cap (FEEL): even a late-30s cliff stays
      // readable on the card instead of vaporizing a player in one summer.
      decline = Math.min(10, decline);
      const applied = distributeDecline(player.attr, group, decline);
      if (applied !== 0) {
        deltas[group] = applied;
        totalDecline += -applied;
      }
    }

    if (Object.keys(deltas).length === 0) continue; // pre-peak players skip silently

    const reasons: string[] = [];
    // Athleticism goes before skill: when the phys group is declining that
    // is the story the card should tell.
    reasons.push(deltas.phys !== undefined ? `age ${age}: legs first` : `age ${age}: the curve bends down`);
    if (wear >= 40) reasons.push(`wear ${wear} taking its toll`); // 40: visible-mileage threshold for card copy. FEEL
    if (ethicSoften < 1) reasons.push('conditioning slows the slide');
    player.devLog.push({ date: { season: league.season, day: league.day }, deltas, reasons });

    // A declining player hands usage back to the offense a point at a
    // time (4+ points lost in one rollover, FEEL threshold): the aging
    // star stops being force-fed. Shot diet stays his own.
    if (totalDecline >= 4) {
      player.tend.usage = clamp(Math.round(player.tend.usage - 1), 0, 100);
    }
  }
}
