/**
 * Identity pins for the two shipped calibration teams (data/src/teams.ts).
 *
 * teams.ts's header declares these rosters load-bearing: "THESE ARE THE TWO
 * CALIBRATION TEAMS ... treat these two rosters with the same caution as a
 * params.ts SWEPT constant". A silent edit here shifts the league averages
 * every band in harness/src/bands.ts was fit to — so the documented identity
 * values (tactics dials, roster shape, sampleMatchup's home side) get pinned,
 * making an accidental edit loud. A DELIBERATE edit must re-run `npm run
 * batch` per that header anyway, and updates these pins in the same change.
 *
 * No sims; pure structure + one JSON read for the shipped-pack parity gate.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { cascadiaBreakers, meridianMonarchs, sampleMatchup, toTeamPack, validateTeamPack } from '@hoopsh/data';
import type { Team } from '@hoopsh/engine';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const rosterPath = (id: string) => path.join(ROOT, 'packages', 'data', 'rosters', `${id}.team.json`);

describe('shipped calibration teams', () => {
  it('Breakers identity: pace-and-space tactics {66, 68, 52}, 10 players (teams.ts:21-22, 39-46)', () => {
    // spec: teams.ts JSDoc — "tactics.pace=66/threeBias=68 (Breakers)" and
    // helpAggr 52 (the Monarchs contrast comment cites "62 vs. 52")
    const t = cascadiaBreakers();
    expect(t.id).toBe('breakers');
    expect(t.abbrev).toBe('CAS');
    expect(t.tactics.pace).toBe(66);
    expect(t.tactics.threeBias).toBe(68);
    expect(t.tactics.helpAggr).toBe(52);
    expect(t.players.length).toBe(10);
  });

  it('Monarchs identity: post/defense tactics {46, 44, 62}, 10 players (teams.ts:70-78)', () => {
    // spec: teams.ts JSDoc — "Low pace (46) and low threeBias (44) ...
    // higher helpAggr (62 vs. 52) matches the defense-first label"
    const t = meridianMonarchs();
    expect(t.id).toBe('monarchs');
    expect(t.abbrev).toBe('MER');
    expect(t.tactics.pace).toBe(46);
    expect(t.tactics.threeBias).toBe(44);
    expect(t.tactics.helpAggr).toBe(62);
    expect(t.players.length).toBe(10);
  });

  it('each team names exactly 5 unique starters, all on its own roster (engine boundary contract, sim/game.ts validateTeam)', () => {
    for (const t of [cascadiaBreakers(), meridianMonarchs()]) {
      expect(t.starters.length).toBe(5);
      expect(new Set(t.starters).size).toBe(5);
      const rosterIds = new Set(t.players.map((p) => p.id));
      expect(t.starters.every((id) => rosterIds.has(id))).toBe(true);
    }
  });

  it('player ids are unique across BOTH rosters — the pair must be co-playable (sim/game.ts requires cross-roster uniqueness)', () => {
    // spec: box scores/agents key on ids; the default matchup would crash or
    // garble stats if brk-*/mon-* ever collided
    const ids = [...cascadiaBreakers().players, ...meridianMonarchs().players].map((p) => p.id);
    expect(new Set(ids).size).toBe(20);
  });

  it('both teams pass their own pack validator (data/src/schema.ts round trip; monarchs previously untested)', () => {
    // spec: schema.ts round-trip promise — the calibration rosters are the
    // canonical valid packs every mutation-test derives from
    for (const t of [cascadiaBreakers(), meridianMonarchs()]) {
      expect(validateTeamPack(JSON.parse(JSON.stringify(toTeamPack(t))))).toEqual([]);
    }
  });
});

describe('sampleMatchup contract', () => {
  it('Cascadia is ALWAYS home; callers apply their own flip (teams.ts:102-109)', () => {
    // spec: sampleMatchup JSDoc — "Cascadia is always `home` here; callers
    // that need home/away balance apply their own flip ... rather than this
    // function alternating on its own"
    const m = sampleMatchup();
    expect(m.home.id).toBe('breakers');
    expect(m.away.id).toBe('monarchs');
    const again = sampleMatchup();
    expect(again.home.id).toBe('breakers'); // never alternates
  });

  it('returns fresh objects per call — mutating one matchup cannot poison the next (fixture safety across the 23 suites that call it)', () => {
    // spec: cascadiaBreakers()/meridianMonarchs() are factory FUNCTIONS
    // (teams.ts) — each call rebuilds players; shared state here would let
    // one test's roster edit silently change every later sim in the process
    const a = sampleMatchup();
    const b = sampleMatchup();
    expect(a.home).not.toBe(b.home);
    a.home.players[0]!.attr.three = 1;
    expect(b.home.players[0]!.attr.three).not.toBe(1);
    expect(sampleMatchup().home.players[0]!.attr.three).not.toBe(1);
  });
});

describe('shipped pack files mirror the code-defined teams', () => {
  it('rosters/*.team.json equal toTeamPack(codeTeam) modulo the editor $schema pointer (schema.ts:10-14: packs are EXPORTS of the code teams)', () => {
    // spec: schema.ts header — "export-rosters.ts (harness) produces packs
    // FROM code-defined teams via toTeamPack()". gen-schema.test only
    // re-validates the JSON; without this pin teams.ts could drift from the
    // committed packs silently and the two faces of the default matchup
    // (code fixtures vs hand-editable files) would disagree.
    const pairs: [string, () => Team][] = [
      ['breakers', cascadiaBreakers],
      ['monarchs', meridianMonarchs]
    ];
    for (const [id, fn] of pairs) {
      const shipped = JSON.parse(readFileSync(rosterPath(id), 'utf8'));
      delete shipped.$schema; // editor affordance, not pack content (gen-schema.test.ts pins it as accepted)
      expect(shipped).toEqual(JSON.parse(JSON.stringify(toTeamPack(fn()))));
    }
  });
});
