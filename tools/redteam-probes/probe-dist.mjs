import { simulateGame } from '/agent/wt-narration/packages/engine/src/index.ts';
import { sampleMatchup } from '/agent/wt-narration/packages/data/src/index.ts';
const dist = new Map(); const attrs = [];
const { home, away } = sampleMatchup();
const players = new Map();
for (const t of [home, away]) for (const p of t.players) players.set(p.id, p);
for (const g of [0,1]) {
  const r = simulateGame({ seed: `probe-dist-${g}`, home, away, collectFrames: false });
  for (const e of r.events) {
    if (e.type !== 'shot') continue;
    const key = `${e.three ? 'THREE' : e.zone} ${Math.round(e.distFt)}ft ${e.moveType}`;
    dist.set(key, (dist.get(key) ?? 0) + 1);
    if (!e.three) {
      const p = players.get(e.shooter);
      attrs.push({ d: e.distFt, mv: e.moveType, made: e.made, v: p.attr.vertical, f: p.attr.finishing, z: e.zone });
    }
  }
}
console.log([...dist.entries()].sort((a,b)=>b[1]-a[1]).slice(0,30).map(x=>x.join(' x')).join('\n'));
const rim = attrs.filter(a=>a.z==='rim'), paint = attrs.filter(a=>a.z==='paint');
console.log('--- rim attempts:', rim.length, 'paint:', paint.length, 'mid:', attrs.length-rim.length-paint.length);
console.log('rim by move:', JSON.stringify(Object.fromEntries(['drive','catch_shoot','pull_up','post','putback','heave','cut_finish'].map(m=>[m, rim.filter(a=>a.mv===m).length]))));
console.log('paint by move:', JSON.stringify(Object.fromEntries(['drive','catch_shoot','pull_up','post','putback','heave','cut_finish'].map(m=>[m, paint.filter(a=>a.mv===m).length]))));
console.log('rim d<=2.5:', rim.filter(a=>a.d<=2.5).length, ' d<=1.5:', rim.filter(a=>a.d<=1.5).length);
const score = a => 0.6*a.v + 0.4*a.f;
console.log('rim score>=70 share:', (rim.filter(a=>score(a)>=70).length/rim.length).toFixed(2), 'score>=75:', (rim.filter(a=>score(a)>=75).length/rim.length).toFixed(2), 'score>=65:', (rim.filter(a=>score(a)>=65).length/rim.length).toFixed(2));
console.log('vertical values on rosters:', [...new Set([...players.values()].map(p=>p.attr.vertical))].sort((x,y)=>x-y).join(','));
