/**
 * GET /api/trade/negotiations (#158): the desk's read-only window onto
 * league.negotiations. Two properties pinned:
 *
 * - FILTERED: only talks involving the user's team travel; AI-AI smoke is
 *   the news desk's beat, not the trade desk's.
 * - PURE READ: serving the stash must not mutate the league. The sibling
 *   route /api/trade/evaluate mutates negotiation memory by design
 *   (respondToOffer records the call); this one must never grow that habit,
 *   because reads happen on every desk render.
 */
import { describe, it, expect } from 'vitest';
import { startServer } from '../src/server.js';

/** TCP port 0: the OS assigns a free ephemeral port, so runs never collide. */
const EPHEMERAL_PORT = 0;

/** The route reads only userTeam and negotiations; a minimal league is honest. */
function fakeLeague(): { userTeam: string; negotiations: unknown[] } {
  const offer = {
    from: 'bka', to: 'nye',
    give: { players: ['pl-bka-1'], picks: ['2028-r1-bka'] },
    get: { players: ['pl-nye-1'], picks: [] },
  };
  return {
    userTeam: 'nye',
    negotiations: [
      { teams: ['bka', 'nye'], about: ['pl-nye-1'], lastOffer: offer, temperature: 'warm', rounds: 1, lastDate: { season: 0, day: 40 } },
      { teams: ['bos', 'phi'], about: ['pl-phi-9'], lastOffer: { ...offer, from: 'bos', to: 'phi' }, temperature: 'cold', rounds: 2, lastDate: { season: 0, day: 39 } },
    ],
  };
}

describe('GET /api/trade/negotiations', () => {
  it('serves only the user\'s talks and leaves the league byte-identical', async () => {
    const svr = await startServer({ port: EPHEMERAL_PORT });
    const st = svr.state as { league: unknown };
    st.league = fakeLeague();
    const before = JSON.stringify(st.league);
    try {
      const res = await fetch(`http://localhost:${svr.port}/api/trade/negotiations`);
      expect(res.status).toBe(200);
      const body = await res.json() as { negotiations: Array<{ teams: string[]; lastOffer: { to: string } }> };
      expect(body.negotiations.length).toBe(1); // the bos-phi smoke stayed home
      expect(body.negotiations[0]!.teams).toContain('nye');
      expect(body.negotiations[0]!.lastOffer.to).toBe('nye');
      expect(JSON.stringify(st.league)).toBe(before); // pure read
    } finally {
      svr.close();
    }
  });

  it('409s with no league loaded, like every league route', async () => {
    const svr = await startServer({ port: EPHEMERAL_PORT });
    try {
      const res = await fetch(`http://localhost:${svr.port}/api/trade/negotiations`);
      expect(res.status).toBe(409);
    } finally {
      svr.close();
    }
  });
});
