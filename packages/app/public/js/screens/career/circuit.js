/**
 * screens/career/circuit.js - Season: the circuit around me. Standings
 * with my row inked, the schedule split into what happened and what is
 * coming, the bracket when it seeds, and the shelf of finished seasons
 * (circuitHistory) that follows the career everywhere.
 */
import { registerScreen } from '../../app.js';
import { api } from '../../api.js';
import { el, ledger } from '../../ui.js';
import { plainTable, historyCard } from './widgets.js';

const KIND_LABELS = {
  hs: 'the county circuit',
  college: 'the conference',
  euro: 'the European league',
  nbl: 'the NBL',
  china: 'the CBA',
};

function otTag(ot) {
  return ot > 0 ? ` (${ot === 1 ? 'OT' : `${ot}OT`})` : '';
}

/** One schedule line; my played games link to the game center. */
function schedRow(g, myName) {
  const mine = g.myGame;
  const kids = [
    el('span', { class: 'wk' }, `w${g.week}`),
    g.round ? el('span', { class: 'round' }, g.round) : null,
  ];
  if (g.final) {
    const homeWon = g.final[0] > g.final[1];
    const iWon = mine && (g.home === myName ? homeWon : !homeWon);
    if (mine) kids.push(el('b', { class: iWon ? 'up' : 'down' }, iWon ? 'W' : 'L'));
    kids.push(el('span', { class: 'score' },
      `${g.away} ${g.final[1]} at ${g.home} ${g.final[0]}${otTag(g.ot)}`));
    if (mine) {
      return el('a', {
        href: `#/career-game/${g.gameId}`,
        class: 'sched-row mine',
        style: 'color:inherit;text-decoration:none',
      }, kids);
    }
    return el('div', { class: 'sched-row' }, kids);
  }
  kids.push(el('span', {}, `${g.away} at ${g.home}`));
  if (mine) kids.push(el('span', { class: 'round', style: 'color:var(--accent);border-color:var(--accent)' }, 'my game'));
  return el('div', { class: `sched-row${mine ? ' mine' : ''}` }, kids);
}

registerScreen('career-circuit', {
  title: 'Season',
  nav: true,
  mode: 'career',
  async render(root) {
    const view = await api.careerCircuit();
    const c = view.circuit;

    const historyBlock = view.history.length
      ? el('div', {},
          ledger('the record', 'every season, kept'),
          el('div', { class: 'hist-strip' }, view.history.map(historyCard)))
      : null;

    if (!c) {
      root.replaceChildren(
        el('h1', { class: 'doc' }, 'the season'),
        el('div', { class: 'doc-sub' }, 'the offseason'),
        el('div', { class: 'empty' }, 'no circuit running. the next season builds when the calendar gets there.'),
        historyBlock,
      );
      return;
    }

    const myName = c.teams[c.myTeamIdx]?.name ?? '';
    const played = c.schedule.filter(g => g.final);
    const upcoming = c.schedule.filter(g => !g.final);

    // bracket grouped by round, in schedule order
    const rounds = [];
    for (const g of c.bracket) {
      let r = rounds.find(x => x.round === (g.round ?? '?'));
      if (!r) { r = { round: g.round ?? '?', games: [] }; rounds.push(r); }
      r.games.push(g);
    }

    root.replaceChildren(
      el('h1', { class: 'doc' }, 'the season'),
      el('div', { class: 'doc-sub' },
        `${c.year}, ${KIND_LABELS[c.kind] ?? c.kind} · ${myName}${c.complete ? ' · season over' : ''}`),
      el('div', { class: 'cols c2' },
        el('div', {},
          ledger('standings'),
          plainTable({
            columns: [
              { key: 'name', label: 'team' },
              { key: 'w', label: 'w', align: 'num' },
              { key: 'l', label: 'l', align: 'num' },
              { key: 'pf', label: 'pf', align: 'num' },
              { key: 'pa', label: 'pa', align: 'num' },
              { key: 'diff', label: '+/-', align: 'num', format: (v, r) => el('span', { class: r.pf - r.pa > 0 ? 'up' : r.pf - r.pa < 0 ? 'down' : '' }, String(r.pf - r.pa)) },
            ],
            rows: c.standings,
            rowClass: r => (r.teamIdx === c.myTeamIdx ? 'my-row' : undefined),
            empty: 'no games in the books',
          }),
          rounds.length ? el('div', {},
            ledger('the bracket', 'single elimination; the cheapest drama in sports'),
            ...rounds.map(r => el('div', { style: 'margin-bottom:8px' },
              el('div', { style: 'font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--ink-soft);margin:6px 0 2px' }, r.round),
              ...r.games.map(g => schedRow(g, myName)),
            ))) : null,
        ),
        el('div', {},
          ledger('played'),
          played.length
            ? el('div', {}, played.slice().reverse().map(g => schedRow(g, myName)))
            : el('div', { class: 'empty' }, 'nothing in the books yet'),
          ledger('upcoming'),
          upcoming.length
            ? el('div', {}, upcoming.map(g => schedRow(g, myName)))
            : el('div', { class: 'empty' }, c.complete ? 'the regular season is done' : 'the schedule is played out'),
        ),
      ),
      historyBlock,
    );
  },
});
