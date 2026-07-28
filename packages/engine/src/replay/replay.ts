/**
 * Replay format: everything a viewer needs to render a game with zero
 * re-simulation. Metadata, downsampled position frames, the event stream,
 * and a lineup timeline (who occupies which frame slot, over time).
 *
 * Frame row layout (see sim/game.ts recordFrame for the exact construction):
 *   [t, period, clock, ballX, ballY, holderSlot, h0x, h0y ... h4x, h4y, a0x, a0y ... a4x, a4y]
 * holderSlot: 0-4 home slots, 5-9 away slots, -1 = ball loose/in flight.
 *
 * Index-by-index:
 *   [0] t: wall-clock seconds (`round1(s.wallT)`), despite the short name
 *       here. This is not game-clock time (core/events.ts's `Base.t`); it's
 *       the same wall-clock axis as `Base.wt` and `LineupSnapshot.t` below,
 *       chosen as the frame key because a viewer scrubbing a replay timeline
 *       needs stoppages (free throws, dead-ball resets) to occupy real,
 *       seekable time instead of collapsing to an instant.
 *   [1] period: 1-based, matches Base.period.
 *   [2] clock: game-clock seconds remaining in the period (`s.clock`,
 *       clamped >= 0), for on-screen display. Frozen across consecutive
 *       frames during a dead-ball stoppage even though [0] keeps advancing;
 *       that's expected, not a bug.
 *   [3] ballX, [4] ballY: ball position in court feet (geometry/court.ts's
 *       coordinate system).
 *   [5] holderSlot: which of the 10 on-court slots (0-4 home, 5-9 away, in
 *       each side's `s.lineup` order) currently holds the ball, or -1 when
 *       the ball is loose or mid-flight (a pass or shot in the air, or a
 *       live rebound scramble). Discrete/categorical; see the interpolation
 *       note below.
 *   [6..15] h0x, h0y .. h4x, h4y: the 5 home on-court players' positions,
 *       in home lineup-slot order (slot i here is `holderSlot` value i when
 *       i is 0-4).
 *   [16..25] a0x, a0y .. a4x, a4y: the 5 away on-court players' positions,
 *       in away lineup-slot order (slot i here is `holderSlot` value 5+i).
 *
 * Frames are recorded on a fixed wall-clock cadence (`frameEvery` sim ticks
 * at `tickHz`), not one row per simulation tick; this is the "downsampled"
 * in the summary above. A viewer reconstructing motion between two frames
 * should linearly interpolate ball/player x,y using [0] (wallT) to find the
 * playback fraction between the bracketing frames, but should not
 * interpolate `holderSlot`: snap to whichever bracketing frame is temporally
 * closer, since blending a discrete slot index is meaningless.
 *
 * Lineups are a separate timeline (`LineupSnapshot[]`) rather than 10 more
 * columns per frame because substitutions are rare (a handful per game)
 * while frames are recorded many times a minute; baking "who's in slot i"
 * into every row would repeat the same 10 ids across hundreds of frames for
 * nothing. Instead, `buildReplay` below folds `game_start` and
 * `substitution` events into snapshots, and a viewer looks up "who occupies
 * slot i at wall-clock time T" by finding the last LineupSnapshot for that
 * side with `snapshot.t <= T` (nothing needs interpolating here; a lineup
 * is either in effect or it isn't).
 */

import type { GameEvent } from '../core/events.js';
import type { GameResult } from '../sim/game.js';

export interface ReplayPlayerMeta {
  id: string;
  name: string;
  pos: string;
  heightIn: number;
}

export interface ReplayTeamMeta {
  id: string;
  name: string;
  abbrev: string;
  players: ReplayPlayerMeta[];
}

/** One lineup change on the replay timeline for one side; see the "Lineups are a separate timeline" note above. A viewer looks up the current lineup for `side` by finding the latest snapshot with `t <= playbackWallClock`. */
export interface LineupSnapshot {
  /** wall-clock timeline seconds this lineup takes effect */
  t: number;
  side: 0 | 1;
  slots: string[];
}

/** The complete self-contained replay artifact: serializable, and sufficient on its own to render a full game with no access to the engine's internal simulation state. */
export interface Replay {
  /**
   * Replay format version. Bump whenever the serialized shape of this
   * artifact changes (including the embedded `GameEvent` shapes) and
   * update packages/viewer in the same change (AGENTS.md DO-NOT #8): the
   * viewer HTML is designed to be saved standalone, so externally-held
   * copies have this field as their only way to detect a shape they
   * predate.
   *
   * History:
   * - 2 (2026-07-27): `ReboundEvent.player` went required → optional and
   *   gained `deadBall?` (playerless team/dead-ball rebounds occur in every
   *   default game via `reb.deadBallCaromChance`); `TimeoutEvent` joined the
   *   `GameEvent` union; `FreeThrowEvent.oneAndOne?` added. Frame row
   *   layout unchanged. Consumers typed against v1 (`player` required)
   *   must treat a playerless rebound as a team rebound.
   * - 1: initial format.
   */
  version: 2;
  seed: string;
  rules: {
    id: string;
    courtLengthFt: number;
    courtWidthFt: number;
    rimInsetFt: number;
    three: { arcRadiusFt: number; cornerDistFt: number; cornerBreakFt: number };
    periods: number;
    periodMinutes: number;
  };
  teams: [ReplayTeamMeta, ReplayTeamMeta];
  finalScore: [number, number];
  lineups: LineupSnapshot[];
  frames: number[][];
  events: GameEvent[];
}

/**
 * Assemble the shippable `Replay` artifact from a finished game's raw
 * `GameResult` (which carries the full team rosters, not just the trimmed
 * per-player fields a viewer needs; this function is the trim/reshape
 * step). The only non-trivial work here is turning the sparse
 * `substitution` events into a walkable lineup timeline; everything else is
 * a straight field copy.
 */
export function buildReplay(result: GameResult): Replay {
  const teamMeta = (side: 0 | 1): ReplayTeamMeta => {
    const t = result.teams[side];
    return {
      id: t.id,
      name: t.name,
      abbrev: t.abbrev,
      players: t.players.map((p) => ({
        id: p.id, name: p.name, pos: p.pos, heightIn: p.heightIn
      }))
    };
  };

  // Fold substitutions into a lineup timeline: start from the game_start
  // event's two starting fives (one snapshot per side, both at t = game
  // start), then replay each substitution event in event order, mutating a
  // running `current` lineup array per side and pushing a fresh snapshot
  // every time it changes. This walks the same events already in
  // result.events (a derived view for convenient lookup, not new
  // information), so a viewer could reconstruct this itself from the event
  // stream alone, but doesn't have to.
  const lineups: LineupSnapshot[] = [];
  const current: [string[], string[]] = [[], []];
  for (const e of result.events) {
    if (e.type === 'game_start') {
      current[0] = [...e.home.lineup];
      current[1] = [...e.away.lineup];
      lineups.push({ t: e.wt, side: 0, slots: [...current[0]] });
      lineups.push({ t: e.wt, side: 1, slots: [...current[1]] });
    } else if (e.type === 'substitution') {
      const slots = current[e.team];
      for (let i = 0; i < e.out.length; i++) {
        const idx = slots.indexOf(e.out[i]!);
        if (idx !== -1 && e.in[i]) slots[idx] = e.in[i]!;
      }
      lineups.push({ t: e.wt, side: e.team, slots: [...slots] });
    }
  }

  return {
    // must stay in lockstep with the `Replay.version` literal type above;
    // the version history lives at that field's doc comment
    version: 2,
    seed: result.seed,
    rules: {
      id: result.rules.id,
      courtLengthFt: result.rules.courtLengthFt,
      courtWidthFt: result.rules.courtWidthFt,
      rimInsetFt: result.rules.rimInsetFt,
      three: { ...result.rules.three },
      periods: result.rules.periods,
      periodMinutes: result.rules.periodMinutes
    },
    teams: [teamMeta(0), teamMeta(1)],
    finalScore: result.finalScore,
    lineups,
    frames: result.frames,
    events: result.events
  };
}
