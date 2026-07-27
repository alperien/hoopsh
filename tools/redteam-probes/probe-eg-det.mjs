// Usage (from repo root): node --disable-warning=ExperimentalWarning --import ./tools/register.mjs tools/redteam-probes/probe-eg-det.mjs
// Probe 3: endgame determinism — same-seed rerun byte-identical, flowEndgame worker-count invariant.
import { simulateGame } from '../../packages/engine/src/index.ts';
import { sampleMatchup } from '../../packages/data/src/index.ts';
import { runGames } from '../../packages/harness/src/parallel.ts';

const go = () => {
  const { home, away } = sampleMatchup();
  const r = simulateGame({ seed: 'rt-on-1', home, away, endgame: true, collectFrames: true });
  return JSON.stringify({ e: r.events, f: r.frames });
};
console.log('endgame:true same-seed rerun identical:', go() === go());

const a = JSON.stringify(await runGames({ task: 'flowEndgame', games: 4, seedBase: 'rt-fe', workers: 1 }));
const b = JSON.stringify(await runGames({ task: 'flowEndgame', games: 4, seedBase: 'rt-fe', workers: 3 }));
console.log('flowEndgame w3 vs w1:', a === b ? 'IDENTICAL' : 'DIFFERS');
