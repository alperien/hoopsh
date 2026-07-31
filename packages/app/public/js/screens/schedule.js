/**
 * screens/schedule.js - the season, one row per game, results from the
 * user's perspective. Played rows click through to the game center.
 */
import { registerScreen, store, navigate } from '../app.js';
import { api } from '../api.js';
import { el, chip, table } from '../ui.js';
import { recordLabel, streakLabel } from '../format.js';

registerScreen('schedule', {
  title: 'Schedule',
  nav: 'Schedule', navKey: 'c',
  async render(root) {
    const user = store.summary.userTeam;
    const data = await api.schedule(user);
    const s = store.summary;
    const next = data.games.find(g => !g.final);
    const standings = (await api.standings()).standings.find(x => x.teamId === user);

    const rows = data.games.map(g => {
      const home = g.home === user;
      const opp = home ? g.away : g.home;
      let result = null;
      let won = null;
      if (g.final) {
        const my = home ? g.final[0] : g.final[1];
        const their = home ? g.final[1] : g.final[0];
        won = my > their;
        result = `${won ? 'W' : 'L'} ${my}-${their}${g.ot ? (g.ot === 1 ? ' OT' : ` ${g.ot}OT`) : ''}`;
      }
      return { ...g, opp, home, result, won };
    });

    root.replaceChildren(
      el('h1', { class: 'doc' }, 'the schedule'),
      el('div', { class: 'doc-sub' },
        `${recordLabel(standings)} · streak ${streakLabel(standings?.streak ?? 0)}` +
        (next ? ` · next: ${next.home === user ? 'vs' : 'at'} ${store.teams[next.home === user ? next.away : next.home]?.name ?? ''} on ${next.dateLabel}` : ' · season complete')),
      table({
        columns: [
          { key: 'dateLabel', label: 'date', sortValue: r => r.date.day },
          { key: 'home', label: '', format: v => (v ? 'vs' : 'at'), sortValue: r => (r.home ? 1 : 0) },
          { key: 'opp', label: 'opponent', format: v => chip(store.teams, v, { full: true }) },
          { key: 'result', label: 'result', format: (v, r) => (v ? el('span', { class: r.won ? 'up' : 'down' }, v) : el('span', { class: 'sub' }, 'upcoming')), sortValue: r => (r.result ? (r.won ? 2 : 1) : 0) },
        ],
        rows,
        onRow: (r) => { if (r.final) navigate(`/game/${r.gameId}`); },
        caption: 'click a played game for the box score and broadcast',
      }),
    );
  },
});
