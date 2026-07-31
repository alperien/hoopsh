/**
 * screens/fa.js - the free agency hub: the market table over a cap strip,
 * with the signing desk opening under the table one player at a time. The
 * means select is the CBA made visible; the validators do the arguing.
 */
import { registerScreen, store } from '../app.js';
import { api } from '../api.js';
import { el, grade, ledger, table, toast } from '../ui.js';
import { money } from '../format.js';

/** SigningMeans a user can reach from this screen (cba/contracts.ts). */
const MEANS = [
  ['capSpace', 'cap space'], ['bird', 'bird'], ['earlyBird', 'early bird'],
  ['nonBird', 'non-bird'], ['mle', 'mid-level'], ['taxMle', 'taxpayer mid-level'],
  ['room', 'room exception'], ['bae', 'bi-annual'], ['minimum', 'minimum'],
];

let openId = null; // one signing panel at a time

function capStrip(cap) {
  const roomUnder = (label, line) => {
    const room = line - cap.total;
    return room >= 0 ? `${money(room)} under the ${label}` : `${money(-room)} over the ${label}`;
  };
  // the floor is 90% of the cap (params.cba.minPayrollPctOfCap); the sheet does not carry it
  const shortfall = Math.round(cap.cap * 0.9) - cap.total;
  const bits = [
    `space ${money(cap.spaceWithHolds)} (holds counted)`,
    shortfall > 0 ? `${money(shortfall)} short of the salary floor` : null,
    roomUnder('tax', cap.tax),
    roomUnder('first apron', cap.apron1),
    roomUnder('second apron', cap.apron2),
  ];
  return el('p', { class: 'money', style: 'color:var(--ink-soft);font-size:12.5px;margin:0 0 12px' },
    bits.filter(Boolean).join(' · '));
}

function signingPanel(row, rerender) {
  const meansSelect = el('select', { style: 'min-width:150px' },
    MEANS.map(([value, label]) => el('option', { value }, label)));
  const yearsSelect = el('select', { style: 'min-width:70px' },
    [1, 2, 3, 4].map(n => el('option', { value: n, selected: n === Math.min(row.askYears, 4) ? true : undefined }, n)));
  const salaryInput = el('input', {
    type: 'number', min: '0', step: '100000', value: row.askSalary,
    style: 'min-width:140px;width:150px',
  });
  const errBox = el('div');

  const send = async (btn, action) => {
    btn.disabled = true;
    errBox.replaceChildren();
    try {
      const result = await api.action(action);
      if (result.ok) {
        toast('done');
        openId = null;
        rerender();
        return;
      }
      // the validators speak cap-engine; print them verbatim
      errBox.replaceChildren(el('div', { style: 'color:var(--bad);font-size:12.5px;margin-top:8px' }, result.errors.join('; ')));
    } catch (err) {
      errBox.replaceChildren(el('div', { style: 'color:var(--bad);font-size:12.5px;margin-top:8px' }, err.message));
    } finally {
      btn.disabled = false;
    }
  };

  const terms = () => ({
    playerId: row.id,
    years: Number(yearsSelect.value),
    startSalary: Math.max(0, Math.round(Number(salaryInput.value) || 0)),
  });

  const offerBtn = el('button', {
    onclick: () => send(offerBtn, { kind: 'signFreeAgent', ...terms(), means: meansSelect.value }),
  }, 'offer the contract');
  const sheetBtn = row.rights && row.rights.includes('RFA')
    ? el('button', {
        class: 'quiet',
        onclick: () => send(sheetBtn, { kind: 'offerSheet', ...terms() }),
      }, 'offer sheet')
    : null;

  const field = (label, control) => el('div', {},
    el('label', { class: 'field', style: 'margin-top:0' }, label), control);

  return el('div', { class: 'card', style: 'margin-top:10px;max-width:680px' },
    el('div', { style: 'display:flex;align-items:baseline;gap:10px;flex-wrap:wrap' },
      el('b', {}, row.name),
      el('span', { class: 'pos-chip' }, row.pos),
      grade(row.ovr),
      el('span', { style: 'color:var(--ink-faint);font-size:12px' },
        `asking ${row.askYears} x ${money(row.askSalary)}${row.rights ? ` · ${row.rights}` : ''}`),
    ),
    el('div', { style: 'display:flex;gap:16px;align-items:flex-end;flex-wrap:wrap;margin-top:8px' },
      field('means', meansSelect),
      field('years', yearsSelect),
      field('first-year salary', salaryInput),
    ),
    el('div', { style: 'display:flex;gap:8px;margin-top:12px' }, offerBtn, sheetBtn),
    errBox,
  );
}

registerScreen('fa', {
  title: 'Free agency',
  nav: 'Free agency', navKey: 'f',
  async render(root) {
    const data = await api.faMarket();
    const rerender = () => this.render(root);
    const panel = el('div');

    const openPanel = (row) => {
      if (openId === row.id) {
        openId = null;
        panel.replaceChildren();
        return;
      }
      openId = row.id;
      panel.replaceChildren(signingPanel(row, rerender));
    };

    root.replaceChildren(
      el('h1', { class: 'doc' }, 'free agency'),
      el('div', { class: 'doc-sub' }, 'the open market, priced by the agents'),
      capStrip(data.capContext),
      ledger('the market', `${data.players.length} unsigned`),
      table({
        columns: [
          { key: 'name', label: 'player' },
          { key: 'pos', label: 'pos', format: v => el('span', { class: 'pos-chip' }, v) },
          { key: 'age', label: 'age', align: 'num' },
          { key: 'ovr', label: 'grade', align: 'num', format: v => grade(v) },
          { key: 'ask', label: 'ask', align: 'num', format: (v, r) => el('span', { class: 'money' }, `${r.askYears} x ${money(r.askSalary)}`), sortValue: r => r.askSalary },
          { key: 'interest', label: 'interest' },
          { key: 'rights', label: 'rights' },
        ],
        rows: data.players,
        sort: { key: 'ovr', dir: 1 },
        onRow: openPanel,
        caption: 'the ask is the opening number, not the closing one. click a name to talk terms.',
        empty: 'nobody worth a call is unsigned',
      }),
      panel,
    );

    // re-open the desk after a failed round trip re-rendered the market
    if (openId) {
      const row = data.players.find(r => r.id === openId);
      if (row) panel.replaceChildren(signingPanel(row, rerender));
      else openId = null;
    }
  },
});
