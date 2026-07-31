/**
 * screens/news.js - the paper. A plain region on purpose (theme.css header
 * note): bylines, weighted headlines, body text, a team filter, and more
 * of the same below the fold. No cards, no chrome; the copy is the layout.
 */
import { registerScreen, store } from '../app.js';
import { api } from '../api.js';
import { el, toast } from '../ui.js';

let teamFilter = ''; // '' = the whole league; survives re-renders

function newsItem(n) {
  return el('div', { class: `news-item w${n.weight}` },
    el('div', { class: 'byline' }, n.byline),
    el('h3', {},
      n.gameId
        ? el('a', { href: `#/game/${n.gameId}`, style: 'color:inherit' }, n.headline)
        : n.headline),
    n.body ? el('p', {}, n.body) : null,
  );
}

registerScreen('news', {
  title: 'News',
  nav: 'News', navKey: 'n',
  async render(root) {
    const feed = el('div');
    const more = el('button', { class: 'quiet', style: 'margin-top:14px' }, 'more');
    let page = 0;

    const load = async (append) => {
      more.disabled = true;
      try {
        const data = await api.news(page, teamFilter);
        if (!append) feed.replaceChildren();
        if (data.items.length === 0 && !append) {
          feed.replaceChildren(el('div', { class: 'empty' }, 'the beat writers have filed nothing yet'));
        } else {
          feed.append(...data.items.map(newsItem));
        }
        more.style.display = data.hasMore ? '' : 'none';
      } catch (err) {
        toast(err.message, true);
      } finally {
        more.disabled = false;
      }
    };
    more.addEventListener('click', () => { page += 1; load(true); });

    const teams = Object.values(store.teams)
      .sort((a, b) => `${a.city} ${a.name}`.localeCompare(`${b.city} ${b.name}`));
    const select = el('select', {},
      el('option', { value: '' }, 'the whole league'),
      teams.map(t => el('option', { value: t.teamId, selected: t.teamId === teamFilter ? true : undefined }, `${t.city} ${t.name}`)));
    select.addEventListener('change', () => {
      teamFilter = select.value;
      page = 0;
      load(false);
    });

    root.replaceChildren(
      el('h1', { class: 'doc' }, 'the paper'),
      el('div', { class: 'doc-sub' }, 'everything the desk filed, newest first'),
      el('div', { style: 'margin-bottom:8px' }, select),
      feed,
      more,
    );
    await load(false);
  },
});
