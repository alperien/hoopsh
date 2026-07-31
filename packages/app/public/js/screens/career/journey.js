/**
 * screens/career/journey.js - the whole record: the explained-consequence
 * feed (every event, reason verbatim, paged back to week one), the shelf
 * of seasons, and the epilogue once the ball stops. This is where the
 * career reads as one story.
 */
import { registerScreen, store } from '../../app.js';
import { api } from '../../api.js';
import { el, ledger } from '../../ui.js';
import { money } from '../../format.js';
import { stamp, kindChip, signed, historyCard } from './widgets.js';

function eventRow(ev) {
  return el('div', { class: 'evt' },
    kindChip(ev.kind),
    el('span', { class: 'stamp' }, stamp(ev.clock)),
    ev.reason,
    ev.delta !== undefined ? el('span', { class: 'delta' }, signed(ev.delta)) : null,
  );
}

function epilogueCard(ep) {
  const teamName = (id) => {
    const t = store.teams?.[id];
    return t ? `${t.city} ${t.name}` : id;
  };
  return el('div', { class: 'epilogue-card' },
    el('div', { class: 'ep-head' }, `retired, ${ep.retiredYear}`),
    el('div', { class: 'ep-line' },
      `${ep.seasonsPlayed} season${ep.seasonsPlayed === 1 ? '' : 's'} · ${money(ep.careerEarnings)} earned · ` +
      `${ep.rings} ring${ep.rings === 1 ? '' : 's'} · legacy ${Math.round(ep.legacyScore)}`),
    ep.hofYear !== undefined && ep.hofYear !== null
      ? el('div', { class: 'ep-line', style: ep.hofInducted ? 'color:var(--warn);font-weight:700' : '' },
          ep.hofInducted ? `Hall of Fame, class of ${ep.hofYear}` : `on the Hall of Fame ballot in ${ep.hofYear}`)
      : null,
    ep.jerseyRetiredBy
      ? el('div', { class: 'ep-line', style: 'font-weight:700' }, `a number in the rafters: ${teamName(ep.jerseyRetiredBy)}`)
      : null,
    ep.honors.length
      ? el('ul', { class: 'ep-honors' }, ep.honors.map(h => el('li', {}, h)))
      : el('div', { class: 'ep-line' }, 'no hardware. the games still happened.'),
  );
}

registerScreen('career-journey', {
  title: 'Journey',
  nav: true,
  mode: 'career',
  async render(root) {
    const [firstPage, circuitData, epilogue, draftnight] = await Promise.all([
      api.careerEvents(0),
      api.careerCircuit(),
      api.careerEpilogue().catch(() => null), // 404 while the story is still going
      api.careerDraftnight().catch(() => null), // 404 before any draft exists
    ]);

    // the green room replays only once the night was MINE: my name was
    // called, or my draft came and went (post-entry phases; a draftPrep
    // career past the beat). Pre-draft the endpoint serves scenery drafts.
    const phase = store.career?.clock?.phase;
    const myNight = draftnight && (
      draftnight.myPick !== null
      || phase === 'nba' || phase === 'china' || phase === 'retired'
      || (phase === 'draftPrep' && !store.career?.nextBeat)
    );

    let page = 0;
    const feed = el('div', {}, firstPage.items.map(eventRow));
    const moreBtn = el('button', {
      class: 'quiet',
      style: firstPage.hasMore ? 'margin-top:10px' : 'display:none',
      onclick: async () => {
        moreBtn.disabled = true;
        try {
          page += 1;
          const next = await api.careerEvents(page);
          feed.append(...next.items.map(eventRow));
          if (!next.hasMore) moreBtn.style.display = 'none';
        } finally {
          moreBtn.disabled = false;
        }
      },
    }, 'earlier');

    root.replaceChildren(
      el('h1', { class: 'doc' }, 'the journey'),
      el('div', { class: 'doc-sub' },
        'everything that happened, and why',
        myNight ? el('span', {}, ' · ', el('a', { href: '#/career-draftnight' }, 'relive draft night')) : null),
      epilogue ? el('div', { style: 'margin-bottom:18px' }, epilogueCard(epilogue)) : null,
      circuitData.history.length ? el('div', {},
        ledger('the seasons'),
        el('div', { class: 'hist-strip' }, circuitData.history.map(historyCard)),
      ) : null,
      ledger('the record', 'newest first; reasons verbatim'),
      firstPage.items.length ? feed : el('div', { class: 'empty' }, 'week one has not happened yet.'),
      moreBtn,
    );
  },
});
