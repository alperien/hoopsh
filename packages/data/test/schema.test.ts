import { describe, expect, it } from 'vitest';
import { cascadiaBreakers, loadTeamPack, toTeamPack, validateTeamPack } from '@hoopsh/data';

describe('data pack schema', () => {
  it('sample teams round-trip through JSON validation', () => {
    const pack = toTeamPack(cascadiaBreakers());
    const json = JSON.stringify(pack);
    const { team, issues } = loadTeamPack(json);
    expect(issues).toEqual([]);
    expect(team?.id).toEqual('breakers');
  });

  it('catches malformed packs', () => {
    const bad = toTeamPack(cascadiaBreakers());
    (bad.team.players[0]!.attr as { three: number }).three = 400;
    bad.team.starters = ['nope', 'b', 'c', 'd', 'e'];
    const issues = validateTeamPack(JSON.parse(JSON.stringify(bad)));
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.some((i) => i.path.includes('three'))).toBe(true);
    expect(issues.some((i) => i.path.includes('starters'))).toBe(true);
  });

  it('rejects a non-string team id (game_start stamps teamId into the event stream verbatim)', () => {
    const bad = JSON.parse(JSON.stringify(toTeamPack(cascadiaBreakers()))) as { team: { id: unknown } };
    bad.team.id = 42; // truthy, so a truthiness-only check would pass it
    expect(validateTeamPack(bad).some((i) => i.path === '$.team.id')).toBe(true);
  });

  it('rejects unknown keys inside attr/tend — the class simulateGame crashes on', () => {
    const bad = JSON.parse(JSON.stringify(toTeamPack(cascadiaBreakers()))) as {
      team: { players: { attr: Record<string, unknown>; tend: Record<string, unknown> }[] };
    };
    // the natural hand-edit: JSON has no comments, so authors annotate a
    // rating bag with a string note — the engine throws on it at tip-off
    bad.team.players[0]!.attr.note = 'bump after trade deadline';
    // a typo'd-but-numeric key: engine-ignored, i.e. a rating that silently
    // does nothing — rejected for the same honest-description reason
    bad.team.players[1]!.tend.pullup = 60;
    const issues = validateTeamPack(bad);
    expect(issues.some((i) =>
      i.path === '$.team.players[0].attr.note' && i.message.includes('unknown attribute "note"'))).toBe(true);
    expect(issues.some((i) =>
      i.path === '$.team.players[1].tend.pullup' && i.message.includes('unknown tendency "pullup"'))).toBe(true);
    // and the loader refuses the pack outright, not just flags it
    expect(loadTeamPack(JSON.stringify(bad)).team).toBe(null);
  });

  it('rejects a repeated starter id (5 entries, 4 unique players)', () => {
    const bad = toTeamPack(cascadiaBreakers());
    // duplicate the first starter over the second — length stays 5 and every
    // entry is a real roster id, so only the uniqueness check can catch it
    bad.team.starters = [
      bad.team.starters[0]!, bad.team.starters[0]!,
      bad.team.starters[2]!, bad.team.starters[3]!, bad.team.starters[4]!
    ];
    const issues = validateTeamPack(JSON.parse(JSON.stringify(bad)));
    expect(issues.some((i) => i.message.includes('duplicate starter'))).toBe(true);
  });

  it('reports (never throws) on null/non-object player entries — the duplicate-id pass dereferenced them', () => {
    const bad = JSON.parse(JSON.stringify(toTeamPack(cascadiaBreakers()))) as {
      team: { players: unknown[] };
    };
    // a hand-edit slip leaves a null or a bare string in the players array;
    // the validator's whole promise is one complete error dump, not a TypeError
    bad.team.players[2] = null;
    bad.team.players[5] = 'benched';
    const issues = validateTeamPack(bad); // must not throw
    expect(issues.some((i) => i.path === '$.team.players[2]' && i.message.includes('object'))).toBe(true);
    expect(issues.some((i) => i.path === '$.team.players[5]')).toBe(true);
    // and two invalid entries (both ids undefined) must not fabricate a
    // false duplicate-player-ids issue
    expect(issues.some((i) => i.message === 'duplicate player ids')).toBe(false);
  });

  it('a short roster still gets its players and starters validated — one complete dump (B5-6)', () => {
    const bad = JSON.parse(JSON.stringify(toTeamPack(cascadiaBreakers()))) as {
      team: { players: { attr: Record<string, unknown> }[]; starters: string[] };
    };
    bad.team.players = bad.team.players.slice(0, 7); // under MIN_PLAYERS
    bad.team.players[0]!.attr.three = 400;           // a concrete per-player problem
    bad.team.starters = ['ghost', ...bad.team.starters.slice(1)];
    const issues = validateTeamPack(bad);
    expect(issues.some((i) => i.message.includes('at least'))).toBe(true);      // the roster-size issue
    expect(issues.some((i) => i.path.includes('attr.three'))).toBe(true);       // AND the player issue
    expect(issues.some((i) => i.message.includes('ghost'))).toBe(true);         // AND the starter issue
  });

  it('rejects packs that would crash or garble the sim despite valid ratings', () => {
    const bad = JSON.parse(JSON.stringify(toTeamPack(cascadiaBreakers()))) as {
      team: {
        name?: string; abbrev?: string;
        players: { weightLb?: number; wingspanIn?: unknown }[];
        rotationMinutes?: Record<string, unknown>;
      };
    };
    delete bad.team.name;                       // "undefined 98" narration
    delete bad.team.abbrev;                     // "undefined are in the bonus"
    delete bad.team.players[0]!.weightLb;       // simulateGame throws non-finite body measurement
    bad.team.players[1]!.wingspanIn = 'long';   // NaN standing reach in derived.ts
    bad.team.rotationMinutes = { 'brk-mercer': 'lots' }; // NaN minutes-pace leash in subs.ts
    const issues = validateTeamPack(bad);
    expect(issues.some((i) => i.path === '$.team.name')).toBe(true);
    expect(issues.some((i) => i.path === '$.team.abbrev')).toBe(true);
    expect(issues.some((i) => i.path === '$.team.players[0].weightLb')).toBe(true);
    expect(issues.some((i) => i.path === '$.team.players[1].wingspanIn')).toBe(true);
    expect(issues.some((i) => i.path === '$.team.rotationMinutes.brk-mercer')).toBe(true);
  });
});
