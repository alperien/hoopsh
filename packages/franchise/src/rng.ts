/**
 * RNG stream registry — determinism discipline for the franchise layer.
 *
 * One rule: every subsystem draws from its own derived stream, so adding
 * or removing a roll in one system never reshuffles another (the same
 * isolation gameSeed() gives games in the season layer). Streams derive
 * from the league seed plus a stable path of labels; the path vocabulary
 * below is the registry. Adding a stream = adding a name here, with its
 * owner, so collisions are impossible by construction.
 *
 * Registered stream paths (owner):
 *   genesis            league creation master stream (genesis.ts)
 *   genesis:team:<id>  per-team genesis rosters/personas (genesis.ts)
 *   class:<season>     draft class generation (people/gen.ts)
 *   classwave:<season> per-season class strength wave (people/gen.ts;
 *                      isolated so pool-size changes never move a wave)
 *   dev:<season>:<playerId>       development review rolls (people/dev.ts)
 *   injury:<season>:<day>         post-game injury rolls (people/injury.ts)
 *   retire:<season>               retirement hazard rolls (people/retire.ts)
 *   morale:<season>:<day>         disposition/request rolls (people/disposition.ts)
 *   schedule:<season>             schedule generation (schedule.ts)
 *   lottery:<season>              lottery drawing (postseason.ts)
 *   trade:<season>:<day>          AI trade pulses (ai/trade.ts)
 *   fa:<season>:<day>             free-agency market rolls (ai/fa.ts)
 *   scout:<teamId>:<playerId>     scouting error noise (scouting.ts; NOTE:
 *                                 no season/day — a team's read on a player
 *                                 is persistent, not re-rolled)
 *   scout:<teamId>:<scoutSeed>    per-team bias vector (scouting.ts; keyed by
 *                                 the team's scoutSeed so bias survives the
 *                                 player and stays the scout's, not the read's)
 *   news:<season>:<day>           template variety selection (media/news.ts)
 *   officials:crews               crew pool generation at genesis (officials.ts)
 *   officials:<season>:<day>      per-day crew assignment shuffle (officials.ts)
 *   officials:game:<gameId>       per-game tightness jitter (officials.ts)
 *   coach:<season>:<day>          coach-candidate generation on a firing (tick.ts)
 *   psyche:lifestyle:<playerId>   one-time lifestyle assignment (people/psyche.ts;
 *                                 no season/day: identity, never re-rolled)
 *   psyche:aging:<playerId>       per-career aging-grace trait (people/dev.ts;
 *                                 persistent, a pure function of the stream)
 *   psyche:news:<season>:<day>    rare lifestyle news beat (people/psyche.ts)
 *   awards:<season>               voting noise (media/awards.ts)
 *   economy:<season>              cap growth sampling (cba/cap.ts)
 *   game:<gameId>                 reserved: game seeds are the gameId itself
 *                                 prefixed by the league seed (gameday.ts)
 *
 * Games: `gameSeedFor` matches the season layer's convention (seed carries
 * the matchup and slot, so editing unrelated schedule entries never
 * perturbs games that did not move — SEASON.md).
 */

import { Rng } from '@hoopsh/engine';

/** Derive the deterministic Rng for a registered stream path. */
export function streamRng(leagueSeed: string, ...path: Array<string | number>): Rng {
  return new Rng(`${leagueSeed}:${path.join(':')}`);
}

/** The engine seed for one scheduled game. */
export function gameSeedFor(leagueSeed: string, gameId: string): string {
  return `${leagueSeed}:game:${gameId}`;
}
