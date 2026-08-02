/**
 * Malformed JSON request bodies (#252): a body that does not parse used
 * to escape JSON.parse to the server catch-all and come back as a 500 —
 * a client's typo read as a server fault. Every JSON-body route must
 * answer 400 with one stable plain-language copy from the shared
 * ingestion point (readJsonBody in server.ts), leaving the catch-all
 * for genuine server faults.
 *
 * This is the layer BELOW #112's fix (PR #251): that one maps a
 * well-formed body carrying an invalid spec to 400. The 200 path and
 * the invalid-spec 400 path are pinned in career-new-endpoint.test.ts
 * and are deliberately not restated here.
 *
 * Census of the eleven JSON-body routes, grouped by which guards sit
 * ABOVE the parse (a malformed body must reach the parse to reproduce,
 * so each group carries exactly the state its guards demand):
 *   no state loaded:  POST /api/career/new, /api/career/load, /api/new, /api/load
 *   career loaded:    POST /api/career/save, /api/career/choice, /api/career/advance
 *   league loaded:    POST /api/save, /api/sim/advance, /api/action, /api/trade/evaluate
 */
import { describe, it, expect } from 'vitest';
import { startServer } from '../src/server.js';

/** TCP port 0: the OS assigns a free ephemeral port, so runs never collide. */
const EPHEMERAL_PORT = 0;

/** An unterminated object — the canonical body JSON.parse cannot accept. */
const MALFORMED_BODY = '{ "name": "half';

/** readJsonBody's one copy; api.js surfaces { error } verbatim as the toast. */
const MALFORMED_COPY = 'the request body is not valid JSON';

function post(port: number, route: string, body: string): Promise<Response> {
  return fetch(`http://localhost:${port}${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });
}

/** The three assertions every route in the census shares. */
async function expectMalformed400(res: Response): Promise<void> {
  expect(res.status).toBe(400);
  const body = await res.json() as { error: string };
  expect(body.error).toBe(MALFORMED_COPY);
}

describe('malformed JSON answers 400, not 500 (#252) — routes that parse before any state guard', () => {
  const STATELESS_ROUTES = ['/api/career/new', '/api/career/load', '/api/new', '/api/load'];
  for (const route of STATELESS_ROUTES) {
    it(`POST ${route}`, async () => {
      const svr = await startServer({ port: EPHEMERAL_PORT });
      try {
        await expectMalformed400(await post(svr.port, route, MALFORMED_BODY));
        // the rejected body mounted nothing: no half-created state
        const st = svr.state as { career: unknown; league: unknown };
        expect(st.career).toBe(null);
        expect(st.league).toBe(null);
      } finally {
        svr.close();
      }
    });
  }
});

describe('malformed JSON answers 400, not 500 (#252) — career routes behind the loaded-career guard', () => {
  const CAREER_ROUTES = ['/api/career/save', '/api/career/choice', '/api/career/advance'];
  for (const route of CAREER_ROUTES) {
    it(`POST ${route}`, async () => {
      const svr = await startServer({ port: EPHEMERAL_PORT });
      // Minimal stand-in: every guard between these routes and their
      // parse reads sim flags only, never a career field, so an empty
      // object is honest (the negotiations test pins the technique).
      const st = svr.state as { career: unknown };
      st.career = {};
      const before = JSON.stringify(st.career);
      try {
        await expectMalformed400(await post(svr.port, route, MALFORMED_BODY));
        expect(JSON.stringify(st.career)).toBe(before); // nothing ran past the parse
      } finally {
        svr.close();
      }
    });
  }
});

describe('malformed JSON answers 400, not 500 (#252) — league routes behind the loaded-league guard', () => {
  const LEAGUE_ROUTES = ['/api/save', '/api/sim/advance', '/api/action', '/api/trade/evaluate'];
  for (const route of LEAGUE_ROUTES) {
    it(`POST ${route}`, async () => {
      const svr = await startServer({ port: EPHEMERAL_PORT });
      // Same technique as the career group: the guards above these
      // parses read state.career (null on a fresh server) and sim
      // flags; no league field is touched before the parse rejects.
      const st = svr.state as { league: unknown };
      st.league = {};
      const before = JSON.stringify(st.league);
      try {
        await expectMalformed400(await post(svr.port, route, MALFORMED_BODY));
        expect(JSON.stringify(st.league)).toBe(before); // nothing ran past the parse
      } finally {
        svr.close();
      }
    });
  }
});

describe('the ingestion boundary around the empty body (#252)', () => {
  it('a whitespace-only body cannot parse: 400 with the same copy', async () => {
    const svr = await startServer({ port: EPHEMERAL_PORT });
    try {
      // three spaces: truthy, so it skips the empty-body {} coalesce and
      // must travel the parse — JSON.parse('   ') throws
      await expectMalformed400(await post(svr.port, '/api/career/new', '   '));
    } finally {
      svr.close();
    }
  });

  it('an empty body still reads as {} and falls to route validation, byte-unchanged copy', async () => {
    const svr = await startServer({ port: EPHEMERAL_PORT });
    try {
      const res = await post(svr.port, '/api/career/new', '');
      expect(res.status).toBe(400);
      const body = await res.json() as { error: string };
      // #112's layer, not #252's: the empty body parses as {} and the
      // route's own required-field check answers — pinned so the shared
      // ingestion point never swallows the {} coalesce
      expect(body.error).toBe('spec is required');
    } finally {
      svr.close();
    }
  });
});
