/**
 * screens/career/game.js - the circuit game center, in the telecast
 * register (the pattern of screens/game.js): scorebug, the two-voice
 * ticker with spoiler discipline, both box scores with my line inked,
 * key plays, the coach's grade, and the baked 2D viewer in a new tab.
 */
import { registerScreen, store } from '../../app.js';
import { api } from '../../api.js';
import { el } from '../../ui.js';
import { plusMinus } from '../../format.js';
import { personName, signed } from './widgets.js';

function fmtClock(period, secs) {
  const s = Math.max(0, Math.round(secs));
  const label = period <= 4 ? `Q${period}` : period === 5 ? 'OT' : `${period - 4}OT`;
  return `${label} ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function bugSide(name, pts, right, hidden, colors) {
  const bits = [
    el('span', { class: 'bar', style: `background:${colors ?? '#3a4252'}` }),
    el('span', { class: 'abbrev', style: 'font-size:14px' }, name),
    el('span', { class: 'pts' }, hidden ? '--' : String(pts)),
  ];
  return el('div', { class: `side ${right ? 'away' : ''}` }, right ? bits.reverse() : bits);
}

function boxTable(caption, lines, names, meId) {
  const rows = lines.slice().sort((a, b) => (b.starter ? 1 : 0) - (a.starter ? 1 : 0) || b.min - a.min);
  return el('table', { class: 'grid' },
    el('caption', {}, caption),
    el('thead', {}, el('tr', {},
      ['player', 'min', 'pts', 'reb', 'ast', 'stl', 'blk', 'to', 'fg', '3p', 'ft', '+/-'].map((h, i) =>
        el('th', { class: i > 0 ? 'num' : undefined }, h)))),
    el('tbody', {}, rows.map(l => el('tr', { class: l.playerId === meId ? 'my-row' : undefined },
      el('td', {},
        personName(names[l.playerId], l.playerId),
        l.starter ? el('span', { class: 'sub' }, ' · start') : null),
      el('td', { class: 'num' }, String(Math.round(l.min))),
      el('td', { class: 'num' }, String(l.pts)),
      el('td', { class: 'num' }, String(l.orb + l.drb)),
      el('td', { class: 'num' }, String(l.ast)),
      el('td', { class: 'num' }, String(l.stl)),
      el('td', { class: 'num' }, String(l.blk)),
      el('td', { class: 'num' }, String(l.tov)),
      el('td', { class: 'num' }, `${l.fgm}-${l.fga}`),
      el('td', { class: 'num' }, `${l.tpm}-${l.tpa}`),
      el('td', { class: 'num' }, `${l.ftm}-${l.fta}`),
      el('td', { class: 'num' }, el('span', { class: l.plusMinus > 0 ? 'up' : l.plusMinus < 0 ? 'down' : '' }, plusMinus(l.plusMinus))),
    ))),
  );
}

function totalsLine(t) {
  return el('div', { class: 'totals-line' },
    `fg ${t.fgm}-${t.fga} · 3p ${t.tpm}-${t.tpa} · ft ${t.ftm}-${t.fta} · reb ${t.orb + t.drb} · ast ${t.ast} · to ${t.tov} · fastbreak ${t.fastbreakPts}`);
}

registerScreen('career-game', {
  title: 'Game',
  nav: false,
  mode: 'career',
  async render(root, params) {
    const gameId = params[0];
    const game = await api.careerGame(gameId);

    // the view names teams but keys lines by raw circuit team ids; match
    // each id group to the home/away side by its scored points
    const byTeam = new Map();
    for (const l of game.lines) {
      if (!byTeam.has(l.teamId)) byTeam.set(l.teamId, []);
      byTeam.get(l.teamId).push(l);
    }
    const groups = [...byTeam.values()];
    const pts = (list) => list.reduce((s, l) => s + l.pts, 0);
    const homeLines = groups.find(g => pts(g) === game.final[0]) ?? groups[0] ?? [];
    const awayLines = groups.find(g => g !== homeLines) ?? [];

    const myColors = store.career?.team && (store.career.team.name === game.home || store.career.team.name === game.away)
      ? store.career.team.colors[0] : null;
    const mineIsHome = store.career?.team?.name === game.home;

    let spoiled = !game.hasBroadcast;
    const bug = el('div', { class: 'scorebug final' });
    const renderBug = () => {
      bug.replaceChildren(
        bugSide(game.home, game.final[0], false, !spoiled, mineIsHome ? myColors : null),
        el('div', { class: 'clock' },
          el('b', {}, spoiled ? 'FINAL' : 'LIVE'),
          `${game.away} at ${game.home}` + (spoiled && game.ot > 0 ? ` · ${game.ot === 1 ? 'OT' : `${game.ot}OT`}` : ''),
        ),
        bugSide(game.away, game.final[1], true, !spoiled, !mineIsHome && myColors ? myColors : null),
      );
    };
    renderBug();

    const below = el('div');
    const renderBelow = () => {
      // null marks a section that does not render (pre-spoiler, or absent
      // data). replaceChildren is raw DOM and, unlike el(), does not filter:
      // it coerces null to the literal text "null". Four of them printed
      // under the scorebug (issue #214, the career chair's #190). Collect,
      // filter, then hand the DOM only what exists.
      const sections = [
        spoiled && game.grade ? el('div', { class: 'grade-card' },
          el('b', {}, 'the grade'),
          el('div', { class: 'gc-nums' },
            el('span', {}, `adherence ${Math.round(game.grade.adherence)}`),
            el('span', {}, `production ${Math.round(game.grade.production)}`),
            el('span', {}, 'trust ', signed(game.grade.trustDelta))),
          el('div', { class: 'gc-note' }, `"${game.grade.note}"`),
        ) : null,
        spoiled ? el('div', { class: 'cols c2', style: 'grid-template-columns:1fr 1fr;gap:14px;margin-top:14px' },
          el('div', {}, boxTable(game.home, homeLines, game.names, game.me), totalsLine(game.totals[0])),
          el('div', {}, boxTable(game.away, awayLines, game.names, game.me), totalsLine(game.totals[1])),
        ) : null,
        spoiled && game.keyPlays.length
          ? el('div', { style: 'margin-top:12px' },
              el('b', { style: 'font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#7f8794' }, 'turning points'),
              ...game.keyPlays.map(k => el('div', { class: 'cue', style: 'padding:3px 6px' },
                el('span', { class: 't' }, k.clock), k.text)))
          : null,
        // the crew line (realism wave): NBA games carry named officials
        spoiled && game.officials
          ? el('div', { style: 'margin-top:10px;font-size:12px;color:#7f8794;letter-spacing:.02em' },
              `Crew: ${game.officials.crew.join(', ')}`)
          : null,
      ];
      below.replaceChildren(...sections.filter(s => s !== null));
    };
    renderBelow();

    // the broadcast ticker (career cues carry speaker + numeric clock)
    const ticker = el('div', { class: 'ticker' });
    let cues = null;
    let timer = null;
    let idx = 0;
    const stopTicker = () => { if (timer) { clearInterval(timer); timer = null; } };
    const finish = () => { stopTicker(); spoiled = true; renderBug(); renderBelow(); };
    const step = () => {
      if (!cues || idx >= cues.length) { finish(); return; }
      const cue = cues[idx++];
      ticker.append(el('div', { class: `cue ${cue.speaker === 'color' ? 'color' : ''}` },
        el('span', { class: 't' }, fmtClock(cue.period, cue.clock)), cue.text));
      ticker.scrollTop = ticker.scrollHeight;
    };
    const play = async (speed) => {
      if (!cues) {
        try { cues = (await api.careerBroadcast(gameId)).cues; }
        catch (err) { ticker.append(el('div', { class: 'cue' }, `no broadcast: ${err.message}`)); return; }
      }
      stopTicker();
      timer = setInterval(step, speed);
    };

    const controls = game.hasBroadcast
      ? el('div', { class: 'controls' },
          el('button', { onclick: () => play(320) }, 'play broadcast'),
          el('button', { onclick: () => play(80) }, '4x'),
          el('button', { onclick: () => play(20) }, '16x'),
          el('button', { onclick: () => { if (!cues) { finish(); } else { while (idx < cues.length) step(); finish(); } } }, 'skip to final'),
        )
      : null;

    const viewerControls = game.hasReplay
      ? el('div', { class: 'controls' },
          el('a', {
            class: 'btn', target: '_blank', rel: 'noopener',
            href: `/api/career/game/${gameId}/viewer`,
            style: 'background:#232833;text-decoration:none;display:inline-block',
          }, 'open the 2D replay in a new tab'),
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
