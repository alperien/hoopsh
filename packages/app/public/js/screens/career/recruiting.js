/**
 * screens/career/recruiting.js - the recruiting board (docs/CAREER.md,
 * Recruiting): programs holding scouted ranges on me, the interest
 * ladder rung by rung, and the offers with real terms. Committing is
 * the fork of the whole journey, so it asks once before it takes.
 */
import { registerScreen, store } from '../../app.js';
import { api } from '../../api.js';
import { el, ledger, toast } from '../../ui.js';
import { money } from '../../format.js';
import { errorBox } from './widgets.js';

const RUNGS = ['none', 'questionnaire', 'letter', 'texts', 'visit', 'offer'];

function rungLadder(rung) {
  const idx = Math.max(0, RUNGS.indexOf(rung));
  return el('span', { class: 'rungs', title: RUNGS.map((r, i) => `${i <= idx ? '●' : '○'} ${r}`).join('  ') },
    RUNGS.map((r, i) => el('span', { class: `rung${i <= idx ? ' on' : ''}` })),
    el('span', { class: 'rung-word' }, rung),
  );
}

function teachingLetter(coachDev) {
  const letter = coachDev >= 85 ? 'A' : coachDev >= 75 ? 'A-' : coachDev >= 65 ? 'B' : coachDev >= 55 ? 'B-' : coachDev >= 45 ? 'C' : 'D';
  return el('span', { class: 'mono', title: `development quality ${coachDev}` }, letter);
}

function styleWords(style) {
  const pace = style.pace >= 62 ? 'run-and-gun' : style.pace >= 54 ? 'up-tempo' : style.pace > 46 ? 'balanced pace' : style.pace > 38 ? 'deliberate' : 'grind-it-out';
  const three = style.threeBias >= 62 ? 'lets it fly' : style.threeBias >= 54 ? 'three-happy' : style.threeBias > 46 ? 'even shot diet' : style.threeBias > 38 ? 'inside first' : 'lives in the paint';
  return `${pace}, ${three}`;
}

const tierStars = (tier) => '★'.repeat(Math.max(1, 4 - tier));

registerScreen('career-recruiting', {
  title: 'Recruiting',
  nav: true,
  mode: 'career',
  async render(root) {
    const view = await api.careerRecruiting();
    const clock = store.career?.clock ?? { phase: 'hs', week: 0 };
    const inHs = clock.phase === 'hs';
    const empty = view.programs.length === 0 && view.offers.length === 0 && !view.committedTo;
    const rerender = () => this.render(root);

    if (empty) {
      root.replaceChildren(
        el('h1', { class: 'doc' }, 'recruiting'),
        el('div', { class: 'doc-sub' }, inHs ? 'senior year' : 'after high school'),
        el('div', { class: 'empty' },
          inHs ? 'the letters have not started. play, and the fog will find you.' : 'this chapter is closed.'),
      );
      return;
    }

    const committedOffer = view.committedTo ? view.offers.find(o => o.id === view.committedTo) : null;
    const destName = (offer) =>
      view.programs.find(p => p.id === offer.programId)?.name ?? offer.clubName ?? 'the program';

    const errBox = el('div');
    const accept = async (offer, btn) => {
      const dest = destName(offer);
      const line = offer.kind === 'college'
        ? `Commit to ${dest}? Role promise: ${offer.promisedRole}. NIL ${money(offer.money)} a season. The journey forks here.`
        : `Sign with ${dest}? ${money(offer.money)} a season, ${offer.promisedRole} role, grown men every night. The journey forks here.`;
      if (!window.confirm(line)) return;
      btn.disabled = true;
      errBox.replaceChildren();
      try {
        const kind = offer.kind === 'college' ? 'commitCollege' : 'acceptOffer';
        const result = await api.careerChoice({ kind, offerId: offer.id });
        if (!result.ok) { errBox.replaceChildren(errorBox(result.errors)); btn.disabled = false; return; }
        toast(offer.kind === 'college' ? `committed: ${dest}` : `signed: ${dest}`);
        await store.refresh();
        rerender();
      } catch (err) {
        toast(err.message, true);
        btn.disabled = false;
      }
    };

    // offer windows are same-year week numbers; once the phase turns the
    // whole market is history, whatever the counter says
    const openOffers = inHs ? view.offers.filter(o => o.expiresWeek >= clock.week) : [];
    const expiredCount = view.offers.length - openOffers.length;

    const offerCard = (o) => el('div', { class: 'offer-card' },
      el('div', { style: 'display:flex;justify-content:space-between;align-items:baseline' },
        el('b', {}, destName(o)),
        el('span', { class: 'pos-chip' }, o.kind)),
      el('div', { class: 'terms' },
        `${o.kind === 'college' ? `NIL ${money(o.money)}` : `${money(o.money)} salary`} · promised ${o.promisedRole} · teaching `,
        teachingLetter(o.coachDev),
        ` · ${styleWords(o.style)} · window closes week ${o.expiresWeek}`),
      view.committedTo
        ? null
        : el('button', { onclick: (e) => accept(o, e.target) }, o.kind === 'college' ? 'commit' : 'sign'),
    );

    root.replaceChildren(
      el('h1', { class: 'doc' }, 'recruiting'),
      el('div', { class: 'doc-sub' },
        inHs ? 'they see ranges, not your sheet. your box scores move them.' : 'the book is closed; the record stays.'),
      view.committedTo ? el('div', { class: 'commit-banner' },
        el('b', {}, 'committed: '),
        committedOffer ? `${destName(committedOffer)} (${committedOffer.kind})` : view.committedTo,
        committedOffer && committedOffer.kind === 'college' ? ` · NIL ${money(committedOffer.money)} a season` : '',
      ) : null,
      ledger('the board', `${view.programs.length} programs know the name`),
      view.programs.length ? el('table', { class: 'grid' },
        el('thead', {}, el('tr', {},
          el('th', {}, 'program'),
          el('th', {}, 'tier'),
          el('th', {}, 'region'),
          el('th', {}, 'style'),
          el('th', {}, 'teaching'),
          el('th', { class: 'num' }, 'NIL'),
          el('th', {}, 'promised role'),
          el('th', {}, 'the ladder'),
        )),
        el('tbody', {}, view.programs.map(p => el('tr', { class: p.closed ? 'closed-row' : undefined },
          el('td', {}, p.name, p.closed && p.closedReason ? el('span', { class: 'sub' }, ` · ${p.closedReason}`) : null),
          el('td', { title: `tier ${p.tier}` }, tierStars(p.tier)),
          el('td', {}, p.region),
          el('td', {}, styleWords(p.style)),
          el('td', {}, teachingLetter(p.coachDev)),
          el('td', { class: 'num money' }, money(p.nil)),
          el('td', {}, p.promisedRole),
          el('td', {}, rungLadder(p.rung)),
        )))) : el('div', { class: 'empty' }, 'no program has the name yet'),
      inHs ? el('div', {},
        ledger('offers', view.committedTo ? 'the ink is dry' : 'committable, while the window holds'),
        errBox,
        openOffers.length
          ? el('div', {}, openOffers.map(offerCard))
          : el('div', { class: 'empty' }, view.committedTo ? 'the rest of the board moved on' : 'no live offers. climb the ladder.'),
        expiredCount > 0
          ? el('p', { style: 'font-size:12px;color:var(--ink-faint)' }, `${expiredCount} offer${expiredCount === 1 ? '' : 's'} came and went unanswered.`)
          : null,
      ) : null,
    );
  },
});
