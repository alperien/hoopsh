/**
 * screens/career/week.js - This Week, the career home: the week planner
 * (three slots against the energy budget, docs/CAREER.md 'A week in the
 * life') beside the pulse (next game, the coach, the explained events).
 * Advancing time lives in the masthead (the shell's job); this screen
 * only sets the plan the advance will spend.
 */
import { registerScreen, store, on } from '../../app.js';
import { api } from '../../api.js';
import { el, ledger } from '../../ui.js';
import { stamp, meter, kindChip, signed, errorBox } from './widgets.js';

const SLOT_CHOICES = [
  ['extraWork', 'extra work (train the focus group)'],
  ['film', 'film (decisions, BBIQ)'],
  ['body', 'body work (trim wear, resist injury)'],
  ['rest', 'rest (energy back)'],
  ['life', 'life (morale, grades, people)'],
];
const GROUPS = ['phys', 'scoring', 'playmaking', 'defense', 'rebounding', 'mental'];
const SLOT_COUNT = 3; // params.week.slotCount

function nextGameCard(s) {
  const g = s.nextGame;
  if (!g) return el('p', { class: 'empty', style: 'padding:6px 0' }, 'no game on the schedule. the week is yours.');
  const roundChip = g.round ? el('span', { class: 'round', style: 'margin-left:6px' }, g.round) : null;
  if (g.myGame && s.team) {
    const home = g.home === s.team.name;
    return el('div', { style: 'font-size:14px' },
      el('b', {}, `${home ? 'vs' : 'at'} ${home ? g.away : g.home}`), roundChip,
      el('div', { style: 'font-size:12px;color:var(--ink-soft)' },
        `week ${g.week}${g.type !== 'regular' ? ` · ${g.type === 'bracket' ? 'the bracket' : 'conference tournament'}` : ''}`),
    );
  }
  return el('div', { style: 'font-size:13px;color:var(--ink-soft)' },
    `around the circuit, week ${g.week}: ${g.away} at ${g.home}`, roundChip);
}

function coachCard(coach) {
  const lg = coach.lastGrade;
  return el('div', { class: 'card' },
    el('div', { style: 'display:flex;justify-content:space-between;align-items:baseline' },
      el('b', {}, coach.name),
      coach.greenLight ? el('span', { class: 'gl-chip' }, 'green light') : null),
    el('div', { style: 'font-size:12px;color:var(--ink-soft);margin:1px 0 6px' },
      `${coach.personality} · your role: ${coach.role}`),
    el('div', { style: 'display:flex;align-items:center;gap:8px' },
      el('span', { style: 'font-size:11.5px;color:var(--ink-faint);width:34px' }, 'trust'),
      el('div', { style: 'flex:1' }, meter(coach.trust))),
    lg ? el('div', { style: 'font-size:12.5px;margin-top:8px' },
      el('span', { style: 'color:var(--ink-faint)' }, 'last grade: '),
      `adherence ${Math.round(lg.adherence)}, production ${Math.round(lg.production)}, trust `,
      signed(lg.trustDelta),
      el('div', { style: 'font-style:italic;color:var(--ink-soft)' }, `"${lg.note}"`),
    ) : el('div', { style: 'font-size:12.5px;color:var(--ink-faint);margin-top:8px' }, 'no game graded yet'),
  );
}

registerScreen('career-week', {
  title: 'This Week',
  nav: true,
  mode: 'career',
  async render(root) {
    const s = store.career;
    if (!s) {
      root.replaceChildren(el('div', { class: 'empty' },
        'no career loaded. ', el('a', { href: '#/career-new' }, 'create him'), '.'));
      return;
    }

    // ---- plan editor ----
    const plan = {
      slots: [...(s.weekPlan?.slots ?? [])],
      focus: s.weekPlan?.focus ?? 'scoring',
    };
    while (plan.slots.length < SLOT_COUNT) plan.slots.push('rest');
    plan.slots = plan.slots.slice(0, SLOT_COUNT);

    const planErr = el('div');
    const slotSelect = (i) => el('select', {
      onchange: (e) => { plan.slots[i] = e.target.value; },
    }, SLOT_CHOICES.map(([id, label]) =>
      el('option', { value: id, selected: plan.slots[i] === id ? true : undefined }, label)));

    const saveBtn = el('button', {
      onclick: async () => {
        planErr.replaceChildren();
        saveBtn.disabled = true;
        try {
          const result = await api.careerChoice({ kind: 'setWeekPlan', plan: { slots: [...plan.slots], focus: plan.focus } });
          if (!result.ok) { planErr.replaceChildren(errorBox(result.errors)); return; }
          await store.refresh();
          saveBtn.textContent = 'week set';
          setTimeout(() => { saveBtn.textContent = 'set the week'; }, 1600);
        } catch (err) {
          planErr.replaceChildren(errorBox([err.message]));
        } finally {
          saveBtn.disabled = false;
        }
      },
    }, 'set the week');

    const planEditor = el('div', {},
      el('div', { class: 'slot-row' },
        el('span', { class: 'slot-tag' }, 'fixed'),
        el('span', { class: 'fixed' }, 'team practice (mandatory)'),
        el('span', { class: 'why' }, 'sets the trust baseline'),
      ),
      ...[0, 1, 2].map(i => el('div', { class: 'slot-row' },
        el('span', { class: 'slot-tag' }, `slot ${i + 1}`),
        slotSelect(i),
      )),
      el('div', { class: 'slot-row' },
        el('span', { class: 'slot-tag' }, 'focus'),
        el('select', {
          onchange: (e) => { plan.focus = e.target.value; },
        }, GROUPS.map(g => el('option', { value: g, selected: plan.focus === g ? true : undefined }, g))),
        el('span', { class: 'why' }, 'extra work trains this group'),
      ),
      planErr,
      el('div', { style: 'margin-top:10px' }, saveBtn),
    );

    // ---- the pulse ----
    const me = s.me;
    const events = s.eventsTail ?? [];

    root.replaceChildren(
      el('h1', { class: 'doc' }, 'this week'),
      el('div', { class: 'doc-sub' },
        `${s.phaseLabel} · week ${s.clock.week}, ${s.clock.year}` +
        (s.team ? ` · ${s.team.name} ${s.team.w}-${s.team.l}` : '') +
        (s.phoneUnread > 0 ? ` · ${s.phoneUnread} on the phone need an answer` : '')),
      s.epilogue ? el('div', { class: 'epilogue-banner' },
        'the playing days are over. ',
        el('a', { href: '#/career-journey' }, 'read the whole journey'), '.') : null,
      el('div', { class: 'cols c2' },
        el('div', {},
          ledger('the plan', 'practice plus three slots against the tank'),
          me ? el('div', { style: 'margin:4px 0 12px' },
            el('div', { style: 'display:flex;align-items:center;gap:8px' },
              el('span', { style: 'font-size:11.5px;color:var(--ink-faint);width:44px' }, 'energy'),
              el('div', { style: 'flex:1' }, meter(me.energy, { tier: 'energy' }))),
            me.injury ? el('div', { style: 'font-size:12.5px;color:var(--bad);margin-top:4px' },
              `${me.injury.label}, about ${me.injury.weeksOut} week${me.injury.weeksOut === 1 ? '' : 's'}`) : null,
            el('div', { style: 'font-size:11.5px;color:var(--ink-faint);margin-top:2px' },
              `wear ${me.wear} · morale ${me.morale} · overtraining under 30 energy multiplies injury risk`),
          ) : null,
          planEditor,
        ),
        el('div', {},
          ledger('this week'),
          el('div', { class: 'card', style: 'margin-bottom:10px' }, nextGameCard(s)),
          coachCard(s.coach),
          ledger('lately', 'every consequence states its reason'),
          events.length
            ? el('div', {}, events.map(ev => el('div', { class: 'evt' },
                kindChip(ev.kind),
                el('span', { class: 'stamp' }, stamp(ev.clock)),
                ev.reason,
                ev.delta !== undefined ? el('span', { class: 'delta' }, signed(ev.delta)) : null,
              )))
            : el('div', { class: 'empty' }, 'nothing on the record yet. advance the week.'),
        ),
      ),
    );

    // live progress while the shell runs a multi-week sim
    on('sim-progress', (status) => {
      if (!root.isConnected) return;
      const sub = root.querySelector('.doc-sub');
      if (sub && status.running && status.weeksTotal !== undefined) {
        sub.textContent = `simming: week ${status.weeksDone} of ${status.weeksTotal}...`;
      }
    });
  },
});
