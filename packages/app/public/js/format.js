/**
 * format.js - formatters shared by every screen. Numbers are the product
 * here: money in tabular figures, percentages one decimal, heights in
 * feet-inches like a roster sheet.
 */

export function money(n) {
  if (n === 0 || n === undefined || n === null) return '-';
  const m = n / 1_000_000;
  if (Math.abs(m) >= 1) return `$${m.toFixed(m >= 20 ? 1 : 2)}M`;
  return `$${Math.round(n / 1000)}K`;
}

export function pct(n) {
  return n === undefined || Number.isNaN(n) ? '-' : `${n.toFixed(1)}%`;
}

export function plusMinus(n) {
  if (n === 0) return '0';
  return n > 0 ? `+${n}` : `${n}`;
}

export function seasonLabel(season) {
  return `${season}-${String((season + 1) % 100).padStart(2, '0')}`;
}

export function recordLabel(s) {
  return s ? `${s.w}-${s.l}` : '0-0';
}

export function streakLabel(n) {
  if (!n) return '-';
  return n > 0 ? `W${n}` : `L${-n}`;
}

export function ordinal(n) {
  const r10 = n % 10, r100 = n % 100;
  if (r10 === 1 && r100 !== 11) return `${n}st`;
  if (r10 === 2 && r100 !== 12) return `${n}nd`;
  if (r10 === 3 && r100 !== 13) return `${n}rd`;
  return `${n}th`;
}
