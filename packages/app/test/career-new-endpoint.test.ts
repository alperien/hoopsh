/**
 * POST /api/career/new (#112): a spec that fails creation validation used
 * to escape as a throw to the server's catch-all and come back as a 500 —
 * the UI showed a server fault for a form mistake. The route must answer
 * 400 and the copy must be validateCreation's own plain language,
 * unchanged (api.js surfaces { error } verbatim as the toast).
 *
 * The career package is not touched: the app maps the fail-loud throw's
 * stable 'career/creation: invalid spec:' prefix to a status, nothing
 * more. Numbers in the fixture pin the copy end to end: groupBase 38 +
 * scoring 34 = 72 > creationGroupCap 68, while the phenom budget of 160
 * is spent exactly — the cap breach is the ONLY validation error, so the
 * whole message is deterministic.
 */
import { describe, it, expect } from 'vitest';
import { startServer } from '../src/server.js';

/** TCP port 0: the OS assigns a free ephemeral port, so runs never collide. */
const EPHEMERAL_PORT = 0;

function specWith(budget: Record<string, number>): Record<string, unknown> {
  return {
    firstName: 'Cap', lastName: 'Breaker',
    nationality: 'us', birthplace: 'Dayton, OH',
    pos: 'SG', heightIn: 77, weightLb: 196,
    background: 'aau', preset: 'phenom',
    budget, signatures: ['movement-shooter', 'downhill'],
  };
}

async function postNew(port: number, name: string, spec: unknown): Promise<Response> {
  return fetch(`http://localhost:${port}/api/career/new`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, seed: `i112-${name}`, spec }),
  });
}

describe('POST /api/career/new (#112)', () => {
  it('answers an invalid spec with 400 and the validation copy unchanged', async () => {
    const svr = await startServer({ port: EPHEMERAL_PORT });
    try {
      // 30+34+25+30+16+25 = 160 spent exactly; only scoring passes the cap
      const res = await postNew(svr.port, 'i112-cap-breach',
        specWith({ phys: 30, scoring: 34, playmaking: 25, defense: 30, rebounding: 16, mental: 25 }));
      expect(res.status).toBe(400);
      const body = await res.json() as { error: string };
      expect(body.error).toBe(
        'career/creation: invalid spec: scoring allocation of 34 puts the group at 72, over the creation cap of 68 (nobody arrives finished)');
      // the gate rejected before anything mutated: no half-created career
      const st = svr.state as { career: unknown; league: unknown };
      expect(st.career).toBe(null);
      expect(st.league).toBe(null);
    } finally {
      svr.close();
    }
  });

  it('still mounts a career on a valid spec (the 200 path is untouched)', async () => {
    const svr = await startServer({ port: EPHEMERAL_PORT });
    try {
      // same sheet, scoring back inside the cap: 30+30+25+30+20+25 = 160
      const res = await postNew(svr.port, 'i112-valid-spec',
        specWith({ phys: 30, scoring: 30, playmaking: 25, defense: 30, rebounding: 20, mental: 25 }));
      expect(res.status).toBe(200);
      const body = await res.json() as { ok: boolean };
      expect(body.ok).toBe(true);
      const st = svr.state as { career: unknown; league: unknown };
      expect(st.career).toBeTruthy();
      expect(st.league).toBeTruthy(); // the world mounts as scenery
    } finally {
      svr.close();
    }
  });
});
