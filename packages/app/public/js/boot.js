/**
 * boot.js - imports every screen module (each registers itself against
 * the shell contract in app.js) and starts the app. A new franchise
 * screen ships by adding its import here; the career screens ship as
 * one bundle (screens/career/index.js) that app.js boot() loads
 * dynamically, so a missing career build never stops the GM chair.
 * boot.js also owns the first-run fork: nothing loaded, two doors.
 */
import { boot, registerScreen, navigate } from './app.js';
import { api } from './api.js';
import { el } from './ui.js';

import './screens/office.js';
import './screens/roster.js';
import './screens/league.js';
import './screens/schedule.js';
import './screens/team.js';
import './screens/player.js';
import './screens/game.js';
import './screens/trade.js';
import './screens/fa.js';
import './screens/draft.js';
import './screens/news.js';
import './screens/almanac.js';
import './screens/settings.js';

registerScreen('start', {
  title: 'Start',
  async render(root) {
    const meta = await api.meta().catch(() => ({ saves: [] }));
    root.replaceChildren(
      el('h1', { class: 'doc' }, 'hoopsh'),
      el('div', { class: 'doc-sub' }, 'two ways into the league. pick a door.'),
      el('div', { class: 'fork' },
        el('div', { class: 'card choice', onclick: () => navigate('/settings/new') },
          el('h2', {}, 'Run a franchise'),
          el('p', {}, 'the GM chair: thirty rosters, a cap sheet, a draft, and a schedule that does not care how you feel.')),
        el('div', { class: 'card choice', onclick: () => navigate('/career-new') },
          el('h2', {}, 'Live a career'),
          el('p', {}, 'one player: a body, a phone, and a week at a time, from a high school gym as far as the game lets you.')),
      ),
      meta.saves.length
        ? el('p', { style: 'margin-top:18px;font-size:13px' },
            el('a', { href: '#/settings', style: 'color:var(--ink-soft)' },
              `or load a save (${meta.saves.length} on this machine)`))
        : null,
    );
  },
});

boot();
