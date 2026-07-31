/**
 * screens/career/draftnight.js - the green room. The mode's biggest
 * night gets the telecast register and nothing else does: the first
 * round reveals pick by pick, my pick lands as the one takeover card
 * the design allows, the rival gets a marked row, and the undrafted
 * night plays as its own produced quiet. Reached once automatically
 * when the draft turns the phase (app.js), and any time after from the
 * journey's 'relive draft night' link.
 */
import { registerScreen, navigate } from '../../app.js';
import { api } from '../../api.js';
import { el } from '../../ui.js';
import { money } from '../../format.js';

const REVEAL_MS_R1 = 600;
const REVEAL_MS_R2 = 200;
const REVEAL_MS_QUIET = 220; // the undrafted stream: quicker, quieter
const TAKEOVER_HOLD_MS = 1200;

function reducedMotion() {
  try {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/** One pick on the board. Mine gets the takeover; the rival a marked row. */
function pickNode(p, view) {
  if (p.mine) {
    const gap = view.mockAtEntry !== null && view.mockAtEntry !== undefined && view.mockAtEntry !== p.overall
      ? el('div', { class: 'dn-gap' }, `the boards had you ${view.mockAtEntry}`)
      : null;
    const deal = view.rookieDeal && view.rookieDeal.firstYear
      ? el('div', { class: 'dn-deal' },
          `rookie scale: ${money(view.rookieDeal.firstYear)} year one`)
      : null;
    return el('div', {
      class: 'dn-mine dn-hidden',
      style: p.colors ? `border-color:${p.colors[0]}` : undefined,
    },
      el('div', { class: 'dn-mine-head' }, `pick ${p.overall}. ${p.team}.`),
      el('div', { class: 'dn-mine-name' }, p.player),
      gap,
      deal,
    );
  }
  return el('div', { class: `dn-row dn-hidden${p.rival ? ' dn-rival' : ''}` },
    el('span', { class: 'dn-swatch', style: p.colors ? `background:${p.colors[0]}` : undefined }),
    el('span', { class: 'dn-no' }, `pick ${p.overall}`),
    el('span', { class: 'dn-team' }, p.team),
    el('span', { class: 'dn-player' }, p.player),
    p.rival ? el('span', { class: 'dn-chip' }, 'the rival') : null,
  );
}

registerScreen('career-draftnight', {
  title: 'Draft Night',
  nav: false,
  mode: 'career',
  async render(root) {
    let view = null;
    try {
      view = await api.careerDraftnight();
    } catch (err) {
      root.replaceChildren(
        el('h1', { class: 'doc' }, 'draft night'),
        el('div', { class: 'empty' }, `${err.message}. `,
          el('a', { href: '#/career-week' }, 'back to the week'), '.'),
      );
      return;
    }

    const quiet = view.undrafted;
    const firstRound = view.picks.filter(p => p.round === 1);
    const secondRound = view.picks.filter(p => p.round !== 1);
    // the stream: round one always; round two rides when the night is
    // mine to sit through (undrafted) or my name lands there
    const streamSecond = quiet || (view.myPick !== null && view.myPick > firstRound.length);
    const stream = streamSecond ? [...firstRound, ...secondRound] : firstRound;

    const nodes = stream.map(p => ({ pick: p, node: pickNode(p, view) }));

    const board = el('div', { class: `dn-board${quiet ? ' dn-quiet' : ''}` }, nodes.map(n => n.node));

    // what the stream leaves out renders after the reveal, folded flat
    const restRows = streamSecond ? [] : secondRound.map(p => pickNode(p, view));
    const rest = restRows.length
      ? el('div', { class: 'dn-rest dn-hidden' },
          el('div', { class: 'dn-rest-head' }, 'the second round, in the noise'),
          restRows)
      : null;
    if (rest) for (const r of restRows) r.classList.remove('dn-hidden');

    const closing = quiet
      ? el('div', { class: 'dn-close dn-hidden' },
          el('div', { class: 'dn-close-head' }, `${view.picks.length} names. none of them yours.`),
          el('div', { class: 'dn-close-line' }, 'the phone still works.'))
      : null;

    const footer = el('div', { class: 'dn-footer dn-hidden' },
      el('button', { onclick: () => navigate('/career-week') }, 'go to the week'),
    );

    let idx = 0;
    let timer = null;
    let done = false;
    const skipBtn = el('button', { class: 'quiet' }, 'skip the reveal');

    const finish = () => {
      if (done) return;
      done = true;
      if (timer) { clearTimeout(timer); timer = null; }
      for (const n of nodes) n.node.classList.remove('dn-hidden');
      if (rest) rest.classList.remove('dn-hidden');
      if (closing) closing.classList.remove('dn-hidden');
      footer.classList.remove('dn-hidden');
      skipBtn.style.display = 'none';
    };
    skipBtn.addEventListener('click', finish);

    const step = () => {
      if (done || !root.isConnected) return;
      if (idx >= nodes.length) { finish(); return; }
      const { pick, node } = nodes[idx++];
      node.classList.remove('dn-hidden');
      const hold = pick.mine ? TAKEOVER_HOLD_MS
        : quiet ? REVEAL_MS_QUIET
        : pick.round === 1 ? REVEAL_MS_R1 : REVEAL_MS_R2;
      timer = setTimeout(step, hold);
    };

    root.replaceChildren(
      el('div', { class: 'greenroom' },
        el('div', { class: 'dn-masthead' },
          el('div', { class: 'dn-title' }, 'draft night'),
          el('div', { class: 'dn-sub' },
            quiet
              ? 'the green room, and the longest hour in basketball'
              : 'the green room, and the walk that ends the climb'),
          el('div', { class: 'dn-controls' }, skipBtn),
        ),
        board,
        rest,
        closing,
        footer,
      ),
    );

    if (reducedMotion()) finish();
    else step();
  },
});
