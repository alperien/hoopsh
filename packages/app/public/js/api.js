/**
 * api.js - the browser mirror of packages/app/src/protocol.ts. That file
 * is the source of truth; this one follows it. Every function returns
 * parsed JSON or throws Error(message) from the server's { error } shape.
 */

async function call(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `${method} ${path} failed (${res.status})`);
  return data;
}

export const api = {
  meta: () => call('GET', '/api/meta'),
  newLeague: (body) => call('POST', '/api/new', body),
  load: (name) => call('POST', '/api/load', { name }),
  save: (name) => call('POST', '/api/save', name ? { name } : {}),
  summary: () => call('GET', '/api/summary'),
  team: (id) => call('GET', `/api/team/${id}`),
  cap: (id) => call('GET', `/api/cap/${id}`),
  player: (id) => call('GET', `/api/player/${id}`),
  standings: () => call('GET', '/api/league/standings'),
  leaders: (stat) => call('GET', `/api/league/leaders?stat=${encodeURIComponent(stat)}`),
  leagueStats: (view) => call('GET', `/api/league/stats?view=${encodeURIComponent(view)}`),
  transactions: () => call('GET', '/api/league/transactions'),
  news: (page = 0, team = '') => call('GET', `/api/news?page=${page}${team ? `&team=${team}` : ''}`),
  inbox: () => call('GET', '/api/inbox'),
  schedule: (teamId) => call('GET', `/api/schedule/${teamId}`),
  game: (id) => call('GET', `/api/game/${id}`),
  broadcast: (id) => call('GET', `/api/game/${id}/broadcast`),
  draftBoard: () => call('GET', '/api/draft/board'),
  faMarket: () => call('GET', '/api/fa/market'),
  almanacIndex: () => call('GET', '/api/almanac'),
  almanac: (season) => call('GET', `/api/almanac/${season}`),
  records: () => call('GET', '/api/records'),
  action: (action) => call('POST', '/api/action', { action }),
  evaluateTrade: (offer) => call('POST', '/api/trade/evaluate', { offer }),
  advance: (days, stopOnInbox = true) => call('POST', '/api/sim/advance', { days, stopOnInbox }),
  simStatus: () => call('GET', '/api/sim/status'),

  // ---- the career chair (CAREER ROUTES in protocol.ts)
  newCareer: (body) => call('POST', '/api/career/new', body),
  careerLoad: (name) => call('POST', '/api/career/load', { name }),
  careerSave: (name) => call('POST', '/api/career/save', name ? { name } : {}),
  careerSummary: () => call('GET', '/api/career/summary'),
  careerMe: () => call('GET', '/api/career/me'),
  careerPlan: () => call('GET', '/api/career/plan'),
  careerCircuit: () => call('GET', '/api/career/circuit'),
  careerPhone: () => call('GET', '/api/career/phone'),
  careerRecruiting: () => call('GET', '/api/career/recruiting'),
  careerStock: () => call('GET', '/api/career/stock'),
  careerOffers: () => call('GET', '/api/career/offers'),
  careerLedger: () => call('GET', '/api/career/ledger'),
  careerEvents: (page = 0) => call('GET', `/api/career/events?page=${page}`),
  careerEpilogue: () => call('GET', '/api/career/epilogue'),
  careerGame: (id) => call('GET', `/api/career/game/${id}`),
  careerBroadcast: (id) => call('GET', `/api/career/game/${id}/broadcast`),
  careerChoice: (choice) => call('POST', '/api/career/choice', { choice }),
  careerAdvance: (weeks, stopOnDecision = true) => call('POST', '/api/career/advance', { weeks, stopOnDecision }),
  careerSimStatus: () => call('GET', '/api/career/sim/status'),
};
