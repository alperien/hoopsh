/**
 * screens/player.js - the player card. Rostered players get the career
 * ledger, the game log, and the development file. Prospects get the
 * scout memo: ranges, not numbers, because the fog is the game.
 */
import { registerScreen, store, navigate } from '../app.js';
import { api } from '../api.js';
import { el, chip, ledger, table } from '../ui.js';
import { money, plusMinus, seasonLabel } from '../format.js';

function rangeBar(label, [lo, hi]) {
  return el('div', { style: 'display:flex;align-items:center;gap:10px;margin:3px 0' },
    el('span', { style: 'width:92px;font-size:12px;color:var(--ink-soft)' }, label),
    el('span', { class: 'mono', style: 'width:58px;font-size:12px;text-align:right' }, `${Math.round(lo)}-${Math.round(hi)}`),
    el('div', { style: 'flex:1;height:6px;background:var(--rule);border-radius:2px;position:relative' },
      el('div', {
        style: `position:absolute;left:${lo}%;width:${Math.max(2, hi - lo)}%;height:6px;background:var(--accent);border-radius:2px`,
      })),
  );
}

function scoutMemo(report) {
  const groups = ['scoring', 'playmaking', 'defense', 'rebounding', 'phys', 'mental'];
  return el('div', { class: 'card' },
    el('div', { style: 'display:flex;justify-content:space-between;align-items:baseline' },
      el('b', {}, 'scouting report'),
      el('span', { class: 'sub', style: 'color:var(--ink-faint);font-size:12px' }, `coverage ${Math.round(report.coverage)}`)),
    el('p', { style: 'margin:6px 0;font-size:13px' }, `${report.role}. comparison: ${report.comparison}.`),
    el('div', { style: 'margin:10px 0 4px;font-size:11.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--ink-soft)' }, 'today'),
    groups.map(g => report.current[g] ? rangeBar(g, report.current[g]) : null),
    el('div', { style: 'margin:10px 0 4px;font-size:11.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--ink-soft)' }, 'ceiling'),
    groups.map(g => report.ceiling[g] ? rangeBar(g, report.ceiling[g]) : null),
    report.strengths.length ? el('p', { style: 'font-size:12.5px;margin:8px 0 0' }, el('b', {}, 'strengths: '), report.strengths.join('; ')) : null,
    report.flags.length ? el('p', { style: 'font-size:12.5px;margin:4px 0 0;color:var(--bad)' }, el('b', {}, 'flags: '), report.flags.join('; ')) : null,
  );
}

function careerTable(seasons) {
  const rows = seasons.map(r => ({ ...r, key: `${r.season}-${r.type}-${r.teamId}` }));
  const pg = (r, stat) => (r.gp ? Math.round((stat / r.gp) * 10) / 10 : 0);
  return table({
    columns: [
      { key: 'season', label: 'season', format: (v, r) => `${seasonLabel(v)}${r.type === 'playoffs' ? ' po' : ''}` },
      { key: 'teamId', label: 'team', format: v => chip(store.teams, v) },
      { key: 'gp', label: 'gp', align: 'num' },
      { key: 'minpg', label: 'min', align: 'num', format: (v, r) => pg(r, r.min), sortValue: r => pg(r, r.min) },
      { key: 'ptspg', label: 'pts', align: 'num', format: (v, r) => pg(r, r.pts), sortValue: r => pg(r, r.pts) },
      { key: 'rebpg', label: 'reb', align: 'num', format: (v, r) => pg(r, r.orb + r.drb), sortValue: r => pg(r, r.orb + r.drb) },
      { key: 'astpg', label: 'ast', align: 'num', format: (v, r) => pg(r, r.ast), sortValue: r => pg(r, r.ast) },
      { key: 'fg', label: 'fg%', align: 'num', format: (v, r) => (r.fga ? ((r.fgm / r.fga) * 100).toFixed(1) : '-'), sortValue: r => (r.fga ? r.fgm / r.fga : 0) },
      { key: 'tp', label: '3p%', align: 'num', format: (v, r) => (r.tpa ? ((r.tpm / r.tpa) * 100).toFixed(1) : '-'), sortValue: r => (r.tpa ? r.tpm / r.tpa : 0) },
      { key: 'ft', label: 'ft%', align: 'num', format: (v, r) => (r.fta ? ((r.ftm / r.fta) * 100).toFixed(1) : '-'), sortValue: r => (r.fta ? r.ftm / r.fta : 0) },
    ],
    rows,
    sort: { key: 'season', dir: -1 },
    empty: 'no league games yet',
  });
}

registerScreen('player', {
  title: 'Player',
  async render(root, params) {
    const view = await api.player(params[0]);
    const p = view.player;
    const teamId = p.contract?.teamId;
    const contractLine = p.contract
      ? p.contract.years.map(y => money(y.salary)).join(' / ') + (p.contract.kind !== 'standard' ? ` (${p.contract.kind})` : '')
      : p.status === 'draftEligible' ? 'draft eligible' : 'free agent';

    root.replaceChildren(
      el('h1', { class: 'doc' }, p.name),
      el('div', { class: 'doc-sub' },
        `${p.pos} · ${Math.floor(p.heightIn / 12)}'${p.heightIn % 12}" ${p.weightLb} lb · age ${store.summary.date.season - p.bornSeason} · ${p.originDetail} · `,
        teamId ? chip(store.teams, teamId) : el('span', {}, p.status),
        ` · ${contractLine}`),
      p.awards?.length
        ? el('p', { style: 'font-size:12.5px;color:var(--ink-soft)' },
            p.awards.map(a => `${a.label} ${seasonLabel(a.season)}`).join(' · '))
        : null,
      el('div', { class: 'cols c2' },
        el('div', {},
          ledger('career'),
          careerTable(view.seasons),
          ledger('game log'),
          table({
            columns: [
              { key: 'date', label: 'day', align: 'num', format: v => v.day, sortValue: r => r.date.day },
              { key: 'gameId', label: 'game', format: v => el('a', { href: `#/game/${v}`, style: 'color:inherit' }, v.split('-').slice(2).join('-')) },
              { key: 'line', label: 'min', align: 'num', format: v => Math.round(v.min), sortValue: r => r.line.min },
              { key: 'pts', label: 'pts', align: 'num', format: (v, r) => r.line.pts, sortValue: r => r.line.pts },
              { key: 'reb', label: 'reb', align: 'num', format: (v, r) => r.line.orb + r.line.drb, sortValue: r => r.line.orb + r.line.drb },
              { key: 'ast', label: 'ast', align: 'num', format: (v, r) => r.line.ast, sortValue: r => r.line.ast },
              { key: 'pm', label: '+/-', align: 'num', format: (v, r) => el('span', { class: r.line.plusMinus > 0 ? 'up' : r.line.plusMinus < 0 ? 'down' : '' }, plusMinus(r.line.plusMinus)), sortValue: r => r.line.plusMinus },
            ],
            rows: view.gameLog,
            sort: { key: 'date', dir: 1 },
            empty: 'no games this season',
          }),
        ),
        el('div', {},
          view.report ? scoutMemo(view.report) : null,
          view.player.devLog?.length ? el('div', {},
            ledger('development file'),
            ...view.player.devLog.slice(-8).reverse().map(note =>
              el('div', { class: 'card', style: 'margin-bottom:6px;padding:8px 12px' },
                el('div', { class: 'sub', style: 'color:var(--ink-faint);font-size:11.5px' },
                  `${seasonLabel(note.date.season)}, day ${note.date.day}`),
                el('div', { style: 'font-size:12.5px' },
                  Object.entries(note.deltas).map(([g, d]) => `${d > 0 ? '+' : ''}${Math.round(d * 10) / 10} ${g}`).join(', ') || 'held steady'),
                el('div', { style: 'font-size:12px;color:var(--ink-soft)' }, note.reasons.join('; ')),
              ))) : null,
          view.news.length ? el('div', {},
            ledger('clippings'),
            ...view.news.map(n => el('div', { class: 'news-item' },
              el('div', { class: 'byline' }, n.byline),
              el('h3', { style: 'font-size:13.5px' }, n.headline)))) : null,
        ),
      ),
    );
  },
});
