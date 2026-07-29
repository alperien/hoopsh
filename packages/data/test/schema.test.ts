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
