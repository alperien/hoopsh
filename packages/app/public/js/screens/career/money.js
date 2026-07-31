/**
 * screens/career/money.js - the ledger. Quiet on purpose: NIL checks,
 * contracts, the China years; a line per entry, a running total, no
 * charts. The money is a record, not a scoreboard.
 */
import { registerScreen } from '../../app.js';
import { api } from '../../api.js';
import { el, ledger } from '../../ui.js';
import { money } from '../../format.js';
import { plainTable } from './widgets.js';

registerScreen('career-money', {
  title: 'Money',
  nav: true,
  mode: 'career',
  async render(root) {
    const { entries, earnings } = await api.careerLedger();

    // entries arrive newest first; the running total accrues from the
    // oldest line up, so each row shows the career total to that point
    let running = 0;
    const rows = entries.slice().reverse().map(e => {
      running += e.amount;
      return { ...e, toDate: running };
    }).reverse();

    root.replaceChildren(
      el('h1', { class: 'doc' }, 'money'),
      el('div', { class: 'doc-sub' }, `career earnings: ${earnings > 0 ? money(earnings) : 'nothing yet'}`),
      ledger('the ledger'),
      plainTable({
        columns: [
          { key: 'year', label: 'year', align: 'num' },
          { key: 'label', label: 'what' },
          { key: 'amount', label: 'amount', align: 'num', format: v => el('span', { class: 'money' }, money(v)) },
          { key: 'toDate', label: 'to date', align: 'num', format: v => el('span', { class: 'money', style: 'color:var(--ink-soft)' }, money(v)) },
        ],
        rows,
        empty: 'nothing earned yet. NIL comes with the letters; contracts come later.',
      }),
    );
  },
});
