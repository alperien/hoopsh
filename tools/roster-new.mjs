// Scaffold a valid starter team pack — the "don't make humans type 38 raw
// numbers" tool:
//   npm run roster:new                      interactive wizard (TTY)
//   npm run roster:new -- --yes             all defaults, zero questions
//   npm run roster:new -- --name "Oak City Owls" --abbrev OWL --size 12
//   npm run roster:new -- --slots floorGeneral,scoringWing,threeAndD,glueForward,rimRunner,comboGuard,benchScorer,benchBig
//   npm run roster:new -- --list            print the archetype catalog
//
// Every player is seeded from one of @hoopsh/data's archetype builders, so
// the author starts from a coherent basketball identity (a rim-running
// center whose 38 dials already agree with each other) and edits ratings
// downward/upward from there, instead of inventing a profile from zeros.
// The emitted pack:
//   - carries a "$schema" pointer at data/schema/team-pack.schema.json so
//     JSON-aware editors give autocomplete + inline range errors immediately
//   - is self-checked through validateTeamPack() before it hits disk — this
//     tool exiting 0 IS a validity guarantee, enforced by test
//   - names players after their archetype ("Floor General", "Bench Big 2")
//     so the placeholder roster is self-documenting in a box score until the
//     author renames everyone
//
// ANTI-DRIFT: the archetype registry below binds slugs to the REAL builder
// functions imported from @hoopsh/data — ratings live there, never here. A
// registry test (packages/data/test/roster-new.test.ts) discovers every
// archetype-shaped export in @hoopsh/data and fails if one is missing from
// this menu, so a 12th archetype cannot land without becoming scaffoldable.

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  eliteShooter, rimRunner, floorGeneral, threeAndD, scoringWing,
  postAnchor, comboGuard, glueForward, benchBig, benchScorer, stretchBig,
  toTeamPack, validateTeamPack, MIN_PLAYERS, STARTERS_COUNT
} from '@hoopsh/data';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCHEMA_FILE = path.join(ROOT, 'data', 'schema', 'team-pack.schema.json');

/**
 * The scaffold menu: slug -> builder + one-line pitch. Order matters — it's
 * the wizard's display order, starters-first. Blurbs are editorial (what the
 * archetype is FOR); the numbers live in packages/data/src/archetypes.ts and
 * are shown to the user by deriving from the builder itself (see catalog()).
 */
export const ARCHETYPES = {
  floorGeneral: { fn: floorGeneral, blurb: 'pass-first PG, elite vision, paint-to-kick engine' },
  eliteShooter: { fn: eliteShooter, blurb: 'off-movement three-point assassin, defense optional' },
  scoringWing: { fn: scoringWing, blurb: 'three-level bucket-getter, lives at the FT line' },
  threeAndD: { fn: threeAndD, blurb: 'corner spacer + point-of-attack stopper' },
  comboGuard: { fn: comboGuard, blurb: 'steady no-weakness rotation guard' },
  glueForward: { fn: glueForward, blurb: 'does a bit of everything, never hurts you' },
  postAnchor: { fn: postAnchor, blurb: 'back-to-basket bruiser with soft touch' },
  stretchBig: { fn: stretchBig, blurb: 'floor-spacing center, shoots over sagging bigs' },
  rimRunner: { fn: rimRunner, blurb: 'lob-catching, glass-eating, rim-protecting C' },
  benchScorer: { fn: benchScorer, blurb: 'microwave sixth man — heater upside, streaky floor' },
  benchBig: { fn: benchBig, blurb: 'energy reserve center, rebounds and protects the rim' }
};

/**
 * Default archetype cycle for N players: a coherent modern roster — balanced
 * starting five (PG/SG/SF/PF/C), then a bench that covers backup creation,
 * instant offense, forward depth, and a second big. Sliced to the requested
 * size, so --size 8 keeps the five starters plus the three highest-priority
 * bench pieces.
 */
export function defaultSlots(n) {
  const cycle = [
    'floorGeneral', 'scoringWing', 'threeAndD', 'glueForward', 'rimRunner',
    'comboGuard', 'benchScorer', 'benchBig', 'glueForward', 'stretchBig',
    'eliteShooter', 'threeAndD', 'postAnchor', 'comboGuard', 'benchBig'
  ];
  // Number.isInteger also rejects NaN from a mistyped --size, which would
  // otherwise sail through the comparisons (NaN < x is false) and slice an
  // empty roster.
  if (!Number.isInteger(n) || n < MIN_PLAYERS || n > cycle.length) {
    throw new Error(`roster size must be a whole number ${MIN_PLAYERS}-${cycle.length} (got ${n})`);
  }
  return cycle.slice(0, n);
}

/** Title-case an archetype slug for player display names: floorGeneral -> "Floor General". */
function labelOf(slug) {
  return slug.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()).trim();
}

/** Slugify a team name for ids/filenames: "Oak City Owls" -> "oak-city-owls". */
export function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'new-team';
}

/**
 * Build a complete, validated TeamPack from scaffold options (pure — no I/O,
 * so tests exercise it directly). Throws if the result would not validate:
 * a scaffold that can emit an invalid pack is a bug in THIS file, never
 * something to hand the user.
 */
export function buildRoster({ name, abbrev, id, slots, tactics }) {
  const teamId = id ?? slugify(name);
  const seen = new Map(); // archetype label -> count, for "Bench Big 2" disambiguation
  const players = slots.map((slug, i) => {
    const entry = ARCHETYPES[slug];
    if (!entry) {
      throw new Error(`unknown archetype '${slug}' — valid: ${Object.keys(ARCHETYPES).join(', ')}`);
    }
    const label = labelOf(slug);
    const n = (seen.get(label) ?? 0) + 1;
    seen.set(label, n);
    return entry.fn({
      id: `${teamId}-p${String(i + 1).padStart(2, '0')}`,
      name: n === 1 ? label : `${label} ${n}`
    });
  });
  const team = {
    id: teamId,
    name,
    abbrev,
    players,
    starters: players.slice(0, STARTERS_COUNT).map((p) => p.id),
    tactics: { pace: 50, threeBias: 50, helpAggr: 50, ...tactics }
  };
  const pack = toTeamPack(team);
  const issues = validateTeamPack(JSON.parse(JSON.stringify(pack)));
  if (issues.length > 0) {
    throw new Error(`scaffold bug — generated pack failed validation:\n` +
      issues.map((i) => `  ${i.path}: ${i.message}`).join('\n'));
  }
  return pack;
}

/** Pack -> on-disk JSON text, with the editor "$schema" pointer injected first. */
export function packText(pack, outFile) {
  const rel = path.relative(path.dirname(path.resolve(outFile)), SCHEMA_FILE).replaceAll(path.sep, '/');
  return JSON.stringify({ $schema: rel, ...pack }, null, 2) + '\n';
}

/** Derive the catalog rows from the builders themselves — top skills shown are computed, not hand-listed. */
function catalog() {
  const rows = [];
  for (const [slug, { fn, blurb }] of Object.entries(ARCHETYPES)) {
    const p = fn({ id: 'probe', name: 'probe' });
    const top = Object.entries(p.attr).sort((a, b) => b[1] - a[1]).slice(0, 3)
      .map(([k, v]) => `${k} ${v}`).join(', ');
    rows.push({ slug, pos: p.pos, h: p.heightIn, blurb, top, usage: p.tend.usage });
  }
  return rows;
}

function printCatalog() {
  console.log('archetypes (packages/data/src/archetypes.ts — ratings shown are derived, not copied):\n');
  for (const r of catalog()) {
    const ft = `${Math.floor(r.h / 12)}'${r.h % 12}"`;
    console.log(`  ${r.slug.padEnd(13)} ${r.pos.padEnd(2)} ${ft.padEnd(5)} usage ${String(r.usage).padStart(2)}  ${r.blurb}`);
    console.log(`  ${''.padEnd(13)} best: ${r.top}`);
  }
  console.log(`\npick per-slot with --slots a,b,c,... (first ${STARTERS_COUNT} are the starters)`);
}

function argOf(flag) {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

const HELP = `roster:new — scaffold a valid hoopsh team pack from archetypes

usage: npm run roster:new [-- options]
  --name "Full Name"     team display name          (default: New Team)
  --abbrev XYZ           scoreboard tag             (default: from name)
  --id slug              team id + default filename (default: slug of name)
  --size N               roster size ${MIN_PLAYERS}-15            (default: 10)
  --slots a,b,c,...      explicit archetype per player; first ${STARTERS_COUNT} start
                         (overrides --size; min ${MIN_PLAYERS} entries)
  --pace/--three-bias/--help-aggr N   team tactics 0-100 (default: 50)
  --out path             output file (default: <id>.team.json in cwd)
  --force                overwrite an existing output file
  --yes                  accept all defaults, no prompts
  --interactive          force the wizard even when other flags are present
  --list                 print the archetype catalog and exit
  --help                 this text

then:  npm run roster:validate -- <file>     lint it
       npm run sim -- --home <file>          play it`;

/**
 * Buffering line reader — NOT readline/promises.question(). With piped stdin
 * (tests, heredocs) every line of a chunk is emitted synchronously in one
 * data tick, so any line that arrives while no question() is pending is
 * dropped and the next question awaits forever ("unsettled top-level
 * await"). Queueing every 'line' event and letting ask() pop the queue makes
 * the wizard equally driveable by a human at a TTY and by `printf ... |`.
 * EOF resolves to '' — i.e. running out of piped answers accepts the
 * remaining defaults instead of hanging.
 */
async function lineReader() {
  const { createInterface } = await import('node:readline');
  const rl = createInterface({ input: process.stdin, terminal: false });
  const queue = [];
  const waiters = [];
  let closed = false;
  rl.on('line', (l) => {
    const w = waiters.shift();
    if (w) w(l); else queue.push(l);
  });
  rl.on('close', () => {
    closed = true;
    for (const w of waiters.splice(0)) w('');
  });
  return {
    next() {
      if (queue.length > 0) return Promise.resolve(queue.shift());
      if (closed) return Promise.resolve('');
      return new Promise((r) => waiters.push(r));
    },
    close: () => rl.close()
  };
}

/** One question with a shown default; empty answer (or EOF) = default. */
async function ask(rl, q, dflt) {
  process.stdout.write(`${q} [${dflt}]: `);
  const a = (await rl.next()).trim();
  return a === '' ? String(dflt) : a;
}

/** Rating question: out-of-range/non-numeric answers fall back to the default with a note. */
async function askRating(rl, q, dflt) {
  const n = Number(await ask(rl, q, dflt));
  if (!Number.isFinite(n) || n < 0 || n > 100) {
    console.log(`  (not 0-100 — using ${dflt})`);
    return dflt;
  }
  return n;
}

async function interactive() {
  const rl = await lineReader();
  try {
    console.log('scaffolding a team pack — Enter accepts every default\n');
    const name = await ask(rl, 'team name', 'New Team');
    const abbrev = (await ask(rl, 'abbrev', name.slice(0, 3).toUpperCase())).toUpperCase();
    const id = await ask(rl, 'team id', slugify(name));
    let size = Number(await ask(rl, `roster size (${MIN_PLAYERS}-15)`, 10));
    if (!Number.isInteger(size) || size < MIN_PLAYERS || size > 15) {
      console.log(`  (that isn't ${MIN_PLAYERS}-15 — using 10)`);
      size = 10;
    }
    const slots = [...defaultSlots(size)];
    console.log('\narchetype per slot — Enter keeps the suggestion, or type one of:');
    console.log(`  ${Object.keys(ARCHETYPES).join(', ')}\n`);
    for (let i = 0; i < slots.length; i++) {
      const role = i < STARTERS_COUNT ? `starter ${i + 1}` : `bench ${i + 1 - STARTERS_COUNT}`;
      const pick = await ask(rl, `${role.padEnd(9)} archetype`, slots[i]);
      if (!(pick in ARCHETYPES)) {
        console.log(`  (unknown '${pick}' — keeping ${slots[i]})`);
      } else {
        slots[i] = pick;
      }
    }
    const tactics = {
      pace: await askRating(rl, '\ntactics: pace 0-100', 50),
      threeBias: await askRating(rl, 'tactics: threeBias 0-100', 50),
      helpAggr: await askRating(rl, 'tactics: helpAggr 0-100', 50)
    };
    const out = await ask(rl, 'output file', `${id}.team.json`);
    return { name, abbrev, id, slots, tactics, out };
  } finally {
    rl.close();
  }
}

async function main() {
  if (process.argv.includes('--help')) { console.log(HELP); return; }
  if (process.argv.includes('--list')) { printCatalog(); return; }

  // Wizard when asked for explicitly, or when invoked bare on a real
  // terminal; every scripted/piped/flagged invocation takes the
  // deterministic flag path so automation never blocks on a prompt.
  const hasFlags = process.argv.slice(2).some((a) => a.startsWith('--'));
  let opts;
  let pack;
  // one catch for the whole flag-parse + build path: every authoring mistake
  // (bad --size, unknown archetype, out-of-range tactic) exits 2 with the
  // message and no stack trace — stacks are for scaffold bugs, not typos
  try {
    if (process.argv.includes('--interactive') || (!hasFlags && process.stdin.isTTY)) {
      opts = await interactive();
    } else {
      const name = argOf('--name') ?? 'New Team';
      const id = argOf('--id') ?? slugify(name);
      const slots = argOf('--slots')
        ? argOf('--slots').split(',').map((s) => s.trim()).filter(Boolean)
        : defaultSlots(Number(argOf('--size') ?? 10));
      if (slots.length < MIN_PLAYERS) {
        throw new Error(`need at least ${MIN_PLAYERS} slots (got ${slots.length})`);
      }
      const rating = (flag) => {
        const n = Number(argOf(flag) ?? 50);
        if (!Number.isFinite(n) || n < 0 || n > 100) {
          throw new Error(`${flag} must be 0-100 (got ${argOf(flag)})`);
        }
        return n;
      };
      opts = {
        name,
        abbrev: (argOf('--abbrev') ?? name.slice(0, 3)).toUpperCase(),
        id,
        slots,
        tactics: {
          pace: rating('--pace'),
          threeBias: rating('--three-bias'),
          helpAggr: rating('--help-aggr')
        },
        out: argOf('--out') ?? `${id}.team.json`
      };
    }
    pack = buildRoster(opts);
  } catch (err) {
    console.error(String(err instanceof Error ? err.message : err));
    process.exit(2);
  }

  const outFile = path.resolve(opts.out);
  if (existsSync(outFile) && !process.argv.includes('--force')) {
    console.error(`${opts.out} already exists — pass --force to overwrite`);
    process.exit(2);
  }
  mkdirSync(path.dirname(outFile), { recursive: true });
  writeFileSync(outFile, packText(pack, outFile));

  console.log(`\nwrote ${opts.out} — ${pack.team.players.length} players, validated clean`);
  console.log(`starting five: ${pack.team.players.slice(0, STARTERS_COUNT).map((p) => `${p.name} (${p.pos})`).join(', ')}`);
  console.log(`\nnext:  edit the ratings (your editor autocompletes via "$schema")`);
  console.log(`       npm run roster:validate -- ${opts.out}`);
  console.log(`       npm run sim -- --home ${opts.out}`);
}

const isMain = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) await main();
