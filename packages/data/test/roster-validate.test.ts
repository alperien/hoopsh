/**
 * roster:validate's two promises, each with its own failure mode:
 *  - ERRORS restate validateTeamPack() verdicts with a usable fix — so the
 *    enrichment must never invent or hide a rejection (validator parity).
 *  - WARNINGS are calibrated heuristics — so every shipped roster and the
 *    default scaffold MUST come out warning-free (a heuristic that flags
 *    known-good basketball is noise, and noise trains authors to ignore the
 *    tool), while each heuristic fires on the pathology it names.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validateTeamPack } from '@hoopsh/data';
import { buildRoster, defaultSlots } from '../../../tools/roster-new.mjs';
import { computeWarnings, explainIssue, getAtPath } from '../../../tools/roster-validate.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

function scaffold(): any {
  return JSON.parse(JSON.stringify(buildRoster({
    name: 'Warn Lab', abbrev: 'WRN', id: 'warn-lab',
    slots: defaultSlots(10), tactics: {}
  })));
}

const codes = (pack: unknown) => computeWarnings(pack as any).map((w: { code: string }) => w.code);

describe('roster:validate warnings', () => {
  it('shipped rosters and the default scaffold are warning-free (calibration ratchet)', () => {
    for (const id of ['breakers', 'monarchs']) {
      const pack = JSON.parse(readFileSync(path.join(ROOT, 'packages', 'data', 'rosters', `${id}.team.json`), 'utf8'));
      expect(computeWarnings(pack)).toEqual([]);
    }
    expect(computeWarnings(scaffold())).toEqual([]);
  });

  it('flat-profile: 24 identical attributes', () => {
    const pack = scaffold();
    for (const k of Object.keys(pack.team.players[9].attr)) pack.team.players[9].attr[k] = 50;
    expect(codes(pack)).toContain('flat-profile');
  });

  it('no-plus-skill vs uniform-elite: both flavors of information-free roster', () => {
    const low = scaffold();
    for (const pl of low.team.players) {
      for (const k of Object.keys(pl.attr)) pl.attr[k] = Math.min(pl.attr[k], 65);
    }
    expect(codes(low)).toContain('no-plus-skill');

    const high = scaffold();
    for (const pl of high.team.players) {
      for (const k of Object.keys(pl.attr)) pl.attr[k] = Math.max(pl.attr[k], 85);
    }
    expect(codes(high)).toContain('uniform-elite');
  });

  it('no-rim-protection: all-wing starting five', () => {
    const pack = scaffold();
    // starters: floorGeneral, scoringWing, threeAndD + two bench guards
    pack.team.starters = ['warn-lab-p01', 'warn-lab-p02', 'warn-lab-p03', 'warn-lab-p06', 'warn-lab-p07'];
    expect(validateTeamPack(pack)).toEqual([]); // legal lineup — that's the point
    expect(codes(pack)).toContain('no-rim-protection');
  });

  it('no-initiator: nobody can bring the ball up', () => {
    const pack = scaffold();
    for (const id of pack.team.starters) {
      pack.team.players.find((pl: any) => pl.id === id).attr.ballHandle = 40;
    }
    expect(codes(pack)).toContain('no-initiator');
  });

  it('shot-diet: refuses-every-shot and wants-every-shot both flagged', () => {
    const pack = scaffold();
    Object.assign(pack.team.players[8].tend, { shotRim: 5, shotMid: 5, shotThree: 5 });
    Object.assign(pack.team.players[9].tend, { shotRim: 100, shotMid: 90, shotThree: 95 });
    const found = computeWarnings(pack).filter((w: { code: string }) => w.code === 'shot-diet');
    expect(found.length).toBe(2);
  });

  it('duplicate-names: case-insensitive collision', () => {
    const pack = scaffold();
    pack.team.players[9].name = pack.team.players[3].name.toUpperCase();
    expect(codes(pack)).toContain('duplicate-names');
  });

  it('usage budget: overload and vacuum on the starting five', () => {
    const over = scaffold();
    for (const id of over.team.starters) over.team.players.find((pl: any) => pl.id === id).tend.usage = 90;
    expect(codes(over)).toContain('usage-overload');

    const under = scaffold();
    for (const id of under.team.starters) under.team.players.find((pl: any) => pl.id === id).tend.usage = 20;
    expect(codes(under)).toContain('usage-vacuum');
  });

  it('rotationMinutes: unknown id (with typo suggestion), >48 target, overbooked total', () => {
    const pack = scaffold();
    pack.team.rotationMinutes = { 'warn-lab-p1': 30, 'warn-lab-p01': 52 };
    const warns = computeWarnings(pack);
    const unknown = warns.find((w: { code: string }) => w.code === 'rotation-unknown-id');
    expect(unknown?.why).toContain('warn-lab-p01');
    expect(warns.some((w: { code: string }) => w.code === 'rotation-implausible')).toBe(true);

    const booked = scaffold();
    booked.team.rotationMinutes = Object.fromEntries(
      booked.team.players.slice(0, 8).map((pl: any) => [pl.id, 40]) // 320 player-minutes
    );
    expect(codes(booked)).toContain('rotation-overbooked');
  });
});

describe('roster:validate error enrichment', () => {
  it('speaks human: quoted numbers, centimeter heights, missing keys, id typos', () => {
    const pack = scaffold();
    (pack.team.players[0].attr as any).three = '88';
    pack.team.players[1].heightIn = 206;
    delete pack.team.players[2].tend.usage;
    pack.team.starters[4] = 'warn-lab-p5'; // typo for p05
    const issues = validateTeamPack(pack);
    const explained = issues.map((i) => explainIssue(pack, i) as any);

    expect(explained.find((e) => e.path.endsWith('attr.three'))?.fix).toContain('remove the quotes');
    expect(explained.find((e) => e.path.endsWith('heightIn'))?.fix).toContain('centimeters');
    expect(explained.find((e) => e.path.endsWith('heightIn'))?.fix).toContain('81'); // 206cm -> 81in
    expect(explained.find((e) => e.path.endsWith('tend.usage'))?.fix).toContain('"usage": 50');
    expect(explained.find((e) => e.path === '$.team.starters')?.fix).toContain('"warn-lab-p05"');
  });

  it('never hides an issue: every validator issue survives enrichment 1:1', () => {
    const pack = scaffold();
    delete (pack as any).team.tactics;
    pack.formatVersion = 99;
    (pack.team.players[3] as any).pos = 'CENTER';
    const issues = validateTeamPack(pack);
    expect(issues.length).toBeGreaterThan(0);
    const explained = issues.map((i) => explainIssue(pack, i) as any);
    expect(explained.length).toBe(issues.length);
    for (let i = 0; i < issues.length; i++) {
      expect(explained[i].path).toBe(issues[i].path);
      expect(explained[i].message).toBe(issues[i].message);
    }
  });

  it('getAtPath walks bracketed player paths', () => {
    const pack = scaffold();
    expect(getAtPath(pack, '$.team.players[2].attr.three')).toBe(pack.team.players[2].attr.three);
    expect(getAtPath(pack, '$.formatVersion')).toBe(2);
    expect(getAtPath(pack, '$.team.players[99].attr.three')).toBe(undefined);
  });
});

describe('roster:validate CLI', () => {
  const run = (...cliArgs: string[]) => spawnSync(process.execPath, [
    '--disable-warning=ExperimentalWarning',
    '--import', path.join(ROOT, 'tools', 'register.mjs'),
    path.join(ROOT, 'tools', 'roster-validate.mjs'),
    ...cliArgs
  ], { encoding: 'utf8' });

  it('exit codes: 0 valid, 1 invalid, 1 strict-with-warnings, 2 missing file', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'hoopsh-rv-'));

    const good = path.join(dir, 'good.json');
    writeFileSync(good, JSON.stringify(scaffold()));
    const goodRes = run(good, '--json');
    expect(goodRes.status).toBe(0);
    const goodOut = JSON.parse(goodRes.stdout);
    expect(goodOut.valid).toBe(true);
    expect(goodOut.warnings).toEqual([]);

    const bad = path.join(dir, 'bad.json');
    const broken = scaffold();
    broken.team.starters = broken.team.starters.slice(0, 4);
    writeFileSync(bad, JSON.stringify(broken));
    expect(run(bad).status).toBe(1);

    const susFile = path.join(dir, 'sus.json');
    const sus = scaffold();
    for (const k of Object.keys(sus.team.players[9].attr)) sus.team.players[9].attr[k] = 50;
    writeFileSync(susFile, JSON.stringify(sus));
    expect(run(susFile).status).toBe(0);          // warnings alone don't fail
    expect(run(susFile, '--strict').status).toBe(1); // unless asked to

    expect(run(path.join(dir, 'nope.json')).status).toBe(2);
    expect(run().status).toBe(2);
  });

  it('rejects malformed JSON with a syntax hint, exit 1', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'hoopsh-rv-'));
    const f = path.join(dir, 'syntax.json');
    writeFileSync(f, '{ "formatVersion": 2, }');
    const res = run(f);
    expect(res.status).toBe(1);
    expect(res.stdout).toContain('trailing commas');
  });
});
