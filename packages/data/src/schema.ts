/**
 * Data packs: versioned JSON containers for teams/rosters, with validation.
 * The deep editor (roadmap) reads and writes exactly this format.
 */

import type { Attributes, Player, Team, Tendencies } from '@hoopsh/engine';

export const DATA_PACK_VERSION = 1;

export interface TeamPack {
  formatVersion: number;
  kind: 'team';
  team: Team;
}

export interface ValidationIssue {
  path: string;
  message: string;
}

const ATTR_KEYS: (keyof Attributes)[] = [
  'speed', 'accel', 'strength', 'vertical', 'lateral', 'stamina',
  'finishing', 'midRange', 'three', 'freeThrow', 'drawFoul',
  'ballHandle', 'passAcc', 'passVision',
  'perimeterD', 'interiorD', 'steal', 'block', 'contestSkill',
  'offReb', 'defReb', 'boxout', 'decisions', 'consistency'
];

const TEND_KEYS: (keyof Tendencies)[] = [
  'shotRim', 'shotMid', 'shotThree', 'pullUp',
  'drive', 'passOut', 'iso', 'post',
  'offBallMotion', 'crashOffReb', 'gambleSteal', 'foulAggr', 'pushPace'
];

function isRating(x: unknown): boolean {
  return typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= 100;
}

function validatePlayer(p: unknown, path: string, issues: ValidationIssue[]): void {
  if (typeof p !== 'object' || p === null) {
    issues.push({ path, message: 'player must be an object' });
    return;
  }
  const pl = p as Partial<Player>;
  if (!pl.id || typeof pl.id !== 'string') issues.push({ path: `${path}.id`, message: 'missing id' });
  if (!pl.name || typeof pl.name !== 'string') issues.push({ path: `${path}.name`, message: 'missing name' });
  if (!['PG', 'SG', 'SF', 'PF', 'C'].includes(pl.pos as string)) {
    issues.push({ path: `${path}.pos`, message: `invalid position ${String(pl.pos)}` });
  }
  if (typeof pl.heightIn !== 'number' || pl.heightIn < 60 || pl.heightIn > 96) {
    issues.push({ path: `${path}.heightIn`, message: 'heightIn must be 60-96' });
  }
  const attr = pl.attr as Record<string, unknown> | undefined;
  if (!attr) issues.push({ path: `${path}.attr`, message: 'missing attributes' });
  else {
    for (const k of ATTR_KEYS) {
      if (!isRating(attr[k])) issues.push({ path: `${path}.attr.${k}`, message: 'rating must be 0-100' });
    }
  }
  const tend = pl.tend as Record<string, unknown> | undefined;
  if (!tend) issues.push({ path: `${path}.tend`, message: 'missing tendencies' });
  else {
    for (const k of TEND_KEYS) {
      if (!isRating(tend[k])) issues.push({ path: `${path}.tend.${k}`, message: 'rating must be 0-100' });
    }
  }
}

export function validateTeamPack(pack: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (typeof pack !== 'object' || pack === null) {
    return [{ path: '$', message: 'pack must be an object' }];
  }
  const tp = pack as Partial<TeamPack>;
  if (tp.formatVersion !== DATA_PACK_VERSION) {
    issues.push({ path: '$.formatVersion', message: `expected ${DATA_PACK_VERSION}` });
  }
  if (tp.kind !== 'team') issues.push({ path: '$.kind', message: 'expected "team"' });
  const team = tp.team as Partial<Team> | undefined;
  if (!team || typeof team !== 'object') {
    issues.push({ path: '$.team', message: 'missing team' });
    return issues;
  }
  if (!team.id) issues.push({ path: '$.team.id', message: 'missing id' });
  if (!Array.isArray(team.players) || team.players.length < 8) {
    issues.push({ path: '$.team.players', message: 'need at least 8 players' });
  } else {
    team.players.forEach((p, i) => validatePlayer(p, `$.team.players[${i}]`, issues));
    const ids = new Set(team.players.map((p) => p.id));
    if (ids.size !== team.players.length) {
      issues.push({ path: '$.team.players', message: 'duplicate player ids' });
    }
    if (!Array.isArray(team.starters) || team.starters.length !== 5) {
      issues.push({ path: '$.team.starters', message: 'exactly 5 starters required' });
    } else {
      for (const sid of team.starters) {
        if (!ids.has(sid)) issues.push({ path: '$.team.starters', message: `starter ${sid} not on roster` });
      }
    }
  }
  return issues;
}

export function toTeamPack(team: Team): TeamPack {
  return { formatVersion: DATA_PACK_VERSION, kind: 'team', team };
}

export function loadTeamPack(json: string): { team: Team | null; issues: ValidationIssue[] } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    return { team: null, issues: [{ path: '$', message: `invalid JSON: ${String(err)}` }] };
  }
  const issues = validateTeamPack(parsed);
  return { team: issues.length === 0 ? (parsed as TeamPack).team : null, issues };
}
