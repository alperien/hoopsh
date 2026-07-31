/**
 * screens/career/office.js - The Office, the second act's missing desk:
 * open contract decisions (the windows the sim stops for), the market
 * (NBA money and the descent doors, ids per nbabridge.ts conventions:
 * 'nba:' and 'abroad:' prefixes are authoritative, kind is a
 * placeholder), and the crossroads (declare, sign the agent, ask out,
 * retire). Every no from the server renders inline: the world saying
 * no is content.
 */
import { registerScreen, store } from '../../app.js';
import { api } from '../../api.js';
import { el, ledger, toast } from '../../ui.js';
import { money } from '../../format.js';
import { stamp, errorBox } from './widgets.js';

const WEEKS_PER_YEAR = 52; // params.tick.weeksPerYear
const DECISION_RE = /\(decision ((?:option|extension|qo):\d+)\)/;

/** Session memory: answered or learned-closed decision ids. */
const settled = new Map(); // decisionId -> note ('answered: exercise' | server error)

const AGENTS = [
  ['dominic-vitale', 'Dominic Vitale', 'old school, knows every GM by their first divorce'],
  ['renata-okafor', 'Renata Okafor', 'runs a small list and answers on the first ring'],
  ['saul-lindqvist', 'Saul Lindqvist', 'the analytics agency; your comps arrive as a deck'],
];

/**
 * Pull recent career events, newest first as the API serves: page back
 * until the tail is older than the two-season display window (a dense
 * NBA year runs several pages), capped at 8 pages as the hard stop.
 */
async function recentEvents(clock) {
  const nowAbs = clock.year * WEEKS_PER_YEAR + clock.week;
  const events = [];
  for (let page = 0; page < 8; page++) {
    let res;
    try { res = await api.careerEvents(page); } catch { break; }
    events.push(...res.items);
    const oldest = res.items[res.items.length - 1];
    if (!res.hasMore) break;
    if (oldest && nowAbs - (oldest.clock.year * WEEKS_PER_YEAR + oldest.clock.week) > 2 * WEEKS_PER_YEAR) break;
  }
  return events;
}

function choicesFor(decisionId) {
  if (decisionId.startsWith('option:')) return [['exercise', 'exercise it'], ['decline', 'decline it']];
  return [['accept', 'accept'], ['decline', 'decline']];
}

registerScreen('career-office', {
  title: 'The Office',
  nav: true,
  mode: 'career',
  async render(root) {
    const s = store.career;
    if (!s) {
      root.replaceChildren(el('div', { class: 'empty' },
        'no career loaded. ', el('a', { href: '#/career-new' }, 'create him'), '.'));
      return;
    }
    const phase = s.clock.phase;
    const rerender = () => this.render(root);

    const [events, offersView] = await Promise.all([
      recentEvents(s.clock),
      api.careerOffers().catch(() => ({ offers: [], market: [] })),
    ]);
    const nowAbs = s.clock.year * WEEKS_PER_YEAR + s.clock.week;

    // ---- open decisions (attempt-and-learn: the server is the truth) ----
    const windows = events
      .filter(ev => ev.kind === 'contract' && DECISION_RE.test(ev.reason))
      .map(ev => ({ ev, decisionId: DECISION_RE.exec(ev.reason)[1] }))
      .filter(w => nowAbs - (w.ev.clock.year * WEEKS_PER_YEAR + w.ev.clock.week) <= 2 * WEEKS_PER_YEAR);

    const decisionCard = (w) => {
      const note = settled.get(w.decisionId);
      const err = el('div');
      const card = el('div', { class: `decision-card${note ? ' resolved' : ''}` },
        el('div', { class: 'dc-meta' },
          el('span', { class: 'stamp' }, stamp(w.ev.clock)),
          el('span', { class: 'dc-id' }, w.decisionId)),
        el('div', { class: 'dc-reason' }, w.ev.reason),
        note
          ? el('div', { class: 'dc-note' }, note)
          : el('div', { class: 'dc-actions' },
              choicesFor(w.decisionId).map(([choiceId, label]) =>
                el('button', {
                  class: choiceId === 'decline' ? 'quiet' : undefined,
                  onclick: async (e) => {
                    e.target.disabled = true;
                    err.replaceChildren();
                    try {
                      const result = await api.careerChoice({
                        kind: 'contractDecision', decisionId: w.decisionId, choiceId,
                      });
                      if (!result.ok) {
                        // learned: the window is not open; dim it and keep the no
                        settled.set(w.decisionId, result.errors.join('; '));
                        rerender();
                        return;
                      }
                      settled.set(w.decisionId, `answered: ${label}`);
                      await store.refresh();
                      rerender();
                    } catch (ex) {
                      err.replaceChildren(errorBox([ex.message]));
                      e.target.disabled = false;
                    }
                  },
                }, label))),
        err,
      );
      return card;
    };

    // ---- the market ----
    const market = offersView.market ?? [];
    const marketCard = (o) => {
      const isNba = o.id.startsWith('nba:');
      const isAbroad = o.id.startsWith('abroad:');
      const dest = isAbroad ? (o.id.startsWith('abroad:china') ? 'the CBA' : 'Europe') : 'the league';
      const err = el('div');
      let armed = false;
      const signBtn = el('button', {
        onclick: async (e) => {
          if (!armed) {
            armed = true;
            signBtn.textContent = 'sign it. really.';
            signBtn.classList.add('armed');
            disarm.style.display = '';
            return;
          }
          e.target.disabled = true;
          err.replaceChildren();
          try {
            const kind = isNba ? 'acceptNbaOffer' : 'acceptAbroadOffer';
            const result = await api.careerChoice({ kind, offerId: o.id });
            if (!result.ok) { err.replaceChildren(errorBox(result.errors)); e.target.disabled = false; return; }
            toast(`signed: ${o.clubName ?? o.id}`);
            await store.refresh();
            rerender();
          } catch (ex) {
            err.replaceChildren(errorBox([ex.message]));
            e.target.disabled = false;
          }
        },
      }, 'accept');
      const disarm = el('button', {
        class: 'quiet', style: 'display:none',
        onclick: () => {
          armed = false;
          signBtn.textContent = 'accept';
          signBtn.classList.remove('armed');
          disarm.style.display = 'none';
        },
      }, 'never mind');
      return el('div', { class: 'offer-card market-card' },
        el('div', { style: 'display:flex;justify-content:space-between;align-items:baseline' },
          el('b', {}, o.clubName ?? o.id),
          el('span', { class: 'pos-chip' }, isNba ? 'NBA' : dest)),
        el('div', { class: 'terms' },
          `${money(o.money)} a season · promised ${o.promisedRole} · window closes week ${o.expiresWeek}`),
        el('div', { class: 'dc-actions' }, signBtn, disarm),
        err,
      );
    };

    // ---- the crossroads ----
    const crossErr = el('div');
    const post = async (choice, btn, doneWord) => {
      btn.disabled = true;
      crossErr.replaceChildren();
      try {
        const result = await api.careerChoice(choice);
        if (!result.ok) { crossErr.replaceChildren(errorBox(result.errors)); btn.disabled = false; return; }
        if (doneWord) toast(doneWord);
        await store.refresh();
        rerender();
      } catch (ex) {
        crossErr.replaceChildren(errorBox([ex.message]));
        btn.disabled = false;
      }
    };

    const crossroads = [];

    if (phase === 'college') {
      crossroads.push(el('div', { class: 'cross-row' },
        el('div', { class: 'cross-word' }, 'the draft'),
        el('button', { onclick: (e) => post({ kind: 'declareDraft' }, e.target, 'declared') }, 'declare for the draft'),
        el('button', { class: 'quiet', onclick: (e) => post({ kind: 'returnToSchool' }, e.target, 'running it back') }, 'pull out: run it back'),
        el('span', { class: 'cross-why' }, 'the season plays out either way; the last call logged this year wins'),
      ));
    }

    if (phase !== 'hs' && phase !== 'retired') {
      const signedAgent = events.find(ev => ev.reason.startsWith('signed with an agent'));
      crossroads.push(signedAgent
        ? el('div', { class: 'cross-row' },
            el('div', { class: 'cross-word' }, 'the agent'),
            el('span', { style: 'font-size:12.5px;color:var(--ink-soft)' }, signedAgent.reason))
        : el('div', { class: 'cross-row', style: 'align-items:flex-start' },
            el('div', { class: 'cross-word' }, 'the agent'),
            el('div', { style: 'flex:1' },
              el('div', { class: 'agent-cards' }, AGENTS.map(([id, name, line]) =>
                el('div', {
                  class: 'pick-card',
                  onclick: (e) => post({ kind: 'signAgent', agentId: id }, e.target, `signed: ${name}`),
                }, el('b', {}, name), line))),
              el('span', { class: 'cross-why' }, 'one signature, once; the calls route through them after'),
            )));
    }

    if (phase === 'nba') {
      // the latest ask/withdrawal in the record is the pending truth
      let pending = false;
      for (const ev of events) {
        if (ev.reason.startsWith('asked out:')) { pending = true; break; }
        if (ev.reason.startsWith('trade request withdrawn')) { pending = false; break; }
      }
      crossroads.push(el('div', { class: 'cross-row' },
        el('div', { class: 'cross-word' }, 'the room'),
        pending
          ? el('button', { class: 'quiet', onclick: (e) => post({ kind: 'withdrawTradeRequest' }, e.target, 'request withdrawn') }, 'withdraw the trade request')
          : el('button', { onclick: (e) => post({ kind: 'requestTrade' }, e.target, 'the request is on the record') }, 'request a trade'),
        el('span', { class: 'cross-why' }, pending ? 'a request is on the record; the team moves on its own clock' : 'the ask costs morale and the room knows'),
      ));
    }

    if (phase === 'nba' || phase === 'china') {
      let armed = false;
      const retireBtn = el('button', {
        class: 'quiet',
        onclick: (e) => {
          if (!armed) {
            armed = true;
            retireBtn.textContent = 'call it. really.';
            retireBtn.classList.add('armed');
            return;
          }
          post({ kind: 'retire' }, e.target, 'the ball stopped');
        },
      }, 'retire');
      crossroads.push(el('div', { class: 'cross-row' },
        el('div', { class: 'cross-word' }, 'the end'),
        retireBtn,
        el('span', { class: 'cross-why' }, 'two clicks; the epilogue writes itself from the record'),
      ));
    }

    root.replaceChildren(
      el('h1', { class: 'doc' }, 'the office'),
      el('div', { class: 'doc-sub' },
        `${s.phaseLabel} · the desk where the career signs its name`),
      ledger('open decisions', 'contract windows from the last two seasons'),
      windows.length
        ? el('div', {}, windows.map(decisionCard))
        : el('div', { class: 'empty' }, 'no windows open. the sim stops when one does.'),
      ledger('the market', market.length ? 'live money; the id says which world' : undefined),
      market.length
        ? el('div', {}, market.map(marketCard))
        : el('div', { class: 'empty' },
            phase === 'draftPrep' || phase === 'nba' || phase === 'china'
              ? 'nothing concrete this week. the market reprices weekly.'
              : 'the market opens with the pros; recruiting handles this chapter.'),
      ledger('the crossroads', 'the forks you can call from this chair'),
      crossroads.length
        ? el('div', {}, crossroads)
        : el('div', { class: 'empty' },
            phase === 'retired' ? 'the playing days are over. the journey keeps the record.' : 'no forks from this phase.'),
      crossErr,
    );
  },
});
