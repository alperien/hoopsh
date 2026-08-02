/**
 * probe-wire.ts - UNTRACKED measurement rig for issue #184 (wire anatomy).
 * Read-only observer: counts transactions by calendar bucket, AI-to-user
 * trade offers (inbox items id-prefixed 'trade-offer-'), rumor news items,
 * and negotiation records, per season. Optional funnel census: on sampled
 * days, clones the league, forces pulse chance to 1.0 under varied seeds,
 * and classifies each aiTradePulse attempt (executed / smoke / user-offer /
 * dud) - measuring the proposal-to-acceptance funnel with the real code.
 *
 * Never mutates the live league (census works on clones). Not part of the
 * repo; evidence tooling only.
 *
 * Usage:
 *   node --disable-warning=ExperimentalWarning --import ./tools/register.mjs \
 *     probe-wire.ts --seed acceptance-1 --seasons 2 --chair persona \
 *     --census 1 --workers 2 --out /tmp/wire/acc1-persona.json
 */
import {
  advanceDay, aiTradePulse, createLeague, generatePersona, streamRng,
} from '@hoopsh/franchise';
import type { League, Transaction } from '@hoopsh/franchise';
import { pickSellerTarget, tradeDeadlineDay, inDeadlineWindow } from './packages/franchise/src/ai/trade.js';
import { makeWorkerPool } from './packages/app/src/runner.js';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

function flag(name: string, fallback: string): string {
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 && process.argv[idx + 1] ? process.argv[idx + 1]! : fallback;
}

const SEED = flag('seed', 'acceptance-1');
const SEASONS = Number(flag('seasons', '2'));
const CHAIR = flag('chair', 'persona'); // persona | human
const CENSUS = flag('census', '0') === '1';
const WORKERS = Number(flag('workers', '2'));
const OUT = flag('out', `/tmp/wire/${SEED}-${CHAIR}.json`);

/** Calendar bucket for a (phase, day) pair. */
function bucketOf(league: League, phase: string, day: number): string {
  if (phase === 'camp') return 'camp';
  if (phase === 'regular') {
    const dl = tradeDeadlineDay(league);
    if (day > dl) return 'postDeadline';
    return dl - day <= 14 ? 'deadlineWindow' : 'regular';
  }
  if (phase === 'playin' || phase === 'playoffs') return 'playoffs';
  return 'offseason'; // lottery/draft/moratorium/freeAgency/offseason
}

interface SeasonRow {
  season: number;
  tradesByBucket: Record<string, number>;
  txByKind: Record<string, number>;
  offers: number;          // trade-offer-* inbox items created
  offerDays: string[];     // s/d stamps of offer creation
  tradeDays: string[];     // s/d stamps + bucket of executed trades
  rumors: number;          // news items type 'rumor'
  rumorsInWindow: number;
  negotiationsTouched: number; // negotiation upserts observed (by lastDate)
}

interface CensusRow {
  season: number; day: number; phase: string; bucket: string;
  pairsT1: number; pairsT2: number; targets: number;
  draws: number; executed: number; smoke: number; userOffer: number; dud: number;
}

function newSeasonRow(season: number): SeasonRow {
  return {
    season, tradesByBucket: {}, txByKind: {}, offers: 0, offerDays: [],
    tradeDays: [], rumors: 0, rumorsInWindow: 0, negotiationsTouched: 0,
  };
}

/** Replicated pair context (diagnostic only; tiers from ai/trade.ts complementaryPairs). */
function pairContext(league: League): { t1: number; t2: number; targets: number } {
  const ids = Object.keys(league.teams).sort();
  let t1 = 0, t2 = 0, targets = 0;
  for (const b of ids) {
    const buyer = league.teams[b]!;
    if (!buyer.gm) continue;
    for (const s of ids) {
      if (s === b) continue;
      const bt = buyer.strategy.timeline;
      const st = league.teams[s]!.strategy.timeline;
      const isT1 = bt === 'contend' && st === 'rebuild';
      const isT2 = (bt === 'contend' && st === 'retool') || (bt === 'retool' && st === 'rebuild');
      if (isT1) t1++;
      else if (isT2) t2++;
      if ((isT1 || isT2) && pickSellerTarget(league, b, s) !== null) targets++;
    }
  }
  return { t1, t2, targets };
}

/** One census: N forced-pulse draws on clones of the current league state. */
function census(league: League, draws: number): CensusRow {
  const snapshot = JSON.stringify(league);
  const ctx = pairContext(league);
  const row: CensusRow = {
    season: league.season, day: league.day, phase: league.phase,
    bucket: bucketOf(league, league.phase, league.day),
    pairsT1: ctx.t1, pairsT2: ctx.t2, targets: ctx.targets,
    draws, executed: 0, smoke: 0, userOffer: 0, dud: 0,
  };
  for (let k = 0; k < draws; k++) {
    const clone: League = JSON.parse(snapshot);
    clone.seed = `${league.seed}-census${k}`;
    clone.params.trade.regularPulse = 1;
    clone.params.trade.deadlinePulse = 1;
    clone.params.trade.offseasonPulse = 1;
    const negBefore = clone.negotiations.length;
    const negDatesBefore = clone.negotiations.map(n => `${n.lastDate.season}:${n.lastDate.day}:${n.rounds}`).join('|');
    const inboxBefore = clone.inbox.length;
    const txs = aiTradePulse(clone);
    if (txs.length > 0) row.executed++;
    else if (clone.inbox.length > inboxBefore) row.userOffer++;
    else if (clone.negotiations.length > negBefore
      || clone.negotiations.map(n => `${n.lastDate.season}:${n.lastDate.day}:${n.rounds}`).join('|') !== negDatesBefore) row.smoke++;
    else row.dud++;
  }
  return row;
}

async function main(): Promise<void> {
  const league = createLeague({ seed: SEED, userTeam: 'nye' });
  if (CHAIR === 'persona') {
    league.teams[league.userTeam]!.gm = generatePersona(streamRng(SEED, 'genesis', 'user-gm'));
  }
  const pool = makeWorkerPool({ workers: WORKERS });
  const seasons: SeasonRow[] = [];
  const censusRows: CensusRow[] = [];
  let row = newSeasonRow(league.season);
  let txSeen = 0;
  let newsSeen = 0;
  let inboxSeen = league.inbox.length;
  let dayCount = 0;
  const startSeason = league.season;

  while (league.season < startSeason + SEASONS) {
    const seasonAtTick = league.season;
    const phaseAtTick = league.phase;
    const dayAtTick = league.day;
    // census BEFORE the day advances (state as the pulse would see it)
    if (CENSUS && seasonAtTick === startSeason) {
      const dl = tradeDeadlineDay(league);
      const isWindow = phaseAtTick === 'regular' && dl - dayAtTick >= 0 && dl - dayAtTick <= 14;
      const sampled = (phaseAtTick === 'regular' && !isWindow && (dayAtTick === 40 || dayAtTick === 75 || dayAtTick === 105))
        || (isWindow && (dl - dayAtTick) % 3 === 0)
        || (phaseAtTick === 'freeAgency' && dayAtTick % 17 === 0);
      if (sampled) {
        const c = census(league, 12);
        censusRows.push(c);
        console.error(`CENSUS ${JSON.stringify(c)}`);
      }
    }

    const digest = await advanceDay(league, pool);
    dayCount++;
    if (dayCount > SEASONS * 400 + 400) { console.error('runaway day loop'); break; }

    // bucket by the day that just ran
    const bucket = bucketOf(league, phaseAtTick, dayAtTick);
    for (; txSeen < league.transactions.length; txSeen++) {
      const tx: Transaction = league.transactions[txSeen]!;
      row.txByKind[tx.kind] = (row.txByKind[tx.kind] ?? 0) + 1;
      if (tx.kind === 'trade') {
        row.tradesByBucket[bucket] = (row.tradesByBucket[bucket] ?? 0) + 1;
        row.tradeDays.push(`s${tx.date.season}d${tx.date.day}:${bucket}`);
      }
    }
    for (; newsSeen < league.news.length; newsSeen++) {
      const n = league.news[newsSeen]!;
      if (n.type === 'rumor') {
        row.rumors++;
        if (bucket === 'deadlineWindow') row.rumorsInWindow++;
      }
    }
    for (; inboxSeen < league.inbox.length; inboxSeen++) {
      const item = league.inbox[inboxSeen]!;
      if (item.id.startsWith('trade-offer-')) {
        row.offers++;
        row.offerDays.push(item.id);
      }
    }
    row.negotiationsTouched += league.negotiations
      .filter(n => n.lastDate.season === seasonAtTick && n.lastDate.day === dayAtTick).length;

    if (digest.seasonRolledTo !== undefined && seasonAtTick < digest.seasonRolledTo) {
      seasons.push(row);
      console.error(`SEASON ${JSON.stringify(row)}`);
      row = newSeasonRow(league.season);
    }
    if (CHAIR === 'human' && (league.phase === 'playin' || league.phase === 'playoffs')) {
      seasons.push(row); // partial season: in-season window fully covered
      console.error(`human-chair stop at s${league.season}d${league.day} (${league.phase}): trades=${JSON.stringify(row.tradesByBucket)} offers=${row.offers} rumors=${row.rumors}`);
      break;
    }
  }

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify({ seed: SEED, chair: CHAIR, seasons, census: censusRows }, null, 2));
  console.log(`WROTE ${OUT}`);
  process.exit(0);
}

main().catch(err => { console.error('probe crashed:', err); process.exit(1); });
