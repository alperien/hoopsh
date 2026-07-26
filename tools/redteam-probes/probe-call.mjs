import { simulateGame } from '/agent/wt-narration/packages/engine/src/index.ts';
import { sampleMatchup } from '/agent/wt-narration/packages/data/src/index.ts';
import { shotCall, distPhrase } from '/agent/wt-narration/packages/narration/src/index.ts';
const { home, away } = sampleMatchup();
const players = new Map();
for (const t of [home, away]) for (const p of t.players) players.set(p.id, p);
const calls = new Map(); const twoPtCalls = new Map(); let atRim = 0; const distHist = new Map();
for (const g of [0, 1]) {
  const r = simulateGame({ seed: `probe-call-${g}`, home, away, collectFrames: false });
  for (const e of r.events) {
    if (e.type !== 'shot') continue;
    const p = players.get(e.shooter);
    const c = shotCall(e, { vertical: p.attr.vertical, finishing: p.attr.finishing });
    calls.set(c, (calls.get(c) ?? 0) + 1);
    if (!e.three) twoPtCalls.set(c, (twoPtCalls.get(c) ?? 0) + 1);
    if (distPhrase(e.distFt) === 'at rim') atRim++;
    if (e.three) { const d = Math.round(e.distFt); distHist.set(d, (distHist.get(d) ?? 0) + 1); }
  }
}
console.log('ALL calls:', JSON.stringify([...calls.entries()]));
console.log('2-pt calls:', JSON.stringify([...twoPtCalls.entries()]));
console.log('at-rim lines:', atRim);
console.log('3PT dist histogram:', [...distHist.entries()].sort((a,b)=>a[0]-b[0]).map(x=>x.join(':')).join(' '));
