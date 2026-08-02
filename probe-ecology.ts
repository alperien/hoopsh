/** UNTRACKED #184 diagnostic: timeline ecology at genesis and after day-0 re-evaluation. */
import { createLeague } from '@hoopsh/franchise';
import { reevaluateTimelines } from './packages/franchise/src/ai/persona.js';
import type { League } from '@hoopsh/franchise';

function count(league: League): Record<string, number> {
  const c: Record<string, number> = { contend: 0, retool: 0, rebuild: 0 };
  for (const id of Object.keys(league.teams)) {
    const t = league.teams[id]!;
    if (t.gm) c[t.strategy.timeline] = (c[t.strategy.timeline] ?? 0) + 1;
  }
  return c;
}

for (const seed of ['acceptance-1', 'acceptance-2', 'pt3-gm']) {
  const league = createLeague({ seed, userTeam: 'nye' });
  const genesis = count(league);
  reevaluateTimelines(league);
  const reevaluated = count(league);
  console.log(`${seed}: genesis=${JSON.stringify(genesis)} day0-reevaluate=${JSON.stringify(reevaluated)}`);
}
