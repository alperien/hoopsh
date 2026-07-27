// Usage (from repo root): node --disable-warning=ExperimentalWarning --import ./tools/register.mjs tools/redteam-probes/probe-packs.mjs   (writes pack fixtures to /tmp/fitprobe/)
// Probe 8: packs that PASS validateTeamPack must not crash/stall simulateGame.
import { loadTeamPack, toTeamPack, cascadiaBreakers } from '../../packages/data/src/index.ts';
import { simulateGame } from '../../packages/engine/src/index.ts';
import { mkdirSync, writeFileSync } from 'node:fs';

const ATTRS = ['speed','accel','strength','vertical','lateral','stamina','finishing','midRange','three','freeThrow','drawFoul','ballHandle','passAcc','passVision','perimeterD','interiorD','steal','block','contestSkill','offReb','defReb','boxout','decisions','consistency'];
const TENDS = ['shotRim','shotMid','shotThree','pullUp','drive','passOut','iso','post','offBallMotion','crashOffReb','gambleSteal','foulAggr','pushPace','usage'];

function mkTeam(id, playerOver = {}, teamOver = {}) {
  const players = [];
  for (let i = 0; i < 8; i++) {
    players.push(Object.assign({
      id: `${id}-p${i}`, name: `P${i} ${id}`, pos: ['PG','SG','SF','PF','C'][i % 5],
      heightIn: 75, weightLb: 210,
      attr: Object.fromEntries(ATTRS.map((k) => [k, 50])),
      tend: Object.fromEntries(TENDS.map((k) => [k, 50]))
    }, structuredClone(playerOver)));
  }
  return Object.assign({
    id, name: `Team ${id}`, abbrev: id.slice(0, 3).toUpperCase(),
    players, starters: players.slice(0, 5).map((p) => p.id),
    tactics: { pace: 50, threeBias: 50, helpAggr: 50 }
  }, teamOver);
}

const variants = {
  allzero:   mkTeam('allzero', { attr: Object.fromEntries(ATTRS.map((k) => [k, 0])), tend: Object.fromEntries(TENDS.map((k) => [k, 0])) }),
  allhundred:mkTeam('allhund', { attr: Object.fromEntries(ATTRS.map((k) => [k, 100])), tend: Object.fromEntries(TENDS.map((k) => [k, 100])) }),
  zeroweight:mkTeam('zerowt', { weightLb: 0 }),
  negwingspan:mkTeam('negws', { wingspanIn: 0 }),
  tinymen:   mkTeam('tiny', { heightIn: 60 }),
  rot0:      (() => { const t = mkTeam('rotzero'); t.rotationMinutes = Object.fromEntries(t.players.map((p) => [p.id, 0])); return t; })(),
  rothuge:   (() => { const t = mkTeam('rothuge'); t.rotationMinutes = Object.fromEntries(t.players.map((p) => [p.id, 1e308])); return t; })(),
  pacezero:  mkTeam('pace0', {}, { tactics: { pace: 0, threeBias: 0, helpAggr: 0 } })
};

mkdirSync('/tmp/fitprobe', { recursive: true }); // scratch dir for the pack fixtures written below (does not ship)
let fail = 0;
for (const [name, team] of Object.entries(variants)) {
  const json = JSON.stringify(toTeamPack(team));
  writeFileSync(`/tmp/fitprobe/pack-${name}.json`, json);
  const { team: loaded, issues } = loadTeamPack(json);
  if (!loaded) { console.log(`${name}: REJECTED by validator (${issues.length} issues: ${issues[0]?.message}) — not a crash risk`); continue; }
  try {
    const opp = cascadiaBreakers();
    const r = simulateGame({ seed: `rt-pack-${name}`, home: loaded, away: opp, collectFrames: false, validate: 'strict' });
    const last = r.events[r.events.length - 1];
    console.log(`${name}: VALID pack, game completed ${r.finalScore.join('-')} (${r.events.length} events, last=${last.type})`);
    if (!Number.isFinite(r.finalScore[0]) || !Number.isFinite(r.finalScore[1])) { fail++; console.log(`  FAIL: non-finite score!`); }
  } catch (e) {
    fail++;
    console.log(`${name}: VALID pack but simulateGame THREW: ${e.message.slice(0, 160)}`);
  }
}
console.log(fail === 0 ? 'PACK BATTERY: validator boundary holds' : `${fail} CRASHES from validator-approved packs`);
