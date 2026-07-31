/**
 * screens/career/new.js - create him. Identity, body, one background,
 * a preset budget spent across the six groups, two signatures, a seed.
 * Every constant here mirrors packages/career/src/params.ts and
 * creation.ts (budgets 60/110/160 over base 38, group cap 68, the
 * height/weight plausibility band); the server revalidates and its
 * errors render inline, never alert().
 */
import { registerScreen, store, navigate } from '../../app.js';
import { api } from '../../api.js';
import { el, ledger } from '../../ui.js';
import { errorBox } from './widgets.js';

// mirrors params.creation (career/src/params.ts)
const BUDGET_BY_PRESET = { walkon: 60, fourstar: 110, phenom: 160 };
const GROUP_BASE = 38;
const GROUP_CAP = 68;           // alloc cap per group = 68 - 38 = 30
const MAX_ALLOC = GROUP_CAP - GROUP_BASE;

// mirrors creation.ts body bounds: height 68-90 overall, weight within
// 45 lb of the frame line 190 + (h - 74.5) * 7, absolute 140-330
const WEIGHT_BAND = 45;
const weightLine = (h) => 190 + (h - 74.5) * 7;
const weightBounds = (h) => ({
  lo: Math.max(140, Math.round(weightLine(h) - WEIGHT_BAND)),
  hi: Math.min(330, Math.round(weightLine(h) + WEIGHT_BAND)),
});

// sane UI spans per position, inside the server's 68-90
const POS_BODY = {
  PG: { lo: 68, hi: 79, def: 74 },
  SG: { lo: 72, hi: 81, def: 77 },
  SF: { lo: 74, hi: 83, def: 79 },
  PF: { lo: 76, hi: 86, def: 81 },
  C: { lo: 78, hi: 90, def: 84 },
};

const GROUPS = ['phys', 'scoring', 'playmaking', 'defense', 'rebounding', 'mental'];

const BACKGROUNDS = [
  ['aau', 'AAU circuit kid', 'offensive polish up, defensive habits down'],
  ['coachs-son', "Coach's son", 'decisions and film sense up, athletic priors modest'],
  ['playground', 'Playground', 'handle and iso up, discipline and shot selection down'],
  ['late-bloomer', 'Late bloomer', 'lower start, more ceiling headroom'],
  ['academy', 'Academy product', 'fundamentals and passing up, self-creation down (international only)'],
];

const PRESETS = [
  ['walkon', 'Walk-on', '60 points. Under-recruited on purpose; every rung gets earned.'],
  ['fourstar', 'Four-star', '110 points. The default climb: real hype, real work left.'],
  ['phenom', 'Phenom', '160 points. Top-five hype and the pressure that comes with it.'],
];

const SIGNATURES = [
  ['movement-shooter', 'Movement shooter', 'flies off screens and lets it go on the catch'],
  ['downhill', 'Downhill', 'lives on drives, contact, and the free throw line'],
  ['point-forward', 'Point forward', 'runs the offense no matter the listed position'],
  ['rim-runner', 'Rim runner', 'lobs, putbacks, and rim protection; no threes'],
  ['three-and-d', 'Three-and-D', "corner threes and the other team's best scorer"],
  ['post-hub', 'Post hub', 'back to the basket, passing out of the double'],
  ['glue', 'Glue', 'screens, rotations, extra passes; the winning plays'],
];

const ftIn = (h) => `${Math.floor(h / 12)}'${h % 12}"`;

registerScreen('career-new', {
  title: 'New Career',
  nav: false,
  mode: 'career',
  async render(root) {
    const state = {
      firstName: '', lastName: '',
      nationality: 'us', birthplace: '',
      pos: 'SG',
      heightIn: POS_BODY.SG.def,
      weightLb: Math.round(weightLine(POS_BODY.SG.def)),
      background: 'aau',
      preset: 'fourstar',
      budget: { phys: 22, scoring: 24, playmaking: 16, defense: 20, rebounding: 12, mental: 16 }, // sums to 110
      signatures: ['movement-shooter', 'three-and-d'],
      seed: '',
      submitting: false,
    };

    const input = (key, attrs = {}) => el('input', {
      ...attrs,
      value: state[key],
      oninput: (e) => { state[key] = e.target.value; },
    });

    // ---- body sliders -------------------------------------------------
    const bodyBox = el('div');
    const renderBody = () => {
      const span = POS_BODY[state.pos];
      state.heightIn = Math.min(span.hi, Math.max(span.lo, state.heightIn));
      const wb = weightBounds(state.heightIn);
      state.weightLb = Math.min(wb.hi, Math.max(wb.lo, state.weightLb));
      const hOut = el('span', { class: 'readout' }, `${ftIn(state.heightIn)} (${state.heightIn} in)`);
      const wOut = el('span', { class: 'readout' }, `${state.weightLb} lb`);
      const wSlider = el('input', {
        type: 'range', min: wb.lo, max: wb.hi, value: state.weightLb,
        oninput: (e) => { state.weightLb = Number(e.target.value); wOut.textContent = `${state.weightLb} lb`; },
      });
      bodyBox.replaceChildren(
        el('label', { class: 'field' }, `height (${ftIn(span.lo)} to ${ftIn(span.hi)} for a ${state.pos})`),
        el('div', { class: 'slider-line' },
          el('input', {
            type: 'range', min: span.lo, max: span.hi, value: state.heightIn,
            oninput: (e) => {
              state.heightIn = Number(e.target.value);
              hOut.textContent = `${ftIn(state.heightIn)} (${state.heightIn} in)`;
              const b = weightBounds(state.heightIn);
              state.weightLb = Math.min(b.hi, Math.max(b.lo, state.weightLb));
              wSlider.min = b.lo; wSlider.max = b.hi; wSlider.value = state.weightLb;
              wOut.textContent = `${state.weightLb} lb`;
            },
          }),
          hOut,
        ),
        el('label', { class: 'field' }, 'weight (the frame has to carry it)'),
        el('div', { class: 'slider-line' }, wSlider, wOut),
      );
    };

    // ---- pickers ------------------------------------------------------
    const bgBox = el('div', { class: 'pick-grid' });
    const renderBackgrounds = () => {
      if (state.nationality !== 'intl' && state.background === 'academy') state.background = 'aau';
      bgBox.replaceChildren(...BACKGROUNDS.map(([id, name, line]) => {
        const locked = id === 'academy' && state.nationality !== 'intl';
        return el('div', {
          class: `pick-card${state.background === id ? ' on' : ''}${locked ? ' off' : ''}`,
          onclick: locked ? undefined : () => { state.background = id; renderBackgrounds(); },
        }, el('b', {}, name), line);
      }));
    };

    const presetBox = el('div', { class: 'pick-grid' });
    const renderPresets = () => {
      presetBox.replaceChildren(...PRESETS.map(([id, name, line]) =>
        el('div', {
          class: `pick-card${state.preset === id ? ' on' : ''}`,
          onclick: () => { state.preset = id; renderPresets(); renderBudget(); },
        }, el('b', {}, name), line)));
    };

    // ---- budget -------------------------------------------------------
    const budgetBox = el('div');
    const spent = () => GROUPS.reduce((s, g) => s + state.budget[g], 0);
    const renderBudget = () => {
      const total = BUDGET_BY_PRESET[state.preset];
      const left = total - spent();
      const step = (g, d) => {
        const next = state.budget[g] + d;
        const room = total - spent();
        if (next < 0 || next > MAX_ALLOC) return;
        if (d > 0 && d > room) return; // cannot spend points the preset does not grant
        state.budget[g] = next;
        renderBudget();
      };
      budgetBox.replaceChildren(
        el('div', { class: `budget-remaining${left < 0 ? ' bad' : ''}` },
          el('b', {}, String(left)), ` of ${total} points left to place`,
          left < 0 ? ' (over budget)' : '',
        ),
        ...GROUPS.map(g => el('div', { class: 'budget-row' },
          el('span', { class: 'bg-name' }, g),
          el('button', { class: 'step', onclick: () => step(g, -5) }, '-5'),
          el('button', { class: 'step', onclick: () => step(g, -1) }, '-'),
          el('span', { class: 'bg-alloc' }, String(state.budget[g])),
          el('button', { class: 'step', onclick: () => step(g, 1) }, '+'),
          el('button', { class: 'step', onclick: () => step(g, 5) }, '+5'),
          el('span', { class: 'bg-level' }, `= ${GROUP_BASE + state.budget[g]}`),
        )),
        el('p', { style: 'font-size:11.5px;color:var(--ink-faint);margin:6px 0 0' },
          `every group starts at ${GROUP_BASE}; the creation cap is ${GROUP_CAP} (nobody arrives finished). Ceilings stay hidden, even from you.`),
      );
    };

    const sigBox = el('div', { class: 'pick-grid' });
    const renderSignatures = () => {
      sigBox.replaceChildren(...SIGNATURES.map(([id, name, line]) => {
        const on = state.signatures.includes(id);
        const full = state.signatures.length >= 2 && !on;
        return el('div', {
          class: `pick-card${on ? ' on' : ''}${full ? ' off' : ''}`,
          onclick: () => {
            if (on) state.signatures = state.signatures.filter(s => s !== id);
            else if (state.signatures.length < 2) state.signatures = [...state.signatures, id];
            renderSignatures();
          },
        }, el('b', {}, name), line);
      }));
    };

    // ---- submit -------------------------------------------------------
    const errBox = el('div');
    const submitBtn = el('button', {
      onclick: async () => {
        if (state.submitting) return;
        errBox.replaceChildren();
        if (state.signatures.length !== 2) {
          errBox.replaceChildren(errorBox(['pick exactly two signatures; the blend is the identity']));
          return;
        }
        const spec = {
          firstName: state.firstName.trim(),
          lastName: state.lastName.trim(),
          nationality: state.nationality,
          birthplace: state.birthplace.trim(),
          pos: state.pos,
          heightIn: state.heightIn,
          weightLb: state.weightLb,
          background: state.background,
          preset: state.preset,
          budget: { ...state.budget },
          signatures: [state.signatures[0], state.signatures[1]],
        };
        const saveName = `${spec.firstName} ${spec.lastName}`.trim().toLowerCase()
          .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'my-career';
        state.submitting = true;
        submitBtn.disabled = true;
        submitBtn.textContent = 'building the world...';
        try {
          await api.newCareer({ name: saveName, seed: state.seed.trim() || undefined, spec });
          await store.refresh();
          navigate('/career-week');
        } catch (err) {
          // the server states every problem at once: 'career/creation:
          // invalid spec: a; b; c' - strip the prefix, list the rest
          const msg = String(err.message ?? err);
          const list = msg.replace(/^career\/creation: invalid spec: /, '').split('; ');
          errBox.replaceChildren(errorBox(list));
        } finally {
          state.submitting = false;
          submitBtn.disabled = false;
          submitBtn.textContent = 'start the career';
        }
      },
    }, 'start the career');

    // ---- layout -------------------------------------------------------
    root.replaceChildren(
      el('h1', { class: 'doc' }, 'create him'),
      el('div', { class: 'doc-sub' }, 'seventeen years old, senior year ahead. everything you set here is a real input to a real simulation.'),
      el('div', { class: 'cols c2' },
        el('div', {},
          ledger('identity'),
          el('label', { class: 'field' }, 'first name'),
          input('firstName', { placeholder: 'first' }),
          el('label', { class: 'field' }, 'last name'),
          input('lastName', { placeholder: 'last' }),
          el('label', { class: 'field' }, 'nationality'),
          el('select', {
            onchange: (e) => { state.nationality = e.target.value; renderBackgrounds(); },
          },
          el('option', { value: 'us', selected: true }, 'United States'),
          el('option', { value: 'intl' }, 'international'),
          ),
          el('label', { class: 'field' }, 'birthplace'),
          input('birthplace', { placeholder: "'Akron, OH' or 'Split, Croatia'" }),
          el('label', { class: 'field' }, 'position'),
          el('select', {
            onchange: (e) => { state.pos = e.target.value; renderBody(); },
          }, ['PG', 'SG', 'SF', 'PF', 'C'].map(p =>
            el('option', { value: p, selected: p === state.pos ? true : undefined }, p))),
          ledger('body'),
          bodyBox,
          ledger('background'),
          bgBox,
        ),
        el('div', {},
          ledger('preset'),
          presetBox,
          ledger('the budget'),
          budgetBox,
          ledger('signatures', 'pick two'),
          sigBox,
          ledger('the world'),
          el('label', { class: 'field' }, 'seed (optional)'),
          input('seed', { placeholder: 'leave blank for a fresh world' }),
          errBox,
          el('div', { style: 'margin-top:14px' }, submitBtn),
        ),
      ),
    );
    renderBody();
    renderBackgrounds();
    renderPresets();
    renderBudget();
    renderSignatures();
  },
});
