import type { RulePack } from '../rules/rulepack.js';
import type { V2 } from '../core/vec.js';
import { dist } from '../core/vec.js';
import type { ShotZone } from '../core/events.js';

/**
 * Court geometry derived from a rule pack.
 *
 * Coordinate system: origin (0, 0) is the home baseline's LEFT corner as
 * viewed looking down the court from behind that baseline. +x runs the full
 * LENGTH of the court (0 .. courtLengthFt, e.g. 0..94 for NBA) toward the
 * opposite baseline; +y runs the WIDTH of the court (0 .. courtWidthFt, e.g.
 * 0..50 for NBA) from that left sideline to the right sideline. All units are
 * feet. There is no y-flip or rotation anywhere downstream — every consumer
 * (AI, resolve.ts, replay frames) shares this exact frame.
 *
 * Two rims, fixed in world space: `rims[0]` always sits at the LOW-x baseline
 * (near the origin), `rims[1]` at the HIGH-x baseline. Which TEAM attacks
 * which rim is not fixed, though — attackedRim() in sim/state.ts says home
 * attacks the high-x rim (rims[1]) in the first half and the low-x rim
 * (rims[0]) in the second half, flipping at intermission exactly like real
 * basketball (teams swap baskets at halftime; the court itself never moves).
 */
export interface Court {
  length: number;
  width: number;
  midX: number;
  centerY: number;
  /** rims[0] at low-x baseline, rims[1] at high-x baseline */
  rims: [V2, V2];
}

export function makeCourt(rules: RulePack): Court {
  const w = rules.courtWidthFt;
  const l = rules.courtLengthFt;
  return {
    length: l,
    width: w,
    midX: l / 2,
    centerY: w / 2,
    rims: [
      // NBA rimInsetFt = 5.25 ft: the rim center sits 5.25 ft in from the
      // baseline (not ON the baseline) — matches the real hoop's mounting
      // point relative to the backboard/baseline in an NBA gym.
      { x: rules.rimInsetFt, y: w / 2 },
      { x: l - rules.rimInsetFt, y: w / 2 }
    ]
    // no ftSpots here: free-throw-line positioning is derived where it is
    // used (fouls.ts enterFreeThrows, ftLineFt − rimInsetFt). A precomputed
    // pair sat defined-but-unconsumed for the file's whole history and was
    // deleted per the dead-surface rule (AGENTS DO-NOT #5).
  };
}

export interface ShotLocation {
  distFt: number;
  zone: ShotZone;
  three: boolean;
}

/**
 * Classify a shot location against the attacked rim.
 *
 * The real NBA three-point line is NOT a single arc: it's a semicircle of
 * radius `arcRadiusFt` (23.75 ft) centered on the rim, but that arc is
 * clipped short in the corners by two straight lines running parallel to the
 * sideline at `cornerDistFt` (22 ft) from the rim's lateral center, from the
 * baseline out to where the straight line meets the arc at `cornerBreakFt`
 * (14 ft) from the baseline. This exists in real life because the full-radius
 * arc would otherwise run out of bounds past the sideline near the corner —
 * the rule literally reshapes the line to keep it on the court. That's why
 * corner threes (22 ft) are shorter than above-the-break threes (23.75 ft):
 * it's a side effect of the court's fixed width, not a design choice.
 *
 * So the classification branches on which geometry applies: within
 * `cornerBreakFt` of the baseline, "is this a three" is a straight LATERAL
 * distance check off the rim's center line (mirrors the real straight corner
 * line); beyond the break, it switches to a circular check against
 * `arcRadiusFt` (mirrors the real arc). Getting this branch wrong would
 * misclassify the shortest, most efficient three-point shot in the game.
 */
export function classifyShot(rules: RulePack, court: Court, rim: V2, p: V2): ShotLocation {
  const d = dist(p, rim);
  const distFromBaseline = rim.x < court.midX ? p.x : court.length - p.x;
  const lateral = Math.abs(p.y - court.centerY);

  let three: boolean;
  if (distFromBaseline <= rules.three.cornerBreakFt) {
    three = lateral >= rules.three.cornerDistFt;
  } else {
    three = d >= rules.three.arcRadiusFt;
  }

  // non-three zones split by raw distance from the rim: point-blank shots
  // (dunks, layups) vs. the rest of the paint (floaters, hooks, put-backs)
  // vs. everything outside the key that isn't a three (the mid-range).
  // 4 ft and 14 ft roughly bracket "restricted area" and "the paint" in real
  // broadcast shot-chart terms, even though the engine doesn't model the
  // restricted-area arc or the lane lines as hard boundaries.
  let zone: ShotZone;
  if (three) zone = 'three';
  else if (d <= 4) zone = 'rim';
  else if (d <= 14) zone = 'paint';
  else zone = 'mid';

  return { distFt: d, zone, three };
}

/**
 * Halfcourt spacing spots for the offense attacking `rim` — a 5-out template
 * (all five spots live beyond/around the paint; there's no fixed post-up
 * "4-out-1-in" slot). ai.ts assignSpots hands these out by personnel: best
 * ball-handler to `top`, the four best-gravity shooters to the
 * wings/corners, and the worst shooter to `dunker` if he's a true
 * non-shooter. `elbow_l/r` are the mid-range supply line: assignSpots
 * stations a low-gravity big with a real in-between game there (instead
 * of wasting a corner on him), and ai/actions.ts routes a mid-pop
 * screener there after the screen. `short_roll` is reached via the cut
 * machinery rather than assignment.
 *
 * Every position below is a named REAL basketball spot:
 *  - `top`: top of the key / top of the arc, dead center, the traditional
 *    point-guard-with-the-ball spot (26 ft out — beyond the three-point arc
 *    so the primary ball-handler naturally starts as a three-point threat).
 *  - `wing_l`/`wing_r`: the wings, angled ~35-40° off the baseline at
 *    three-point range (21 ft up-court of the rim and ~15.5 ft off the
 *    center line — ≈26 ft from the rim, comfortably behind the 23.75 ft
 *    arc) — the classic catch-and-shoot / drive-either-way spot for a
 *    team's other perimeter shooters.
 *  - `corner_l`/`corner_r`: the corner spots at 21.5 ft LATERAL distance
 *    from the rim's center line — just INSIDE classifyShot's 22 ft corner
 *    line (see the D3 note on the entries below for why moving them behind
 *    the line waits on the assist-economy fix).
 *  - `dunker`: the dunker's-spot ROLE — the low man who stays out of the
 *    primary driver's lane while remaining a lob/dump-off threat. The
 *    shipped, calibrated position is NOT the textbook baseline spot: it
 *    sits 4 ft up-court of the rim plane and 9 ft lateral (≈9.9 ft from
 *    the rim center, a step outside the lane's 8 ft half-width, ~9 ft off
 *    the baseline). Putting a shooter here would clog the drive; putting a
 *    non-shooter on the perimeter would let his defender sag off and
 *    congest the paint instead — hence assignSpots routing by gravity.
 *  - `elbow_l`/`elbow_r`: the elbows — where the free-throw line meets the
 *    lane lines, a classic pass-and-cut or pick-and-pop landing spot. The
 *    canonical mid-range real estate: a catch here is the 16-footer.
 *  - `short_roll`: the "short roll" area, roughly the front of the rim at
 *    mid-paint depth — where a screener who rolled to the basket but got cut
 *    off pulls up short to become a passing-window threat instead of
 *    forcing the finish (ai.ts actionTick routes a rolling screener here via
 *    the cut machinery rather than assigning it directly).
 */
export function spacingSpots(court: Court, rim: V2): { key: string; pos: V2 }[] {
  // direction from rim toward midcourt
  const dir = rim.x < court.midX ? 1 : -1;
  const cy = court.centerY;
  const baselineX = rim.x - dir * 2.25; // roughly the baseline in front of rim

  const spot = (dx: number, y: number): V2 => ({ x: rim.x + dir * dx, y });

  return [
    { key: 'top', pos: spot(26, cy) },
    { key: 'wing_l', pos: spot(21, cy - 15.5) },
    { key: 'wing_r', pos: spot(21, cy + 15.5) },
    // Corner spot at 21.5 ft lateral — just inside the 22 ft corner line,
    // producing a small junk-corner-2 rate (REFACTOR.md D3). Moving corners
    // genuinely behind the line was attempted THREE ways during M1 (naive,
    // gravity-gated, appetite-ranked + block stationing — full trail in
    // REFACTOR.md): each iteration fixed its target metric, and the final
    // best-fit model restored Jokic's 3PA/TRB/post trajectory — but real
    // behind-the-line corners raise kick EV enough that the primary
    // creator's assists inflate to 12-14/game, amplifying the PRE-EXISTING
    // structural assist-economy overshoot (D1). D3 is therefore COUPLED to
    // D1: land the assist-model fix first, then this becomes safe. Until
    // then the junk-2 trickle is the lesser distortion.
    { key: 'corner_l', pos: { x: baselineX + dir * 4, y: cy - 21.5 } },
    { key: 'corner_r', pos: { x: baselineX + dir * 4, y: cy + 21.5 } },
    { key: 'dunker', pos: spot(4, cy + 9) },
    // low blocks — post-up real estate, ~first hash beside the key
    { key: 'post_l', pos: spot(3.5, cy - 6.5) },
    { key: 'post_r', pos: spot(3.5, cy + 6.5) },
    // True elbow geometry: the NBA free-throw line sits 13.75 ft from the
    // rim center (ftLineFt 19 − rimInsetFt 5.25) and the lane lines ±8 ft
    // off the center line; the elbow jumper is taken from a step behind
    // that intersection — dx 14 puts the spot sqrt(14² + 8²) ≈ 16.1 ft
    // from the rim, the canonical 16-footer (was dx 16 ≈ 17.9 ft while
    // the spots sat unconsumed; the mid-pop supply line made the distance
    // load-bearing: it must land inside the 14-19.5 ft real-mid band with
    // jitter, not straddle the long-2 boundary).
    { key: 'elbow_l', pos: spot(14, cy - 8) },
    { key: 'elbow_r', pos: spot(14, cy + 8) },
    { key: 'short_roll', pos: spot(11, cy) }
  ];
}
