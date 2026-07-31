/**
 * server.ts - the game server: node:http JSON API (protocol.ts is the
 * contract) plus the static UI. All I/O for the franchise layer lives
 * here; the franchise itself never touches a socket or a file.
 *
 * State model: one league in memory at a time (this is a local
 * single-player game server, not a service). Multi-day sims run as an
 * async loop the UI polls via /api/sim/status; the loop stops on inbox
 * decisions when asked, at the target otherwise.
 */
import { readFileSync, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  advanceDay, applyUserAction, createLeague, respondToOffer,
} from '@hoopsh/franchise';
import type { DayDigest, League, SimulateJobs, TradeOffer, UserAction } from '@hoopsh/franchise';
import { buildBroadcastScript, TemplateColorProvider } from '@hoopsh/narration';
import type { GameEvent, Team } from '@hoopsh/engine';
import { makeWorkerPool } from './runner.js';
import { listSaves, loadLeague, saveLeague } from './saves.js';
import {
  faMarket, gameView, leaders, playerRow, playerView, prospects,
  scheduleRow, summary, teamView,
} from './views.js';
import type { NewLeagueBody, SimStatus } from './protocol.js';
import { SAVE_FORMAT_VERSION, conferenceSeeds } from '@hoopsh/franchise';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(HERE, '..', 'public');
const REPLAY_DIR = path.resolve('out', 'replays');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

interface AppState {
  league: League | null;
  saveName: string;
  sim: SimStatus & { digestCap: number };
  pool: SimulateJobs;
  lastDigest: DayDigest | null;
}

function newSimStatus(): AppState['sim'] {
  return {
    running: false,
    currentDay: { season: 0, day: 0 },
    target: null,
    daysDone: 0,
    daysTotal: 0,
    digests: [],
    stoppedFor: null,
    digestCap: 40, // the UI needs recent context, not the whole run
  };
}

function json(res: ServerResponse, code: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
  res.end(data);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', c => chunks.push(c as Buffer));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/** The async multi-day sim loop; one at a time, polled by the UI. */
async function runAdvance(state: AppState, days: number, stopOnInbox: boolean): Promise<void> {
  const league = state.league!;
  state.sim.running = true;
  state.sim.daysTotal = days;
  state.sim.daysDone = 0;
  state.sim.digests = [];
  state.sim.stoppedFor = null;
  try {
    for (let i = 0; i < days; i++) {
      const digest = await advanceDay(league, state.pool);
      state.lastDigest = digest;
      // stamp replay files onto today's user/featured games (the worker
      // writes them by gameId convention for detail:'events' jobs)
      for (const gid of digest.games) {
        const file = path.join(REPLAY_DIR, `${gid}.json`);
        const record = league.results[gid];
        if (record && existsSync(file)) record.replayFile = file;
      }
      state.sim.daysDone = i + 1;
      state.sim.currentDay = { season: league.season, day: league.day };
      state.sim.digests.push(digest);
      if (state.sim.digests.length > state.sim.digestCap) state.sim.digests.shift();
      const openDecisions = league.inbox.some(x => !x.resolved && x.kind === 'decision');
      if (stopOnInbox && (digest.inboxIds.length > 0 || openDecisions) && i < days - 1) {
        state.sim.stoppedFor = 'inbox';
        break;
      }
      if (digest.phaseChangedTo && i < days - 1 && stopOnInbox) {
        state.sim.stoppedFor = 'phase';
        break;
      }
    }
    if (!state.sim.stoppedFor) state.sim.stoppedFor = 'target';
  } finally {
    state.sim.running = false;
  }
}

/** Route the request. Returns true when handled. */
async function handleApi(state: AppState, req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const p = url.pathname;
  if (!p.startsWith('/api/')) return false;

  // ---- league-independent routes
  if (p === '/api/meta' && req.method === 'GET') {
    json(res, 200, { saves: listSaves(), version: SAVE_FORMAT_VERSION, hasLeague: state.league !== null });
    return true;
  }
  if (p === '/api/new' && req.method === 'POST') {
    const body = JSON.parse(await readBody(req) || '{}') as NewLeagueBody;
    if (!body.userTeam) { json(res, 400, { error: 'userTeam is required' }); return true; }
    if (state.sim.running) { json(res, 409, { error: 'a sim is running' }); return true; }
    state.league = createLeague({
      seed: body.seed || `league-${body.userTeam}-${body.name || 'gm'}`,
      userTeam: body.userTeam,
      startSeason: body.startSeason,
    });
    state.saveName = body.name || 'my-league';
    state.lastDigest = null;
    state.sim = newSimStatus();
    saveLeague(state.league, state.saveName);
    json(res, 200, { ok: true });
    return true;
  }
  if (p === '/api/load' && req.method === 'POST') {
    const body = JSON.parse(await readBody(req) || '{}') as { name?: string };
    if (!body.name) { json(res, 400, { error: 'name is required' }); return true; }
    if (state.sim.running) { json(res, 409, { error: 'a sim is running' }); return true; }
    state.league = loadLeague(body.name);
    state.saveName = body.name;
    state.lastDigest = null;
    state.sim = newSimStatus();
    json(res, 200, { ok: true });
    return true;
  }

  const league = state.league;
  if (!league) { json(res, 409, { error: 'no league loaded; POST /api/new or /api/load first' }); return true; }

  if (p === '/api/save' && req.method === 'POST') {
    const body = JSON.parse(await readBody(req) || '{}') as { name?: string };
    const name = body.name || state.saveName;
    saveLeague(league, name);
    state.saveName = name;
    json(res, 200, { ok: true, name });
    return true;
  }
  if (p === '/api/summary' && req.method === 'GET') {
    json(res, 200, summary(league, { digest: state.lastDigest, simRunning: state.sim.running }));
    return true;
  }
  if (p === '/api/league/standings' && req.method === 'GET') {
    json(res, 200, {
      standings: Object.values(league.standings),
      seeds: { East: conferenceSeeds(league, 'East'), West: conferenceSeeds(league, 'West') },
    });
    return true;
  }
  if (p === '/api/league/leaders' && req.method === 'GET') {
    json(res, 200, { rows: leaders(league, url.searchParams.get('stat') ?? 'pts') });
    return true;
  }
  if (p === '/api/league/stats' && req.method === 'GET') {
    const view = url.searchParams.get('view') ?? 'teams';
    if (view === 'players') {
      const rows = Object.keys(league.players)
        .filter(pid => league.players[pid]!.status === 'roster' || league.players[pid]!.status === 'gleague')
        .map(pid => playerRow(league, pid));
      json(res, 200, { rows });
    } else {
      const rows = Object.values(league.teams).map(t => ({
        teamId: t.id, city: t.city, name: t.name, abbrev: t.abbrev,
        conference: t.conference, division: t.division, colors: t.colors,
        ...(league.standings[t.id] ?? {}),
      }));
      json(res, 200, { rows });
    }
    return true;
  }
  if (p === '/api/league/transactions' && req.method === 'GET') {
    json(res, 200, { transactions: league.transactions.slice(-120).reverse() });
    return true;
  }
  if (p === '/api/news' && req.method === 'GET') {
    const page = Number(url.searchParams.get('page') ?? '0');
    const team = url.searchParams.get('team');
    const all = team ? league.news.filter(n => n.teams.includes(team)) : league.news;
    const pageSize = 25;
    const start = Math.max(0, all.length - (page + 1) * pageSize);
    const end = all.length - page * pageSize;
    json(res, 200, { items: all.slice(start, Math.max(start, end)).reverse(), hasMore: start > 0 });
    return true;
  }
  if (p === '/api/inbox' && req.method === 'GET') {
    json(res, 200, { items: league.inbox.slice().reverse() });
    return true;
  }
  if (p === '/api/draft/board' && req.method === 'GET') {
    json(res, 200, {
      prospects: prospects(league),
      myPicks: league.teams[league.userTeam]!.picks,
      order: league.lottery?.order ?? [],
    });
    return true;
  }
  if (p === '/api/fa/market' && req.method === 'GET') {
    json(res, 200, { players: faMarket(league), capContext: teamView(league, league.userTeam).cap });
    return true;
  }
  if (p === '/api/records' && req.method === 'GET') {
    json(res, 200, { records: league.records });
    return true;
  }
  if (p === '/api/sim/status' && req.method === 'GET') {
    const { digestCap, ...status } = state.sim;
    void digestCap;
    json(res, 200, status);
    return true;
  }
  if (p === '/api/sim/advance' && req.method === 'POST') {
    if (state.sim.running) { json(res, 409, { error: 'a sim is already running' }); return true; }
    const body = JSON.parse(await readBody(req) || '{}') as { days?: number; stopOnInbox?: boolean };
    const days = Math.max(1, Math.min(400, Math.floor(body.days ?? 1)));
    void runAdvance(state, days, body.stopOnInbox !== false).then(
      () => saveLeague(state.league!, state.saveName), // autosave after every advance run
      err => { console.error('advance failed:', err); state.sim.running = false; },
    );
    json(res, 200, { started: true });
    return true;
  }
  if (p === '/api/action' && req.method === 'POST') {
    if (state.sim.running) { json(res, 409, { error: 'a sim is running' }); return true; }
    const body = JSON.parse(await readBody(req) || '{}') as { action?: UserAction };
    if (!body.action) { json(res, 400, { error: 'action is required' }); return true; }
    const result = applyUserAction(league, body.action);
    if (result.ok) saveLeague(league, state.saveName);
    json(res, 200, result);
    return true;
  }
  if (p === '/api/trade/evaluate' && req.method === 'POST') {
    const body = JSON.parse(await readBody(req) || '{}') as { offer?: TradeOffer };
    if (!body.offer) { json(res, 400, { error: 'offer is required' }); return true; }
    json(res, 200, respondToOffer(league, body.offer));
    return true;
  }

  // ---- parameterized routes
  const teamMatch = p.match(/^\/api\/team\/([a-z]{3})$/);
  if (teamMatch && req.method === 'GET') {
    if (!league.teams[teamMatch[1]!]) { json(res, 404, { error: 'unknown team' }); return true; }
    json(res, 200, teamView(league, teamMatch[1]!));
    return true;
  }
  const capMatch = p.match(/^\/api\/cap\/([a-z]{3})$/);
  if (capMatch && req.method === 'GET') {
    if (!league.teams[capMatch[1]!]) { json(res, 404, { error: 'unknown team' }); return true; }
    json(res, 200, teamView(league, capMatch[1]!).cap);
    return true;
  }
  const playerMatch = p.match(/^\/api\/player\/([\w-]+)$/);
  if (playerMatch && req.method === 'GET') {
    if (!league.players[playerMatch[1]!]) { json(res, 404, { error: 'unknown player' }); return true; }
    json(res, 200, playerView(league, playerMatch[1]!));
    return true;
  }
  const schedMatch = p.match(/^\/api\/schedule\/([a-z]{3})$/);
  if (schedMatch && req.method === 'GET') {
    const teamId = schedMatch[1]!;
    if (!league.teams[teamId]) { json(res, 404, { error: 'unknown team' }); return true; }
    const games = league.schedule
      .filter(g => g.home === teamId || g.away === teamId)
      .map(g => scheduleRow(league, g.id))
      .filter((x): x is NonNullable<typeof x> => x !== null);
    json(res, 200, { games });
    return true;
  }
  const almanacMatch = p.match(/^\/api\/almanac(?:\/(\d+))?$/);
  if (almanacMatch && req.method === 'GET') {
    if (!almanacMatch[1]) {
      json(res, 200, { seasons: league.archives.map(a => a.season) });
      return true;
    }
    const archive = league.archives.find(a => a.season === Number(almanacMatch[1]));
    if (!archive) { json(res, 404, { error: 'no archive for that season' }); return true; }
    json(res, 200, archive);
    return true;
  }
  const gameMatch = p.match(/^\/api\/game\/([\w@.-]+)$/);
  if (gameMatch && req.method === 'GET') {
    const record = league.results[gameMatch[1]!];
    if (!record) { json(res, 404, { error: 'no result for that game' }); return true; }
    const hasReplay = Boolean(record.replayFile && existsSync(record.replayFile));
    json(res, 200, gameView(league, record, hasReplay));
    return true;
  }
  const replayMatch = p.match(/^\/api\/game\/([\w@.-]+)\/replay$/);
  if (replayMatch && req.method === 'GET') {
    const record = league.results[replayMatch[1]!];
    if (!record?.replayFile || !existsSync(record.replayFile)) {
      json(res, 404, { error: 'no replay kept for that game' });
      return true;
    }
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    res.end(readFileSync(record.replayFile));
    return true;
  }
  const bcastMatch = p.match(/^\/api\/game\/([\w@.-]+)\/broadcast$/);
  if (bcastMatch && req.method === 'GET') {
    const record = league.results[bcastMatch[1]!];
    if (!record?.replayFile || !existsSync(record.replayFile)) {
      json(res, 404, { error: 'no broadcast available (replay not kept)' });
      return true;
    }
    const replay = JSON.parse(readFileSync(record.replayFile, 'utf8')) as { events: GameEvent[] };
    const toTeam = (id: string): Team => {
      const t = league.teams[id]!;
      return {
        id: t.id, name: `${t.city} ${t.name}`, abbrev: t.abbrev,
        tactics: { pace: 50, threeBias: 50, helpAggr: 50 },
        players: [], starters: [],
      } as unknown as Team;
    };
    const cues = await buildBroadcastScript(
      replay.events,
      [toTeam(record.home), toTeam(record.away)],
      new TemplateColorProvider(),
      { seed: record.seed },
    );
    json(res, 200, { cues });
    return true;
  }
  const viewerMatch = p.match(/^\/api\/game\/([\w@.-]+)\/viewer$/);
  if (viewerMatch && req.method === 'GET') {
    // bake the frozen 2D viewer around this game's replay, in memory,
    // exactly the way packages/viewer/embed.mjs does on disk
    const record = league.results[viewerMatch[1]!];
    if (!record?.replayFile || !existsSync(record.replayFile)) {
      json(res, 404, { error: 'no replay kept for that game' });
      return true;
    }
    const template = readFileSync(path.join(HERE, '..', '..', 'viewer', 'index.html'), 'utf8');
    const MARK = '/*HOOPSH_REPLAY*/null'; // the viewer template's bake marker (embed.mjs)
    const replayJson = readFileSync(record.replayFile, 'utf8').replace(/</g, '\\u003c');
    const idx = template.indexOf(MARK);
    if (idx < 0) { json(res, 500, { error: 'viewer template is missing the bake marker' }); return true; }
    const html = template.slice(0, idx) + replayJson + template.slice(idx + MARK.length);
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html);
    return true;
  }
  const watchMatch = p.match(/^\/api\/sim\/watch\/([\w@.-]+)$/);
  if (watchMatch && req.method === 'POST') {
    // v1: the spine already keeps events for the user's games; this
    // endpoint exists so the UI can mark interest ahead of a featured
    // game. Accepted and remembered on the record when it exists.
    json(res, 200, { ok: true });
    return true;
  }

  json(res, 404, { error: `no route for ${req.method} ${p}` });
  return true;
}

function serveStatic(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url ?? '/', 'http://localhost');
  let rel = url.pathname === '/' ? '/index.html' : url.pathname;
  // the 2D replay viewer ships in packages/viewer; serve it under /viewer/
  let base = PUBLIC_DIR;
  if (rel.startsWith('/viewer/')) {
    base = path.join(HERE, '..', '..', 'viewer');
    rel = rel.slice('/viewer'.length);
    if (rel === '/' || rel === '') rel = '/index.html';
  }
  const file = path.normalize(path.join(base, rel));
  if (!file.startsWith(path.normalize(base))) {
    res.writeHead(403); res.end('forbidden'); return;
  }
  if (!existsSync(file)) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
    return;
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' });
  res.end(readFileSync(file));
}

export interface StartedServer { port: number; close: () => void; state: unknown; }

export function startServer(opts: { port?: number; workers?: number; loadSave?: string } = {}): Promise<StartedServer> {
  const state: AppState = {
    league: null,
    saveName: 'my-league',
    sim: newSimStatus(),
    pool: makeWorkerPool({ workers: opts.workers, replayDir: REPLAY_DIR }),
    lastDigest: null,
  };
  if (opts.loadSave) {
    state.league = loadLeague(opts.loadSave);
    state.saveName = opts.loadSave;
  }

  const server = createServer((req, res) => {
    handleApi(state, req, res)
      .then(handled => { if (!handled) serveStatic(req, res); })
      .catch(err => {
        console.error(`${req.method} ${req.url} failed:`, err);
        if (!res.headersSent) json(res, 500, { error: (err as Error).message });
        else res.end();
      });
  });

  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(opts.port ?? 4200, () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : (opts.port ?? 4200);
      resolve({ port, close: () => server.close(), state });
    });
  });
}
