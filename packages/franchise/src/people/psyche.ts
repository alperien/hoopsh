/**
 * people/psyche.ts - confidence, locker room chemistry, lifestyle. OWNER:
 * psyche task.
 *
 * The layer register F1 said would never exist, amended by the owner this
 * wave (register F1-A, INTEGRATION-psyche.md): psyche now touches the
 * court, but ONLY through the legal pre-game seam (gameday.ts projectTeam,
 * where fatigue and HCA already pre-degrade attributes) and through the
 * existing off-court systems (morale in disposition.ts, development in
 * dev.ts). Hard caps everywhere; no post-hoc stat edits, ever.
 *
 * HOUSE RULES this module inherits from disposition.ts:
 * - Recompute style: targets are pure functions of today's league state.
 *   The stored value only STEPS toward the target (bounded per update), so
 *   confidence never teleports and chemistry never oscillates.
 * - Quiet by design: a healthy winning league recomputes to baselines and
 *   the UI has nothing to gossip about. Weekly cadence, no mood spam.
 * - Determinism: the only dice are the one-time lifestyle assignment and
 *   the rare news beat, on registered streams ('psyche:lifestyle:<playerId>',
 *   'psyche:news:<season>:<day>'; see INTEGRATION-psyche.md for the rng.ts
 *   registry note). Everything else is dice-free recomputation.
 * - State rides ON the objects (player.psyche / team.psyche as optional
 *   extension fields, typed locally until the types.ts patch lands) so it
 *   serializes with the league. initPsyche fills missing state lazily and
 *   idempotently: genesis rosters, draftees, and old saves all work.
 */
import type { Attributes } from '@hoopsh/engine';
import type {
  FrPlayer, FrTeam, League, LeagueDate, NewsItem, PlayerId, TeamId,
} from '../types.js';
import { streamRng } from '../rng.js';

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

// ---------------------------------------------------------------------------
// tunables

/**
 * Psyche parameter block. params.ts is frozen mid-wave, so the section
 * lives here with an accessor that reads league.params.psyche once the
 * INTEGRATION-psyche.md params patch lands and falls back to these
 * defaults until then. Same provenance discipline as params.ts.
 */
export interface PsycheParams {
  /** CAL 1.5: max attribute points a player's confidence moves the offensive-execution dials, either direction */
  confAttrCap: number;
  /** CAL 1.0: max attribute points team chemistry moves the same dials, team-wide; smaller than the personal dial by design */
  chemAttrCap: number;
  /** FEEL 8: max confidence movement per weekly update (no teleporting) */
  confStep: number;
  /** FEEL 3: max chemistry movement per weekly update; the room MUST move slower than the man */
  chemStep: number;
  /** FEEL 1: chemistry deadband; targets within this of current do not move (hysteresis, no oscillation) */
  chemDeadband: number;
  /** CAL 0.05: dev-review factor span from chemistry; bounds 0.95-1.05 by construction */
  chemDevSpan: number;
  /** FEEL 0.02: per-day chance of one lifestyle news beat league-wide (~3-4 per regular season) */
  lifestyleNewsRate: number;
}

export function defaultPsycheParams(): PsycheParams {
  return {
    confAttrCap: 1.5,
    chemAttrCap: 1.0,
    confStep: 8,
    chemStep: 3,
    chemDeadband: 1,
    chemDevSpan: 0.05,
    lifestyleNewsRate: 0.02,
  };
}

/** league.params.psyche once the params patch lands; defaults until then. */
export function psycheParams(league: League): PsycheParams {
  const over = (league.params as { psyche?: Partial<PsycheParams> }).psyche;
  return over ? { ...defaultPsycheParams(), ...over } : defaultPsycheParams();
}

/** Neutral confidence: the league-average night. FEEL 50. */
export const CONF_BASE = 50;
/** Content-room chemistry baseline: a professional roster with no churn sits here. FEEL 60. */
export const CHEM_BASE = 60;

/** FEEL 5: recent-form window in games. */
const FORM_GAMES = 5;
/** FEEL 100: season minutes below which form reads as nothing (opening-week noise). */
const FORM_MIN_SEASON_MINUTES = 100;
/** FEEL 60: days on the roster before a new arrival stops dragging the room. */
const BOND_DAYS = 60;
/** FEEL 120: lazy init seeds current rosters as settled (genesis and old saves carry no phantom churn). */
const SETTLED_TENURE_DAYS = 120;
/** FEEL 30: an offseason together settles a room this much (tenure bridge across rollover). */
const OFFSEASON_TENURE_BRIDGE = 30;
/** FEEL 400: tenure cap; past a season and a half together the bond is the bond. */
const TENURE_CAP_DAYS = 400;

/**
 * The dials psyche shifts: offensive execution only, mirroring gameday.ts
 * HCA_OFFENSE_KEYS exactly (that constant is not exported; this is the
 * documented copy). Confidence and chemistry are execution states, not
 * strength or speed: the slumping player presses his reads and his shot,
 * he does not get slower.
 */
export const PSYCHE_OFFENSE_KEYS: ReadonlyArray<keyof Attributes> = [
  'finishing', 'midRange', 'three', 'freeThrow', 'passAcc', 'decisions',
];

// ---------------------------------------------------------------------------
// state shapes and accessors

export type LifestyleKey =
  | 'gymRat' | 'quietPro' | 'familyMan' | 'nightlife' | 'mediaDarling' | 'gamerHermit';

/** Stable label order for deterministic scoring/iteration. */
export const LIFESTYLE_KEYS: readonly LifestyleKey[] = [
  'gymRat', 'quietPro', 'familyMan', 'nightlife', 'mediaDarling', 'gamerHermit',
];

export interface PlayerPsyche {
  /** 0-100; stepped weekly toward a recomputed target */
  confidence: number;
  /** assigned once at init from disposition axes plus one seeded roll */
  lifestyle: LifestyleKey;
}

export interface TeamPsyche {
  /** 0-100; stepped weekly, slower than confidence, with a deadband */
  chemistry: number;
  /** days each current roster/two-way player has been with the team (bond age) */
  tenureDays: Record<PlayerId, number>;
  /** last weekly update; the idempotence guard (same day = no re-step) */
  updatedOn: LeagueDate | null;
}

/** Local extension typing until the types.ts patch lands (INTEGRATION-psyche.md). */
type PsychePlayer = FrPlayer & { psyche?: PlayerPsyche };
type PsycheTeam = FrTeam & { psyche?: TeamPsyche };

/** A player's psyche state, or null before initPsyche has run for him. */
export function playerPsyche(player: FrPlayer): PlayerPsyche | null {
  return (player as PsychePlayer).psyche ?? null;
}

/** A team's chemistry 0-100, or null before initPsyche has run for it. */
export function teamChemistry(team: FrTeam): number | null {
  return (team as PsycheTeam).psyche?.chemistry ?? null;
}

/** Chemistry of the team employing the player, or null (free agents, pre-init). */
export function teamChemistryFor(league: League, playerId: PlayerId): number | null {
  for (const tid of Object.keys(league.teams).sort()) {
    const team = league.teams[tid]!;
    if (team.roster.includes(playerId) || team.twoWay.includes(playerId)) {
      return teamChemistry(team);
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// lazy init

/**
 * Lifestyle assignment: the disposition axes lead, one seeded roll breaks
 * the mold (stream 'psyche:lifestyle:<playerId>', drawn once per career;
 * re-calling returns the same label). Weights FEEL: each label leans on
 * the axes that plausibly produce it, noise keeps rosters from sorting
 * into four archetypes.
 */
export function assignLifestyle(seed: string, player: FrPlayer): LifestyleKey {
  const rng = streamRng(seed, 'psyche', 'lifestyle', player.id);
  const d = player.disposition;
  const scores: Record<LifestyleKey, number> = {
    gymRat: 0.6 * player.workEthic + 0.4 * d.professionalism,
    quietPro: 0.7 * d.professionalism + 0.3 * (100 - d.marketPref),
    familyMan: 0.7 * d.loyalty + 0.3 * (100 - d.marketPref),
    nightlife: 0.6 * (100 - d.professionalism) + 0.4 * d.marketPref,
    mediaDarling: 0.6 * d.marketPref + 0.4 * d.ambition,
    gamerHermit: 0.5 * (100 - d.marketPref) + 0.5 * (100 - d.ambition),
  };
  let best: LifestyleKey = LIFESTYLE_KEYS[0]!;
  let bestScore = -Infinity;
  for (const key of LIFESTYLE_KEYS) {
    // FEEL 55: the roll matters (identity is not pure destiny) but the axes lead
    const s = scores[key] + rng.float() * 55;
    if (s > bestScore) {
      bestScore = s;
      best = key;
    }
  }
  return best;
}

/**
 * Idempotently fill missing psyche state: every non-retired player gets
 * confidence at the neutral baseline plus a lifestyle; every team gets
 * baseline chemistry with its CURRENT roster seeded as settled (no phantom
 * churn on genesis rosters or old saves). Called at the top of every
 * updatePsyche, so draftees and trade arrivals self-heal on the next tick.
 * Calling twice changes nothing: existing state is never touched.
 */
export function initPsyche(league: League): void {
  for (const pid of Object.keys(league.players).sort()) {
    const player = league.players[pid] as PsychePlayer;
    if (player.status === 'retired') continue;
    if (player.psyche) continue;
    player.psyche = {
      confidence: CONF_BASE,
      lifestyle: assignLifestyle(league.seed, player),
    };
  }
  for (const tid of Object.keys(league.teams).sort()) {
    const team = league.teams[tid] as PsycheTeam;
    if (team.psyche) continue;
    const tenureDays: Record<PlayerId, number> = {};
    for (const pid of [...team.roster, ...team.twoWay]) tenureDays[pid] = SETTLED_TENURE_DAYS;
    team.psyche = { chemistry: CHEM_BASE, tenureDays, updatedOn: null };
  }
}

// ---------------------------------------------------------------------------
// confidence

/** This-season regular totals incl. scoring, summed across trade stints. Local
 * copy of dev.ts's totals idea, widened to the shooting columns confidence
 * needs; kept local so this module imports nothing from its siblings (no
 * import cycles: dev.ts and disposition.ts import psyche.ts, never back). */
function seasonTotals(player: FrPlayer, season: number): {
  min: number; gp: number; pts: number; fgm: number; fga: number; tpm: number;
} {
  let min = 0, gp = 0, pts = 0, fgm = 0, fga = 0, tpm = 0;
  for (const row of player.seasons) {
    if (row.season !== season || row.type !== 'regular') continue;
    min += row.min; gp += row.gp; pts += row.pts;
    fgm += row.fgm; fga += row.fga; tpm += row.tpm;
  }
  return { min, gp, pts, fgm, fga, tpm };
}

/** The player's last FORM_GAMES played lines this regular season, oldest first. */
function recentLines(league: League, playerId: PlayerId): Array<{
  min: number; pts: number; fgm: number; fga: number; tpm: number;
}> {
  const rows: Array<{ day: number; id: string; min: number; pts: number; fgm: number; fga: number; tpm: number }> = [];
  for (const id of Object.keys(league.results)) {
    const r = league.results[id]!;
    if (r.date.season !== league.season || r.type !== 'regular') continue;
    for (const line of r.lines) {
      if (line.playerId === playerId && line.min > 0) {
        rows.push({ day: r.date.day, id: r.id, min: line.min, pts: line.pts, fgm: line.fgm, fga: line.fga, tpm: line.tpm });
      }
    }
  }
  rows.sort((a, b) => a.day - b.day || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return rows.slice(-FORM_GAMES);
}

/**
 * Recompute one player's confidence target (0-100) from today's league
 * state. Pure; exported for tests and the UI. Factors, each bounded:
 *
 * - form: last FORM_GAMES scoring rate, shooting efficiency, and minutes
 *   against the player's OWN season baseline (a bench player's hot week
 *   counts the same as a star's)
 * - team: the last-10 trend; winning covers a lot
 * - role: an ambitious player buried under 20 minutes presses; a starter
 *   workload steadies
 * - morale: the off-court state bleeds in modestly (stored morale, which
 *   updateDispositions recomputes on the same cadence)
 *
 * Professionalism damps the whole swing (the pro stays level), ambition
 * amplifies both directions (the alpha rides his own wave). Both FEEL.
 */
export function confidenceTargetFor(league: League, team: FrTeam, player: FrPlayer): number {
  const totals = seasonTotals(player, league.season);
  const recent = recentLines(league, player.id);

  // Personal form vs own baseline. Quiet until the season has shape.
  let form = 0;
  if (totals.min >= FORM_MIN_SEASON_MINUTES && recent.length >= 3) {
    let rMin = 0, rPts = 0, rFgm = 0, rFga = 0, rTpm = 0;
    for (const g of recent) { rMin += g.min; rPts += g.pts; rFgm += g.fgm; rFga += g.fga; rTpm += g.tpm; }
    // scoring rate: per-36 points, recent vs season. 1.2/point FEEL, cap 10.
    const per36Recent = (rPts / rMin) * 36;
    const per36Season = (totals.pts / totals.min) * 36;
    const ptsSwing = clamp((per36Recent - per36Season) * 1.2, -10, 10);
    // efficiency: eFG% recent vs season, needs 15 recent attempts for signal.
    // 40 = 10 eFG points read as 4 confidence points. FEEL.
    let efgSwing = 0;
    if (rFga >= 15 && totals.fga > 0) {
      const efgRecent = (rFgm + 0.5 * rTpm) / rFga;
      const efgSeason = (totals.fgm + 0.5 * totals.tpm) / totals.fga;
      efgSwing = clamp((efgRecent - efgSeason) * 40, -8, 8);
    }
    // minutes: a shrinking role reads as the coach's verdict. 0.4/min FEEL.
    const minSwing = clamp((rMin / recent.length - totals.min / Math.max(1, totals.gp)) * 0.4, -6, 4);
    form = clamp(ptsSwing + efgSwing + minSwing, -18, 18);
  }

  // Team trend: last 10, needs 5 games. 1.4 per game over .500 pace. FEEL.
  let teamT = 0;
  const st = league.standings[team.id];
  if (st && st.last10.length >= 5) {
    let wins = 0;
    for (const g of st.last10) wins += g;
    teamT = clamp((wins - st.last10.length / 2) * 1.4, -7, 7);
  }

  // Role vs ambition fit. Thresholds FEEL: 65+ ambition under 20 minutes a
  // night presses; a 30-minute workload steadies anyone. The deep role
  // grievance math stays in disposition.ts and arrives via morale.
  let roleT = 0;
  if (totals.gp >= 5) {
    const mpg = totals.min / totals.gp;
    if (player.disposition.ambition >= 65 && mpg < 20) roleT = -6;
    else if (mpg >= 30) roleT = 3;
  }

  // Morale coupling: 0.25/point around the content baseline; misery drags
  // harder than contentment lifts. FEEL.
  const moraleT = clamp((player.morale - 70) * 0.25, -12, 5);

  // Professionalism compresses (1.0 down to 0.5 at pro 100); ambition
  // amplifies (0.7 up to 1.3 at ambition 100). Both FEEL.
  const damper = 1 - 0.5 * (player.disposition.professionalism / 100);
  const amp = 0.7 + 0.6 * (player.disposition.ambition / 100);
  return clamp(Math.round(CONF_BASE + damper * amp * (form + teamT + roleT + moraleT)), 0, 100);
}

// ---------------------------------------------------------------------------
// chemistry

/**
 * Recompute one team's chemistry target (0-100) from today's league state.
 * Pure; exported for tests. Factors, each bounded:
 *
 * - professionalism mix: pros keep a room right
 * - frustration: bench players (under 20 minutes) with starter ambition
 * - churn: new arrivals drag until BOND_DAYS together heal it; a trade
 *   resets the arriving player's bond to zero
 * - winning: the record vs .500 once the season has 10 games of shape
 */
export function chemistryTargetFor(league: League, team: FrTeam): number {
  const psy = (team as PsycheTeam).psyche;
  const players: FrPlayer[] = [];
  for (const pid of team.roster) {
    const p = league.players[pid];
    if (p) players.push(p);
  }
  if (players.length === 0) return CHEM_BASE;

  // professionalism mix: 0.2/point around 60. FEEL; bounds [-12, +8].
  let profSum = 0;
  for (const p of players) profSum += p.disposition.professionalism;
  const profT = clamp((profSum / players.length - 60) * 0.2, -12, 8);

  // frustration: each ambitious bench player costs 1.5, capped at 6. FEEL.
  let frustration = 0;
  for (const p of players) {
    const t = seasonTotals(p, league.season);
    if (t.gp >= 5 && p.disposition.ambition >= 65 && t.min / t.gp < 20) frustration += 1.5;
  }
  const frustT = -Math.min(6, frustration);

  // churn: a fresh face is 2 points of drag fading linearly over BOND_DAYS;
  // capped at 10 (a teardown reads as a teardown, not a spiral). FEEL.
  let drag = 0;
  for (const pid of team.roster) {
    const tenure = psy?.tenureDays[pid] ?? 0;
    if (tenure < BOND_DAYS) drag += (1 - tenure / BOND_DAYS) * 2;
  }
  const churnT = -Math.min(10, drag);

  // winning: 20 x (win pct - .500), clamped to [-4, +4], 10-game floor. FEEL.
  let winT = 0;
  const st = league.standings[team.id];
  const games = st ? st.w + st.l : 0;
  if (st && games >= 10) winT = clamp((st.w / games - 0.5) * 20, -4, 4);

  return clamp(Math.round(CHEM_BASE + profT + frustT + churnT + winT), 0, 100);
}

// ---------------------------------------------------------------------------
// the weekly step

/** Step a stored value toward its target, at most `step` per call. */
function stepToward(current: number, target: number, step: number): number {
  return current + clamp(target - current, -step, step);
}

/**
 * The weekly psyche pulse: lazy init, then step every team's chemistry and
 * every rostered player's confidence toward their recomputed targets.
 * Idempotent per calendar day (updatedOn guard), so re-entered days move
 * nothing twice. Call it BEFORE updateDispositions on the same cadence so
 * morale reads this week's room (tick.ts patch, INTEGRATION-psyche.md).
 *
 * Dice-free: targets are pure recomputation, steps are bounded arithmetic.
 */
export function updatePsyche(league: League): void {
  initPsyche(league);
  const params = psycheParams(league);

  for (const tid of Object.keys(league.teams).sort()) {
    const team = league.teams[tid] as PsycheTeam;
    const psy = team.psyche!;
    const last = psy.updatedOn;
    if (last && last.season === league.season && last.day === league.day) continue; // already stepped today

    // bond ageing: current members grow together by the days since the last
    // pulse (an offseason bridge across rollover); arrivals enter at zero;
    // the departed are pruned (a return starts the bond over).
    const delta = last === null ? 0
      : last.season === league.season ? Math.max(0, league.day - last.day)
        : OFFSEASON_TENURE_BRIDGE;
    const next: Record<PlayerId, number> = {};
    for (const pid of [...team.roster, ...team.twoWay]) {
      const prev = psy.tenureDays[pid];
      next[pid] = prev === undefined ? 0 : Math.min(TENURE_CAP_DAYS, prev + delta);
    }
    psy.tenureDays = next;

    // chemistry: slow step with a deadband (quiet by design, no oscillation)
    const chemTarget = chemistryTargetFor(league, team);
    if (Math.abs(chemTarget - psy.chemistry) > params.chemDeadband) {
      psy.chemistry = clamp(Math.round(stepToward(psy.chemistry, chemTarget, params.chemStep)), 0, 100);
    }

    // confidence: per rostered player, faster step, no deadband (form is
    // supposed to move; convergence to a stable target stops on its own)
    for (const pid of [...team.roster, ...team.twoWay]) {
      const player = league.players[pid] as PsychePlayer | undefined;
      if (!player?.psyche) continue;
      const target = confidenceTargetFor(league, team, player);
      player.psyche.confidence = clamp(Math.round(stepToward(player.psyche.confidence, target, params.confStep)), 0, 100);
    }

    psy.updatedOn = { season: league.season, day: league.day };
  }
}

// ---------------------------------------------------------------------------
// on-court seam (register F1-A)

/**
 * The one number the projection seam reads: a bounded shift applied to the
 * offensive-execution dials (PSYCHE_OFFENSE_KEYS) at game-day projection,
 * BEFORE gameday.ts's final integer rounding pass. Personal confidence is
 * worth at most +-confAttrCap (CAL 1.5) at the extremes; the room at most
 * +-chemAttrCap (CAL 1.0), so a confident player in a good room tops out
 * at +2.5 attribute points on six dials and the slumping mirror image at
 * -2.5. Missing psyche state (old saves pre-tick, mid-day draftees) reads
 * as exactly zero: the pre-psyche projection.
 *
 * Returns a finite float; the caller's Math.round pass keeps projected
 * rosters integer-valued (integer-safe by construction).
 */
export function psycheAttrShift(league: League, team: FrTeam, player: FrPlayer): number {
  const params = psycheParams(league);
  let shift = 0;
  const psy = playerPsyche(player);
  if (psy !== null) {
    shift += clamp((psy.confidence - CONF_BASE) / 50, -1, 1) * params.confAttrCap;
  }
  const chem = teamChemistry(team);
  if (chem !== null) {
    shift += clamp((chem - CHEM_BASE) / 40, -1, 1) * params.chemAttrCap;
  }
  return shift;
}

/**
 * Lifestyle recovery factor for the trailing-load fatigue debuff (gameday
 * patch): the gym rat carries load better, the night owl worse. CAL values,
 * bounded 0.85-1.15 by table; 1.0 when unassigned.
 */
export function lifestyleFatigueFactor(player: FrPlayer): number {
  const psy = playerPsyche(player);
  if (!psy) return 1;
  switch (psy.lifestyle) {
    case 'gymRat': return 0.85;      // CAL: recovery habits pay off
    case 'quietPro': return 0.95;    // CAL: sleep is a skill
    case 'nightlife': return 1.12;   // CAL: the city collects
    default: return 1;
  }
}

/**
 * Per-season injury proneness drift from lifestyle (called from dev.ts's
 * applyAging, once per rollover): nightlife up a touch, gym rat down.
 * CAL +-1/season, clamped to [5, 95] so nobody drifts to invincible or
 * made of glass. Unassigned lifestyles do not drift.
 */
export function driftedProneness(player: FrPlayer): number {
  const psy = playerPsyche(player);
  if (!psy) return player.health.proneness;
  const drift = psy.lifestyle === 'nightlife' ? 1 : psy.lifestyle === 'gymRat' ? -1 : 0;
  return clamp(player.health.proneness + drift, 5, 95);
}

/**
 * Development spillover factor from chemistry (dev.ts multiplies this into
 * the earned growth): bounded 1 +- chemDevSpan (0.95-1.05 at defaults) so
 * a good room is a tailwind, never a cheat code. Null chemistry = 1.0.
 */
export function chemDevFactor(chemistry: number | null, params?: PsycheParams): number {
  if (chemistry === null) return 1;
  const span = (params ?? defaultPsycheParams()).chemDevSpan;
  // 40: the distance from CHEM_BASE to the top of the scale; the factor
  // hits its bounds at chemistry 20 and 100.
  return 1 + clamp(chemistry - CHEM_BASE, -40, 40) * (span / 40);
}

/**
 * Morale texture from lifestyle (disposition.ts adds this inside the
 * damped sum): the settled personalities sit a point happier, the night
 * owl a point lower. FEEL; zero when unassigned. Deliberately tiny: the
 * label is texture, not a stat stick.
 */
export function lifestyleMoraleDelta(player: FrPlayer): number {
  const psy = playerPsyche(player);
  if (!psy) return 0;
  switch (psy.lifestyle) {
    case 'quietPro': return 1;
    case 'familyMan': return 1;
    case 'nightlife': return -1;
    default: return 0;
  }
}

// ---------------------------------------------------------------------------
// visible texture

/** One dry phrase for cards and recaps. Bands FEEL. */
export function confidencePhrase(confidence: number): string {
  if (confidence >= 75) return 'playing free';
  if (confidence >= 60) return 'feeling good';
  if (confidence >= 40) return 'level';
  if (confidence >= 25) return 'pressing';
  return 'in his head';
}

/** One-line flavor per lifestyle for the player card. */
export function lifestylePhrase(lifestyle: LifestyleKey): string {
  switch (lifestyle) {
    case 'gymRat': return 'gym rat. First in, last out.';
    case 'quietPro': return 'quiet pro. Does the work, skips the noise.';
    case 'familyMan': return 'family man. Keeps his circle close.';
    case 'nightlife': return 'nightlife. The city knows him.';
    case 'mediaDarling': return 'media darling. The cameras find him.';
    case 'gamerHermit': return 'gamer hermit. Offline only for tipoff.';
  }
}

/** The rare lifestyle beat's copy, one entry per label. Dry, factual, no quotes invented beyond the shrug register the news desk allows. */
const LIFESTYLE_BEATS: Record<LifestyleKey, { headline: string; body: string }> = {
  gymRat: {
    headline: '%N was in the building before sunrise',
    body: 'An off day, and %N still beat the staff to the practice facility. Teammates have stopped being surprised.',
  },
  quietPro: {
    headline: '%N keeps it simple',
    body: 'No entourage, no noise. %N watched film, got his work in, and went home.',
  },
  familyMan: {
    headline: '%N flies the family in for the homestand',
    body: '%N had his people in the building again this week. He says the routine keeps him right.',
  },
  nightlife: {
    headline: '%N spotted out late downtown',
    body: 'A late night out before a game day raised some eyebrows around %T. The team called it a non-issue.',
  },
  mediaDarling: {
    headline: '%N books another sit-down',
    body: '%N taped a long interview this week, his third media appearance of the month. The cameras find him either way.',
  },
  gamerHermit: {
    headline: '%N streamed past midnight again',
    body: '%N logged another marathon session online. His coaches shrug. His routine has not missed.',
  },
};

/** Mirrors media/news.ts COLUMNIST (not imported: news.ts calls into this module and a cycle helps nobody). */
const LIFESTYLE_BYLINE = 'Ray Delgado';

/**
 * The rare lifestyle beat for the news desk (news.ts patch appends this to
 * the day's stories): at most one league-wide per day, gated at
 * lifestyleNewsRate (FEEL 0.02: a few per season, never spam), regular
 * season only. Stream 'psyche:news:<season>:<day>'. Weight 1: wire brief,
 * never the front page.
 */
export function lifestyleNews(league: League): NewsItem[] {
  if (league.phase !== 'regular') return [];
  const rng = streamRng(league.seed, 'psyche', 'news', league.season, league.day);
  if (!rng.chance(psycheParams(league).lifestyleNewsRate)) return [];

  const candidates: Array<{ player: FrPlayer; teamId: TeamId; lifestyle: LifestyleKey }> = [];
  for (const tid of Object.keys(league.teams).sort()) {
    const team = league.teams[tid]!;
    for (const pid of team.roster) {
      const player = league.players[pid];
      const psy = player ? playerPsyche(player) : null;
      if (player && psy) candidates.push({ player, teamId: tid, lifestyle: psy.lifestyle });
    }
  }
  if (candidates.length === 0) return [];
  const pick = candidates[rng.int(candidates.length)]!;
  const beat = LIFESTYLE_BEATS[pick.lifestyle];
  const teamName = league.teams[pick.teamId]!.name;
  return [{
    id: `n-s${league.season}d${league.day}-life0`,
    date: { season: league.season, day: league.day },
    type: 'feature',
    headline: beat.headline.replace('%N', pick.player.name).replace('%T', teamName),
    body: beat.body.replace('%N', pick.player.name).replace('%T', teamName),
    byline: LIFESTYLE_BYLINE,
    players: [pick.player.id],
    teams: [pick.teamId],
    weight: 1,
  }];
}
