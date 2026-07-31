/**
 * screens/almanac.js - the almanac: the record book first, then one season
 * per pull. A plain region on purpose, like the paper (theme.css header
 * note); history reads best as printed matter.
 */
import { registerScreen, store } from '../app.js';
import { api } from '../api.js';
import { el, chip, ledger, table, toast } from '../ui.js';
import { seasonLabel } from '../format.js';

/** AwardResult carries kind + ids only; the printed label lives UI-side. */
const AWARD_LABELS = {
  mvp: 'Most valuable player', dpoy: 'Defensive player of the year',
  roy: 'Rookie of the year', smoy: 'Sixth man of the year',
  mip: 'Most improved player', coy: 'Coach of the year', fmvp: 'Finals MVP',
  allLeague1: 'All-League first team', allLeague2: 'All-League second team',
  allLeague3: 'All-League third team', allDefense1: 'All-Defense first team',
  allDefense2: 'All-Defense second team', allRookie: 'All-Rookie team',
  allStar: 'All-Stars', potw: 'Player of the week', potm: 'Player of the month',
  scoringTitle: 'Scoring champion',
};

function abbrev(teamId) {
  return store.teams[teamId]?.abbrev ?? teamId.toUpperCase();
}

/** 'R1 BOS 4-2 MIA' with the series winner printed first. */
function seriesLine(s) {
  const label = s.round === 4 ? 'F ' : `R${s.round}`;
  const highFirst = s.wins[0] >= s.wins[1];
  const first = highFirst ? s.high : s.low;
  const second = highFirst ? s.low : s.high;
  const wins = highFirst ? s.wins : [s.wins[1], s.wins[0]];
  return `${label} ${abbrev(first)} ${wins[0]}-${wins[1]} ${abbrev(second)}`;
}

function seasonSection(a) {
  const avg = a.leagueAverages ?? {};
  const rounds = a.playoffs.slice().sort((x, y) => x.round - y.round);
  return el('div', {},
    el('div', { style: 'display:flex;align-items:center;gap:8px;font-size:15px;margin:12px 0 2px;flex-wrap:wrap' },
      el('b', {}, `${seasonLabel(a.season)}:`),
      chip(store.teams, a.champion, { full: true }),
      el('span', { style: 'color:var(--ink-faint)' }, 'over'),
      chip(store.teams, a.runnerUp, { full: true }),
    ),
    avg.pts !== undefined
      ? el('p', { class: 'money', style: 'color:var(--ink-soft);font-size:12.5px;margin:2px 0 0' },
          `league averages: ${avg.pts} pts, ${avg.fga} fga, ${avg.tpa} 3pa, pace ${avg.pace}`)
      : null,
    ledger('awards'),
    table({
      columns: [
        { key: 'kind', label: 'award', format: v => AWARD_LABELS[v] ?? v },
        // winners and ballots carry raw player ids in v1; resolving names
        // for retired-and-archived men is a debt this screen owns later
        { key: 'winners', label: 'winner', format: v => el('span', { class: 'mono', style: 'font-size:12px' }, v.join(', ')) },
      ],
      rows: a.awards,
      empty: 'no ballots in the file',
    }),
    ledger('final standings'),
    table({
      columns: [
        { key: 'rank', label: '#', align: 'num', sortValue: r => -r.rank },
        { key: 'teamId', label: 'team', format: v => chip(store.teams, v, { full: true }) },
        { key: 'record', label: 'record', align: 'num', format: (v, r) => `${r.w}-${r.l}`, sortValue: r => r.w },
      ],
      rows: a.finalStandings.map((s, i) => ({ rank: i + 1, ...s })),
      empty: 'no standings in the file',
    }),
    ledger('playoffs'),
    rounds.length
      ? el('div', { class: 'mono', style: 'font-size:12.5px;line-height:1.9' },
          rounds.map(s => el('div', {}, seriesLine(s))))
      : el('div', { class: 'empty' }, 'no bracket in the file'),
    ledger('draft class'),
    table({
      columns: [
        { key: 'pick', label: 'pick', align: 'num', sortValue: r => -(r.round * 100 + r.pick) },
        { key: 'round', label: 'rd', align: 'num' },
        { key: 'teamId', label: 'team', format: v => chip(store.teams, v) },
        { key: 'playerId', label: 'player', format: v => el('a', { href: `#/player/${v}`, class: 'mono', style: 'color:inherit;font-size:12px' }, v) },
      ],
      rows: a.draftClass,
      empty: 'no class in the file',
    }),
  );
}

registerScreen('almanac', {
  title: 'Almanac',
  nav: 'Almanac',
  async render(root) {
    const [rec, index] = await Promise.all([api.records(), api.almanacIndex()]);
    const seasons = (index.seasons ?? []).slice().sort((a, b) => b - a); // newest first
    const seasonBox = el('div');

    const loadSeason = async (season) => {
      seasonBox.replaceChildren(el('div', { class: 'empty' }, 'loading...'));
      try {
        seasonBox.replaceChildren(seasonSection(await api.almanac(season)));
      } catch (err) {
        toast(err.message, true);
        seasonBox.replaceChildren(el('div', { class: 'empty' }, err.message));
      }
    };

    const select = el('select', {}, seasons.map(s => el('option', { value: s }, seasonLabel(s))));
    select.addEventListener('change', () => loadSeason(Number(select.value)));

    root.replaceChildren(
      el('h1', { class: 'doc' }, 'the almanac'),
      el('div', { class: 'doc-sub' }, 'the record book, then one season at a time'),
      ledger('the record book'),
      table({
        columns: [
          { key: 'label', label: 'record' },
          { key: 'holderName', label: 'holder' },
          { key: 'value', label: 'mark', align: 'num' },
          { key: 'season', label: 'season', align: 'num', format: v => seasonLabel(v), sortValue: r => r.season },
        ],
        rows: rec.records,
        empty: 'no marks of note yet',
      }),
      ledger('seasons'),
      seasons.length
        ? el('div', {}, select, seasonBox)
        : el('div', { class: 'empty' }, 'no seasons in the books yet'),
    );
    if (seasons.length) await loadSeason(seasons[0]);
  },
});
