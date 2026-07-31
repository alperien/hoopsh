/**
 * screens/team.js - any franchise, read-only: roster, results, the cap
 * line. Your own team routes to the roster screen for the editing tools.
 */
import { registerScreen, store, navigate } from '../app.js';
import { api } from '../api.js';
import { el, chip, grade, ledger, table } from '../ui.js';
import { money, pct, streakLabel } from '../format.js';

registerScreen('team', {
  title: 'Team',
  async render(root, params) {
    const teamId = params[0];
    if (teamId === store.summary.userTeam) { navigate('/roster'); return; }
    const view = await api.team(teamId);
    const t = view.team;
    const s = view.standings;

    const games = (rows, caption) => table({
      caption,
      columns: [
        { key: 'dateLabel', label: 'date', sortValue: r => r.date.day },
        { key: 'match', label: 'game', format: (v, r) => el('span', {}, chip(store.teams, r.away), ' at ', chip(store.teams, r.home)) },
        { key: 'final', label: 'result', format: v => (v ? `${v[0]}-${v[1]}` : el('span', { class: 'sub' }, 'upcoming')) },
      ],
      rows,
      onRow: (r) => { if (r.final) navigate(`/game/${r.gameId}`); },
      empty: 'nothing',
    });

    root.replaceChildren(
      el('h1', { class: 'doc', style: `border-left:6px solid ${t.colors[0]};padding-left:12px` }, `${t.city} ${t.name}`),
      el('div', { class: 'doc-sub' },
        `${s.w}-${s.l} · ${t.conference} ${t.division} · streak ${streakLabel(s.streak)} · ` +
        `payroll ${money(view.cap.total)}${view.cap.overTax ? ` (taxpayer, bill ${money(view.cap.taxBill)})` : ''} · ${t.arena}`),
      ledger('roster'),
      table({
        columns: [
          { key: 'name', label: 'player', format: (v, r) => el('span', {}, v, ' ', el('span', { class: 'sub' }, r.injuryLabel ?? '')) },
          { key: 'pos', label: 'pos', format: v => el('span', { class: 'pos-chip' }, v) },
          { key: 'age', label: 'age', align: 'num' },
          { key: 'ovr', label: 'grade', align: 'num', format: v => grade(v) },
          { key: 'pts', label: 'pts', align: 'num', format: (v, r) => r.perGame.pts ?? '-', sortValue: r => r.perGame.pts ?? -1 },
          { key: 'reb', label: 'reb', align: 'num', format: (v, r) => r.perGame.reb ?? '-', sortValue: r => r.perGame.reb ?? -1 },
          { key: 'ast', label: 'ast', align: 'num', format: (v, r) => r.perGame.ast ?? '-', sortValue: r => r.perGame.ast ?? -1 },
          { key: 'fgPct', label: 'fg%', align: 'num', format: (v, r) => r.perGame.fgPct !== undefined ? pct(r.perGame.fgPct) : '-', sortValue: r => r.perGame.fgPct ?? -1 },
          { key: 'salary', label: 'salary', align: 'num', format: v => el('span', { class: 'money' }, money(v)) },
          { key: 'years', label: 'yrs', align: 'num' },
        ],
        rows: view.roster,
        sort: { key: 'ovr', dir: 1 },
        onRow: (r) => navigate(`/player/${r.id}`),
      }),
      el('div', { class: 'cols c2', style: 'grid-template-columns:1fr 1fr;margin-top:8px' },
        el('div', {}, ledger('recent'), games(view.recent, '')),
        el('div', {}, ledger('upcoming'), games(view.upcoming, '')),
      ),
    );
  },
});
