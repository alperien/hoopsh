/**
 * screens/career/plan.js - My Game, the agency core (docs/CAREER.md,
 * The approach system). Five dials over the coach's allowed bands: the
 * band is the plan, the thumb is your intent, and the distance between
 * them is priced live with the same arithmetic the sim grades by
 * (approach.ts deviationFrom: overflow beyond the band, doubled,
 * capped at 100).
 */
import { registerScreen, store } from '../../app.js';
import { api } from '../../api.js';
import { el, ledger, toast } from '../../ui.js';
import { stamp, signed, errorBox, plainTable } from './widgets.js';

const DIALS = [
  ['assertiveness', 'assertiveness', 'defer', 'take over'],
  ['range', 'range', 'inside the offense', 'let it fly'],
  ['motor', 'motor', 'conserve', 'empty the tank'],
  ['defense', 'defense', 'solid', 'gambling'],
  ['playmaking', 'playmaking', 'hunt yours', 'extra pass'],
];

/** Mirror of approach.ts deviationFrom: overflow x2, capped 0..100. */
function deviation(plan, card) {
  let overflow = 0;
  for (const [dial] of DIALS) {
    const [lo, hi] = plan[dial];
    const v = card[dial];
    overflow += Math.max(0, lo - v, v - hi);
  }
  return Math.max(0, Math.min(100, Math.round(overflow * 2)));
}

function weekOf(gameId) {
  const m = /-w(\d+)-/.exec(gameId);
  return m ? `w${m[1]}` : gameId;
}

registerScreen('career-plan', {
  title: 'My Game',
  nav: true,
  mode: 'career',
  async render(root) {
    const view = await api.careerPlan();
    const coach = view.coach;
    const card = { ...(view.nextApproach ?? view.approach) };
    let playingHurt = Boolean(view.nextApproach?.playingHurt);

    // ---- deviation readout ----
    const devLine = el('div', { class: 'deviation-line' });
    const renderDev = () => {
      const d = deviation(view.plan, card);
      const read = d === 0 ? 'inside the plan'
        : d <= 15 ? 'a stretch the coach can live with'
        : d <= 40 ? 'off script; the grade will say so'
        : 'his plan or yours, not both';
      devLine.className = `deviation-line${d > 40 ? ' hot' : d > 15 ? ' warm' : ''}`;
      devLine.replaceChildren(el('b', {}, `deviation ${d}`), ` · ${read}`);
    };

    // ---- the dials ----
    const dialRows = DIALS.map(([dial, label, loWord, hiWord]) => {
      const [lo, hi] = view.plan[dial];
      const val = el('span', { class: 'dial-val' }, String(card[dial]));
      return el('div', { class: 'dial-row' },
        el('span', { class: 'dial-name', title: `${loWord} (0) to ${hiWord} (100)` }, label),
        val,
        el('div', { class: 'dial-wrap' },
          el('div', { class: 'dial-track' }),
          el('div', { class: 'dial-band', style: `left:${lo}%;width:${Math.max(1, hi - lo)}%`, title: `the plan: ${lo}-${hi}` }),
          el('input', {
            type: 'range', class: 'dial', min: 0, max: 100, value: card[dial],
            oninput: (e) => { card[dial] = Number(e.target.value); val.textContent = e.target.value; renderDev(); },
          }),
        ),
        el('span', { class: 'dial-range-label' }, `${lo}-${hi}`),
      );
    });
    renderDev();

    // ---- playing hurt ----
    const injuryLabel = store.career?.me?.injury?.label;
    const hurtRow = view.playingHurtAvailable
      ? el('label', { style: 'display:flex;align-items:center;gap:8px;font-size:13px;margin:10px 0;color:var(--bad)' },
          el('input', {
            type: 'checkbox', style: 'min-width:0',
            checked: playingHurt ? true : undefined,
            onchange: (e) => { playingHurt = e.target.checked; },
          }),
          `gut it out${injuryLabel ? ` (${injuryLabel})` : ''}: dulled dials tonight, and the wear model keeps the receipt`)
      : null;

    // ---- submit ----
    const errBox = el('div');
    const saveBtn = el('button', {
      onclick: async () => {
        errBox.replaceChildren();
        saveBtn.disabled = true;
        try {
          const result = await api.careerChoice({ kind: 'setApproach', card: { ...card }, playingHurt });
          if (!result.ok) { errBox.replaceChildren(errorBox(result.errors)); return; }
          await store.refresh();
          toast('the card is set for the next game');
        } catch (err) {
          errBox.replaceChildren(errorBox([err.message]));
        } finally {
          saveBtn.disabled = false;
        }
      },
    }, 'set the approach');

    const clock = coach.roleClock ?? { above: 0, below: 0 };
    const clockLine = clock.above > 0
      ? `role clock: ${clock.above} straight above the band; sustained production forces a role response`
      : clock.below > 0
        ? `role clock: ${clock.below} straight below the band`
        : 'role clock: even';

    root.replaceChildren(
      el('h1', { class: 'doc' }, 'my game'),
      el('div', { class: 'doc-sub' },
        `${coach.name} (${coach.personality}) has you at ${coach.role} · trust ${Math.round(coach.trust)} `,
        coach.greenLight ? el('span', { class: 'gl-chip' }, 'green light') : null),
      el('div', { class: 'cols c2' },
        el('div', {},
          ledger('the card', 'the band is his plan; the thumb is yours'),
          el('div', { class: 'card' },
            ...dialRows,
            devLine,
            el('p', { style: 'font-size:11.5px;color:var(--ink-faint);margin:6px 0 10px' },
              `${clockLine}. adherence plus production widens the band; the dials move what you attempt, never what you can do.`),
            hurtRow,
            errBox,
            saveBtn,
          ),
        ),
        el('div', {},
          ledger('the grades', 'the coach states every reason'),
          plainTable({
            columns: [
              { key: 'gameId', label: 'game', format: v => el('a', { href: `#/career-game/${v}`, title: v, style: 'color:inherit' }, weekOf(v)) },
              { key: 'adherence', label: 'adh', align: 'num', format: v => Math.round(v) },
              { key: 'production', label: 'prod', align: 'num', format: v => Math.round(v) },
              { key: 'trustDelta', label: 'trust', align: 'num', format: v => signed(v) },
              { key: 'note', label: 'the note', format: v => el('span', { style: 'font-style:italic;white-space:normal' }, `"${v}"`) },
            ],
            rows: view.grades,
            empty: 'no graded games yet. play one.',
          }),
        ),
      ),
    );
  },
});
