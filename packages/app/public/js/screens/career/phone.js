/**
 * screens/career/phone.js - the inbox, the career's narrative spine
 * (docs/CAREER.md, The phone). Diegetic and quiet: sender, words, week
 * stamp, and the few choices that matter. No typing indicators, no read
 * receipts; the discipline rules live server-side and the screen adds
 * no chrome the fiction did not earn.
 */
import { registerScreen, store } from '../../app.js';
import { api } from '../../api.js';
import { el, ledger, toast } from '../../ui.js';
import { stamp } from './widgets.js';

const THREAD_LABELS = {
  coach: 'the coach',
  agent: 'the agent',
  teammate: 'the locker room',
  mentor: 'the mentor',
  rival: 'the rival',
  family: 'home',
  media: 'the press',
  wire: 'the wire',
};

function threadLabel(threadId, newest) {
  if (threadId.startsWith('recruiter:')) return newest?.from ?? 'a recruiter';
  return THREAD_LABELS[threadId] ?? threadId;
}

/** The wire reads as newsprint, the mentor as a steadier hand; the rest
 *  keep the plain bubble. Unknown thread ids fall through unstyled. */
const THREAD_CLASS = { wire: 'ph-wire', mentor: 'ph-mentor' };

function bubble(m, respond) {
  const open = m.choices && m.choices.length > 0 && !m.chosen;
  const picked = m.chosen && m.choices ? m.choices.find(c => c.id === m.chosen) : null;
  return el('div', {},
    el('div', { class: `ph-msg${open ? ' ph-need' : ''}` },
      el('div', { class: 'ph-meta' },
        el('span', { class: 'from' }, m.from),
        el('span', {}, stamp(m.clock))),
      el('p', { class: 'ph-body' }, m.body),
      open ? el('div', { class: 'ph-choices' },
        m.choices.map(c => el('button', { class: 'quiet', onclick: (e) => respond(m, c, e.target) }, c.label))) : null,
      open && m.deadlineWeek !== undefined
        ? el('div', { class: 'ph-deadline' }, `needs an answer by week ${m.deadlineWeek}`) : null,
    ),
    m.chosen ? el('div', { class: 'ph-you' }, `you: ${picked ? picked.label : m.chosen}`) : null,
  );
}

registerScreen('career-phone', {
  title: 'Phone',
  nav: true,
  mode: 'career',
  async render(root) {
    const { messages } = await api.careerPhone();
    const rerender = () => this.render(root);

    const respond = async (m, choice, btn) => {
      btn.disabled = true;
      try {
        const result = await api.careerChoice({ kind: 'respondPhone', messageId: m.id, choiceId: choice.id });
        if (!result.ok) { toast(result.errors.join('; '), true); btn.disabled = false; return; }
        await store.refresh(); // the unread count rides the summary
        rerender();
      } catch (err) {
        toast(err.message, true);
        btn.disabled = false;
      }
    };

    // group by thread; messages arrive newest first and stay that way,
    // sections ordered by their newest message (first appearance)
    const sections = new Map();
    for (const m of messages) {
      if (!sections.has(m.thread)) sections.set(m.thread, []);
      sections.get(m.thread).push(m);
    }

    const needCount = messages.filter(m => m.choices && m.choices.length > 0 && !m.chosen).length;

    root.replaceChildren(
      el('h1', { class: 'doc' }, 'the phone'),
      el('div', { class: 'doc-sub' },
        messages.length
          ? `${messages.length} message${messages.length === 1 ? '' : 's'}` +
            (needCount ? ` · ${needCount} waiting on you` : ' · nothing needs an answer')
          : 'quiet'),
      messages.length === 0
        ? el('div', { class: 'empty' }, 'nobody texts first. play a game.')
        : el('div', {}, [...sections.entries()].map(([threadId, list]) =>
            el('div', { class: `ph-thread${THREAD_CLASS[threadId] ? ` ${THREAD_CLASS[threadId]}` : ''}` },
              el('div', { class: 'ph-thread-head' },
                el('span', {}, threadLabel(threadId, list[0])),
                el('span', { class: 'count' }, `${list.length}`)),
              list.map(m => bubble(m, respond)),
            ))),
    );
  },
});
