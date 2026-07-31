/**
 * screens/career/widgets.js - career-local shared widgets. The franchise
 * screens copy tiny helpers between themselves; the career chair has ten
 * screens sharing week stamps, meters, kind chips, and a row-classed
 * table, so they live here once. Career screens import this file and the
 * shell files (../../ui.js etc.); they never import each other.
 */
import { el } from '../../ui.js';

/** 'w14 \'26' - the week stamp every career surface uses. */
export function stamp(clock) {
  if (!clock) return '';
  return `w${clock.week} '${String(clock.year % 100).padStart(2, '0')}`;
}

/**
 * career-views.ts currently builds display names from player.first and
 * player.last, fields FrPlayer does not have, so names arrive as the
 * literal string 'undefined undefined'. Render the fallback until the
 * view is fixed; this helper is the single seam to delete afterward.
 */
export function personName(raw, fallback) {
  if (typeof raw === 'string' && raw.length > 0 && !raw.includes('undefined')) return raw;
  return fallback;
}

/** Event-kind chip: mono, uppercase, colored by kind via CSS. */
export function kindChip(kind) {
  return el('span', { class: 'kind-chip', 'data-kind': kind }, kind);
}

/** A meter with the number beside it. tier: 'accent' | 'energy' | fixed class. */
export function meter(value, opts = {}) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  const cls = opts.tier === 'energy' ? (v >= 60 ? 'ok' : v >= 30 ? 'low' : 'bad') : (opts.tier ?? '');
  return el('div', { class: 'meter' },
    el('div', { class: 'track' }, el('div', { class: `fill ${cls}`, style: `width:${v}%` })),
    el('span', { class: 'val' }, String(Math.round(value))),
  );
}

/** Signed, colored number: +1.2 green, -2.6 red, 0 plain. */
export function signed(n) {
  const r = Math.round(n * 10) / 10;
  const text = r > 0 ? `+${r}` : `${r}`;
  return el('span', { class: r > 0 ? 'up' : r < 0 ? 'down' : '' }, text);
}

/**
 * A plain dense table with per-row classes; the career screens need my-row
 * highlighting, which ui.js table() does not carry. No sorting: these are
 * standings and ledgers whose order IS the information.
 * spec: { columns: [{ key, label, align?, format? }], rows, rowClass?, caption?, empty? }
 */
export function plainTable(spec) {
  if (!spec.rows || spec.rows.length === 0) {
    return el('div', { class: 'empty' }, spec.empty ?? 'nothing here yet');
  }
  return el('table', { class: 'grid' },
    spec.caption ? el('caption', {}, spec.caption) : null,
    el('thead', {}, el('tr', {}, spec.columns.map(col =>
      el('th', { class: col.align === 'num' ? 'num' : undefined }, col.label)))),
    el('tbody', {}, spec.rows.map(row =>
      el('tr', { class: spec.rowClass ? spec.rowClass(row) : undefined },
        spec.columns.map(col => {
          const raw = row[col.key];
          const rendered = col.format ? col.format(raw, row) : raw;
          return el('td', { class: col.align === 'num' ? 'num' : undefined }, rendered ?? '-');
        })))),
  );
}

/** Inline error list for choice/creation results; never alert(). */
export function errorBox(errors) {
  return el('div', { class: 'form-errors' }, errors.map(e => el('div', {}, e)));
}

/** One circuit-season history card (docs/CAREER.md: the record travels). */
export function historyCard(h) {
  const pg = (v) => (h.myLine.gp ? Math.round((v / h.myLine.gp) * 10) / 10 : 0);
  const line = h.myLine.gp
    ? `${h.myLine.gp} gp · ${pg(h.myLine.pts)} pts · ${pg(h.myLine.reb)} reb · ${pg(h.myLine.ast)} ast · ${(h.myLine.fgPct * 100).toFixed(1)} fg%`
    : 'did not play';
  return el('div', { class: 'hist-card' },
    el('div', { class: 'hc-head' }, el('span', {}, `${h.year} · ${h.kind}`), el('span', {}, `${h.w}-${h.l}`)),
    el('div', { class: 'hc-team' }, h.teamName),
    el('div', { class: 'hc-line' }, line),
    el('div', { class: 'hc-head', style: 'margin-top:3px' }, el('span', {}, h.finish)),
    h.honors.length ? el('div', { class: 'hc-honors' }, h.honors.join(' · ')) : null,
  );
}
