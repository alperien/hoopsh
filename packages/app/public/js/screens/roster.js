/**
 * screens/roster.js - your roster and rotation. The dense table is the
 * product; rotation minutes edit inline like the coach's whiteboard.
 */
import { registerScreen, store, navigate } from '../app.js';
import { api } from '../api.js';
import { el, grade, ledger, table, toast } from '../ui.js';
import { money, pct } from '../format.js';

function minutesInput(row, rotation) {
  const input = el('input', {
    type: 'number', min: '0', max: '44', step: '1',
    value: rotation.minutes[row.id] ?? '',
    placeholder: 'coach',
    style: 'min-width:64px;width:64px;padding:3px 6px;font-size:12.5px',
  });
  input.addEventListener('change', () => {
    const v = input.value.trim();
    if (v === '') delete rotation.minutes[row.id];
    else rotation.minutes[row.id] = Math.max(0, Math.min(44, Number(v)));
  });
  return input;
}

registerScreen('roster', {
  title: 'Roster',
  nav: 'Roster', navKey: 'r',
  async render(root) {
    const view = await api.team(store.summary.userTeam);
    const team = view.team;
    const rotation = structuredClone(team.rotation);
    const starterSet = new Set(rotation.starters);

    const totalMinutes = () => Object.values(rotation.minutes).reduce((s, v) => s + v, 0);

    const starToggle = (row) => {
      const btn = el('button', {
        class: 'quiet',
        style: 'padding:1px 8px;font-size:11px',
        onclick: (e) => {
          e.stopPropagation();
          if (starterSet.has(row.id)) starterSet.delete(row.id);
          else if (starterSet.size < 5) starterSet.add(row.id);
          else { toast('five starters; sit one first', true); return; }
          rotation.starters = [...starterSet];
          e.target.textContent = starterSet.has(row.id) ? 'starting' : 'bench';
          e.target.style.fontWeight = starterSet.has(row.id) ? '700' : '400';
        },
      }, starterSet.has(row.id) ? 'starting' : 'bench');
      if (starterSet.has(row.id)) btn.style.fontWeight = '700';
      return btn;
    };

    const saveRotation = async () => {
      rotation.starters = [...starterSet];
      const result = await api.action({ kind: 'setRotation', rotation }).catch(e => ({ ok: false, errors: [e.message] }));
      if (result.ok) toast('rotation set');
      else toast(result.errors.join('; '), true);
    };

    root.replaceChildren(
      el('h1', { class: 'doc' }, `${team.city} ${team.name}`),
      el('div', { class: 'doc-sub' },
        `${view.standings.w}-${view.standings.l} · payroll ${money(view.cap.total)} against a ${money(view.cap.cap)} cap` +
        (view.cap.overTax ? ` · into the tax for ${money(view.cap.taxBill)}` : '')),
      ledger('rotation', 'targets renormalize to 240 on game night'),
      table({
        columns: [
          { key: 'name', label: 'player', format: (v, r) => el('span', {}, v, ' ', el('span', { class: 'sub' }, r.injuryLabel ?? '')) },
          { key: 'pos', label: 'pos', format: v => el('span', { class: 'pos-chip' }, v) },
          { key: 'age', label: 'age', align: 'num' },
          { key: 'ovr', label: 'grade', align: 'num', format: v => grade(v) },
          { key: 'starter', label: 'role', format: (v, r) => starToggle(r), sortValue: r => (starterSet.has(r.id) ? 1 : 0) },
          { key: 'minutes', label: 'min target', align: 'num', format: (v, r) => minutesInput(r, rotation), sortValue: r => rotation.minutes[r.id] ?? -1 },
          { key: 'perGame', label: 'pts', align: 'num', format: v => v.pts ?? '-', sortValue: r => r.perGame.pts ?? -1 },
          { key: 'reb', label: 'reb', align: 'num', format: (v, r) => r.perGame.reb ?? '-', sortValue: r => r.perGame.reb ?? -1 },
          { key: 'ast', label: 'ast', align: 'num', format: (v, r) => r.perGame.ast ?? '-', sortValue: r => r.perGame.ast ?? -1 },
          { key: 'fg', label: 'fg%', align: 'num', format: (v, r) => r.perGame.fgPct !== undefined ? pct(r.perGame.fgPct) : '-', sortValue: r => r.perGame.fgPct ?? -1 },
          { key: 'salary', label: 'salary', align: 'num', format: v => el('span', { class: 'money' }, money(v)) },
          { key: 'years', label: 'yrs', align: 'num' },
        ],
        rows: view.roster,
        sort: { key: 'ovr', dir: 1 },
        onRow: (row) => navigate(`/player/${row.id}`),
        caption: 'click a name for the card; grades are your staff\'s composite, not the sim\'s',
      }),
      el('div', { style: 'display:flex;gap:10px;margin-top:10px;align-items:center' },
        el('button', { onclick: saveRotation }, 'set rotation'),
        el('span', { class: 'sub', style: 'color:var(--ink-faint);font-size:12px' },
          'targeted minutes: ', el('b', {}, String(totalMinutes())), ' (leave blank to let the coach decide)'),
      ),
      ledger('cap sheet'),
      table({
        columns: [
          { key: 'playerId', label: 'player', format: (v) => view.roster.find(r => r.id === v)?.name ?? v },
          { key: 'amount', label: 'this season', align: 'num', format: v => el('span', { class: 'money' }, money(v)) },
        ],
        rows: view.cap.salaries,
        sort: { key: 'amount', dir: 1 },
        empty: 'no salaries on the books',
      }),
      el('p', { style: 'color:var(--ink-soft);font-size:12.5px' },
        `dead money ${money(view.cap.deadMoney)} · cap holds ${money(view.cap.capHolds)} · ` +
        `space ${money(view.cap.spaceWithHolds)} (holds counted) · ` +
        `apron room ${money(view.cap.apron1 - view.cap.total)}`),
    );
  },
});
