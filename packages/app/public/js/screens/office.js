/**
 * screens/office.js - the desk: inbox first, then today, then the paper.
 * The inbox is the game's spine (docs/FRANCHISE.md §8); everything that
 * needs a decision surfaces here and nowhere else.
 */
import { registerScreen, store, on, navigate } from '../app.js';
import { api } from '../api.js';
import { el, chip, ledger, toast } from '../ui.js';
import { seasonLabel } from '../format.js';

function newsCard(n) {
  return el('div', { class: `news-item w${n.weight}` },
    el('div', { class: 'byline' }, n.byline),
    el('h3', {}, n.headline),
    el('p', {}, n.body),
  );
}

async function respond(item, choiceId, rerender) {
  try {
    const result = await api.action({ kind: 'respondToRequest', requestId: item.id, choice: choiceId });
    if (!result.ok) { toast(result.errors.join('; '), true); return; }
    await store.refresh();
    rerender();
  } catch (err) {
    toast(err.message, true);
  }
}

function inboxCard(item, rerender) {
  return el('div', { class: `inbox-item ${item.kind}` },
    el('h4', {}, item.title),
    el('p', {}, item.body),
    item.kind === 'decision' && item.choices
      ? el('div', { class: 'choices' }, item.choices.map(c =>
          el('button', { class: 'quiet', onclick: () => respond(item, c.id, rerender) }, c.label)))
      : null,
  );
}

registerScreen('office', {
  title: 'Office',
  nav: 'Office', navKey: 'o',
  async render(root) {
    const [inboxData, newsData] = await Promise.all([api.inbox(), api.news(0)]);
    const s = store.summary;
    const open = inboxData.items.filter(i => !i.resolved);
    const rerender = () => this.render(root);

    const digest = s.digest;
    const digestLine = digest
      ? `${digest.games.length} game${digest.games.length === 1 ? '' : 's'} around the league, ` +
        `${digest.transactionCount} transaction${digest.transactionCount === 1 ? '' : 's'}, ` +
        `${digest.newsIds.length} stories filed`
      : 'no day simulated yet';

    root.replaceChildren(
      el('h1', { class: 'doc' }, 'the office'),
      el('div', { class: 'doc-sub' }, `${s.dateLabel}, ${seasonLabel(s.date.season)} · ${digestLine}`),
      el('div', { class: 'cols c2' },
        el('div', {},
          ledger(`inbox${open.length ? ` (${open.length})` : ''}`),
          open.length
            ? el('div', {}, open.slice(0, 12).map(i => inboxCard(i, rerender)))
            : el('div', { class: 'empty' }, 'nothing needs you. advance the day.'),
          ledger('the paper'),
          newsData.items.length
            ? el('div', {}, newsData.items.slice(0, 14).map(newsCard))
            : el('div', { class: 'empty' }, 'the beat writers are waiting on games'),
        ),
        el('div', {},
          s.todayGame ? el('div', {},
            ledger('tonight'),
            el('div', { class: 'card' },
              el('div', { style: 'display:flex;align-items:center;gap:10px;font-size:15px' },
                chip(store.teams, s.todayGame.home ? s.userTeam : s.todayGame.opponent, { full: true }),
                el('span', { class: 'pos-chip' }, s.todayGame.home ? 'hosts' : 'visits'),
                chip(store.teams, s.todayGame.home ? s.todayGame.opponent : s.userTeam, { full: true }),
              ),
              el('p', { style: 'color:var(--ink-soft);font-size:12.5px;margin:8px 0 10px' },
                'advance the day to play it, then watch the broadcast from the game page.'),
              el('button', { onclick: () => navigate('/roster') }, 'set the rotation'),
            ),
          ) : null,
          ledger('front page'),
          s.headlines.length
            ? el('div', {}, s.headlines.map(n =>
                el('div', { class: 'news-item' },
                  el('div', { class: 'byline' }, n.byline),
                  el('h3', { style: 'font-size:14px' },
                    n.gameId
                      ? el('a', { href: `#/game/${n.gameId}`, style: 'color:inherit' }, n.headline)
                      : n.headline),
                )))
            : el('div', { class: 'empty' }, 'quiet league'),
        ),
      ),
    );

    // live digest stream while a multi-day sim runs
    on('sim-progress', (status) => {
      if (!status.running && status.daysDone === 0) return;
      const sub = root.querySelector('.doc-sub');
      if (sub && status.running) sub.textContent = `simming: day ${status.daysDone} of ${status.daysTotal}...`;
    });
  },
});
