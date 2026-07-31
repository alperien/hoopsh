/**
 * screens/league.js - standings, leaders, team and player tables, the
 * transaction wire. Tabs, one dense table each, everything sortable.
 */
import { registerScreen, store, navigate } from '../app.js';
import { api } from '../api.js';
import { el, chip, grade, ledger, table } from '../ui.js';
import { money, pct, streakLabel } from '../format.js';

const TABS = ['standings', 'leaders', 'players', 'transactions'];

function tabBar(active, base) {
  return el('div', { style: 'display:flex;gap:4px;margin-bottom:14px' }, TABS.map(t =>
    el('button', {
      class: t === active ? '' : 'quiet',
      onclick: () => navigate(`/league/${t}`),
    }, t)));
}

async function renderStandings(root) {
  const data = await api.standings();
  const rows = data.standings;
  const byId = Object.fromEntries(rows.map(r => [r.teamId, r]));
  const confTable = (conf) => table({
    caption: `${conf}ern conference`,
    columns: [
      { key: 'seed', label: '#', align: 'num', sortValue: r => -r.seed },
      { key: 'teamId', label: 'team', format: v => chip(store.teams, v, { full: true }) },
      { key: 'w', label: 'w', align: 'num' },
      { key: 'l', label: 'l', align: 'num' },
      { key: 'pct', label: 'pct', align: 'num', format: (v, r) => (r.w + r.l ? (r.w / (r.w + r.l)).toFixed(3).slice(1) : '-'), sortValue: r => r.w / Math.max(1, r.w + r.l) },
      { key: 'home', label: 'home', format: (v, r) => `${r.homeW}-${r.homeL}`, sortValue: r => r.homeW },
      { key: 'away', label: 'road', format: (v, r) => `${r.awayW}-${r.awayL}`, sortValue: r => r.awayW },
      { key: 'diff', label: 'diff', align: 'num', format: (v, r) => { const d = r.w + r.l ? ((r.ptsFor - r.ptsAgainst) / (r.w + r.l)) : 0; return el('span', { class: d >= 0 ? 'up' : 'down' }, d.toFixed(1)); }, sortValue: r => r.ptsFor - r.ptsAgainst },
      { key: 'streak', label: 'strk', align: 'num', format: v => streakLabel(v), sortValue: r => r.streak },
      { key: 'last10', label: 'last 10', format: v => `${v.filter(x => x === 1).length}-${v.filter(x => x === 0).length}` },
    ],
    rows: (data.seeds[conf] ?? []).map((id, i) => ({ seed: i + 1, ...byId[id] })).filter(r => r.teamId),
    onRow: (r) => navigate(`/team/${r.teamId}`),
  });
  root.append(el('div', { class: 'cols c2', style: 'grid-template-columns:1fr 1fr' },
    confTable('East'), confTable('West')));
}

async function renderLeaders(root) {
  const stats = ['pts', 'reb', 'ast', 'stl', 'blk', 'tpm'];
  const all = await Promise.all(stats.map(s => api.leaders(s)));
  root.append(el('div', { class: 'cols c3' }, stats.map((stat, i) =>
    el('div', {},
      ledger(stat === 'tpm' ? 'threes' : stat),
      table({
        columns: [
          { key: 'name', label: 'player' },
          { key: 'teamId', label: 'team', format: v => chip(store.teams, v) },
          { key: 'value', label: 'per game', align: 'num' },
        ],
        rows: all[i].rows.slice(0, 10),
        onRow: (r) => navigate(`/player/${r.playerId}`),
        empty: 'not enough games yet',
      })))));
}

async function renderPlayers(root) {
  const data = await api.leagueStats('players');
  root.append(table({
    caption: 'every rostered player; click through for the card',
    columns: [
      { key: 'name', label: 'player' },
      { key: 'pos', label: 'pos', format: v => el('span', { class: 'pos-chip' }, v) },
      { key: 'age', label: 'age', align: 'num' },
      { key: 'ovr', label: 'grade', align: 'num', format: v => grade(v) },
      { key: 'gp', label: 'gp', align: 'num', format: (v, r) => r.perGame.gp ?? 0, sortValue: r => r.perGame.gp ?? 0 },
      { key: 'pts', label: 'pts', align: 'num', format: (v, r) => r.perGame.pts ?? '-', sortValue: r => r.perGame.pts ?? -1 },
      { key: 'reb', label: 'reb', align: 'num', format: (v, r) => r.perGame.reb ?? '-', sortValue: r => r.perGame.reb ?? -1 },
      { key: 'ast', label: 'ast', align: 'num', format: (v, r) => r.perGame.ast ?? '-', sortValue: r => r.perGame.ast ?? -1 },
      { key: 'min', label: 'min', align: 'num', format: (v, r) => r.perGame.min ?? '-', sortValue: r => r.perGame.min ?? -1 },
      { key: 'fgPct', label: 'fg%', align: 'num', format: (v, r) => r.perGame.fgPct !== undefined ? pct(r.perGame.fgPct) : '-', sortValue: r => r.perGame.fgPct ?? -1 },
      { key: 'salary', label: 'salary', align: 'num', format: v => el('span', { class: 'money' }, money(v)) },
    ],
    rows: data.rows,
    sort: { key: 'pts', dir: 1 },
    onRow: (r) => navigate(`/player/${r.id}`),
  }));
}

async function renderTransactions(root) {
  const data = await api.transactions();
  const label = (tx) => {
    switch (tx.kind) {
      case 'trade': return `trade: ${tx.teams.map(t => store.teams[t]?.abbrev ?? t).join(' and ')} (${tx.players.length} players, ${tx.picks.length} picks)`;
      case 'signing': return `${store.teams[tx.teamId]?.abbrev ?? tx.teamId} sign ${tx.playerId}${tx.offerSheet ? ' (offer sheet)' : ''}`;
      case 'waive': return `${store.teams[tx.teamId]?.abbrev ?? tx.teamId} waive ${tx.playerId}${tx.stretched ? ' (stretched)' : ''}`;
      case 'draftSelection': return `${store.teams[tx.teamId]?.abbrev ?? tx.teamId} draft ${tx.playerId} (r${tx.round} p${tx.pick})`;
      case 'retirement': return `${tx.playerId} retires`;
      case 'optionDecision': return `${store.teams[tx.teamId]?.abbrev ?? tx.teamId} ${tx.exercised ? 'exercise' : 'decline'} ${tx.option} option on ${tx.playerId}`;
      case 'extension': return `${store.teams[tx.teamId]?.abbrev ?? tx.teamId} extend ${tx.playerId}`;
      case 'assignment': return `${store.teams[tx.teamId]?.abbrev ?? tx.teamId} ${tx.to === 'gleague' ? 'assign' : 'recall'} ${tx.playerId}`;
      case 'coachChange': return `${store.teams[tx.teamId]?.abbrev ?? tx.teamId} ${tx.fired ? 'replace their coach with' : 'hire'} ${tx.coach.name}`;
      default: return tx.kind;
    }
  };
  root.append(table({
    caption: 'the wire, newest first',
    columns: [
      { key: 'date', label: 'day', align: 'num', format: v => v.day, sortValue: r => r.date.day },
      { key: 'kind', label: 'type' },
      { key: 'what', label: 'transaction', format: (v, r) => label(r), sortValue: r => r.kind },
    ],
    rows: data.transactions,
    empty: 'no transactions yet',
  }));
}

registerScreen('league', {
  title: 'League',
  nav: 'League', navKey: 'l',
  async render(root, params) {
    const tab = TABS.includes(params[0]) ? params[0] : 'standings';
    root.replaceChildren(
      el('h1', { class: 'doc' }, 'around the league'),
      el('div', { class: 'doc-sub' }, 'standings, leaders, the full player table, and the wire'),
      tabBar(tab),
    );
    if (tab === 'standings') await renderStandings(root);
    if (tab === 'leaders') await renderLeaders(root);
    if (tab === 'players') await renderPlayers(root);
    if (tab === 'transactions') await renderTransactions(root);
  },
});
