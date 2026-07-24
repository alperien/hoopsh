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
});
