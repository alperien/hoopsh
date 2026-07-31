/**
 * save-guard.test.ts
 *
 * Both save routes must 409 while their respective sim loop is running.
 * Without the guard a mid-run save serializes a torn mid-week (or mid-day)
 * state: allocation debited but games unplayed, double-charge on reload.
 * This is the test that was missing when the CRITICAL was filed
 * (findings/career-app.md #1 on branch review/optimization-audit).
 *
 * Red on unfixed code: the routes return 200 and write a corrupted save.
 * Green on fixed code: the routes return 409 with { error: 'a sim is running' }.
 *
 * The test injects minimal truthy stubs directly into the AppState that
 * startServer exposes as `state: unknown`. No real career or league is
 * created; the worker pool is never called.
 */
import { describe, it, expect } from 'vitest';
import { startServer } from '../src/server.js';

describe('save routes 409 while sim is running', () => {
  it('/api/career/save: 409 while careerSim.running', async () => {
    const svr = await startServer({ port: 0 });
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
    try {
      const res = await fetch(`http://localhost:${svr.port}/api/career/save`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      expect(res.status).toBe(409);
      const body = await res.json() as { error?: string };
      expect(body.error).toContain('sim is running');
    } finally {
      svr.close();
    }
  });

  it('/api/save: 409 while sim.running', async () => {
    const svr = await startServer({ port: 0 });
    const st = svr.state as {
      career: unknown;
      league: unknown;
      sim: { running: boolean };
    };
    // career must stay null so the "career saves through /api/career/save"
    // guard does not fire; the test is specifically about sim.running.
    st.league = { season: 0, day: 0 };   // truthy — passes the !league guard
    st.sim.running = true;
    try {
      const res = await fetch(`http://localhost:${svr.port}/api/save`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      expect(res.status).toBe(409);
      const body = await res.json() as { error?: string };
      expect(body.error).toContain('sim is running');
    } finally {
      svr.close();
    }
  });
});
