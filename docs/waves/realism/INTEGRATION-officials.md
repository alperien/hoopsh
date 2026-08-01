# INTEGRATION: officials (referee crews)

Patch spec for wiring `packages/franchise/src/officials.ts` into the shared
files. Every patch is FILE + verbatim OLD (unique in the file) + NEW. All
heavy logic lives in officials.ts; each patch is a thin call or a field.

Apply order: patches 1-6 (types, params, rng registry) first, then the rest
in any order. Nothing here changes behavior for a league whose
`League.officials` is absent: every officials call no-ops to the exact
pre-officials pipeline (proved in `test/officials.test.ts`, graceful-absence
suite).

Engine seam, verified against source before wiring:

- `GameConfig.params` exists (`packages/engine/src/sim/game.ts` line 38,
  type `Parameters<typeof withParams>[0]`), and `initState` merges it with
  `withParams` over `defaultParams` (line 138).
- The shooting-foul zone probabilities exist as
  `params.foul.shootRim/shootPaint/shootMid/shootThree`
  (`packages/engine/src/sim/params.ts`, defaults 0.51974 / 0.16952 /
  0.065 / 0.0156). `withParams` accepts a deep partial containing only
  those four keys and leaves every other foul param untouched.
- `params.hca.roadAttrDebuff` (2.2) lives in FRANCHISE params
  (`packages/franchise/src/params.ts`), applied in `projectTeam` over
  `HCA_OFFENSE_KEYS`. The homeLean rider patches that one line.
- A neutral override (multiplier 1.0) is byte-identical to passing no
  params at all (probed: identical event streams for the same seed).

HONESTY LAW compliance: both influence paths flow through legal pre-game
inputs only. Tightness rides `GameConfig.params` (patch 12/16); homeLean
rides the projectTeam attribute projection (patch 10/11). Nothing touches
results after simulation.

---

## 1. types.ts: League.officials

FILE: `packages/franchise/src/types.ts`

OLD:
```ts
   * decision. Absent/empty on GM saves; purely additive.
   */
  careerControlled?: PlayerId[];
}
```

NEW:
```ts
   * decision. Absent/empty on GM saves; purely additive.
   */
  careerControlled?: PlayerId[];
  /**
   * Referee crews (officials.ts). Generated once at genesis; absent on
   * saves from before the feature, and every officials read no-ops
   * cleanly then (results byte-identical to the pre-officials pipeline).
   */
  officials?: import('./officials.js').OfficialsState;
}
```

## 2. types.ts: GameRecord.officials

FILE: `packages/franchise/src/types.ts`

OLD:
```ts
  /** app-side replay JSON path for watched/featured games; absent otherwise */
  replayFile?: string;
  seriesId?: SeriesId;
}
```

NEW:
```ts
  /** app-side replay JSON path for watched/featured games; absent otherwise */
  replayFile?: string;
  seriesId?: SeriesId;
  /** the crew that worked the game: id plus surname snapshot (officials.ts) */
  officials?: import('./officials.js').GameOfficials;
}
```

## 3. types.ts: GameJob.params

FILE: `packages/franchise/src/types.ts`

OLD:
```ts
   * Carried by the job so workers and folds stay self-contained.
   */
  rules?: RulePack;
}
```

NEW:
```ts
   * Carried by the job so workers and folds stay self-contained.
   */
  rules?: RulePack;
  /**
   * Per-game SimParams override for simulateGame's public `params` input
   * (officiating tightness rides here; officials.ts officialsJobExtras).
   * Plain numbers only: jobs cross the worker boundary as JSON. Absent =
   * engine stock params, exactly the existing behavior.
   */
  params?: import('@hoopsh/engine').GameConfig['params'];
}
```

## 4. params.ts: FranchiseParams officials section

FILE: `packages/franchise/src/params.ts`

OLD:
```ts
    roadAttrDebuff: number;
  };

  /** owner: gameday.ts (spine task) */
  fatigue: {
```

NEW:
```ts
    roadAttrDebuff: number;
  };

  /**
   * owner: officials.ts (officiating task). Every magnitude is re-clamped
   * to a hard cap at read time (officialsParamsOf): sweeps may lower these,
   * never turn referees into a season-deciding force.
   */
  officials: {
    /** crews in the league pool */
    crewCount: number;            // FEEL 20: ~70 real referees make ~23 crews; 20 keeps names learnable
    /** max relative swing on the engine's shooting-foul zone params at tightness 0/100 */
    tightnessFoulSwing: number;   // CAL 0.10 (hard cap 0.10 in officials.ts)
    /** max extra road attr debuff (rating points) at homeLean 100; negative mirror at 0 */
    leanRoadDebuffMax: number;    // CAL 0.8 (hard cap 1.1, half the hca debuff)
    /** tightness points of per-game jitter at consistency 0 */
    tightnessJitter: number;      // CAL 12 (hard cap 20)
  };

  /** owner: gameday.ts (spine task) */
  fatigue: {
```

## 5. params.ts: defaults literal

FILE: `packages/franchise/src/params.ts`

OLD:
```ts
    hca: { roadAttrDebuff: 2.2 },
    fatigue: {
```

NEW:
```ts
    hca: { roadAttrDebuff: 2.2 },
    officials: {
      crewCount: 20,
      tightnessFoulSwing: 0.10,
      leanRoadDebuffMax: 0.8,
      tightnessJitter: 12,
    },
    fatigue: {
```

NOTE: these four values mirror `DEFAULT_OFFICIALS_PARAMS` in officials.ts
(the module's fallback for leagues whose params predate this section).
Change them together.

## 6. rng.ts: stream registry entries

FILE: `packages/franchise/src/rng.ts` (doc comment; registry discipline)

OLD:
```ts
 *   news:<season>:<day>           template variety selection (media/news.ts)
 *   coach:<season>:<day>          coach-candidate generation on a firing (tick.ts)
```

NEW:
```ts
 *   news:<season>:<day>           template variety selection (media/news.ts)
 *   officials:crews               crew pool generation at genesis (officials.ts)
 *   officials:<season>:<day>      per-day crew assignment shuffle (officials.ts)
 *   officials:game:<gameId>       per-game tightness jitter (officials.ts)
 *   coach:<season>:<day>          coach-candidate generation on a firing (tick.ts)
```

## 7. genesis.ts: import

FILE: `packages/franchise/src/genesis.ts`

OLD:
```ts
import type { FranchiseParams } from './params.js';
import { withFranchiseParams } from './params.js';
```

NEW:
```ts
import type { FranchiseParams } from './params.js';
import { withFranchiseParams } from './params.js';
import { initOfficials } from './officials.js';
```

## 8. genesis.ts: crew pool at league creation

FILE: `packages/franchise/src/genesis.ts`

OLD:
```ts
  return {
    seed: opts.seed,
    params,
```

NEW:
```ts
  return {
    seed: opts.seed,
    params,
    officials: initOfficials(opts.seed, params),
```

## 9. gameday.ts: import

FILE: `packages/franchise/src/gameday.ts`

OLD:
```ts
import { gameSeedFor } from './rng.js';
import { applyResultToStandings, emptyStanding } from './standings.js';
```

NEW:
```ts
import { gameSeedFor } from './rng.js';
import { applyResultToStandings, emptyStanding } from './standings.js';
import { crewAttrDelta, officialsJobExtras, officialsStamp } from './officials.js';
```

## 10. gameday.ts: projectTeam reads the crew's homeLean rider

FILE: `packages/franchise/src/gameday.ts`

OLD:
```ts
  const backToBack = playedOn(league, teamId, league.season, league.day - 1);

  const players: Player[] = pool.map((p) => {
```

NEW:
```ts
  const backToBack = playedOn(league, teamId, league.season, league.day - 1);
  // Officiating homeLean rider on the HCA seam: a small extra road-team
  // debuff (or shave, under a road-friendly crew) for this game's crew.
  // Zero at home, for neutral crews, and for leagues without officials.
  // Hard-capped in officials.ts at a fraction of hca.roadAttrDebuff.
  const crewRoadDelta = crewAttrDelta(league, opts.gameId, opts.isHome);

  const players: Player[] = pool.map((p) => {
```

## 11. gameday.ts: the HCA debuff line carries the rider

FILE: `packages/franchise/src/gameday.ts`

OLD:
```ts
      // worse, they do not forget how to defend (REGISTER W60).
      for (const k of HCA_OFFENSE_KEYS) attr[k] -= params.hca.roadAttrDebuff;
    }
```

NEW:
```ts
      // worse, they do not forget how to defend (REGISTER W60).
      for (const k of HCA_OFFENSE_KEYS) attr[k] -= params.hca.roadAttrDebuff + crewRoadDelta;
    }
```

## 12. gameday.ts: planDayJobs carries the crew's params override

FILE: `packages/franchise/src/gameday.ts`

OLD:
```ts
    detail: g.home === league.userTeam || g.away === league.userTeam ? 'events' : 'fold',
  }));
```

NEW:
```ts
    detail: g.home === league.userTeam || g.away === league.userTeam ? 'events' : 'fold',
    ...officialsJobExtras(league, g.id),
  }));
```

## 13. gameday.ts: simulateJobsInline passes the override

FILE: `packages/franchise/src/gameday.ts`

OLD:
```ts
    const result = simulateGame({ seed: job.seed, home: job.home, away: job.away, rules: job.rules, collectFrames: false });
```

NEW:
```ts
    const result = simulateGame({ seed: job.seed, home: job.home, away: job.away, rules: job.rules, params: job.params, collectFrames: false });
```

## 14. gameday.ts: applyGameResults stamps the crew on the record

FILE: `packages/franchise/src/gameday.ts`

OLD:
```ts
      keyPlays: r.keyPlays,
      ...(sched.seriesId !== undefined ? { seriesId: sched.seriesId } : {}),
    };
```

NEW:
```ts
      keyPlays: r.keyPlays,
      ...(sched.seriesId !== undefined ? { seriesId: sched.seriesId } : {}),
      ...officialsStamp(league, r.gameId),
    };
```

## 15. tick.ts: import

FILE: `packages/franchise/src/tick.ts`

OLD:
```ts
import { abilityScore, applyGameResults, planDayJobs } from './gameday.js';
import { streamRng } from './rng.js';
```

NEW:
```ts
import { abilityScore, applyGameResults, planDayJobs } from './gameday.js';
import { officialsNewsFor } from './officials.js';
import { streamRng } from './rng.js';
```

## 16. tick.ts: the officials news beat

FILE: `packages/franchise/src/tick.ts`

OLD:
```ts
  appendNews(league, writeDailyNews(league));
  for (const rec of records) {
```

NEW:
```ts
  appendNews(league, writeDailyNews(league));
  appendNews(league, officialsNewsFor(league, records));
  for (const rec of records) {
```

## 17. media/recap.ts: import

FILE: `packages/franchise/src/media/recap.ts`

OLD:
```ts
import { Rng } from '@hoopsh/engine';
import type { GameLine, GameRecord, League, NewsItem } from '../types.js';
```

NEW:
```ts
import { Rng } from '@hoopsh/engine';
import type { GameLine, GameRecord, League, NewsItem } from '../types.js';
import { officialsRecapLine } from '../officials.js';
```

NOTE: officials.ts deliberately does NOT import `WIRE` back from recap.ts
(that would close an import cycle); it mirrors the byline string as a
frozen media contract. See `OFFICIALS_BYLINE` in officials.ts.

## 18. media/recap.ts: the crew line closes the recap body

FILE: `packages/franchise/src/media/recap.ts`

OLD:
```ts
  const userGame = record.home === league.userTeam || record.away === league.userTeam;
  const milestone = (wStar && wStar.pts >= 40) || record.keyPlays.some(k => k.kind === 'milestone' || k.kind === 'buzzer');
  const body = sentences.join(' ');
```

NEW:
```ts
  const crewLine = officialsRecapLine(league, record);
  if (crewLine) sentences.push(crewLine);

  const userGame = record.home === league.userTeam || record.away === league.userTeam;
  const milestone = (wStar && wStar.pts >= 40) || record.keyPlays.some(k => k.kind === 'milestone' || k.kind === 'buzzer');
  const body = sentences.join(' ');
```

## 19. index.ts: public API

FILE: `packages/franchise/src/index.ts`

OLD:
```ts
export { writeDailyNews } from './media/news.js';
export { recapGame } from './media/recap.js';
```

NEW:
```ts
export { writeDailyNews } from './media/news.js';
export { recapGame } from './media/recap.js';
export {
  initOfficials, officialsStateOf, dayAssignments, crewForGame,
  gameTightness, crewAttrDelta, officiatingParamsFor, officialsJobExtras,
  officialsStamp, officialsRecapLine, officialsNewsFor, officialsParamsOf,
  DEFAULT_OFFICIALS_PARAMS,
} from './officials.js';
export type { RefCrew, OfficialsState, GameOfficials, OfficialsParams } from './officials.js';
```

## 20. app/worker.ts: the worker passes the override

FILE: `packages/app/src/worker.ts`

OLD:
```ts
    rules: job.rules, // circuit games ride their own pack (career mode); absent = NBA
    collectFrames: wantFrames,
  });
```

NEW:
```ts
    rules: job.rules, // circuit games ride their own pack (career mode); absent = NBA
    params: job.params, // officiating tightness override when the game has a crew (officials.ts)
    collectFrames: wantFrames,
  });
```

## 21. app/protocol.ts: GameView carries the crew

FILE: `packages/app/src/protocol.ts`

OLD:
```ts
  recap: NewsItem | null;
  hasReplay: boolean; hasBroadcast: boolean;
}
```

NEW:
```ts
  recap: NewsItem | null;
  /** crew snapshot off the record; null for games from before the officials era */
  officials: { crewId: string; crew: [string, string, string] } | null;
  hasReplay: boolean; hasBroadcast: boolean;
}
```

## 22. app/views.ts: game center crew line

FILE: `packages/app/src/views.ts`

OLD:
```ts
    recap: league.news.find(n => n.gameId === record.id && n.type === 'recap') ?? null,
    hasReplay,
```

NEW:
```ts
    recap: league.news.find(n => n.gameId === record.id && n.type === 'recap') ?? null,
    officials: record.officials ?? null,
    hasReplay,
```

## 23. app/career-views.ts: career game center crew line

FILE: `packages/app/src/career-views.ts`

OLD:
```ts
    grade: career.coach.grades.find(g => g.gameId === record.id) ?? null,
    me: career.me,
```

NEW:
```ts
    grade: career.coach.grades.find(g => g.gameId === record.id) ?? null,
    officials: record.officials ?? null,
    me: career.me,
```

---

## Register notes

- HONESTY LAW: no post-hoc influence exists. The two mechanical paths are
  (a) `GameConfig.params` foul-zone override, capped at 10 percent
  relative, symmetric for both teams, and (b) the projectTeam road
  attribute rider, capped at 0.8 rating points (hard wall 1.1, half the
  2.2 baseline HCA debuff). A desired "crews influence WHO wins via calls
  in crunch time" bias has NO legal engine input and therefore does not
  exist mechanically; crunch-time reputation stays narrative only (recap
  and news strings).
- Career circuits (packages/career circuits.ts) build their own
  GameRecords and run without League.officials on purpose: minor circuits
  do not carry named NBA crews. The career NBA bridge advances through
  franchise advanceDay, so NBA games in career mode get crews with zero
  career-side changes.
- Narration hook: skipped. The broadcast layer renders from replay events
  and has no League access at its seam; plumbing crew names through the
  replay payload is a heavier change than the feature warrants. The
  tight-whistle visibility lives in the recap line and the news beat.
  Revisit if the replay payload ever grows a metadata block.
- RNG streams registered (patch 6): `officials:crews`,
  `officials:<season>:<day>`, `officials:game:<gameId>`. All draws in
  officials.ts flow through streamRng with those paths; assignment and
  jitter are pure functions of (seed, path), so call order and call count
  from any site cannot reshuffle results.
- Texture note for acceptance: with patches applied, league-wide FT
  volume gains small per-game variance by crew (probed at the caps:
  roughly plus or minus 12 percent FTA on extreme crews, most crews far
  milder). Season-scale means stay inside the engine's existing spread;
  no autosim gate reads per-game FTA.
- Save compatibility: pre-officials saves lack League.officials and the
  params.officials section. Both reads tolerate absence (officialsStateOf
  returns null, officialsParamsOf returns shipped defaults), and results
  are byte-identical to the old pipeline. Old GameRecords simply have no
  crew line.
