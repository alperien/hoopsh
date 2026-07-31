/**
 * app.js - the shell: hash router, summary store, screen registry, the
 * masthead, the advance loop, keyboard flow. Screens register themselves
 * (see screens/) and render into #content.
 *
 * SHELL CONTRACT (frozen for screen authors):
 *   registerScreen(name, { title, nav?, navKey?, render })
 *     render: async (root, params) => void
 *   navigate(path)             location.hash sugar
 *   store.summary              latest Summary; store.teams: id -> team meta
 *   store.refresh()            re-pull summary, re-render masthead
 *   on(event, fn)              'summary' | 'sim-progress'
 */
import { api } from './api.js';
import { el, toast } from './ui.js';
import { recordLabel, seasonLabel } from './format.js';

const screens = new Map();
const navOrder = [];
const listeners = new Map();

export const store = {
  summary: null,
  teams: {},       // teamId -> { city, name, abbrev, colors, conference, division, w, l ... }
  hasLeague: false,
};

export function on(event, fn) {
  if (!listeners.has(event)) listeners.set(event, []);
  listeners.get(event).push(fn);
}
function emit(event, payload) {
  for (const fn of listeners.get(event) ?? []) fn(payload);
}

export function registerScreen(name, def) {
  screens.set(name, def);
  if (def.nav) navOrder.push({ name, ...def });
}

export function navigate(path) {
  location.hash = path.startsWith('#') ? path : `#${path}`;
}

// ---------------------------------------------------------------------------
// masthead + rail

function renderNav(active) {
  const nav = document.getElementById('nav');
  nav.replaceChildren(...navOrder.map(item =>
    el('a', { href: `#/${item.name}`, class: active === item.name ? 'active' : undefined },
      el('span', {}, item.nav),
      item.navKey ? el('span', { class: 'key' }, item.navKey) : null,
    )));
}

function renderMasthead() {
  const s = store.summary;
  if (!s) return;
  document.getElementById('mh-date').textContent = s.dateLabel;
  document.getElementById('mh-phase-label').textContent = seasonLabel(s.date.season);
  document.getElementById('mh-record').textContent = recordLabel(s.record);
  document.getElementById('mh-seed').textContent = s.record.confSeed > 0 ? `(${s.record.confSeed} seed)` : '';
  document.getElementById('mh-phase').textContent = s.phase;
  const tonight = document.getElementById('mh-tonight');
  if (s.todayGame) {
    const opp = store.teams[s.todayGame.opponent];
    tonight.replaceChildren(el('span', { class: 'tonight' },
      el('span', {}, 'tonight'),
      el('span', { class: 'vs' }, s.todayGame.home ? 'vs' : 'at'),
      el('span', { class: 'team', style: opp ? `color:${contrastSafe(opp.colors?.[0])}` : '' },
        opp ? `${opp.city} ${opp.name}` : s.todayGame.opponent),
    ));
  } else {
    tonight.replaceChildren();
  }
  const userTeam = store.teams[s.userTeam];
  if (userTeam) {
    document.documentElement.style.setProperty('--team-primary', userTeam.colors[0]);
    document.documentElement.style.setProperty('--team-secondary', userTeam.colors[1]);
    document.getElementById('league-tag').textContent = `${userTeam.city} ${userTeam.name}`;
  }
  const inboxNote = document.getElementById('rail-note');
  inboxNote.textContent = s.inboxOpen > 0
    ? `${s.inboxOpen} item${s.inboxOpen === 1 ? '' : 's'} need${s.inboxOpen === 1 ? 's' : ''} you`
    : 'inbox clear';
}

/** Dark team colors stay readable on the dark tonight strip. */
function contrastSafe(hex) {
  if (!hex) return '#f5f6f8';
  const n = parseInt(hex.slice(1), 16);
  const lum = ((n >> 16) & 255) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114;
  return lum < 70 ? '#f5f6f8' : hex;
}

// ---------------------------------------------------------------------------
// data refresh

export async function refresh() {
  const meta = await api.meta();
  store.hasLeague = meta.hasLeague;
  if (!store.hasLeague) return;
  const [summaryData, teamRows] = await Promise.all([api.summary(), api.leagueStats('teams')]);
  store.summary = summaryData;
  store.teams = {};
  for (const row of teamRows.rows) store.teams[row.teamId] = row;
  renderMasthead();
  emit('summary', store.summary);
}
store.refresh = refresh;

// ---------------------------------------------------------------------------
// advancing time

let advancing = false;

async function advanceDays(days) {
  if (advancing) return;
  if (!store.hasLeague) { toast('start a league first', true); return; }
  advancing = true;
  const btn = document.getElementById('btn-advance');
  const btnW = document.getElementById('btn-advance-week');
  btn.disabled = true; btnW.disabled = true;
  try {
    await api.advance(days, true);
    // poll until the loop lands; digests stream into the office screen
    for (;;) {
      const status = await api.simStatus();
      emit('sim-progress', status);
      if (!status.running) break;
      await new Promise(r => setTimeout(r, 350));
    }
    await refresh();
    rerender(); // whatever screen is open re-pulls its data
  } catch (err) {
    toast(err.message, true);
  } finally {
    advancing = false;
    btn.disabled = false; btnW.disabled = false;
  }
}

// ---------------------------------------------------------------------------
// router

let current = { name: null, params: null };

function parseHash() {
  const raw = (location.hash || '#/office').slice(1);
  const parts = raw.split('/').filter(Boolean);
  return { name: parts[0] ?? 'office', params: parts.slice(1) };
}

async function rerender() {
  const root = document.getElementById('content');
  const { name, params } = parseHash();
  const def = screens.get(name) ?? screens.get('office');
  current = { name, params };
  renderNav(name);
  root.replaceChildren(el('div', { class: 'empty' }, 'loading...'));
  try {
    if (!store.hasLeague && name !== 'settings') {
      const onboarding = screens.get('settings');
      await onboarding.render(root, ['new']);
      renderNav('settings');
      return;
    }
    await def.render(root, params);
  } catch (err) {
    root.replaceChildren(el('div', { class: 'card' },
      el('h1', { class: 'doc' }, 'that did not load'),
      el('p', {}, err.message),
    ));
  }
}

// ---------------------------------------------------------------------------
// keyboard: single keys, never inside inputs

const KEYS = {
  a: () => advanceDays(1),
  w: () => advanceDays(14),
  s: async () => { try { const r = await api.save(); toast(`saved: ${r.name}`); } catch (e) { toast(e.message, true); } },
  o: () => navigate('/office'),
  r: () => navigate('/roster'),
  l: () => navigate('/league'),
  t: () => navigate('/trade'),
  n: () => navigate('/news'),
  d: () => navigate('/draft'),
  f: () => navigate('/fa'),
  c: () => navigate('/schedule'),
};

export function boot() {
  window.addEventListener('hashchange', rerender);
  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const fn = KEYS[e.key];
    if (fn) { e.preventDefault(); fn(); }
  });
  document.getElementById('btn-advance').addEventListener('click', () => advanceDays(1));
  document.getElementById('btn-advance-week').addEventListener('click', () => advanceDays(14));
  document.getElementById('btn-save').addEventListener('click', KEYS.s);
  refresh().then(rerender).catch(err => {
    document.getElementById('content').replaceChildren(
      el('div', { class: 'card' }, el('p', {}, `server unreachable: ${err.message}`)));
  });
}
