/**
 * The career game center (screens/career/game.js) hands four conditional
 * sections straight to below.replaceChildren. Raw DOM replaceChildren,
 * unlike ui.js el(), does not filter: it string-coerces every non-Node
 * argument, so a null section prints as the literal text "null" under
 * the scorebug (issue #214 — the career chair's copy of #190, already
 * fixed in screens/game.js with the sections-array-filter pattern).
 *
 * No jsdom in a zero-dependency repo: this file carries its own minimal
 * DOM stub whose append/replaceChildren string-coerce non-Nodes ON
 * PURPOSE — that coercion is the defect's mechanism, so the stub must be
 * faithful to it. The screen module imports the shell (app.js, api.js)
 * by relative path, so the harness copies the REAL screen + ui.js +
 * format.js + widgets.js into a temp dir beside tiny shell stubs and
 * imports the copy. Stubs live here only, never in src/ or public/.
 */
import { describe, it, expect } from 'vitest';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// ---------------------------------------------------------------------------
// the DOM stub

class StubNode {
  childNodes: StubNode[] = [];
}

class StubText extends StubNode {
  data: string;
  constructor(data: string) {
    super();
    this.data = data;
  }
}

class StubElement extends StubNode {
  tag: string;
  attrs = new Map<string, string>();
  scrollTop = 0;
  scrollHeight = 0;
  constructor(tag: string) {
    super();
    this.tag = tag;
  }
  addEventListener(_type: string, _fn: unknown): void { /* recorded nowhere; never dispatched */ }
  setAttribute(k: string, v: string): void {
    this.attrs.set(k, v);
  }
  remove(): void { /* the viewer toggle path; not exercised */ }
  // Faithful to the real DOM: append/replaceChildren accept (Node | string)...
  // and convert anything else via String(), so null becomes the text "null".
  // el() filters nulls BEFORE calling these; raw call sites get no such mercy.
  private coerce(kids: unknown[]): StubNode[] {
    return kids.map(k => (k instanceof StubNode ? k : new StubText(String(k))));
  }
  append(...kids: unknown[]): void {
    this.childNodes.push(...this.coerce(kids));
  }
  replaceChildren(...kids: unknown[]): void {
    this.childNodes = this.coerce(kids);
  }
}

/** Every text node's data, joined — the rendered copy, structure-blind. */
function textOf(node: StubNode): string {
  if (node instanceof StubText) return node.data;
  return node.childNodes.map(textOf).join(' ');
}

/** Count text nodes that are EXACTLY the string "null" — the defect's spoor. */
function strayNulls(node: StubNode): number {
  let n = node instanceof StubText && node.data === 'null' ? 1 : 0;
  for (const c of node.childNodes) n += strayNulls(c);
  return n;
}

// ---------------------------------------------------------------------------
// the harness: real screen + real widgets beside stubbed shell modules

const PUBLIC_JS = fileURLToPath(new URL('../public/js/', import.meta.url));

const APP_STUB = `export const store = { mode: 'career', career: null };
export function registerScreen(name, def) { globalThis.__i214Screens.set(name, def); }
export function navigate() {}
export function on() {}
`;

const API_STUB = `export const api = {
  careerGame: async () => globalThis.__i214Game,
  careerBroadcast: async () => ({ cues: [] }),
};
`;

function buildHarness(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'hoopsh-i214-'));
  mkdirSync(path.join(dir, 'screens', 'career'), { recursive: true });
  for (const f of ['ui.js', 'format.js']) {
    copyFileSync(path.join(PUBLIC_JS, f), path.join(dir, f));
  }
  for (const f of ['widgets.js', 'game.js']) {
    copyFileSync(path.join(PUBLIC_JS, 'screens', 'career', f), path.join(dir, 'screens', 'career', f));
  }
  writeFileSync(path.join(dir, 'app.js'), APP_STUB);
  writeFileSync(path.join(dir, 'api.js'), API_STUB);
  return dir;
}

// ---------------------------------------------------------------------------
// payloads: the two states where sections legitimately go missing

function line(teamId: string, playerId: string, pts: number): Record<string, unknown> {
  return {
    teamId, playerId, starter: true, min: 32, pts,
    orb: 2, drb: 5, ast: 4, stl: 1, blk: 0, tov: 3,
    fgm: 8, fga: 15, tpm: 2, tpa: 5, ftm: 4, fta: 4, plusMinus: 6,
  };
}

function teamTotals(): Record<string, unknown> {
  return { fgm: 24, fga: 55, tpm: 6, tpa: 18, ftm: 10, fta: 13, orb: 8, drb: 22, ast: 15, tov: 11, fastbreakPts: 12 };
}

/** A circuit game with no grade, no key plays, no officials on record. */
function gamePayload(over: Record<string, unknown>): Record<string, unknown> {
  return {
    home: 'Mercer County', away: 'Camden Catholic',
    final: [64, 58], ot: 0,
    hasBroadcast: false, hasReplay: false,
    me: 'me-1',
    names: { 'me-1': 'Acceptance Kid', 'riv-1': 'The Rival' },
    // line points must sum to the final so the home/away id matching holds
    lines: [line('hs-home', 'me-1', 64), line('hs-away', 'riv-1', 58)],
    totals: [teamTotals(), teamTotals()],
    keyPlays: [],
    // grade and officials stay absent: early-career games carry neither
    ...over,
  };
}

interface ScreenDef {
  render: (root: unknown, params: string[]) => Promise<void>;
}

describe('career-game screen (#214)', () => {
  it('never prints the literal text "null" under the scorebug', async () => {
    const G = globalThis as Record<string, unknown>;
    const dir = buildHarness();
    try {
      G.document = {
        createElement: (tag: string) => new StubElement(tag),
        createTextNode: (data: string) => new StubText(String(data)),
      };
      G.Node = StubNode;
      G.__i214Screens = new Map<string, ScreenDef>();

      await import(pathToFileURL(path.join(dir, 'screens', 'career', 'game.js')).href);
      const def = (G.__i214Screens as Map<string, ScreenDef>).get('career-game');
      expect(def).toBeDefined();

      // UNSPOILED: a broadcast waits, the final stays hidden — all four
      // sections are legitimately absent. On the defective screen this
      // renders as "null null null null" under the LIVE bug.
      G.__i214Game = gamePayload({ hasBroadcast: true });
      const live = new StubElement('div');
      await def!.render(live, ['g-1']);
      expect(textOf(live)).toContain('LIVE');
      expect(strayNulls(live)).toBe(0);

      // SPOILED, sparse data: no broadcast spoils at once; the box score
      // renders but grade/key plays/officials are absent — three nulls on
      // the defective screen, and the real sections must still arrive.
      G.__i214Game = gamePayload({});
      const finalRoot = new StubElement('div');
      await def!.render(finalRoot, ['g-2']);
      const copy = textOf(finalRoot);
      expect(copy).toContain('FINAL');
      expect(copy).toContain('Mercer County');
      expect(copy).toContain('Acceptance Kid');
      expect(copy.includes('turning points')).toBe(false); // empty keyPlays: filtered, not faked
      expect(strayNulls(finalRoot)).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      delete (globalThis as Record<string, unknown>).document;
      delete (globalThis as Record<string, unknown>).Node;
      delete (globalThis as Record<string, unknown>).__i214Screens;
      delete (globalThis as Record<string, unknown>).__i214Game;
    }
  });
});
