// Probe 4: endgame ON + team rebounds + jitter, combined invariants.
import { simulateGame } from '/agent/w2-redteam/packages/engine/src/index.ts';
import { sampleMatchup } from '/agent/w2-redteam/packages/data/src/index.ts';
import { boxScore } from '/agent/w2-redteam/packages/stats/src/index.ts';
import { generatePlayByPlay, makeLookup, buildBroadcastScript, formatScript, TemplateColorProvider } from '/agent/w2-redteam/packages/narration/src/index.ts';

let fail = 0;
const bad = (msg) => { fail++; console.log('  FAIL:', msg); };

for (const seed of ['rt-on-1', 'rt-on-2', 'rt-on-3']) {
  const { home, away } = sampleMatchup();
  const r = simulateGame({ seed, home, away, endgame: true, collectFrames: true });
  const ev = r.events;
  console.log(`seed ${seed}: score ${r.finalScore.join('-')}, events ${ev.length}`);

  // timeouts: budget respected, remaining strictly decrements per team, only when flag on
  const tos = ev.filter((e) => e.type === 'timeout');
  const budget = r.rules.timeoutsPerGame;
  const perTeam = [[], []];
  for (const t of tos) perTeam[t.team].push(t.remaining);
  for (const side of [0, 1]) {
    const rem = perTeam[side];
    if (rem.length > budget) bad(`team ${side} called ${rem.length} > budget ${budget}`);
    for (let i = 0; i < rem.length; i++) {
      const expect = budget - i - 1;
      if (rem[i] !== expect) bad(`team ${side} timeout #${i} remaining=${rem[i]} expected ${expect}`);
    }
    if (rem.some((x) => x < 0)) bad(`team ${side} negative remaining`);
  }
  console.log(`  timeouts: [${perTeam[0].length}, ${perTeam[1].length}] of ${budget} — reasons ${JSON.stringify(tos.map(t=>t.reason).reduce((m,x)=>(m[x]=(m[x]??0)+1,m),{}))}`);

  // score self-consistency: recompute from events
  const score = [0, 0];
  for (const e of ev) {
    if (e.type === 'shot' && e.made) score[e.team] += e.points;
    if (e.type === 'free_throw' && e.made) score[e.team] += 1;
  }
  if (score[0] !== r.finalScore[0] || score[1] !== r.finalScore[1]) bad(`event-sum score ${score} != finalScore ${r.finalScore}`);

  // box score balances: team pts equals summed player pts? (team rebounds mean TRB may exceed player sum — that's the design)
  const box = boxScore(ev, [home, away]);
  for (const side of [0, 1]) {
    const t = box.teams[side];
    const pSum = box.players.filter((p) => p.team === side).reduce((s, p) => s + p.pts, 0);
    if (pSum !== t.pts) bad(`side ${side}: player pts ${pSum} != team pts ${t.pts}`);
    if (t.pts !== r.finalScore[side]) bad(`side ${side}: box pts ${t.pts} != final ${r.finalScore[side]}`);
    const pReb = box.players.filter((p) => p.team === side).reduce((s, p) => s + p.trb, 0);
    if (t.trb < pReb) bad(`side ${side}: team TRB ${t.trb} < player sum ${pReb}`);
  }

  // team rebounds present? playerless, non-deadBall
  const teamRebs = ev.filter((e) => e.type === 'rebound' && e.player === undefined && !e.deadBall);
  const deadFT = ev.filter((e) => e.type === 'rebound' && e.deadBall);
  if (teamRebs.some((e) => e.player !== undefined)) bad('team rebound with player?');
  console.log(`  team rebounds: ${teamRebs.length}, deadball FT formalities: ${deadFT.length}`);

  // narration: no "undefined"/"NaN"/"[object" anywhere in pbp or broadcast
  const lk = makeLookup([home, away]);
  const lines = generatePlayByPlay(ev, [home, away]);
  const text = lines.map((l) => `${l.clock ?? ''} ${l.text}`).join('\n');
  for (const tok of ['undefined', 'NaN', '[object']) {
    if (text.includes(tok)) bad(`pbp contains "${tok}": ${text.split('\n').filter((l) => l.includes(tok)).slice(0, 3).join(' || ')}`);
  }
  const script = formatScript(await buildBroadcastScript(ev, [home, away], new TemplateColorProvider(), { seed }));
  for (const tok of ['undefined', 'NaN', '[object']) {
    if (script.includes(tok)) bad(`broadcast contains "${tok}": ${script.split('\n').filter((l) => l.includes(tok)).slice(0, 3).join(' || ')}`);
  }
  // does the pbp even mention timeouts?
  const toLines = lines.filter((l) => /timeout/i.test(l.text));
  console.log(`  pbp timeout lines: ${toLines.length}${toLines[0] ? ' e.g. "' + toLines[0].text + '"' : ' <-- timeout events silently dropped from narration?'}`);
}
console.log(fail === 0 ? 'ALL ENDGAME-ON INVARIANTS PASS' : `${fail} FAILURES`);
