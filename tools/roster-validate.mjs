// Human-grade pack validation — wraps @hoopsh/data's validateTeamPack() and
// turns each terse ValidationIssue into: where (JSONPath), what's wrong, the
// legal range, the value you actually wrote, and a concrete fix. Then, for
// VALID packs, prints basketball-plausibility WARNINGS (legal numbers that
// will play nothing like a real team).
//
//   npm run roster:validate -- path/to/team.json
//   npm run roster:validate -- path/to/team.json --strict   warnings fail too
//   npm run roster:validate -- path/to/team.json --json     machine output
//
// exit codes: 0 valid (warnings allowed unless --strict), 1 invalid, 2 usage
//
// Errors vs warnings is a deliberate line: ERRORS are validateTeamPack()'s
// verdict and nothing else (this tool adds prose, never new rejections — the
// validator in packages/data/src/schema.ts stays the single source of truth
// for what loads). WARNINGS are heuristics about packs that load fine but
// describe implausible basketball; each one states its reasoning so an
// author can knowingly ignore it (an all-bench tanking squad is allowed to
// warn and ship). One judgment call inherited from the player model: usage
// is orthogonal to skill BY DESIGN (player.ts — "a deferential genius and a
// low-skill chucker are both expressible"), so there is intentionally NO
// warning for high-usage/low-skill combinations.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  loadTeamPack, RATING_MAX, RATING_MIN, HEIGHT_MIN_IN, HEIGHT_MAX_IN,
  MIN_PLAYERS, STARTERS_COUNT, POSITIONS, DATA_PACK_VERSION,
  ATTR_KEYS, TEND_KEYS
} from '@hoopsh/data';

// ---------------------------------------------------------------- utilities

/** Fetch the value a JSONPath-style issue points at (e.g. $.team.players[3].attr.three). */
export function getAtPath(obj, jsonPath) {
  if (jsonPath === '$') return obj;
  const segs = jsonPath.slice(2).split(/[.[]/).map((s) => s.replace(/\]$/, ''));
  let node = obj;
  for (let i = 0; i < segs.length; i++) {
    if (node == null) return undefined;
    const seg = segs[i];
    const next = node[/^\d+$/.test(seg) ? Number(seg) : seg];
    // Author-chosen keys (rotationMinutes player ids) may CONTAIN dots —
    // "$.team.rotationMinutes.j.r.-smith" is ONE key, but the split above
    // cannot know that. On a miss, retry the remaining segments re-joined as
    // a single key before giving up (a dotted id whose first segment
    // collides with a real key still walks wrong — accepted, the fallback
    // only fires when the plain walk dead-ends). Release-audit L-61.
    if (next === undefined && i < segs.length - 1 && typeof node === 'object') {
      const joined = segs.slice(i).join('.');
      if (joined in node) return node[joined];
    }
    node = next;
  }
  return node;
}

/** Classic Levenshtein — small enough to inline, and 'brk-mercr' -> 'brk-mercer' suggestions pay for it. */
function editDistance(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
  }
  return dp[a.length][b.length];
}

function closest(target, candidates) {
  let best = null;
  let bestD = Infinity;
  for (const c of candidates) {
    const d = editDistance(target, c);
    if (d < bestD) { bestD = d; best = c; }
  }
  // only suggest when it plausibly IS a typo, not a different id entirely
  return bestD <= Math.max(2, Math.floor(target.length / 3)) ? best : null;
}

const fmtVal = (v) =>
  v === undefined ? 'missing' : typeof v === 'string' ? `"${v}"` : JSON.stringify(v);

// ------------------------------------------------------------- explanations

/**
 * Enrich one ValidationIssue with { current, legal, fix }. Pattern-matched on
 * the validator's message/path text; unrecognized issues pass through with
 * just the raw message (never hidden). Kept as data-in/data-out for tests.
 */
export function explainIssue(pack, issue) {
  const { path: p, message: m } = issue;
  const current = getAtPath(pack, p);
  const out = { path: p, message: m, current: fmtVal(current) };

  const ratingKey = p.match(/\.(attr|tend|tactics)\.(\w+)$/);
  if (m.includes('must be 0-100') && ratingKey) {
    out.legal = `${RATING_MIN}-${RATING_MAX} (plain JSON number)`;
    if (current === undefined) {
      out.fix = `add "${ratingKey[2]}": 50 — 50 is league average; seed real values from an archetype (npm run roster:new -- --list)`;
    } else if (typeof current === 'string' && Number.isFinite(Number(current))) {
      out.fix = `remove the quotes — ratings are bare numbers, so ${current} not "${current}"`;
    } else if (typeof current === 'number') {
      out.fix = `bring it into ${RATING_MIN}-${RATING_MAX} — the scale is calibrated (99 = all-time great, 70 = plus starter, 50 = average)`;
    } else {
      out.fix = `set a number in ${RATING_MIN}-${RATING_MAX}`;
    }
    return out;
  }
  // unknown attr/tend key — the loader rejects the whole bag-extra class
  // (annotation comments and typo'd rating names alike; see the unknown-key
  // note in packages/data/src/schema.ts validatePlayer). Two very different
  // authoring mistakes, two fixes: a near-miss of a real key gets the typo
  // suggestion, anything else gets the JSON-has-no-comments explanation.
  const unknownKey = m.match(/^unknown (attribute|tendency) "(.+)"/);
  if (unknownKey) {
    const known = unknownKey[1] === 'attribute' ? ATTR_KEYS : TEND_KEYS;
    const guess = closest(unknownKey[2], known);
    out.legal = `only the ${known.length} engine ${unknownKey[1]} keys (npm run roster:new emits a complete example)`;
    out.fix = guess
      ? `did you mean "${guess}"? the engine reads every key in this block, so extras don't load`
      : 'remove the key — JSON has no comment syntax, and the engine reads every key in this block';
    return out;
  }
  if (p.endsWith('.heightIn')) {
    out.legal = `${HEIGHT_MIN_IN}-${HEIGHT_MAX_IN} inches (5'0"-8'0")`;
    // the cm reading is only offered when the CONVERSION itself is legal —
    // "500 cm" converts to 197 in, and a fix line must never suggest a value
    // the validator would reject right back (release-audit L-60)
    const asInches = typeof current === 'number' ? Math.round(current / 2.54) : NaN;
    if (typeof current === 'number' && current >= 120
      && asInches >= HEIGHT_MIN_IN && asInches <= HEIGHT_MAX_IN) {
      out.fix = `${current} looks like centimeters — hoopsh wants inches: ${asInches}`;
    } else if (typeof current === 'number' && current > 0 && current < HEIGHT_MIN_IN) {
      out.fix = `${current} looks like feet — use total inches (6'9" = 81)`;
    } else {
      out.fix = 'height in total inches, e.g. 6\'7" = 79';
    }
    return out;
  }
  if (p.endsWith('.weightLb')) {
    out.legal = 'finite number, pounds';
    out.fix = 'add weight in pounds (e.g. 215); from kilograms: kg x 2.205';
    return out;
  }
  if (p.endsWith('.wingspanIn')) {
    out.legal = 'number (inches) — or delete the key (engine assumes heightIn + 2)';
    out.fix = 'set inches or remove the field entirely';
    return out;
  }
  if (p.endsWith('.pos')) {
    out.legal = POSITIONS.join(' | ');
    out.fix = `pick the closest role — matchups are assigned by body and skill, so this label is descriptive`;
    return out;
  }
  if (p === '$.formatVersion') {
    out.legal = String(DATA_PACK_VERSION);
    out.fix = current === 1
      ? `set "formatVersion": ${DATA_PACK_VERSION} — v2 added tend.usage (offensive load, 50 = league average); every player needs it`
      : `set "formatVersion": ${DATA_PACK_VERSION}`;
    return out;
  }
  if (p === '$.kind') { out.legal = '"team"'; out.fix = 'set "kind": "team"'; return out; }
  if (p === '$.team.tactics' || p.startsWith('$.team.tactics.')) {
    out.legal = 'object with pace, threeBias, helpAggr — each 0-100';
    out.fix = 'the engine reads tactics unconditionally; add "tactics": { "pace": 50, "threeBias": 50, "helpAggr": 50 }';
    return out;
  }
  if (p === '$.team.players' && m.includes('at least')) {
    const n = Array.isArray(pack?.team?.players) ? pack.team.players.length : 0;
    out.current = `${n} player(s)`;
    out.legal = `>= ${MIN_PLAYERS}`;
    out.fix = `add ${Math.max(0, MIN_PLAYERS - n)} more — fatigue subs need a bench (npm run roster:new scaffolds a full one)`;
    return out;
  }
  if (p === '$.team.players' && m.includes('duplicate player ids')) {
    const ids = (pack?.team?.players ?? []).map((pl) => pl?.id);
    const dupes = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
    out.current = `repeated: ${dupes.map(fmtVal).join(', ')}`;
    out.legal = 'every players[].id unique';
    out.fix = 'ids are how starters/rotationMinutes reference players — rename the duplicates';
    return out;
  }
  if (p === '$.team.starters') {
    const starters = pack?.team?.starters;
    if (m.includes('not on roster')) {
      const bad = m.match(/starter (\S+) not on roster/)?.[1];
      const rosterIds = (pack?.team?.players ?? []).map((pl) => pl?.id).filter(Boolean);
      const guess = bad ? closest(bad, rosterIds) : null;
      out.current = fmtVal(bad);
      out.legal = `one of: ${rosterIds.join(', ')}`;
      out.fix = guess ? `did you mean "${guess}"?` : 'use an id from players[]';
      return out;
    }
    if (m.includes('duplicate starter')) {
      const dupes = [...new Set(starters.filter((id, i) => starters.indexOf(id) !== i))];
      out.current = `repeated: ${dupes.map(fmtVal).join(', ')}`;
      out.legal = `${STARTERS_COUNT} DISTINCT player ids`;
      out.fix = 'a repeated id would put the same player in two lineup slots — swap in another rostered id';
      return out;
    }
    out.current = Array.isArray(starters) ? `${starters.length} starter(s)` : fmtVal(starters);
    out.legal = `exactly ${STARTERS_COUNT} player ids`;
    out.fix = 'list the opening five, e.g. your first five players[].id values';
    return out;
  }
  if (p.startsWith('$.team.rotationMinutes')) {
    out.legal = 'finite minutes >= 0 per player id';
    out.fix = 'e.g. "rotationMinutes": { "your-star-id": 36 } — or delete the field to sub on fatigue alone';
    return out;
  }
  if (m.includes('missing attributes') || m.includes('missing tendencies')) {
    out.fix = 'every player needs the full attr (24 keys) and tend (14 keys) blocks — copy a player from npm run roster:new output and edit';
    return out;
  }
  if (m.startsWith('invalid JSON')) {
    out.fix = 'not valid JSON at all — check for trailing commas, comments, or unquoted keys (none are legal JSON)';
    return out;
  }
  if (m.includes('missing name') || m.includes('missing abbrev') || m.includes('missing id')) {
    out.fix = 'add the field — box scores and play-by-play print these verbatim';
    return out;
  }
  return out; // unmatched: raw path+message still shown
}

// ---------------------------------------------------------------- warnings

/**
 * Basketball-plausibility heuristics for VALID packs. Every threshold was
 * checked against the shipped calibration rosters and the roster:new
 * default scaffold — all of those come out clean (enforced by test), so a
 * warning here genuinely means "unlike any known-good roster".
 */
export function computeWarnings(pack) {
  const team = pack.team;
  const warnings = [];
  const warn = (code, where, detail, why) => warnings.push({ code, where, detail, why });
  const starters = team.starters.map((id) => team.players.find((pl) => pl.id === id));

  // body plausibility: the load-time validator deliberately accepts ANY
  // finite weight/wingspan (it refuses to out-strict the engine — see the
  // weightLb note in packages/data/src/schema.ts), so unit mistakes are this
  // tool's lane. Anchors are historical NBA extremes plus margin: listed
  // playing weights run about 133 lb (Boykins/Bogues) to 375 lb (Oliver
  // Miller at his heaviest), and draft-combine ape indexes about -2 to +11
  // inches versus height.
  for (const pl of team.players) {
    if (pl.weightLb < 130 || pl.weightLb > 400) {
      warn('weight-implausible', `${pl.name} (${pl.id})`,
        `weightLb ${pl.weightLb}`,
        pl.weightLb >= 60 && pl.weightLb < 130
          ? `looks like kilograms — hoopsh wants pounds (${pl.weightLb} kg x 2.205 = ${Math.round(pl.weightLb * 2.205)} lb); matchup sorting reads this every game`
          : 'no NBA body has played outside roughly 133-375 lb — matchup sorting and post-strength physics will describe nonsense');
    }
    const span = pl.wingspanIn;
    if (span !== undefined && (span < pl.heightIn - 4 || span > pl.heightIn + 14)) {
      warn('wingspan-implausible', `${pl.name} (${pl.id})`,
        `wingspanIn ${span} on heightIn ${pl.heightIn} (ape index ${span - pl.heightIn >= 0 ? '+' : ''}${span - pl.heightIn})`,
        'combine ape indexes run about -2 to +11 inches — outside that, standing-reach geometry stops describing a human; check units (inches) or delete the key (the engine assumes heightIn + 2)');
    }
  }

  // flat profile: identity comes from contrast; 24 identical dials is a
  // player the engine can only render as anonymous
  for (const pl of team.players) {
    const vals = Object.values(pl.attr);
    if (new Set(vals).size === 1) {
      warn('flat-profile', `${pl.name} (${pl.id})`,
        `all ${vals.length} attributes are ${vals[0]}`,
        'identity comes from contrast — seed from an archetype and push 3-4 defining dials instead');
    }
  }

  // no plus skill anywhere: nobody can win any matchup, so possessions
  // decay into coin flips — plays like a scrimmage between strangers
  const bestAttr = Math.max(...team.players.map((pl) => Math.max(...Object.values(pl.attr))));
  if (bestAttr < 70) {
    warn('no-plus-skill', 'whole roster',
      `highest attribute anywhere is ${bestAttr}`,
      'with no rating >= 70 nobody can win a matchup; real NBA rosters carry multiple 85+ skills');
  }

  // uniformly superhuman is the same information-free flatness in reverse
  const worstAttr = Math.min(...team.players.map((pl) => Math.min(...Object.values(pl.attr))));
  if (worstAttr >= 85) {
    warn('uniform-elite', 'whole roster',
      `lowest attribute anywhere is ${worstAttr}`,
      'when everyone is elite at everything, nothing differentiates play styles — spread the weaknesses real players have');
  }

  // rim protection: a 5-out lineup is legal, but with no interior presence
  // opponents shoot layups all night (interiorD guards the restricted area,
  // block converts misses — either one >= 65 counts as "a rim presence")
  const rimBest = starters.reduce((best, pl) =>
    Math.max(pl.attr.interiorD, pl.attr.block) > Math.max(best.attr.interiorD, best.attr.block) ? pl : best);
  const rimScore = Math.max(rimBest.attr.interiorD, rimBest.attr.block);
  if (rimScore < 65) {
    warn('no-rim-protection', 'starting five',
      `best interior presence is ${rimBest.name} (interiorD ${rimBest.attr.interiorD}, block ${rimBest.attr.block})`,
      'nobody deters shots at the rim — a 5-out lineup needs at least one starter with interiorD or block >= 65, or opponents live in the paint');
  }

  // initiation: someone has to bring the ball up and start offense
  const bhBest = starters.reduce((a, b) => (b.attr.ballHandle > a.attr.ballHandle ? b : a));
  if (bhBest.attr.ballHandle < 65) {
    warn('no-initiator', 'starting five',
      `best ballHandle is ${bhBest.name} at ${bhBest.attr.ballHandle}`,
      'with no credible handler, drives die and turnovers spiral — give one starter ballHandle >= 65');
  }

  // shot diet: the three zone appetites are relative weights; known-good
  // rosters sum 99-158. Near-zero total means a player who refuses every
  // shot the AI projects; a huge total drowns out the pass/drive channels.
  for (const pl of team.players) {
    const { shotRim, shotMid, shotThree } = pl.tend;
    const total = shotRim + shotMid + shotThree;
    if (total < 60) {
      warn('shot-diet', `${pl.name} (${pl.id})`,
        `shotRim ${shotRim} + shotMid ${shotMid} + shotThree ${shotThree} = ${total}`,
        'this player wants almost no shot from anywhere (calibrated rosters sum 99-158) — the offense will orbit around a black hole');
    } else if (total > 240) {
      warn('shot-diet', `${pl.name} (${pl.id})`,
        `shotRim ${shotRim} + shotMid ${shotMid} + shotThree ${shotThree} = ${total}`,
        'appetite this high across ALL zones drowns the pass/drive tendencies — shot diets are relative weights, so differentiate the zones instead');
    }
  }

  // duplicate display names: legal (ids differ) but box scores and
  // play-by-play become unreadable
  const byName = new Map();
  for (const pl of team.players) {
    const k = pl.name.toLowerCase();
    byName.set(k, [...(byName.get(k) ?? []), pl.id]);
  }
  for (const [nm, ids] of byName) {
    if (ids.length > 1) {
      warn('duplicate-names', `"${nm}"`, `shared by ${ids.join(', ')}`,
        'play-by-play and box scores print names verbatim — two players named alike are indistinguishable in output');
    }
  }

  // usage budget: tend.usage maps to USG% (50 = 20%, i.e. five 50s = one
  // ball fully fed). Shipped rosters' starting fives average 44-51.
  const meanUsage = starters.reduce((s, pl) => s + pl.tend.usage, 0) / starters.length;
  if (meanUsage > 62) {
    warn('usage-overload', 'starting five',
      `average usage target ${meanUsage.toFixed(1)} (50 = one ball's worth)`,
      'there is one ball — the closed loop will leave every star under target and hunting; stagger the load toward 50 average');
  } else if (meanUsage < 38) {
    warn('usage-vacuum', 'starting five',
      `average usage target ${meanUsage.toFixed(1)} (50 = one ball's worth)`,
      'nobody wants the offense — possessions will be aimless swings; give somebody the keys (usage 60-80)');
  }

  // rotationMinutes sanity (only when the author opted into targets)
  if (team.rotationMinutes) {
    const ids = new Set(team.players.map((pl) => pl.id));
    for (const [rid, mins] of Object.entries(team.rotationMinutes)) {
      if (!ids.has(rid)) {
        const guess = closest(rid, [...ids]);
        warn('rotation-unknown-id', `rotationMinutes.${rid}`,
          'no such player id — the engine silently ignores it',
          guess ? `did you mean "${guess}"?` : 'remove it or fix the id');
      }
      if (mins > 48) {
        warn('rotation-implausible', `rotationMinutes.${rid}`, `${mins} minutes`,
          'regulation is 48 minutes — a target above that is unreachable and pins the player to the floor all game');
      }
    }
    const totalTarget = Object.values(team.rotationMinutes).reduce((a, b) => a + b, 0);
    if (totalTarget > 245) {
      warn('rotation-overbooked', 'rotationMinutes',
        `targets sum to ${totalTarget}`,
        'five positions x 48 minutes = 240 player-minutes per game — targets beyond that cannot all be honored');
    } else if (totalTarget < 235 && team.players.every((pl) => Object.hasOwn(team.rotationMinutes, pl.id))) {
      // the under-booked mirror (same +-5 slack): with EVERY player capped,
      // 240 player-minutes have nowhere legal to land, so the rotation must
      // run somebody past their number. Partial coverage is fine — untargeted
      // players soak the rest by design (release-audit M-43).
      warn('rotation-underbooked', 'rotationMinutes',
        `every player has a target and they sum to ${totalTarget}`,
        'five positions x 48 minutes = 240 player-minutes MUST be played — under-booking the whole roster forces someone past his target; free at least one player of a target, or budget ~240');
    }
  }

  return warnings;
}

// ------------------------------------------------------------------- report

const useColor = process.stdout.isTTY;
const paint = (code, s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
const red = (s) => paint(31, s);
const yellow = (s) => paint(33, s);
const green = (s) => paint(32, s);
const dim = (s) => paint(2, s);

function printIssue(e) {
  console.log(`  ${red('error')} ${e.path}`);
  console.log(`        problem: ${e.message}`);
  if (e.current !== undefined) console.log(`        current: ${e.current}`);
  if (e.legal) console.log(`        legal:   ${e.legal}`);
  if (e.fix) console.log(`        fix:     ${e.fix}`);
}

function printWarning(w) {
  console.log(`  ${yellow('warn')}  [${w.code}] ${w.where}`);
  console.log(`        ${w.detail}`);
  console.log(`        ${dim(`why: ${w.why}`)}`);
}

async function main() {
  // Loud argv policy, mirroring packages/harness/src/args.ts: unknown flags,
  // =-joined values, and stray positionals are usage errors (exit 2), never
  // silent no-ops — a typo'd --strict used to validate WITHOUT strictness and
  // let the CI gate pass wide open (release-audit M-42).
  const KNOWN_FLAGS = ['--strict', '--json'];
  const argv = process.argv.slice(2);
  const files = [];
  let usageError = null;
  for (const a of argv) {
    if (!a.startsWith('-')) { files.push(a); continue; }
    if (KNOWN_FLAGS.includes(a)) continue;
    const bare = a.includes('=') ? a.slice(0, a.indexOf('=')) : a;
    if (KNOWN_FLAGS.includes(bare)) {
      usageError = `${bare} takes no value — write it bare (got "${a}")`;
    } else {
      const guess = closest(bare, KNOWN_FLAGS);
      usageError = `unknown flag "${a}"${guess ? ` — did you mean "${guess}"?` : ''}`;
    }
    break;
  }
  if (!usageError && files.length > 1) {
    usageError = `one pack per run — got ${files.length} positionals (${files.join(', ')}); validate them one at a time`;
  }
  const strict = argv.includes('--strict');
  const asJson = argv.includes('--json');
  const file = files[0];
  // exit discipline throughout main(): set process.exitCode and return, never
  // process.exit() — exit() right after console.log truncated piped --json
  // reports at the 64 KiB pipe buffer (release-audit M-50)
  if (usageError || !file) {
    if (usageError) console.error(`roster-validate: ${usageError}`);
    console.error('usage: npm run roster:validate -- <pack.json> [--strict] [--json]');
    process.exitCode = 2;
    return;
  }
  let raw;
  try {
    raw = readFileSync(file, 'utf8');
  } catch (err) {
    console.error(`cannot read ${file}: ${err.code ?? err.message}`);
    process.exitCode = 2;
    return;
  }

  const { team, issues } = loadTeamPack(raw);
  let parsed = null;
  try { parsed = JSON.parse(raw); } catch { /* issues[] already carries the syntax error */ }

  const explained = issues.map((i) => explainIssue(parsed, i));
  const warnings = team ? computeWarnings(parsed) : [];

  if (asJson) {
    console.log(JSON.stringify({ file, valid: team !== null, issues: explained, warnings }, null, 2));
  } else {
    const label = path.basename(file);
    if (team === null) {
      console.log(`\n${red('INVALID')} ${label} — ${issues.length} issue(s); nothing loads until all are fixed\n`);
      // v1-migration shortcut: the single most common historical failure is
      // an old pack missing tend.usage everywhere — say so once, up top,
      // instead of making the author infer it from 10 identical rating errors
      if (parsed?.formatVersion === 1
        && explained.some((e) => e.path.endsWith('.tend.usage'))) {
        console.log(`  ${yellow('note')}  this looks like a formatVersion 1 pack: v2 added tend.usage`);
        console.log(`        add "usage": 50 to every player's tend block (50 = league-average load), then set formatVersion: 2\n`);
      }
      for (const e of explained) printIssue(e);
      console.log('');
    } else {
      console.log(`\n${green('VALID')} ${label} — ${team.players.length} players, "${team.name}" loads clean`);
      if (warnings.length > 0) {
        console.log(`\n${warnings.length} plausibility warning(s) — legal pack, questionable basketball:\n`);
        for (const w of warnings) printWarning(w);
        console.log(`\n  ${dim('warnings are advisory; pass --strict to treat them as failures')}`);
      }
      console.log('');
    }
  }

  if (team === null || (strict && warnings.length > 0)) process.exitCode = 1;
}

const isMain = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) await main();
