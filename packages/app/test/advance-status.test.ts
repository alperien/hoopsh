/**
 * /api/sim/advance status contract on a held day (#183). Draft night is
 * the one path where advanceDay returns without moving league time: the
 * user is on the clock. Before the fix, runAdvance counted every loop
 * iteration as progress and only stopped on inbox/phase, so a wedged
 * advance spun its whole request as no-ops and reported daysDone: 400
 * with the calendar unmoved, stoppedFor: 'target'. Pinned here: a held
 * day reports daysDone 0, stops immediately, and stops AS an inbox stop
 * (the re-issued clock item is the open decision the stop points at).
 */
import { rmSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { buildSeasonCalendar } from '@hoopsh/franchise';
import type { League } from '@hoopsh/franchise';
import { savesDir } from '../src/saves.js';
import { startServer } from '../src/server.js';
import { fixtureLeague, fixturePlayer } from '../../franchise/test/fixture.js';

/** TCP port 0: the OS assigns a free ephemeral port, so runs never collide. */
const EPHEMERAL_PORT = 0;

// Unique save name: runAdvance autosaves through state.saveName, and the
// fallback name would overwrite the app's real default save (the
// save-guard tests document the same hazard).
const SAVE_NAME = 'test-i183-advance-status';

/** A league whose next advance holds the day: draft night, the user on the clock. */
function pinnedLeague(): League {
  const league = fixtureLeague({ seed: 'i183-status' });
  league.calendar = buildSeasonCalendar(league.params, league.season);
  const draftIdx = league.calendar.findIndex((d) => (d.marks as string[]).includes('draftNight'));
  league.day = draftIdx;
  league.phase = 'draft';
  league.lottery = { season: league.season, order: [league.userTeam], movement: [] };
  const p = fixturePlayer('px01', null, league.season, 901);
  p.status = 'draftEligible';
  league.players['px01'] = p;
  league.draftClass.push('px01');
  return league;
}

interface StatusShape {
  running: boolean;
  daysDone: number;
  stoppedFor: string | null;
  currentDay: { season: number; day: number };
}

describe('advance status while draft night holds the day (#183)', () => {
  it('reports daysDone 0 and an inbox stop; the calendar stays put', async () => {
    const svr = await startServer({ port: EPHEMERAL_PORT });
    const st = svr.state as { league: League | null; saveName: string };
    const file = path.join(savesDir(), `${SAVE_NAME}.json`);
    rmSync(file, { force: true }); // clear debris from an earlier broken run
    st.league = pinnedLeague();
    st.saveName = SAVE_NAME;
    const draftIdx = st.league.day;
    try {
      const res = await fetch(`http://localhost:${svr.port}/api/sim/advance`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ days: 5 }),
      });
      expect(res.status).toBe(200);
      // poll until the loop settles; bounded so a regressed hang fails fast
      let status: StatusShape = { running: true, daysDone: -1, stoppedFor: null, currentDay: { season: -1, day: -1 } };
      for (let polls = 0; polls < 200 && status.running; polls++) {
        const s = await fetch(`http://localhost:${svr.port}/api/sim/status`);
        status = await s.json() as StatusShape;
        if (status.running) await new Promise((r) => setTimeout(r, 25));
      }
      expect(status.running).toBe(false);
      expect(status.daysDone).toBe(0);           // no day completed, no progress claimed
      expect(status.stoppedFor).toBe('inbox');   // never a silent 'target'
      expect(status.currentDay.day).toBe(draftIdx);
      expect(st.league!.day).toBe(draftIdx);     // the calendar did not move
      const item = st.league!.inbox.find((i) => i.id.startsWith(`draft-${st.league!.season}-pick-`));
      expect(item).toBeTruthy();
      expect(item!.resolved).toBe(false);        // the stop points at an open decision
    } finally {
      // the autosave rides runAdvance's .then; give it a beat, then clean up
      await new Promise((r) => setTimeout(r, 100));
      rmSync(file, { force: true });
      svr.close();
    }
  });
});
