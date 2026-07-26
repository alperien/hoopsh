import { simulateGame } from '/agent/wt-narration/packages/engine/src/index.ts';
import { sampleMatchup } from '/agent/wt-narration/packages/data/src/index.ts';
const { home, away } = sampleMatchup();
const players = new Map();
for (const t of [home, away]) for (const p of t.players) players.set(p.id, p);
const rows = [];
for (const g of [0, 1]) {
  const r = simulateGame({ seed: `probe-call-${g}`, home, away, collectFrames: false });
  for (const e of r.events) {
    if (e.type !== 'shot' || e.three || !e.made || e.distFt > 3.5) continue;
    const p = players.get(e.shooter);
    rows.push({ d: e.distFt, mv: e.moveType, v: p.attr.vertical, f: p.attr.finishing, s: Math.round(0.6*p.attr.vertical+0.4*p.attr.finishing), nm: p.name });
  }
}
console.log('point-blank MAKES (<=3.5ft):', rows.length);
const byScore = {};
for (const r of rows) byScore[r.s] = (byScore[r.s] ?? 0) + 1;
console.log('athlete-score histogram:', JSON.stringify(byScore));
console.log('by dist: <=1.5:', rows.filter(r=>r.d<=1.5).length, '<=2.25:', rows.filter(r=>r.d<=2.25).length, '<=3:', rows.filter(r=>r.d<=3).length);
console.log('moveTypes:', JSON.stringify(rows.reduce((a,r)=>(a[r.mv]=(a[r.mv]??0)+1,a),{})));
console.log('sample:', rows.slice(0,8).map(r=>`${r.nm} v${r.v} f${r.f} s${r.s} ${r.d}ft ${r.mv}`).join(' | '));
