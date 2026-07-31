/**
 * app.js - the shell: hash router, summary store, screen registry, the
 * masthead, the advance loop, keyboard flow. Screens register themselves
 * (see screens/) and render into #content.
 *
 * SHELL CONTRACT (frozen for screen authors):
 *   registerScreen(name, { title, nav?, navKey?, mode?, render })
 *     render: async (root, params) => void
 *     mode: 'career' marks a career-chair screen. Screens without a
 *           mode are franchise screens. The rail filters by store.mode:
 *           career mode shows career screens plus the scenery screens
 *           (league, news, almanac, settings); franchise mode hides
 *           career screens.
 *   navigate(path)             location.hash sugar
 *   store.mode                 'franchise' | 'career' | null (nothing loaded)
 *   store.summary              latest Summary (franchise); store.teams: id -> team meta
 *   store.career               latest /api/career/summary payload (career mode)
 *   store.refresh()            re-pull meta + the mounted chair's summary, re-render masthead
 *   on(event, fn)              'summary' | 'sim-progress'
 *
 * Career mode notes: 'summary' fires with store.career; 'sim-progress'
 * carries CareerSimStatus (weeksDone/weeksTotal) instead of SimStatus.
 * The advance buttons post /api/career/advance and poll
 * /api/career/sim/status; the default route is '/career-week'. The
 * career screens ship as one bundle (screens/career/index.js) loaded
 * dynamically in boot(); a missing bundle never stops the franchise
 * chair from booting.
 */
import { api } from './api.js';
import { el, toast } from './ui.js';
import { recordLabel, seasonLabel } from './format.js';

const screens = new Map();
const navOrder = [];
const listeners = new Map();

/** Franchise screens that stay in the rail as scenery in career mode. */
const SCENERY = ['league', 'news', 'almanac', 'settings'];
/** Screens reachable before anything is loaded (the onboarding fork). */
const NULL_MODE_SCREENS = ['start', 'settings', 'career-new'];

export const store = {
  mode: null,      // 'franchise' | 'career' | null before anything loads
  summary: null,
  career: null,    // latest /api/career/summary payload (career mode)
  teams: {},       // teamId -> { city, name, abbrev, colors, conference, division, w, l ... }
  hasLeague: false,
  hasCareer: false,
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

function navItems() {
  if (store.mode === 'career') {
    return [
      ...navOrder.filter(item => item.mode === 'career'),
      ...navOrder.filter(item => item.mode !== 'career' && SCENERY.includes(item.name)),
    ];
  }
  return navOrder.filter(item => item.mode !== 'career');
}

function renderNav(active) {
  const nav = document.getElementById('nav');
  nav.replaceChildren(...navItems().map(item =>
    el('a', { href: `#/${item.name}`, class: active === item.name ? 'active' : undefined },
      el('span', {}, item.nav),
      item.navKey ? el('span', { class: 'key' }, item.navKey) : null,
    )));
}

/** Button labels and the key legend follow the mounted chair. */
function renderChrome() {
  const career = store.mode === 'career';
  const btn = document.getElementById('btn-advance');
  const btnW = document.getElementById('btn-advance-week');
  btn.textContent = career ? 'advance week' : 'advance day';
  btn.title = career ? 'advance one week (a)' : 'advance one day (a)';
  btnW.textContent = 'sim ahead';
  btnW.title = career
    ? 'sim ahead, stop when a decision needs you (w)'
    : 'sim to the next thing that needs you (w)';
  document.getElementById('mh-energy').hidden = !career;
  const legend = career
    ? [['a', 'advance week'], ['w', 'sim ahead'], ['s', 'save'], ['p', 'phone'],
       ['m', 'me'], ['g', 'game plan'], ['c', 'circuit'], ['j', 'journey']]
    : [['a', 'advance'], ['w', 'sim ahead'], ['s', 'save'], ['o', 'office'],
       ['r', 'roster'], ['l', 'league'], ['t', 'trade'], ['n', 'news']];
  document.getElementById('keys').replaceChildren(
    ...legend.map(([k, label]) => el('span', {}, el('b', {}, k), ` ${label}`)));
}

function renderMasthead() {
  const s = store.summary;
  if (!s) return;
  document.getElementById('mh-date').textContent = s.dateLabel;
  document.getElementById('mh-phase-label').textContent = seasonLabel(s.date.season);
  document.getElementById('mh-record-wrap').hidden = false;
  document.getElementById('mh-record-label').textContent = 'record';
  document.getElementById('mh-record').textContent = recordLabel(s.record);
  document.getElementById('mh-seed').textContent = s.record.confSeed > 0 ? `(${s.record.confSeed} seed)` : '';
  const phaseChip = document.getElementById('mh-phase');
  phaseChip.hidden = false;
  phaseChip.textContent = s.phase;
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

/** The career masthead: the clock, the body, the team, the next game. */
function renderCareerMasthead() {
  const s = store.career;
  if (!s) return;
  document.getElementById('mh-date').textContent = `week ${s.clock.week} · ${s.clock.year}`;
  document.getElementById('mh-phase-label').textContent = s.phaseLabel;
  document.getElementById('mh-phase').hidden = true;
  const recordWrap = document.getElementById('mh-record-wrap');
  if (s.team) {
    recordWrap.hidden = false;
    document.getElementById('mh-record-label').textContent = s.team.name;
    document.getElementById('mh-record').textContent = `${s.team.w}-${s.team.l}`;
    document.getElementById('mh-seed').textContent = '';
  } else {
    recordWrap.hidden = true;
  }
  const energy = document.getElementById('mh-energy');
  const value = Math.max(0, Math.min(100, Math.round(s.me?.energy ?? 0)));
  energy.hidden = false;
  energy.title = s.me?.injury
    ? `energy ${value}/100 · ${s.me.injury.label}, ${s.me.injury.weeksOut}w`
    : `energy ${value}/100`;
  energy.replaceChildren(
    el('span', {}, 'energy'),
    el('span', { class: value < 30 ? 'energy-bar low' : 'energy-bar' },
      el('i', { style: `width:${value}%` })),
    el('b', {}, String(value)),
  );
  const tonight = document.getElementById('mh-tonight');
  const g = s.nextGame;
  if (g) {
    const mineHome = s.team && g.home === s.team.name;
    tonight.replaceChildren(el('span', { class: 'tonight' },
      el('span', {}, 'next'),
      g.myGame
        ? el('span', { class: 'vs' }, mineHome ? 'vs' : 'at')
        : el('span', { class: 'team' }, g.awayAbbrev),
      g.myGame
        ? el('span', { class: 'team' }, mineHome ? g.away : g.home)
        : el('span', { class: 'vs' }, `at ${g.homeAbbrev}`),
      el('span', { class: 'vs' }, `wk ${g.week}`),
    ));
  } else {
    tonight.replaceChildren();
  }
  if (s.team?.colors?.[1]) {
    document.documentElement.style.setProperty('--team-primary', s.team.colors[0]);
    document.documentElement.style.setProperty('--team-secondary', s.team.colors[1]);
  }
  document.getElementById('league-tag').textContent = s.me ? s.me.name : 'career';
  const note = document.getElementById('rail-note');
  note.textContent = s.phoneUnread > 0
    ? `${s.phoneUnread} message${s.phoneUnread === 1 ? '' : 's'} on your phone`
    : 'phone quiet';
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
  store.hasCareer = meta.hasCareer;
  store.mode = meta.hasCareer ? 'career' : meta.hasLeague ? 'franchise' : null;
  renderChrome();
  renderNav(current.name);
  if (store.mode === 'career') {
    const [careerData, teamRows] = await Promise.all([api.careerSummary(), api.leagueStats('teams')]);
    store.career = careerData;
    store.teams = {};
    for (const row of teamRows.rows) store.teams[row.teamId] = row;
    renderCareerMasthead();
    emit('summary', store.career);
    return;
  }
  store.career = null;
  if (store.mode !== 'franchise') return;
  const [summaryData, teamRows] = await Promise.all([api.summary(), api.leagueStats('teams')]);
  store.summary = summaryData;
  store.teams = {};
  for (const row of teamRows.rows) store.teams[row.teamId] = row;
  renderMasthead();
  emit('summary', store.summary);
}
store.refresh = refresh;

// ---------------------------------------------------------------------------
// advancing time (one loop per chair, one lock between them)

let advancing = false;

function setAdvanceDisabled(disabled) {
  document.getElementById('btn-advance').disabled = disabled;
  document.getElementById('btn-advance-week').disabled = disabled;
}

async function advanceDays(days) {
  if (advancing) return;
  if (!store.hasLeague) { toast('start a league first', true); return; }
  advancing = true;
  setAdvanceDisabled(true);
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
    setAdvanceDisabled(false);
  }
}

async function advanceWeeks(weeks) {
  if (advancing) return;
  if (store.mode !== 'career') { toast('no career loaded', true); return; }
  advancing = true;
  setAdvanceDisabled(true);
  try {
    await api.careerAdvance(weeks, true);
    for (;;) {
      const status = await api.careerSimStatus();
      emit('sim-progress', status);
      if (!status.running) break;
      await new Promise(r => setTimeout(r, 300));
    }
    await refresh();
    rerender();
  } catch (err) {
    toast(err.message, true);
  } finally {
    advancing = false;
    setAdvanceDisabled(false);
  }
}

function advanceShort() {
  if (store.mode === 'career') advanceWeeks(1);
  else advanceDays(1);
}
function advanceLong() {
  if (store.mode === 'career') advanceWeeks(8);
  else advanceDays(14);
}

// ---------------------------------------------------------------------------
// router

let current = { name: null, params: null };

function defaultRoute() {
  if (store.mode === 'career') return 'career-week';
  if (store.mode === 'franchise') return 'office';
  return 'start';
}

function parseHash() {
  const raw = (location.hash || '').slice(1);
  const parts = raw.split('/').filter(Boolean);
  return { name: parts[0] ?? defaultRoute(), params: parts.slice(1) };
}

async function rerender() {
  const root = document.getElementById('content');
  const { name, params } = parseHash();
  current = { name, params };
  renderNav(name);
  root.replaceChildren(el('div', { class: 'empty' }, 'loading...'));
  try {
    if (store.mode === null && !NULL_MODE_SCREENS.includes(name)) {
      // nothing loaded: the fork owns the screen (boot.js registers it)
      const fork = screens.get('start') ?? screens.get('settings');
      renderNav('start');
      await fork.render(root, fork === screens.get('start') ? [] : ['new']);
      return;
    }
    const def = screens.get(name);
    if (!def) {
      if (name !== defaultRoute() && screens.has(defaultRoute())) {
        navigate(`/${defaultRoute()}`);
        return;
      }
      root.replaceChildren(el('div', { class: 'card' },
        el('h1', { class: 'doc' }, 'not installed'),
        el('p', {}, `no screen answers to "${name}"`),
      ));
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
// keyboard: single keys, never inside inputs; the map follows the chair

const FRANCHISE_KEYS = {
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

const CAREER_KEYS = {
  a: () => advanceWeeks(1),
  w: () => advanceWeeks(8),
  s: async () => { try { const r = await api.careerSave(); toast(`saved: ${r.name}`); } catch (e) { toast(e.message, true); } },
  p: () => navigate('/career-phone'),
  m: () => navigate('/career-me'),
  g: () => navigate('/career-plan'),
  c: () => navigate('/career-circuit'),
  j: () => navigate('/career-journey'),
  l: () => navigate('/league'),
  n: () => navigate('/news'),
};

function keymap() {
  return store.mode === 'career' ? CAREER_KEYS : FRANCHISE_KEYS;
}

export function boot() {
  window.addEventListener('hashchange', rerender);
  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const fn = keymap()[e.key];
    if (fn) { e.preventDefault(); fn(); }
  });
  document.getElementById('btn-advance').addEventListener('click', advanceShort);
  document.getElementById('btn-advance-week').addEventListener('click', advanceLong);
  document.getElementById('btn-save').addEventListener('click', () => keymap().s());
  // the career screens ship as one bundle; missing must never kill boot
  import('./screens/career/index.js')
    .catch(() => {})
    .then(() => refresh())
    .then(rerender)
    .catch(err => {
      document.getElementById('content').replaceChildren(
        el('div', { class: 'card' }, el('p', {}, `server unreachable: ${err.message}`)));
    });
}
