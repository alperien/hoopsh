import { simulateGame } from '/agent/w2-redteam/packages/engine/src/index.ts';
import { sampleMatchup } from '/agent/w2-redteam/packages/data/src/index.ts';
import { runGames } from '/agent/w2-redteam/packages/harness/src/parallel.ts';

const go = () => {
  const { home, away } = sampleMatchup();
  const r = simulateGame({ seed: 'rt-on-1', home, away, endgame: true, collectFrames: true });
  return JSON.stringify({ e: r.events, f: r.frames });
};
console.log('endgame:true same-seed rerun identical:', go() === go());

const a = JSON.stringify(await runGames({ task: 'flowEndgame', games: 4, seedBase: 'rt-fe', workers: 1 }));
const b = JSON.stringify(await runGames({ task: 'flowEndgame', games: 4, seedBase: 'rt-fe', workers: 3 }));
console.log('flowEndgame w3 vs w1:', a === b ? 'IDENTICAL' : 'DIFFERS');
