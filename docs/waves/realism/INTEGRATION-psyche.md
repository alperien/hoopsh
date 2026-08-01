# INTEGRATION-psyche.md: patch spec for the psyche layer

Owner: psyche task (people/psyche.ts). This document is the complete
integration surface for confidence, locker room chemistry, and lifestyle.
Everything below is a thin call into pure functions in `people/psyche.ts`
or `people/dev.ts`; no patch carries logic of its own.

Files already edited directly by this task (in-manifest, no patch needed):

- `packages/franchise/src/people/psyche.ts` (new)
- `packages/franchise/src/people/disposition.ts` (chemistry and lifestyle
  feed morale, both bounded, null-safe)
- `packages/franchise/src/people/dev.ts` (chemistry dev spillover
  0.95-1.05; aging grace trait; lifestyle proneness drift)
- `packages/franchise/test/psyche.test.ts` (new; existing people tests
  untouched and green)

Until the patches below land, the psyche layer is INERT at runtime: no
caller invokes `updatePsyche`, all couplings read missing state as
neutral, and every existing test and save behaves exactly as before.

---

## Register amendment F1-A (write into docs/FRANCHISE.md section 13)

Register F1 said disposition never modifies on-court dials. The OWNER
explicitly amended this during the psyche wave. The amendment, stated as
a register entry:

> **F1-A (amends F1; owner request, psyche wave 2026-08).** Psyche state
> may influence games ONLY through the legal pre-game projection seam
> (gameday.ts projectTeam, where fatigue and HCA already pre-degrade
> attributes) and through existing off-court systems (morale, development).
> Hard caps, enforced inside psyche.ts and testable in isolation:
> player confidence shifts the six offensive-execution dials by at most
> plus or minus 1.5 attribute points (CAL `confAttrCap`); team chemistry
> shifts the same dials by at most plus or minus 1.0 (CAL `chemAttrCap`);
> combined worst case 2.5. Lifestyle scales the trailing-load fatigue
> debuff by 0.85-1.15 (CAL). Development spillover from chemistry is
> bounded 0.95-1.05 (CAL `chemDevSpan`). Morale itself still never touches
> a dial directly; its only on-court reach is as one damped input to
> confidence. No post-hoc stat editing anywhere, ever. Lift condition for
> the caps: calibration evidence at league scale (two-season acceptance
> runs), same discipline as HCA (REGISTER W60).

### PATCH docs/FRANCHISE.md (the F1 row in the section-13 table)

OLD:
```
| F1 | disposition never modifies on-court dials | a sulking star plays true | morale-to-court coupling designed with calibration evidence, not vibes |
```

NEW:
```
| F1 | disposition never modifies on-court dials. AMENDED by F1-A (owner request, psyche wave): bounded psyche effects reach the court through the gameday pre-degrade seam only. Confidence caps at 1.5 attribute points either way, team chemistry at 1.0, offensive-execution dials only; morale still never touches a dial directly (people/INTEGRATION-psyche.md) | a sulking star still plays near-true; inside the F1-A caps a pressing one now shoots a touch worse | raising the F1-A caps needs calibration evidence at league scale, not vibes |
```

---

## Runtime patches

### 1. tick.ts: the weekly psyche pulse

`updatePsyche` recomputes chemistry and confidence targets and steps the
stored values (bounded, idempotent per day). It must run BEFORE
`updateDispositions` on the same cadence so morale reads this week's room.

FILE `packages/franchise/src/tick.ts`

OLD:
```ts
import { applyAging, runDevelopmentReview } from './people/dev.js';
import { advanceRecoveries, rollPostGameInjuries } from './people/injury.js';
import { updateDispositions } from './people/disposition.js';
```

NEW:
```ts
import { applyAging, runDevelopmentReview } from './people/dev.js';
import { advanceRecoveries, rollPostGameInjuries } from './people/injury.js';
import { updateDispositions } from './people/disposition.js';
import { updatePsyche } from './people/psyche.js';
```

OLD:
```ts
  // -------------------------------------------------------- league pulse
  if (league.day % DISPOSITION_CADENCE === 0) {
    for (const item of updateDispositions(league)) pushInbox(league, item);
  }
```

NEW:
```ts
  // -------------------------------------------------------- league pulse
  if (league.day % DISPOSITION_CADENCE === 0) {
    updatePsyche(league); // step confidence/chemistry BEFORE morale reads the room (people/psyche.ts)
    for (const item of updateDispositions(league)) pushInbox(league, item);
  }
```

### 2. gameday.ts: the pre-degrade seam (register F1-A)

Two touch points inside `projectTeam`. `psycheAttrShift` returns a
bounded float (worst case plus or minus 2.5); the existing final
`Math.round` pass keeps projected rosters integer-valued, so the seam
stays integer-safe with no new rounding code. Missing psyche state (old
saves before the first weekly tick, draftees mid-day) reads as exactly
zero. League-scale HCA calibration (REGISTER W60) is unaffected at first
order: the shift is near mean-zero across a league by construction, but
re-measure home-win percentage on the next acceptance run as W60 asks.

FILE `packages/franchise/src/gameday.ts`

OLD:
```ts
import { gameSeedFor } from './rng.js';
import { applyResultToStandings, emptyStanding } from './standings.js';
```

NEW:
```ts
import { gameSeedFor } from './rng.js';
import { applyResultToStandings, emptyStanding } from './standings.js';
import { PSYCHE_OFFENSE_KEYS, lifestyleFatigueFactor, psycheAttrShift } from './people/psyche.js';
```

OLD:
```ts
    let debuff = 0;
    if (backToBack) debuff += params.fatigue.b2bStaminaDebuff;
    debuff += params.fatigue.loadDebuffPer60Min * (trailingLoadMinutes(league, p.id) / 60);
    attr.stamina -= Math.min(debuff, FATIGUE_DEBUFF_CAP);
```

NEW:
```ts
    let debuff = 0;
    if (backToBack) debuff += params.fatigue.b2bStaminaDebuff;
    // Lifestyle recovery (people/psyche.ts, F1-A): the gym rat carries
    // load better, the night owl worse; 0.85-1.15, neutral when unassigned.
    debuff += params.fatigue.loadDebuffPer60Min * (trailingLoadMinutes(league, p.id) / 60)
      * lifestyleFatigueFactor(p);
    attr.stamina -= Math.min(debuff, FATIGUE_DEBUFF_CAP);
```

OLD:
```ts
      for (const k of HCA_OFFENSE_KEYS) attr[k] -= params.hca.roadAttrDebuff;
    }
    // One final integer pass: projected rosters stay integer-valued like
    // authored packs, and Math.round is platform-deterministic.
    for (const k of ATTR_KEYS) attr[k] = Math.max(0, Math.round(attr[k]));
```

NEW:
```ts
      for (const k of HCA_OFFENSE_KEYS) attr[k] -= params.hca.roadAttrDebuff;
    }
    // Psyche (register F1-A): bounded execution shift from confidence and
    // the room; capped inside psycheAttrShift, rounded by the pass below.
    const psyShift = psycheAttrShift(league, team, p);
    if (psyShift !== 0) for (const k of PSYCHE_OFFENSE_KEYS) attr[k] += psyShift;
    // One final integer pass: projected rosters stay integer-valued like
    // authored packs, and Math.round is platform-deterministic.
    for (const k of ATTR_KEYS) attr[k] = Math.max(0, Math.round(attr[k]));
```

### 3. media/news.ts: the rare lifestyle beat

At most one league-wide wire brief per day, gated at
`lifestyleNewsRate` (FEEL 0.02: a few per regular season, never spam),
regular season only, weight 1. All copy lives in psyche.ts and follows
the prose law (dry, factual, no exclamation marks, no em dashes).

FILE `packages/franchise/src/media/news.ts`

OLD:
```ts
import { Rng } from '@hoopsh/engine';
import type { League, NewsItem, Transaction } from '../types.js';
import { WIRE } from './recap.js';
```

NEW:
```ts
import { Rng } from '@hoopsh/engine';
import type { League, NewsItem, Transaction } from '../types.js';
import { WIRE } from './recap.js';
import { lifestyleNews } from '../people/psyche.js';
```

OLD:
```ts
      byline: INSIDER,
      players: nego.about, teams: [a, b],
      weight: hot ? 2 : 1,
    });
  }

  return out;
}
```

NEW:
```ts
      byline: INSIDER,
      players: nego.about, teams: [a, b],
      weight: hot ? 2 : 1,
    });
  }

  // the rare lifestyle beat (people/psyche.ts): a few per season, weight 1
  out.push(...lifestyleNews(league));

  return out;
}
```

---

## Contract patches (shapes and registries)

### 4. types.ts: the psyche state fields

psyche.ts already reads and writes these as locally-typed OPTIONAL
extension fields, so this patch changes no behavior; it makes the state
part of the frozen vocabulary. Both fields are optional by design: old
saves lack them, `initPsyche` fills them lazily on the first weekly tick,
and absent state reads as neutral everywhere.

FILE `packages/franchise/src/types.ts`

OLD:
```ts
  /** off-court morale 0-100; drives requests/decisions only (register F1) */
  morale: number;
  status: PlayerStatus;
```

NEW:
```ts
  /** off-court morale 0-100; drives requests/decisions only (register F1, amended F1-A) */
  morale: number;
  /**
   * Psyche state (people/psyche.ts, register F1-A): confidence 0-100 and
   * a lifestyle label. Absent until initPsyche lazily fills it (old
   * saves, fresh draftees); absent reads as neutral everywhere.
   */
  psyche?: {
    confidence: number;
    lifestyle: 'gymRat' | 'quietPro' | 'familyMan' | 'nightlife' | 'mediaDarling' | 'gamerHermit';
  };
  status: PlayerStatus;
```

OLD:
```ts
  /** persistent per-team scouting error seed (their scouts are wrong differently) */
  scoutSeed: number;
  strategy: {
```

NEW:
```ts
  /** persistent per-team scouting error seed (their scouts are wrong differently) */
  scoutSeed: number;
  /**
   * Locker-room state (people/psyche.ts, register F1-A): chemistry 0-100,
   * bond ages in days, and the weekly-update stamp. Absent until
   * initPsyche runs; absent reads as neutral everywhere.
   */
  psyche?: {
    chemistry: number;
    tenureDays: Record<PlayerId, number>;
    updatedOn: LeagueDate | null;
  };
  strategy: {
```

### 5. params.ts: the psyche section (sweepable calibration)

psyche.ts ships its own defaults and reads `league.params.psyche` when
present (`psycheParams()`), so this patch is about making the CAL dials
reachable by sweeps, per the params.ts philosophy. Optional field: saves
without it keep working.

FILE `packages/franchise/src/params.ts`

OLD:
```ts
    /** rest a starter on B2B night 2 when fatigue below this (policy default) */
    b2bRestBelow: number;             // FEEL 35
  };
}
```

NEW:
```ts
    /** rest a starter on B2B night 2 when fatigue below this (policy default) */
    b2bRestBelow: number;             // FEEL 35
  };

  /** owner: people/psyche.ts (psyche task). OPTIONAL: psyche.ts defaults apply when absent (old saves) */
  psyche?: {
    /** CAL max attr points confidence moves the offensive-execution dials, either direction (register F1-A) */
    confAttrCap: number;              // CAL 1.5
    /** CAL max attr points team chemistry moves the same dials, team-wide; smaller by design */
    chemAttrCap: number;              // CAL 1.0
    confStep: number;                 // FEEL 8 (max confidence move per weekly update)
    chemStep: number;                 // FEEL 3 (the room must move slower than the man)
    chemDeadband: number;             // FEEL 1 (hysteresis: no oscillation)
    chemDevSpan: number;              // CAL 0.05 (dev factor bounds 0.95-1.05)
    lifestyleNewsRate: number;        // FEEL 0.02 (a few beats per season, never spam)
  };
}
```

OLD:
```ts
    rotation: {
      starterMinutes: [36, 35, 33, 31, 29],
      benchMinutes: [26, 22, 18, 12, 8],
      b2bRestBelow: 35,
    },
  };
}
```

NEW:
```ts
    rotation: {
      starterMinutes: [36, 35, 33, 31, 29],
      benchMinutes: [26, 22, 18, 12, 8],
      b2bRestBelow: 35,
    },
    psyche: {
      confAttrCap: 1.5,
      chemAttrCap: 1.0,
      confStep: 8,
      chemStep: 3,
      chemDeadband: 1,
      chemDevSpan: 0.05,
      lifestyleNewsRate: 0.02,
    },
  };
}
```

### 6. rng.ts: registry documentation add

Three stream paths, all consumed today (the same pure-documentation add
tick.ts flagged for 'coach'). No code change.

FILE `packages/franchise/src/rng.ts`

OLD:
```
 *   news:<season>:<day>           template variety selection (media/news.ts)
 *   coach:<season>:<day>          coach-candidate generation on a firing (tick.ts)
 *   awards:<season>               voting noise (media/awards.ts)
```

NEW:
```
 *   news:<season>:<day>           template variety selection (media/news.ts)
 *   coach:<season>:<day>          coach-candidate generation on a firing (tick.ts)
 *   psyche:lifestyle:<playerId>   one-time lifestyle assignment (people/psyche.ts;
 *                                 no season/day: identity, never re-rolled)
 *   psyche:aging:<playerId>       per-career aging-grace trait (people/dev.ts;
 *                                 persistent, a pure function of the stream)
 *   psyche:news:<season>:<day>    rare lifestyle news beat (people/psyche.ts)
 *   awards:<season>               voting noise (media/awards.ts)
```

---

## Notes for the integrator

- Apply order does not matter; each patch is independent and the layer is
  null-safe until patch 1 (tick.ts) turns it on.
- gen.ts and names.ts are deliberately untouched (parallel rewrites):
  psyche state initializes LAZILY in `initPsyche(league)`, called from
  `updatePsyche` at the top of every weekly pulse, so genesis rosters,
  draftees, and old saves all self-heal with no generator hook.
- Determinism: no new draws on any existing stream. The two seeded psyche
  inputs are per-player streams (`psyche:lifestyle`, `psyche:aging`), so
  one player's rolls never reshuffle another's; the news beat draws from
  its own per-day stream. Confidence and chemistry updates are dice-free
  recomputation with bounded steps.
- Verify after applying: `npm test` (franchise 201 + career 176 at
  landing, plus 33 psyche tests), then re-run the calibration probe in
  the wave notes (confidence spread sane, caps never exceeded, chemistry
  slower than confidence, damping measurable, seam integer-safe).
- Watch item for the next acceptance run: home-win percentage (REGISTER
  W60) and league scoring drift with the seam live. The shift is near
  mean-zero by construction; if two-season acceptance shows drift, sweep
  `psyche.confAttrCap` / `psyche.chemAttrCap` down before touching
  anything else.
