/**
 * screens/draft.js - the draft room: the order strip, the class table, the
 * scout memos, and the pick itself on draft night. Ranges, not numbers;
 * the fog is the game (docs/FRANCHISE.md §9).
 */
import { registerScreen, store } from '../app.js';
import { api } from '../api.js';
import { el, chip, ledger, table, toast } from '../ui.js';

const GROUPS = ['scoring', 'playmaking', 'defense', 'rebounding', 'phys', 'mental'];

let openId = null; // one memo at a time; survives the post-scout re-render

/** Highest-midpoint current group from a report, for the board column. */
function bestGroup(report) {
  if (!report) return null;
  let top = null;
  for (const g of GROUPS) {
    const range = report.current[g];
    if (!range) continue;
    const mid = (range[0] + range[1]) / 2;
    if (!top || mid > top.mid) top = { g, range, mid };
  }
  return top;
}

// copied from screens/player.js rather than imported: screens stay
// independent of each other under the shell contract
function rangeBar(label, [lo, hi]) {
  return el('div', { style: 'display:flex;align-items:center;gap:10px;margin:3px 0' },
    el('span', { style: 'width:92px;font-size:12px;color:var(--ink-soft)' }, label),
    el('span', { class: 'mono', style: 'width:58px;font-size:12px;text-align:right' }, `${Math.round(lo)}-${Math.round(hi)}`),
    el('div', { style: 'flex:1;height:6px;background:var(--rule);border-radius:2px;position:relative' },
      el('div', {
        style: `position:absolute;left:${lo}%;width:${Math.max(2, hi - lo)}%;height:6px;background:var(--accent);border-radius:2px`,
      })),
  );
}

function memoPanel(row, rerender) {
  const report = row.report;
  const groupHead = (text) => el('div', {
    style: 'margin:10px 0 4px;font-size:11.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--ink-soft)',
  }, text);

  const scoutBtn = el('button', {
    class: 'quiet',
    onclick: async () => {
      scoutBtn.disabled = true;
      try {
        const result = await api.action({ kind: 'scout', playerId: row.id, points: 20 });
        if (!result.ok) { toast(result.errors.join('; '), true); scoutBtn.disabled = false; return; }
        rerender(); // openId is still set, so the file reopens with tighter ranges
      } catch (err) {
        toast(err.message, true);
        scoutBtn.disabled = false;
      }
    },
  }, 'scout him (+20)');

  const pickBtn = store.summary.phase === 'draft'
    ? el('button', {
        onclick: async () => {
          pickBtn.disabled = true;
          try {
            const result = await api.action({ kind: 'draftPick', playerId: row.id });
            if (!result.ok) { toast(result.errors.join('; '), true); pickBtn.disabled = false; return; }
            toast(`the pick is in: ${row.name}`);
            openId = null;
            await store.refresh();
            rerender();
          } catch (err) {
            toast(err.message, true);
            pickBtn.disabled = false;
          }
        },
      }, 'call the name')
    : null;

  return el('div', { class: 'card', style: 'margin-top:10px;max-width:680px' },
    el('div', { style: 'display:flex;justify-content:space-between;align-items:baseline' },
      el('b', {}, `${row.name}, the file`),
      report ? el('span', { style: 'color:var(--ink-faint);font-size:12px' }, `coverage ${Math.round(report.coverage)}`) : null),
    report
      ? el('div', {},
          (report.role || report.comparison)
            ? el('p', { style: 'margin:6px 0;font-size:13px' },
                `${report.role || 'role unsettled'}. comparison: ${report.comparison || 'none on file'}.`)
            : null,
          groupHead('today'),
          GROUPS.map(g => (report.current[g] ? rangeBar(g, report.current[g]) : null)),
          groupHead('ceiling'),
          GROUPS.map(g => (report.ceiling[g] ? rangeBar(g, report.ceiling[g]) : null)),
          report.strengths.length ? el('p', { style: 'font-size:12.5px;margin:8px 0 0' }, el('b', {}, 'strengths: '), report.strengths.join('; ')) : null,
          report.flags.length ? el('p', { style: 'font-size:12.5px;margin:4px 0 0;color:var(--bad)' }, el('b', {}, 'flags: '), report.flags.join('; ')) : null,
        )
      : el('p', { style: 'margin:6px 0;font-size:13px;color:var(--ink-soft)' },
          'no file yet. the combine floor is all anyone knows.'),
    el('div', { style: 'display:flex;gap:8px;margin-top:12px' }, pickBtn, scoutBtn),
  );
}

function myPicksTable(picks) {
  return table({
    columns: [
      { key: 'season', label: 'season', align: 'num', sortValue: r => -r.season },
      { key: 'round', label: 'round', format: v => `R${v}` },
      { key: 'originalTeam', label: 'via', format: v => chip(store.teams, v) },
    ],
    rows: picks,
    sort: { key: 'season', dir: 1 },
    empty: 'no picks on the shelf. that is a story in itself.',
  });
}

registerScreen('draft', {
  title: 'Draft',
  nav: 'Draft', navKey: 'd',
  async render(root) {
    const board = await api.draftBoard();
    const rerender = () => this.render(root);
    const season = store.summary.date.season;

    if (board.order.length === 0) {
      root.replaceChildren(
        el('h1', { class: 'doc' }, 'the draft room'),
        el('div', { class: 'doc-sub' }, 'no class, no order, no clocks yet'),
        el('div', { class: 'empty' }, 'the lottery has not run'),
        ledger('your picks'),
        myPicksTable(board.myPicks),
      );
      return;
    }

    // slot i belongs to you when you own the round-1 pick that started life there
    const mySlot = (teamId) => board.myPicks.some(p =>
      p.round === 1 && p.season === season && p.originalTeam === teamId);

    const orderStrip = el('div', { style: 'display:flex;flex-wrap:wrap;gap:6px;margin:8px 0 4px' },
      board.order.map((teamId, i) => el('span', {
        style: 'display:inline-flex;align-items:center;gap:6px;padding:2px 7px;border-radius:2px;font-size:11.5px;background:var(--paper-raised);' +
          (mySlot(teamId) ? 'border:2px solid var(--accent);padding:1px 6px' : 'border:1px solid var(--rule-strong)'),
      },
      el('span', { class: 'mono', style: 'color:var(--ink-faint);font-size:10.5px' }, String(i + 1)),
      chip(store.teams, teamId),
      )));

    const panel = el('div');
    const openPanel = (row) => {
      if (openId === row.id) {
        openId = null;
        panel.replaceChildren();
        return;
      }
      openId = row.id;
      panel.replaceChildren(memoPanel(row, rerender));
    };

    root.replaceChildren(
      el('h1', { class: 'doc' }, 'the draft room'),
      el('div', { class: 'doc-sub' },
        store.summary.phase === 'draft' ? 'draft night. the clock only stops for you.' : 'the order is set; the homework is not'),
      ledger('the order', 'your picks carry the border'),
      orderStrip,
      ledger('the class', 'consensus from your own reports; unscouted men sink'),
      table({
        columns: [
          { key: 'name', label: 'prospect' },
          { key: 'pos', label: 'pos', format: v => el('span', { class: 'pos-chip' }, v) },
          { key: 'age', label: 'age', align: 'num' },
          { key: 'heightLabel', label: 'ht', align: 'num' },
          { key: 'origin', label: 'origin' },
          { key: 'projectedPick', label: 'projection' },
          { key: 'best', label: 'best group', format: (v, r) => {
              const b = bestGroup(r.report);
              return b ? el('span', { class: 'mono', style: 'font-size:12px' }, `${b.g} ${Math.round(b.range[0])}-${Math.round(b.range[1])}`) : el('span', { class: 'sub' }, 'unscouted');
            }, sortValue: r => bestGroup(r.report)?.mid ?? -1 },
          { key: 'conf', label: 'conf', align: 'num', format: (v, r) => (r.report ? Math.round(r.report.coverage) : '-'), sortValue: r => r.report?.coverage ?? -1 },
        ],
        rows: board.prospects,
        onRow: openPanel,
        caption: 'click a name for the file',
      }),
      panel,
    );

    if (openId) {
      const row = board.prospects.find(r => r.id === openId);
      if (row) panel.replaceChildren(memoPanel(row, rerender));
      else openId = null;
    }
  },
});
