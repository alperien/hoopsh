/**
 * screens/career/me.js - Me, the true sheet. Attributes are the truth
 * the engine sees and ceilings stay hidden by design (docs/CAREER.md):
 * the six groups read as labeled bars, each expandable to its member
 * attributes; tendencies as the wiring diagram; the dev log quoting
 * every stated reason; the body's ledger (wear, the injury record).
 */
import { registerScreen } from '../../app.js';
import { api } from '../../api.js';
import { el, ledger } from '../../ui.js';
import { meter, signed } from './widgets.js';

const GROUPS = [
  ['phys', 'physical', ['speed', 'accel', 'strength', 'vertical', 'lateral', 'stamina']],
  ['scoring', 'scoring', ['finishing', 'midRange', 'three', 'freeThrow', 'drawFoul']],
  ['playmaking', 'playmaking', ['ballHandle', 'passAcc', 'passVision']],
  ['defense', 'defense', ['perimeterD', 'interiorD', 'steal', 'block', 'contestSkill']],
  ['rebounding', 'rebounding', ['offReb', 'defReb', 'boxout']],
  ['mental', 'mental', ['decisions', 'consistency']],
];

const ATTR_WORDS = {
  speed: 'speed', accel: 'acceleration', strength: 'strength', vertical: 'vertical',
  lateral: 'lateral quickness', stamina: 'stamina',
  finishing: 'finishing', midRange: 'mid-range', three: 'three', freeThrow: 'free throw',
  drawFoul: 'drawing fouls',
  ballHandle: 'handle', passAcc: 'pass accuracy', passVision: 'vision',
  perimeterD: 'perimeter D', interiorD: 'interior D', steal: 'steal', block: 'block',
  contestSkill: 'contests',
  offReb: 'offensive glass', defReb: 'defensive glass', boxout: 'boxing out',
  decisions: 'decisions', consistency: 'consistency',
};

const TENDS = [
  ['shotRim', 'shots at the rim'], ['shotMid', 'mid-range diet'], ['shotThree', 'three diet'],
  ['pullUp', 'pull-up habit'], ['drive', 'drive appetite'], ['passOut', 'gives it up'],
  ['iso', 'iso calls'], ['post', 'post-ups'], ['offBallMotion', 'off-ball motion'],
  ['crashOffReb', 'crashes the glass'], ['gambleSteal', 'gambles for steals'],
  ['foulAggr', 'plays physical'], ['pushPace', 'pushes pace'], ['usage', 'usage load'],
];

function groupBlock(id, label, keys, attr) {
  const vals = keys.map(k => attr[k] ?? 0);
  const mean = Math.round(vals.reduce((s, v) => s + v, 0) / Math.max(1, vals.length));
  return el('details', { class: 'attr-group' },
    el('summary', { class: 'ag-head' },
      el('span', { class: 'ag-name' }, label),
      el('div', { class: 'ag-meter' }, meter(mean)),
    ),
    el('div', { class: 'ag-body' },
      keys.map(k => el('div', { class: 'attr-row' },
        el('span', { class: 'ar-name' }, ATTR_WORDS[k] ?? k),
        el('div', { class: 'ar-meter' }, meter(attr[k] ?? 0)),
      ))),
  );
}

/** Sum devLog deltas per group for the newest season on the log. */
function seasonGrowth(devLog) {
  if (!devLog.length) return null;
  const season = Math.max(...devLog.map(d => d.date.season));
  const sums = {};
  for (const note of devLog) {
    if (note.date.season !== season) continue;
    for (const [group, delta] of Object.entries(note.deltas ?? {})) {
      sums[group] = (sums[group] ?? 0) + delta;
    }
  }
  return { season, sums };
}

function devStamp(date) {
  return `s${date.season} d${date.day}`;
}

function devRow(note) {
  const chips = Object.entries(note.deltas ?? {})
    .filter(([, v]) => v !== 0)
    .map(([g, v]) => el('span', { class: 'dev-chip' }, `${g} `, signed(v)));
  return el('div', { class: 'evt' },
    el('span', { class: 'stamp' }, devStamp(note.date)),
    (note.reasons ?? []).join('; '),
    chips.length ? el('span', { class: 'dev-chips' }, chips) : null,
  );
}

function injuryRow(inj) {
  return el('div', { class: 'evt' },
    el('span', { class: 'stamp' }, `s${inj.startedOn?.season ?? '?'}`),
    `${inj.label} (${inj.severity}, ${inj.outDays} day${inj.outDays === 1 ? '' : 's'})`,
  );
}

registerScreen('career-me', {
  title: 'Me',
  nav: true,
  mode: 'career',
  async render(root) {
    const me = await api.careerMe();
    if (!me || !me.attr) {
      root.replaceChildren(
        el('h1', { class: 'doc' }, 'me'),
        el('div', { class: 'empty' }, 'no career loaded. ',
          el('a', { href: '#/career-new' }, 'create him'), '.'),
      );
      return;
    }

    const growth = seasonGrowth(me.devLog ?? []);
    const growthChips = growth
      ? GROUPS
        .map(([id, label]) => [label, growth.sums[id] ?? 0])
        .filter(([, v]) => v !== 0)
        .map(([label, v]) => el('span', { class: 'dev-chip' }, `${label} `, signed(v)))
      : [];

    const sig = me.creation?.signatures?.length ? me.creation.signatures.join(', ') : null;

    root.replaceChildren(
      el('h1', { class: 'doc' }, me.name),
      el('div', { class: 'doc-sub' },
        `${me.pos} · ${me.heightLabel}, ${me.weightLb} lb · age ${me.age}` +
        (me.creation?.birthplace ? ` · ${me.creation.birthplace}` : '') +
        (sig ? ` · ${sig}` : '')),
      el('div', { class: 'cols c2' },
        el('div', {},
          ledger('the sheet', 'the truth the engine sees'),
          el('div', { class: 'growth-strip' },
            el('span', { class: 'gs-word' }, 'growth this season'),
            growthChips.length ? growthChips
              : el('span', { style: 'color:var(--ink-faint)' }, 'no movement yet'),
          ),
          GROUPS.map(([id, label, keys]) => groupBlock(id, label, keys, me.attr)),
          ledger('tendencies', 'the wiring, not the skill'),
          el('div', { class: 'tend-grid' },
            TENDS.filter(([k]) => me.tend[k] !== undefined).map(([k, label]) =>
              el('div', { class: 'tend-row' },
                el('span', { class: 'tr-name' }, label),
                el('span', { class: 'tr-val' }, String(Math.round(me.tend[k]))),
              ))),
        ),
        el('div', {},
          ledger('the body'),
          el('div', { class: 'card', style: 'margin-bottom:10px' },
            el('div', { style: 'display:flex;align-items:center;gap:8px' },
              el('span', { style: 'font-size:11.5px;color:var(--ink-faint);width:44px' }, 'wear'),
              el('div', { style: 'flex:1' }, meter(me.health.wear)),
            ),
            el('div', { style: 'font-size:11.5px;color:var(--ink-faint);margin-top:3px' },
              'accumulated mileage; it raises the hazard and hurries the ageing'),
            me.health.injury ? el('div', { style: 'font-size:12.5px;color:var(--bad);margin-top:6px' },
              `now: ${me.health.injury.label}, ${me.health.injury.remainingDays} day${me.health.injury.remainingDays === 1 ? '' : 's'} left`) : null,
            el('div', { style: 'margin-top:8px' },
              el('b', { style: 'font-size:12px' }, 'the injury record'),
              me.health.history?.length
                ? el('div', {}, me.health.history.slice().reverse().map(injuryRow))
                : el('div', { class: 'empty', style: 'padding:6px 0' }, 'clean, so far'),
            ),
          ),
          ledger('the dev log', 'every review, reasons stated'),
          me.devLog?.length
            ? el('div', {}, me.devLog.slice().reverse().map(devRow))
            : el('div', { class: 'empty' }, 'no reviews on file yet'),
        ),
      ),
    );
  },
});
