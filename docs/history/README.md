# docs/history — records, not guides

Process artifacts from the July-2026 refactor and agent-swarm campaign, kept
as written (plus dated status notes where later work resolved something).
Nothing here is a live task list; the live debt register is
[../REGISTER.md](../REGISTER.md).

| File | What it is |
|---|---|
| [refactor-log.md](./refactor-log.md) | the `refactor/verification-and-debt` branch narrative: baseline, outcome, Phase-5 finding, M1, gate-tier baselines, finding→commit traceability map |
| [swarm-plan.md](./swarm-plan.md) | the wave-1 agent-swarm plan (self-declared historical 2026-07-27) |
| [wave2-plan.md](./wave2-plan.md) | the wave-2 merge + second-swarm plan (same) |
| [redteam-wave2.md](./redteam-wave2.md) | wave-2 red-team findings: 4 MINORs, of which MINOR-2/-4 are since resolved (REGISTER W11/W13) |
| [calibration-eras.md](./calibration-eras.md) | superseded calibration-state blocks moved out of `docs/INTERNALS.md`; the current state is `docs/CALIBRATION.md` |

Why these are kept rather than deleted: register rows cite them by name as
provenance, the red-team doc documents probe scripts still committed at
`tools/redteam-probes/`, and AGENTS §5's incident-citation style depends on
the trail.
