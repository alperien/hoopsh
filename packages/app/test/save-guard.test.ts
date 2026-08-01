/**
 * Both save routes must reject writes while their sim loop is running.
 *
 * The sim mutates state across many awaits. A save taken mid-run
 * serializes a torn state: allocation debited but games unplayed.
 * Loading that save re-charges the allocation and drifts the career
 * and league clocks apart. The routes answer 409 instead.
 */
import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { savesDir } from '../src/saves.js';
import { startServer } from '../src/server.js';

/** TCP port 0: the OS assigns a free ephemeral port, so runs never collide. */
const EPHEMERAL_PORT = 0;

// Unique per-test save names. With the fallback names (my-career, my-league)
// a guard regression would make a failing test run overwrite the app's real
// default save files in out/saves/. These names turn that failure mode into
// gitignored debris instead.
const CAREER_SAVE_NAME = 'test-guard-career';
const LEAGUE_SAVE_NAME = 'test-guard-league';

describe('save routes 409 while sim is running', () => {
  it('/api/career/save: 409 while careerSim.running', async () => {
    const svr = await startServer({ port: EPHEMERAL_PORT });
    // Cast state to the minimal shape we need to poke.
    const st = svr.state as {
      career: unknown;
      careerSim: { running: boolean };
    };
    // A truthy career bypasses the "no career loaded" guard; the clock
    // spread in saveCareer will hit an empty object and produce savedAt: {},
    // which is still a valid JSON.stringify target — so without the running
    // guard the route returns 200.
    st.career = { clock: {} };
    st.careerSim.running = true;
    const file = path.join(savesDir(), `${CAREER_SAVE_NAME}.json`);
    rmSync(file, { force: true }); // clear debris from an earlier broken run
    try {
      const res = await fetch(`http://localhost:${svr.port}/api/career/save`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: CAREER_SAVE_NAME }),
      });
      expect(res.status).toBe(409);
      const body = await res.json() as { error?: string };
      expect(body.error).toContain('sim is running');
      // The rejection must also mean no write: a 409 that still saved
      // would be the torn-state hazard with a polite status code.
      expect(existsSync(file)).toBe(false);
    } finally {
      svr.close();
    }
  });

  it('/api/save: 409 while sim.running', async () => {
    const svr = await startServer({ port: EPHEMERAL_PORT });
    const st = svr.state as {
      career: unknown;
      league: unknown;
      sim: { running: boolean };
    };
    // career must stay null so the "career saves through /api/career/save"
    // guard does not fire; the test is specifically about sim.running.
    // season 0, day 0 is a league at its calendar origin; the values are
    // arbitrary here and only a regressed guard would ever read them.
    st.league = { season: 0, day: 0 }; // truthy, passes the !league guard
    st.sim.running = true;
    const file = path.join(savesDir(), `${LEAGUE_SAVE_NAME}.json`);
    rmSync(file, { force: true }); // clear debris from an earlier broken run
    try {
      const res = await fetch(`http://localhost:${svr.port}/api/save`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: LEAGUE_SAVE_NAME }),
      });
      expect(res.status).toBe(409);
      const body = await res.json() as { error?: string };
      expect(body.error).toContain('sim is running');
      expect(existsSync(file)).toBe(false);
    } finally {
      svr.close();
    }
  });
});
