/**
 * Rejection paths of the team-pack validator (data/src/schema.ts).
 *
 * The validator's documented philosophy (schema.ts header): strict rejection,
 * never lenient fill-in — every problem becomes one ValidationIssue with a
 * JSONPath-style `path` and plain-English `message`, and the whole report
 * surfaces in ONE pass. Existing suites (schema.test.ts, gen-schema.test.ts)
 * cover the round-trip and a handful of rejections; this file pins the error
 * ENVELOPE for the remaining documented rejection branches: each test asserts
 * both THAT validation fails and WHERE (exact path, message) — a validator
 * that rejected everything with a generic error would fail these.
 *
 * Every negative case starts from a known-valid pack and corrupts exactly one
 * field (the gen-schema.test.ts freshPack recipe). No sims, no I/O.
 */
import { describe, expect, it } from 'vitest';
import {
  cascadiaBreakers, DATA_PACK_VERSION, HEIGHT_MAX_IN, HEIGHT_MIN_IN,
  loadTeamPack, MIN_PLAYERS, STARTERS_COUNT, toTeamPack, validateTeamPack
} from '@hoopsh/data';

// deep-clone a known-valid pack to mutate — every negative case starts valid
function freshPack(): any {
  return JSON.parse(JSON.stringify(toTeamPack(cascadiaBreakers())));
}

// shorthand: does the report contain an issue at exactly this path whose
// message contains `msg`? (ValidationIssue shape per schema.ts:48-51)
function has(issues: { path: string; message: string }[], path: string, msg: string): boolean {
  return issues.some((i) => i.path === path && i.message.includes(msg));
}

describe('schema rejection paths — pack envelope', () => {
  it('the mutation base itself validates clean (guards every rejection test below against vacuity)', () => {
    // spec: schema.test.ts round-trip promise; a corrupt base would make
    // every "rejects X" below ambiguous about WHICH corruption fired
    expect(validateTeamPack(freshPack())).toEqual([]);
  });

  it('a non-object pack is exactly one issue at $ (schema.ts:200-202)', () => {
    // spec: validateTeamPack JSDoc — "returning every issue found"; the
    // non-object early-out is the single case that reports nothing else
    expect(validateTeamPack(null)).toEqual([{ path: '$', message: 'pack must be an object' }]);
    expect(validateTeamPack('a string, not a pack')).toEqual([{ path: '$', message: 'pack must be an object' }]);
    expect(validateTeamPack(42)).toEqual([{ path: '$', message: 'pack must be an object' }]);
  });

  it('formatVersion is checked exactly (!==), so old and wrongly-typed versions fail loudly (schema.ts:33-40; AGENTS.md DO-NOT #9)', () => {
    // spec: DATA_PACK_VERSION comment — "checks it exactly (`!==`), not >=,
    // so old packs fail loudly ... rather than partially validating"
    const old = freshPack();
    old.formatVersion = DATA_PACK_VERSION - 1; // a v1 pack after the v2 bump
    expect(has(validateTeamPack(old), '$.formatVersion', `expected ${DATA_PACK_VERSION}`)).toBe(true);

    const stringly = freshPack();
    stringly.formatVersion = String(DATA_PACK_VERSION); // "2" !== 2 — exact match is type-strict
    expect(has(validateTeamPack(stringly), '$.formatVersion', `expected ${DATA_PACK_VERSION}`)).toBe(true);

    const missing = freshPack();
    delete missing.formatVersion;
    expect(has(validateTeamPack(missing), '$.formatVersion', `expected ${DATA_PACK_VERSION}`)).toBe(true);
  });

  it('kind must be the literal "team" (schema.ts:207)', () => {
    const bad = freshPack();
    bad.kind = 'squad';
    expect(has(validateTeamPack(bad), '$.kind', 'expected "team"')).toBe(true);
  });

  it('a pack with no team object early-outs with exactly one $.team issue (schema.ts:208-212)', () => {
    // spec: validateTeamPack JSDoc — early-outs only "where a missing field
    // makes deeper checks meaningless"; no phantom player/tactics issues
    expect(validateTeamPack({ formatVersion: DATA_PACK_VERSION, kind: 'team' }))
      .toEqual([{ path: '$.team', message: 'missing team' }]);
  });

  it('unrelated problems surface together in one pass (validateTeamPack JSDoc: "a bad formatVersion AND ... out-of-range ratings all surface together")', () => {
    const bad = freshPack();
    bad.formatVersion = DATA_PACK_VERSION - 1;
    bad.team.players[0].attr.three = 400;
    const issues = validateTeamPack(bad);
    expect(has(issues, '$.formatVersion', `expected ${DATA_PACK_VERSION}`)).toBe(true);
    expect(has(issues, '$.team.players[0].attr.three', 'rating must be 0-100')).toBe(true);
  });
});

describe('schema rejection paths — team-level fields', () => {
  it('missing tactics is rejected at load time (crash-prevention gate, schema.ts:229-237)', () => {
    // spec: "tactics is REQUIRED by the engine ... a pack missing tactics
    // would crash mid-game"; rejection message names the expected shape
    const bad = freshPack();
    delete bad.team.tactics;
    expect(has(validateTeamPack(bad), '$.team.tactics', 'missing tactics')).toBe(true);
  });

  it('each tactics dial must be a 0-100 rating, reported per key (schema.ts:239-241)', () => {
    const bad = freshPack();
    bad.team.tactics.pace = 101;
    bad.team.tactics.threeBias = 'fast';
    const issues = validateTeamPack(bad);
    expect(has(issues, '$.team.tactics.pace', 'must be 0-100')).toBe(true);
    expect(has(issues, '$.team.tactics.threeBias', 'must be 0-100')).toBe(true);
  });

  it('a non-array players field is one issue, starter checks are skipped, and nothing throws (schema.ts:243-244)', () => {
    // spec: schema.ts:243-244 — players non-array pushes the roster-size
    // issue and skips the else-branch (per-player + starters); everything
    // else in the pack is valid, so the report is EXACTLY that one issue
    const bad = freshPack();
    bad.team.players = 'nope';
    expect(validateTeamPack(bad))
      .toEqual([{ path: '$.team.players', message: `need at least ${MIN_PLAYERS} players` }]);
  });

  it('duplicate player ids are rejected at $.team.players (schema.ts:257-270; inexpressible in JSON Schema per gen-schema.test.ts)', () => {
    const bad = freshPack();
    bad.team.players[1].id = bad.team.players[0].id;
    expect(has(validateTeamPack(bad), '$.team.players', 'duplicate player ids')).toBe(true);
  });

  it('starters must be an array of exactly 5 — non-array and 6-entry lists both fail (schema.ts:271-275)', () => {
    // spec: "Exactly 5, not 'at least 5' — ... a 4- or 6-name starters list
    // isn't a smaller/larger valid roster, it's malformed" (schema.test.ts
    // already covers 4; this pins the non-array and TOO-MANY sides)
    const notArray = freshPack();
    notArray.team.starters = 'the usual five';
    expect(has(validateTeamPack(notArray), '$.team.starters', `exactly ${STARTERS_COUNT} starters required`)).toBe(true);

    const six = freshPack();
    six.team.starters = [...six.team.starters, six.team.players[5].id];
    expect(has(validateTeamPack(six), '$.team.starters', `exactly ${STARTERS_COUNT} starters required`)).toBe(true);
  });

  it('rotationMinutes must be an object map, not an array (schema.ts:300-304)', () => {
    // spec: "if present it must be shaped right ... 'must be an object of
    // { playerId: minutes }'" — Array.isArray is checked explicitly because
    // typeof [] === 'object'
    const bad = freshPack();
    bad.team.rotationMinutes = [36, 30];
    expect(has(validateTeamPack(bad), '$.team.rotationMinutes', 'must be an object of { playerId: minutes }')).toBe(true);
  });

  it('a negative rotation-minutes target is rejected at the offending id (schema.ts:305-309)', () => {
    const bad = freshPack();
    bad.team.rotationMinutes = { 'brk-mercer': -5 };
    expect(has(validateTeamPack(bad), '$.team.rotationMinutes.brk-mercer', 'finite number >= 0')).toBe(true);
  });

  it('a rotationMinutes key matching no player id is rejected at the offending key (issue #60)', () => {
    // spec: schema.ts — "Keys must match a player id on the roster". The
    // engine skips a dead key without error, so the author's minutes plan
    // silently never applies: the #39 self-play rig lost 85% of its games to
    // a dead rotation map before the cause was found. Until issue #60 this
    // suite pinned the opposite contract (NOT-a-rejection, deferring to a
    // roster-validate plausibility warning the load path never runs); the
    // incident overturned that judgment.
    const bad = freshPack();
    bad.team.rotationMinutes = { ghost: 20 };
    expect(has(validateTeamPack(bad), '$.team.rotationMinutes.ghost', 'matches no player id')).toBe(true);

    // a key matching a rostered player is untouched — no behavior change
    // for valid packs
    const ok = freshPack();
    ok.team.rotationMinutes = { [ok.team.players[5].id]: 20 };
    expect(validateTeamPack(ok)).toEqual([]);
  });

  it('the dead-key check needs a roster to check against: non-array players skips it, like the starters checks (issue #60)', () => {
    // spec: schema.ts — `ids` stays null when players isn't an array, so the
    // reference check is skipped rather than flagging every rotationMinutes
    // key on a pack whose real problem is the roster itself; the value check
    // still runs (20 is a legal target, so no rotation issue at all here)
    const bad = freshPack();
    bad.team.players = 'nope';
    bad.team.rotationMinutes = { ghost: 20 };
    const issues = validateTeamPack(bad);
    expect(has(issues, '$.team.players', `need at least ${MIN_PLAYERS} players`)).toBe(true);
    expect(issues.some((i) => i.path === '$.team.rotationMinutes.ghost')).toBe(false);
  });
});

describe('schema rejection paths — per-player fields', () => {
  it('missing/non-string id and name are reported per player (schema.ts:125-126)', () => {
    const bad = freshPack();
    delete bad.team.players[0].id;
    bad.team.players[1].name = 7;
    const issues = validateTeamPack(bad);
    expect(has(issues, '$.team.players[0].id', 'missing id')).toBe(true);
    expect(has(issues, '$.team.players[1].name', 'missing name')).toBe(true);
  });

  it('a position outside PG/SG/SF/PF/C is named in the message (schema.ts:144-146)', () => {
    const bad = freshPack();
    bad.team.players[0].pos = 'POINT';
    delete bad.team.players[1].pos;
    const issues = validateTeamPack(bad);
    expect(has(issues, '$.team.players[0].pos', 'invalid position POINT')).toBe(true);
    expect(has(issues, '$.team.players[1].pos', 'invalid position undefined')).toBe(true);
  });

  it(`heightIn outside ${HEIGHT_MIN_IN}-${HEIGHT_MAX_IN} or non-numeric is rejected with the range in the message (schema.ts:147-150)`, () => {
    // spec: HEIGHT_MIN_IN/HEIGHT_MAX_IN are "generous human limits
    // (5'0"-8'0")" (schema.ts:89-92)
    const rangeMsg = `heightIn must be a finite number ${HEIGHT_MIN_IN}-${HEIGHT_MAX_IN}`;
    for (const badHeight of [HEIGHT_MIN_IN - 1, HEIGHT_MAX_IN + 1, 'tall']) {
      const bad = freshPack();
      bad.team.players[0].heightIn = badHeight;
      expect(has(validateTeamPack(bad), '$.team.players[0].heightIn', rangeMsg)).toBe(true);
    }
  });

  it('a non-finite weightLb is rejected — finiteness, not just presence (schema.ts:127-136)', () => {
    // spec: "simulateGame() hard-throws on a non-finite body measurement";
    // schema.test.ts covers the MISSING case, this pins Infinity
    const bad = freshPack();
    bad.team.players[0].weightLb = Infinity;
    expect(has(validateTeamPack(bad), '$.team.players[0].weightLb', 'weightLb must be a finite number')).toBe(true);
  });

  it('wingspanIn: absent is fine, present must be finite (schema.ts:137-143)', () => {
    // spec: "Absent is fine; present means finite" (derived.ts falls back to
    // heightIn + 2 only when the field is absent). The shipped rosters omit
    // it, so the clean base pack already proves the absent half; a finite
    // value must also pass, and a non-finite one must be named.
    const ok = freshPack();
    ok.team.players[0].wingspanIn = 84;
    expect(validateTeamPack(ok)).toEqual([]);

    const bad = freshPack();
    bad.team.players[0].wingspanIn = Infinity;
    expect(has(validateTeamPack(bad), '$.team.players[0].wingspanIn', 'must be a finite number')).toBe(true);
  });

  it('missing attr/tend bags are reported as missing, not crashed into (schema.ts:151-152, 174-175)', () => {
    const bad = freshPack();
    delete bad.team.players[0].attr;
    delete bad.team.players[1].tend;
    const issues = validateTeamPack(bad);
    expect(has(issues, '$.team.players[0].attr', 'missing attributes')).toBe(true);
    expect(has(issues, '$.team.players[1].tend', 'missing tendencies')).toBe(true);
  });

  it('a MISSING attribute key is caught — validation enumerates ATTR_KEYS, not the pack\'s own keys (schema.ts:53-59)', () => {
    // spec: "validation is exhaustive even for a pack that's MISSING a key
    // entirely (Object.keys on the pack's own data would only ever find
    // what's already there)"
    const bad = freshPack();
    delete bad.team.players[0].attr.speed;
    expect(has(validateTeamPack(bad), '$.team.players[0].attr.speed', 'rating must be 0-100')).toBe(true);
  });

  it('rating range is inclusive at 0 and 100; just outside, non-finite, and string values all fail at the exact key (schema.ts:102-106)', () => {
    // spec: isRating — "Every rating ... lives on the same 0-100 scale";
    // boundary VALUES ARE legal (RATING_MIN/RATING_MAX are the engine's own
    // contract), so a validator that rejected the boundary would be wrong too
    const boundary = freshPack();
    boundary.team.players[0].attr.three = 0;
    boundary.team.players[0].tend.shotThree = 100;
    expect(validateTeamPack(boundary)).toEqual([]);

    for (const badRating of [-0.5, 100.5, NaN, Infinity, '77']) {
      const bad = freshPack();
      bad.team.players[0].attr.three = badRating;
      expect(has(validateTeamPack(bad), '$.team.players[0].attr.three', 'rating must be 0-100')).toBe(true);
    }
  });

  it('tendency ratings get the same range enforcement at their own path (schema.ts:176-179)', () => {
    const bad = freshPack();
    bad.team.players[0].tend.usage = 101;
    expect(has(validateTeamPack(bad), '$.team.players[0].tend.usage', 'rating must be 0-100')).toBe(true);
  });
});

describe('schema rejection paths — loadTeamPack envelope', () => {
  it('invalid JSON reports through the same issue shape: team null, one issue at $ (schema.ts:322-340)', () => {
    // spec: loadTeamPack JSDoc — "a JSON syntax error becomes one issue at
    // path `$`"; direct-API envelope (only the CLI subprocess covered this)
    const r = loadTeamPack('{ this is not JSON');
    expect(r.team).toBe(null);
    expect(r.issues.length).toBe(1);
    expect(r.issues[0]!.path).toBe('$');
    expect(r.issues[0]!.message).toContain('invalid JSON');
  });

  it('a well-formed but invalid pack yields team null — no partial-pack recovery (schema.ts header: "no partial-pack recovery")', () => {
    const bad = freshPack();
    bad.formatVersion = DATA_PACK_VERSION - 1;
    const r = loadTeamPack(JSON.stringify(bad));
    expect(r.team).toBe(null);
    expect(has(r.issues, '$.formatVersion', `expected ${DATA_PACK_VERSION}`)).toBe(true);
  });
});
