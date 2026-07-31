/**
 * screens/career/stock.js - Draft Stock: the mock-draft ladder written
 * from thirty private boards (docs/CAREER.md, Recruiting and draft
 * stock). The rank is their fog, not your truth; every move on the
 * ladder states its reason verbatim.
 */
import { registerScreen, store } from '../../app.js';
import { api } from '../../api.js';
import { el, ledger, toast } from '../../ui.js';
import { plainTable } from './widgets.js';

registerScreen('career-stock', {
  title: 'Draft Stock',
  nav: true,
  mode: 'career',
  async render(root) {
    let view = null;
    try {
      view = await api.careerStock();
    } catch (err) {
      // the stock view is down (career-views.ts reads league.teams as an
      // array); render the honest empty state rather than a dead screen
      console.warn('stock view unavailable:', err.message);
    }
    const rerender = () => this.render(root);

    const hasData = view && (view.rank !== null || view.history.length > 0 || view.board.length > 0
      || view.workoutInvites.length > 0 || view.workoutsDone.length > 0);
    if (!hasData) {
      root.replaceChildren(
        el('h1', { class: 'doc' }, 'draft stock'),
        el('div', { class: 'doc-sub' }, 'the insider ladder'),
        el('div', { class: 'empty' }, 'nobody is drafting a high schooler yet.'),
      );
      return;
    }

    const workout = async (kind, teamId, btn) => {
      btn.disabled = true;
      try {
        const result = await api.careerChoice({ kind, teamId });
        if (!result.ok) { toast(result.errors.join('; '), true); btn.disabled = false; return; }
        await store.refresh();
        rerender();
      } catch (err) {
        toast(err.message, true);
        btn.disabled = false;
      }
    };

    const history = view.history.slice().reverse(); // newest first
    const rankLabel = (r) => (r === null || r === undefined ? 'off' : `#${r}`);

    root.replaceChildren(
      el('h1', { class: 'doc' }, view.rank !== null ? `projected: pick ${view.rank}` : 'off the board'),
      el('div', { class: 'doc-sub' },
        view.combineDone
          ? 'combine done: the measurements are public and everyone repriced'
          : 'combine not yet run; they are pricing tape and hearsay'),
      el('div', { class: 'cols c2' },
        el('div', {},
          ledger('the ladder', 'every move has a stated reason'),
          history.length
            ? el('div', {}, history.map(h => el('div', { class: 'stock-move' },
                el('span', { class: 'wk' }, `w${h.week} '${String(h.year % 100).padStart(2, '0')}`),
                el('span', { class: 'rk' }, rankLabel(h.rank)),
                el('span', {}, h.reason),
              )))
            : el('div', { class: 'empty' }, 'no coverage yet'),
        ),
        el('div', {},
          view.workoutInvites.length ? el('div', {},
            ledger('workout invites', 'showing well moves that one room; it cuts both ways'),
            ...view.workoutInvites.map(t => el('div', { class: 'card', style: 'margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;gap:10px' },
              el('b', { style: 'font-size:13.5px' }, t.name),
              el('div', { style: 'display:flex;gap:8px' },
                el('button', { onclick: (e) => workout('attendWorkout', t.teamId, e.target) }, 'attend'),
                el('button', { class: 'quiet', onclick: (e) => workout('declineWorkout', t.teamId, e.target) }, 'decline'),
              )))) : null,
          view.workoutsDone.length
            ? el('p', { style: 'font-size:12.5px;color:var(--ink-soft)' },
                'worked out for: ', view.workoutsDone.map(t => t.name).join(', '))
            : null,
          ledger('their boards', 'warmth, team by team'),
          plainTable({
            columns: [
              { key: 'name', label: 'team' },
              { key: 'value', label: 'warmth', align: 'num' },
            ],
            rows: view.board.slice(0, 10),
            empty: 'no board has a number on you',
          }),
        ),
      ),
    );
  },
});
