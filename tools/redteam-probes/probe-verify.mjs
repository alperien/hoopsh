import { simulateGame } from '/agent/wt-narration/packages/engine/src/index.ts';
import { sampleMatchup } from '/agent/wt-narration/packages/data/src/index.ts';
import { boxScore } from '/agent/wt-narration/packages/stats/src/index.ts';
const { home, away } = sampleMatchup();
const r = simulateGame({ seed: 'verify-final-0', home, away, collectFrames: false });
let teamOff = 0, teamDef = 0, deadBall = 0; const threeD = new Map(); const twoD = new Map();
for (const e of r.events) {
  if (e.type === 'rebound') {
    if (e.deadBall) deadBall++;
    else if (!e.player) { if (e.offensive) teamOff++; else teamDef++; }
  }
  if (e.type === 'shot' && e.three && e.moveType !== 'heave') { const d = Math.round(e.distFt); threeD.set(d, (threeD.get(d) ?? 0) + 1); }
  if (e.type === 'shot' && !e.three && e.distFt <= 8) { const d = Math.round(e.distFt); twoD.set(d, (twoD.get(d) ?? 0) + 1); }
}
console.log('team rebounds: off', teamOff, 'def', teamDef, '| FT dead-ball formalities:', deadBall);
console.log('3PT dists:', [...threeD.entries()].sort((a,b)=>a[0]-b[0]).map(x=>x.join(':')).join(' '));
console.log('short-2 dists:', [...twoD.entries()].sort((a,b)=>a[0]-b[0]).map(x=>x.join(':')).join(' '));
const box = boxScore(r.events, r.teams);
console.log('TRB', box.teams[0].trb, box.teams[1].trb, '| final', r.finalScore.join('-'), '| poss', box.teams[0].poss, box.teams[1].poss);
