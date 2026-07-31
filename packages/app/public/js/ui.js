/**
 * ui.js - the shared widgets. The dense sortable table is the core
 * investment: information density is respect for the player
 * (docs/FRANCHISE.md §11), so one good table serves twelve screens.
 */

/** el('div', { class: 'card', onclick: fn }, child1, 'text', ...) */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k === 'html') node.innerHTML = v;
    else node.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat()) {
    if (c === undefined || c === null || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

/** The scorebug atom: a team color block + abbrev, linking to the team. */
export function chip(teamsById, teamId, opts = {}) {
  const t = teamsById[teamId];
  if (!t) return el('span', { class: 'chip' }, teamId);
  const node = el('span', { class: 'chip', title: `${t.city} ${t.name}` },
    el('span', { class: 'swatch', style: `background:${t.colors[0]}` }),
    opts.full ? `${t.city} ${t.name}` : t.abbrev,
  );
  if (!opts.plain) {
    node.style.cursor = 'pointer';
    node.addEventListener('click', (e) => { e.stopPropagation(); location.hash = `#/team/${teamId}`; });
  }
  return node;
}

/** Numeric-first rating grade with a color tier as the secondary cue. */
export function grade(value) {
  const tier = value >= 85 ? 'g9' : value >= 75 ? 'g8' : value >= 65 ? 'g7' : value >= 50 ? 'g6' : 'g0';
  return el('span', { class: `grade ${tier}` }, String(value));
}

/**
 * table(spec) -> element. Dense, sortable, keyboard-scannable.
 * spec: {
 *   columns: [{ key, label, align?: 'num', width?, format?: (value,row)=>node|string, sortValue?: (row)=>number|string }]
 *   rows: object[]
 *   sort?: { key, dir: 1|-1 }        initial sort
 *   onRow?: (row) => void            row click (adds rowlink affordance)
 *   caption?: string
 *   empty?: string
 * }
 */
export function table(spec) {
  if (!spec.rows || spec.rows.length === 0) {
    return el('div', { class: 'empty' }, spec.empty ?? 'nothing here yet');
  }
  let sort = spec.sort ? { ...spec.sort } : null;
  const wrap = el('div');

  const value = (col, row) => (col.sortValue ? col.sortValue(row) : row[col.key]);

  const render = () => {
    const rows = spec.rows.slice();
    if (sort) {
      const col = spec.columns.find(c => c.key === sort.key);
      if (col) {
        rows.sort((a, b) => {
          const va = value(col, a), vb = value(col, b);
          if (typeof va === 'number' && typeof vb === 'number') return (vb - va) * sort.dir;
          return String(va ?? '').localeCompare(String(vb ?? '')) * -sort.dir;
        });
      }
    }
    const thead = el('tr', {}, spec.columns.map(col =>
      el('th', {
        class: col.align === 'num' ? 'num' : undefined,
        style: col.width ? `width:${col.width}` : undefined,
        onclick: () => {
          sort = sort && sort.key === col.key ? { key: col.key, dir: -sort.dir } : { key: col.key, dir: 1 };
          render();
        },
      },
      col.label,
      sort && sort.key === col.key ? el('span', { class: 'arrow' }, sort.dir === 1 ? ' ▾' : ' ▴') : null,
      )));
    const body = rows.map(row =>
      el('tr', {
        class: spec.onRow ? 'rowlink' : undefined,
        onclick: spec.onRow ? () => spec.onRow(row) : undefined,
      }, spec.columns.map(col => {
        const raw = row[col.key];
        const rendered = col.format ? col.format(raw, row) : raw;
        return el('td', { class: col.align === 'num' ? 'num' : undefined }, rendered ?? '-');
      })));
    wrap.replaceChildren(el('table', { class: 'grid' },
      spec.caption ? el('caption', {}, spec.caption) : null,
      el('thead', {}, thead),
      el('tbody', {}, body),
    ));
  };
  render();
  return wrap;
}

/** Section heading in the ledger register. */
export function ledger(text, right) {
  const h = el('h2', { class: 'ledger' }, text);
  if (right) {
    h.style.display = 'flex';
    h.style.justifyContent = 'space-between';
    h.append(el('span', { style: 'text-transform:none;letter-spacing:0;font-weight:400' }, right));
  }
  return h;
}

let toastTimer = null;
export function toast(message, isError = false) {
  const node = document.getElementById('toast');
  node.textContent = message;
  node.className = isError ? 'error' : '';
  node.style.display = 'block';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { node.style.display = 'none'; }, isError ? 6000 : 2800);
}
