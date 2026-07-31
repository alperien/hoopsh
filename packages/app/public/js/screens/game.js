/**
 * screens/game.js - game night: the telecast register. Scorebug, the
 * two-voice broadcast ticker with spoiler discipline (the final stays
 * hidden until the ticker finishes or you skip), full box score, key
 * plays, and the 2D replay viewer inline.
 */
import { registerScreen, store } from '../app.js';
import { api } from '../api.js';
import { el, chip, table } from '../ui.js';
import { plusMinus } from '../format.js';

function bugSide(teamId, pts, right, hidden) {
  const t = store.teams[teamId] ?? { abbrev: teamId, colors: ['#444', '#888'] };
  const bits = [
    el('span', { class: 'bar', style: `background:${t.colors[0]}` }),
    el('span', { class: 'abbrev' }, t.abbrev),
    el('span', { class: 'pts' }, hidden ? '--' : String(pts)),
  ];
  return el('div', { class: `side ${right ? 'away' : ''}` }, right ? bits.reverse() : bits);
}

function boxTable(game, teamId) {
  const lines = game.lines
    .filter(l => l.teamId === teamId)
    .sort((a, b) => (b.starter ? 1 : 0) - (a.starter ? 1 : 0) || b.min - a.min);
  const name = (id) => id; // ids are readable; player names ride on lines? they do not: resolve lazily
  return table({
    caption: `${store.teams[teamId]?.city ?? ''} ${store.teams[teamId]?.name ?? teamId}`,
    columns: [
      { key: 'playerId', label: 'player', format: (v, r) => el('a', { href: `#/player/${v}`, style: 'color:inherit' }, r.playerName ?? name(v), r.starter ? el('span', { class: 'sub' }, '  · start') : null) },
      { key: 'min', label: 'min', align: 'num', format: v => Math.round(v) },
      { key: 'pts', label: 'pts', align: 'num' },
      { key: 'reb', label: 'reb', align: 'num', format: (v, r) => r.orb + r.drb, sortValue: r => r.orb + r.drb },
      { key: 'ast', label: 'ast', align: 'num' },
      { key: 'stl', label: 'stl', align: 'num' },
      { key: 'blk', label: 'blk', align: 'num' },
      { key: 'tov', label: 'to', align: 'num' },
      { key: 'fg', label: 'fg', align: 'num', format: (v, r) => `${r.fgm}-${r.fga}`, sortValue: r => r.fgm },
      { key: 'tp', label: '3p', align: 'num', format: (v, r) => `${r.tpm}-${r.tpa}`, sortValue: r => r.tpm },
      { key: 'ft', label: 'ft', align: 'num', format: (v, r) => `${r.ftm}-${r.fta}`, sortValue: r => r.ftm },
      { key: 'plusMinus', label: '+/-', align: 'num', format: v => el('span', { class: v > 0 ? 'up' : v < 0 ? 'down' : '' }, plusMinus(v)) },
    ],
    rows: lines,
    sort: { key: 'pts', dir: 1 },
  });
}

registerScreen('game', {
  title: 'Game',
  async render(root, params) {
    const gameId = params[0];
    const game = await api.game(gameId);
    // resolve player names for the box from the two rosters (one call each)
    const names = {};
    for (const teamId of [game.home, game.away]) {
      try {
        const view = await api.team(teamId);
        for (const r of view.roster) names[r.id] = r.name;
      } catch { /* names fall back to ids */ }
    }
    for (const l of game.lines) l.playerName = names[l.playerId];

    let spoiled = !game.hasBroadcast; // no broadcast = nothing to protect
    const bug = el('div', { class: 'scorebug final' });
    const renderBug = () => {
      bug.replaceChildren(
        bugSide(game.home, game.final[0], false, !spoiled),
        el('div', { class: 'clock' },
          el('b', {}, spoiled ? 'FINAL' : 'LIVE'),
          `${store.teams[game.away]?.abbrev ?? game.away} at ${store.teams[game.home]?.abbrev ?? game.home}` +
          (spoiled && game.ot > 0 ? ` · ${game.ot === 1 ? 'OT' : `${game.ot}OT`}` : ''),
        ),
        bugSide(game.away, game.final[1], true, !spoiled),
      );
    };
    renderBug();

    const below = el('div');
    const renderBelow = () => {
      below.replaceChildren(
        game.recap && spoiled
          ? el('div', { style: 'margin:14px 0' },
              el('div', { class: 'byline', style: 'color:#7f8794;text-transform:uppercase;font-size:11px;letter-spacing:.06em' }, game.recap.byline),
              el('h3', { style: 'margin:2px 0 6px;font-size:19px' }, game.recap.headline),
              el('p', { style: 'color:#aeb6c2;max-width:70ch;margin:0' }, game.recap.body))
          : null,
        spoiled ? el('div', { class: 'cols c2', style: 'grid-template-columns:1fr 1fr;gap:14px;margin-top:14px' },
          boxTable(game, game.home), boxTable(game, game.away)) : null,
        spoiled && game.keyPlays.length
          ? el('div', { style: 'margin-top:12px' },
              el('b', { style: 'font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#7f8794' }, 'turning points'),
              ...game.keyPlays.map(k => el('div', { class: 'cue', style: 'padding:3px 6px' },
                el('span', { class: 't' }, k.clock), k.text)))
          : null,
      );
    };
    renderBelow();

    // the broadcast ticker
    const ticker = el('div', { class: 'ticker' });
    let cues = null;
    let timer = null;
    let idx = 0;
    let delay = 320;
    const stopTicker = () => { if (timer) { clearInterval(timer); timer = null; } };
    const finish = () => { stopTicker(); spoiled = true; renderBug(); renderBelow(); };
    const step = () => {
      if (!cues || idx >= cues.length) { finish(); return; }
      const cue = cues[idx++];
      ticker.append(el('div', { class: `cue ${cue.voice === 'color' ? 'color' : ''}` },
        el('span', { class: 't' }, cue.clock ?? ''), cue.text));
      ticker.scrollTop = ticker.scrollHeight;
    };
    const play = async (speed) => {
      if (!cues) {
        try { cues = (await api.broadcast(gameId)).cues; }
        catch (err) { ticker.append(el('div', { class: 'cue' }, `no broadcast: ${err.message}`)); return; }
      }
      stopTicker();
      delay = speed;
      timer = setInterval(step, delay);
    };

    const controls = game.hasBroadcast
      ? el('div', { class: 'controls' },
          el('button', { onclick: () => play(320) }, 'play broadcast'),
          el('button', { onclick: () => play(80) }, '4x'),
          el('button', { onclick: () => play(20) }, '16x'),
          el('button', { onclick: () => { if (!cues) { finish(); } else { while (idx < cues.length) step(); finish(); } } }, 'skip to final'),
        )
      : null;

    // the 2D replay viewer, baked server-side around this game's replay
    let frame = null;
    const viewerControls = game.hasReplay
      ? el('div', { class: 'controls' },
          el('button', {
            onclick: (e) => {
              if (frame) { frame.remove(); frame = null; e.target.textContent = 'open the 2D replay'; return; }
              frame = el('iframe', { src: `/api/game/${gameId}/viewer` });
              e.target.textContent = 'close the replay';
              e.target.closest('.broadcast').append(frame);
            },
          }, 'open the 2D replay'),
        )
      : null;

    root.replaceChildren(
      el('div', { class: 'broadcast' },
        bug,
        controls,
        ticker,
        below,
        viewerControls,
      ),
    );
  },
});
