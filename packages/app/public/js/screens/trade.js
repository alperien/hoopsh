/**
 * screens/trade.js - the trade desk. Two ledgers side by side, check what
 * moves, and the other front office answers in its own words. Two-team
 * deals only (register F3); the verdict strip stays on screen because the
 * cap math is the negotiation.
 */
import { registerScreen, store } from '../app.js';
import { api } from '../api.js';
import { el, grade, ledger, toast } from '../ui.js';
import { money } from '../format.js';

let partnerId = ''; // survives re-renders so an executed deal lands back on the same desk

function abbrev(teamId) {
  return store.teams[teamId]?.abbrev ?? teamId.toUpperCase();
}

/** '2028 R1 via CHI' for acquired picks, '2028 R1' for a team's own. */
function pickLabel(pick) {
  const via = pick.originalTeam !== pick.owner ? ` via ${abbrev(pick.originalTeam)}` : '';
  return `${pick.season} R${pick.round}${via}`;
}

function checkbox(onToggle, checked = false) {
  // theme.css gives every input min-width:200px; a checkbox wants none of that
  const box = el('input', { type: 'checkbox', style: 'min-width:0;width:13px;height:13px;margin:0' });
  box.checked = checked; // lines rebuild from selection state ("put this offer on the desk")
  box.addEventListener('change', () => onToggle(box.checked));
  return box;
}

function playerLine(row, set, onChange) {
  return el('label', { style: 'display:flex;align-items:center;gap:8px;padding:3px 0;font-size:13px;cursor:pointer;border-bottom:1px solid var(--rule)' },
    checkbox(checked => { if (checked) set.add(row.id); else set.delete(row.id); onChange(); }, set.has(row.id)),
    el('span', { style: 'flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis' },
      row.name, ' ', el('span', { class: 'pos-chip' }, row.pos)),
    grade(row.ovr),
    el('span', { class: 'money', style: 'width:62px;text-align:right' }, money(row.salary)),
    el('span', { class: 'money', style: 'width:26px;text-align:right;color:var(--ink-soft);font-size:12px' }, `${row.years}y`),
  );
}

function pickLine(pick, set, onChange) {
  return el('label', { style: 'display:flex;align-items:center;gap:8px;padding:3px 0;font-size:12.5px;cursor:pointer;border-bottom:1px solid var(--rule)' },
    checkbox(checked => { if (checked) set.add(pick.id); else set.delete(pick.id); onChange(); }, set.has(pick.id)),
    el('span', { class: 'mono' }, pickLabel(pick)),
  );
}

function buildDesk(mine, theirs, rerender, negotiation) {
  const sel = {
    give: { players: new Set(), picks: new Set() },
    get: { players: new Set(), picks: new Set() },
  };
  const names = {};
  const pickIndex = {};
  for (const r of [...mine.roster, ...theirs.roster]) names[r.id] = r.name;
  for (const p of [...(mine.team.picks ?? []), ...(theirs.team.picks ?? [])]) pickIndex[p.id] = p;

  const describe = (side) => {
    const bits = [
      ...side.players.map(id => names[id] ?? id),
      ...side.picks.map(id => (pickIndex[id] ? pickLabel(pickIndex[id]) : id)),
    ];
    return bits.length ? bits.join(', ') : 'nothing';
  };

  const salarySum = (view, ids) => {
    let s = 0;
    for (const r of view.roster) if (ids.has(r.id)) s += r.salary;
    return s;
  };

  const capLine = (view, out, incoming) => {
    const cap = view.cap;
    return `${view.team.abbrev} payroll ${money(cap.total)} against a ${money(cap.tax)} tax line` +
      (cap.overTax ? ` (bill ${money(cap.taxBill)})` : '') +
      ` · out ${money(out)}, in ${money(incoming)}, after ${money(cap.total - out + incoming)}`;
  };

  const myLine = el('div', { class: 'money', style: 'font-size:12.5px' });
  const theirLine = el('div', { class: 'money', style: 'font-size:12.5px;color:var(--ink-soft)' });
  const verdictBox = el('div');
  const errBox = el('div');

  const updateStrip = () => {
    const out = salarySum(mine, sel.give.players);
    const incoming = salarySum(theirs, sel.get.players);
    myLine.textContent = capLine(mine, out, incoming);
    theirLine.textContent = capLine(theirs, incoming, out);
  };

  const currentOffer = () => ({
    from: mine.team.id,
    to: theirs.team.id,
    give: { players: [...sel.give.players], picks: [...sel.give.picks] },
    get: { players: [...sel.get.players], picks: [...sel.get.picks] },
  });

  const act = async (action, okMessage) => {
    errBox.replaceChildren();
    try {
      const result = await api.action(action);
      if (!result.ok) {
        // the cap engine's wording is the product; print it verbatim
        errBox.replaceChildren(el('div', { style: 'color:var(--bad);font-size:12.5px;margin-top:4px' }, result.errors.join('; ')));
        return;
      }
      toast(okMessage);
      await store.refresh();
      rerender();
    } catch (err) {
      toast(err.message, true);
    }
  };

  const renderVerdict = (verdict, offer) => {
    if (verdict.accept) {
      verdictBox.replaceChildren(
        el('div', { style: 'color:var(--good);font-weight:600;font-size:13px' }, verdict.reasoning),
        el('div', { style: 'margin-top:6px' },
          el('button', { onclick: () => act({ kind: 'proposeTrade', offer }, 'the deal is done') }, 'execute the deal')),
      );
    } else if (verdict.counter) {
      const c = verdict.counter;
      verdictBox.replaceChildren(
        el('div', { style: 'color:var(--ink-soft);font-size:12.5px' }, verdict.reasoning),
        el('div', { style: 'font-size:12.5px;margin-top:4px' }, el('b', {}, 'their counter, you send: '), describe(c.give)),
        el('div', { style: 'font-size:12.5px' }, el('b', {}, 'you receive: '), describe(c.get)),
        el('div', { style: 'margin-top:6px' },
          el('button', { onclick: () => act({ kind: 'acceptCounter', offer: c }, 'the deal is done') }, 'accept their counter')),
      );
    } else {
      verdictBox.replaceChildren(
        el('div', { style: 'color:var(--ink-soft);font-size:12.5px;font-style:italic' }, verdict.reasoning));
    }
  };

  const evalBtn = el('button', {
    onclick: async () => {
      const offer = currentOffer();
      errBox.replaceChildren();
      if (offer.give.players.length + offer.give.picks.length + offer.get.players.length + offer.get.picks.length === 0) {
        verdictBox.replaceChildren(el('div', { style: 'color:var(--ink-faint);font-size:12.5px' }, 'nothing is on the table yet'));
        return;
      }
      evalBtn.disabled = true;
      try {
        renderVerdict(await api.evaluateTrade(offer), offer);
      } catch (err) {
        toast(err.message, true);
      } finally {
        evalBtn.disabled = false;
      }
    },
  }, 'evaluate');

  const column = (view, side) => {
    const players = view.roster.slice().sort((a, b) => b.ovr - a.ovr);
    const picks = (view.team.picks ?? []).slice().sort((a, b) => a.season - b.season || a.round - b.round);
    return el('div', {},
      ledger(`${view.team.city} ${view.team.name}`, side === 'give' ? 'you send' : 'you receive'),
      el('div', {}, players.map(r => playerLine(r, sel[side].players, updateStrip))),
      el('div', { style: 'margin-top:10px;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--ink-soft)' }, 'picks'),
      picks.length
        ? el('div', {}, picks.map(p => pickLine(p, sel[side].picks, updateStrip)))
        : el('div', { class: 'empty', style: 'padding:6px 0' }, 'no picks to move'),
    );
  };

  // lines bind the Set instances they were built with, so replacing the
  // selection ("put this offer on the desk") rebuilds both columns
  const columnsBox = el('div', { class: 'cols c2', style: 'grid-template-columns:1fr 1fr' });
  const redraw = () => {
    columnsBox.replaceChildren(column(mine, 'give'), column(theirs, 'get'));
    updateStrip();
  };

  // the live offer on file (#158): league.negotiations served read-only.
  // The offer faces either direction; the desk always edits the user's side.
  const talksCard = () => {
    const offer = negotiation.lastOffer;
    const youSend = offer.from === mine.team.id ? offer.give : offer.get;
    const youGet = offer.from === mine.team.id ? offer.get : offer.give;
    return el('div', { class: 'card', style: 'margin-bottom:14px;border-color:var(--rule-strong)' },
      el('div', { style: 'font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--ink-soft)' },
        `live talks · ${negotiation.temperature} · round ${negotiation.rounds}`),
      el('div', { style: 'font-size:12.5px;margin-top:4px' }, el('b', {}, 'on file, you send: '), describe(youSend)),
      el('div', { style: 'font-size:12.5px' }, el('b', {}, 'you receive: '), describe(youGet)),
      el('div', { style: 'margin-top:6px' },
        el('button', {
          class: 'quiet',
          onclick: () => {
            sel.give.players = new Set(youSend.players);
            sel.give.picks = new Set(youSend.picks);
            sel.get.players = new Set(youGet.players);
            sel.get.picks = new Set(youGet.picks);
            redraw();
          },
        }, 'put this offer on the desk')),
    );
  };

  redraw();

  return el('div', {},
    negotiation && negotiation.lastOffer ? talksCard() : null,
    columnsBox,
    // sticky above the keys bar (28px clears #keys) so the math never scrolls away
    el('div', { class: 'card', style: 'position:sticky;bottom:28px;z-index:15;margin-top:16px;border-color:var(--rule-strong);display:flex;flex-direction:column;gap:4px' },
      myLine,
      theirLine,
      el('div', { style: 'display:flex;gap:10px;align-items:center;margin-top:4px' },
        evalBtn,
        el('span', { style: 'color:var(--ink-faint);font-size:11.5px' }, 'matching, aprons, and Stepien run on their side of the call'),
      ),
      verdictBox,
      errBox,
    ),
  );
}

registerScreen('trade', {
  title: 'Trade',
  nav: 'Trade', navKey: 't',
  async render(root, params) {
    const user = store.summary.userTeam;
    // a deep link (#/trade/bka) preselects the partner: the office's
    // Counter answer routes here with the offering front office dialed
    if (params && params[0] && params[0] !== user && store.teams[params[0]]) partnerId = params[0];
    const partners = Object.values(store.teams)
      .filter(t => t.teamId !== user)
      .sort((a, b) => `${a.city} ${a.name}`.localeCompare(`${b.city} ${b.name}`));
    const desk = el('div');
    const rerender = () => this.render(root);

    const select = el('select', {},
      el('option', { value: '' }, 'pick a front office'),
      partners.map(t => el('option', { value: t.teamId, selected: t.teamId === partnerId ? true : undefined }, `${t.city} ${t.name}`)));

    const loadDesk = async () => {
      if (!partnerId) {
        desk.replaceChildren(el('div', { class: 'empty' }, 'every deal starts with a phone call. pick who answers.'));
        return;
      }
      desk.replaceChildren(el('div', { class: 'empty' }, 'loading...'));
      try {
        const [mine, theirs, negs] = await Promise.all([api.team(user), api.team(partnerId), api.negotiations()]);
        const negotiation = negs.negotiations.find(n => n.teams.includes(partnerId));
        desk.replaceChildren(buildDesk(mine, theirs, rerender, negotiation));
      } catch (err) {
        toast(err.message, true);
        desk.replaceChildren(el('div', { class: 'empty' }, err.message));
      }
    };
    select.addEventListener('change', () => { partnerId = select.value; loadDesk(); });

    root.replaceChildren(
      el('h1', { class: 'doc' }, 'the trade desk'),
      el('div', { class: 'doc-sub' }, 'two-team deals only. the answer comes back with the reasoning attached.'),
      el('div', {}, el('label', { class: 'field' }, 'trade partner'), select),
      desk,
    );
    await loadDesk();
  },
});
