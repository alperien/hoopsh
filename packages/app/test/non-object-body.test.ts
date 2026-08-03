/**
 * Well-formed non-object request bodies (#260): a top-level JSON `null`
 * is valid JSON, so it passed #252's parse gate — then the route handler
 * dereferenced it and the catch-all answered 500 carrying the raw
 * TypeError as user-facing copy ("Cannot read properties of null").
 * This is the layer BETWEEN #252 (the body does not parse) and #112
 * (the body is an object of the wrong shape): the body parses and is
 * not an object at all. readJsonBody answers 400 with one stable
 * plain-language copy after a successful parse, before any route code
 * runs.
 *
 * Census ruling (#260): all eleven JSON-body routes read named
 * properties off the body (spec, name, choice, weeks, userTeam, days,
 * action, offer) — none accepts a non-object top level. Arrays are
 * typeof 'object' but carry no named fields, so a bare array is not a
 * legal body either; the guard rejects null, number, string, boolean,
 * and array alike.
 *
 * The route census and the state stand-in technique are #252's
 * (malformed-json.test.ts): each group carries exactly the state its
 * guards demand, so the body reaches the parse.
 */
import { describe, it, expect } from 'vitest';
import { startServer } from '../src/server.js';

/** TCP port 0: the OS assigns a free ephemeral port, so runs never collide. */
const EPHEMERAL_PORT = 0;

/** readJsonBody's post-parse copy; api.js surfaces { error } verbatim as the toast. */
const NON_OBJECT_COPY = 'the request body must be a JSON object';

/** Every well-formed top level that is not a plain object, one per JSON type. */
const NON_OBJECT_BODIES: ReadonlyArray<[label: string, body: string]> = [
  ['null', 'null'],
  ['a number', '42'],
  ['a string', '"half"'],
  ['a boolean', 'true'],
  ['an array', '[{ "name": "half" }]'],
];

function post(port: number, route: string, body: string): Promise<Response> {
  return fetch(`http://localhost:${port}${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });
}

/** The two assertions every non-object body shares. */
async function expectNonObject400(res: Response): Promise<void> {
  expect(res.status).toBe(400);
  const body = await res.json() as { error: string };
  expect(body.error).toBe(NON_OBJECT_COPY);
}

describe('a top-level null body answers 400, never a TypeError 500 (#260) — routes that parse before any state guard', () => {
  const STATELESS_ROUTES = ['/api/career/new', '/api/career/load', '/api/new', '/api/load'];
  for (const route of STATELESS_ROUTES) {
    it(`POST ${route}`, async () => {
      const svr = await startServer({ port: EPHEMERAL_PORT });
      try {
        await expectNonObject400(await post(svr.port, route, 'null'));
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

describe('a top-level null body answers 400, never a TypeError 500 (#260) — career routes behind the loaded-career guard', () => {
  const CAREER_ROUTES = ['/api/career/save', '/api/career/choice', '/api/career/advance'];
  for (const route of CAREER_ROUTES) {
    it(`POST ${route}`, async () => {
      const svr = await startServer({ port: EPHEMERAL_PORT });
      // Minimal stand-in, #252's technique: every guard between these
      // routes and their parse reads sim flags only, never a career field.
      const st = svr.state as { career: unknown };
      st.career = {};
      const before = JSON.stringify(st.career);
      try {
        await expectNonObject400(await post(svr.port, route, 'null'));
        expect(JSON.stringify(st.career)).toBe(before); // nothing ran past the guard
      } finally {
        svr.close();
      }
    });
  }
});

describe('a top-level null body answers 400, never a TypeError 500 (#260) — league routes behind the loaded-league guard', () => {
  const LEAGUE_ROUTES = ['/api/save', '/api/sim/advance', '/api/action', '/api/trade/evaluate'];
  for (const route of LEAGUE_ROUTES) {
    it(`POST ${route}`, async () => {
      const svr = await startServer({ port: EPHEMERAL_PORT });
      // Same technique as the career group: the guards above these
      // parses read state.career (null on a fresh server) and sim
      // flags; no league field is touched before the guard rejects.
      const st = svr.state as { league: unknown };
      st.league = {};
      const before = JSON.stringify(st.league);
      try {
        await expectNonObject400(await post(svr.port, route, 'null'));
        expect(JSON.stringify(st.league)).toBe(before); // nothing ran past the guard
      } finally {
        svr.close();
      }
    });
  }
});

describe('every well-formed non-object top level shares the one copy (#260)', () => {
  // The two routes #260 probed live; each JSON type that can head a body.
  for (const [label, body] of NON_OBJECT_BODIES) {
    for (const route of ['/api/career/new', '/api/new']) {
      it(`POST ${route}, body ${label}`, async () => {
        const svr = await startServer({ port: EPHEMERAL_PORT });
        try {
          await expectNonObject400(await post(svr.port, route, body));
        } finally {
          svr.close();
        }
      });
    }
  }
});

describe('the guard boundary (#260): objects still flow, the empty body still coalesces', () => {
  it('an empty body still reads as {} and falls to route validation, byte-unchanged copy', async () => {
    const svr = await startServer({ port: EPHEMERAL_PORT });
    try {
      const res = await post(svr.port, '/api/career/new', '');
      expect(res.status).toBe(400);
      const body = await res.json() as { error: string };
      // #112's layer answers, not the guard: the {} coalesce sits above
      // the parse, so the guard must never see (or swallow) it
      expect(body.error).toBe('spec is required');
    } finally {
      svr.close();
    }
  });

  it('a well-formed OBJECT body flows past the guard to route validation: POST /api/career/new', async () => {
    const svr = await startServer({ port: EPHEMERAL_PORT });
    try {
      const res = await post(svr.port, '/api/career/new', '{}');
      expect(res.status).toBe(400);
      const body = await res.json() as { error: string };
      expect(body.error).toBe('spec is required'); // the route speaks, so the body got through
    } finally {
      svr.close();
    }
  });

  it('a well-formed OBJECT body flows past the guard to route validation: POST /api/new', async () => {
    const svr = await startServer({ port: EPHEMERAL_PORT });
    try {
      const res = await post(svr.port, '/api/new', '{}');
      expect(res.status).toBe(400);
      const body = await res.json() as { error: string };
      expect(body.error).toBe('userTeam is required');
    } finally {
      svr.close();
    }
  });
});
