# Security

hoopsh is a simulation library with no runtime network surface: the engine
imports nothing (no npm packages, no Node built-ins), nothing listens on a
port, and a bare clone runs with zero installed dependencies. The only tool
that touches the network is `tools/fetch-nba.mjs` (dev-only corpus fetcher,
writes to a gitignored cache).

## In scope

- **Roster/team packs are untrusted input.** They are user-editable JSON parsed
  by `packages/data/src/schema.ts`; the engine's `validate: 'strict'` tier
  exists for packs from untrusted sources. A crafted pack that escapes
  validation and reaches code execution, prototype pollution, or path traversal
  (via tools that take pack paths) is a vulnerability.
- **Replay JSON in the viewer is untrusted input.** `packages/viewer/index.html`
  accepts drag-and-dropped replay files and `embed.mjs` bakes them into HTML.
  Script injection via replay/pack content (names, strings) is a vulnerability —
  the renderer deliberately bans `innerHTML` and a tripwire test
  (`packages/viewer/test/no-inner-html.test.ts`) enforces that; a bypass counts.
- **The harness executes repo-authored commands.** `npm test`, the batch runner,
  and the parallel worker pool (`execFile` of in-repo worker scripts with job
  files in tmpdir) run code from the working tree. Anything that lets *data*
  (packs, replays, corpus files) escalate into command execution is a
  vulnerability. Reviewing then running a stranger's branch is arbitrary code
  execution by design — that part is on the person running it.

## Out of scope

Realism misses, acceptance-band failures, calibration drift, and determinism
breaks are quality bugs, not vulnerabilities — file them with the bug or
calibration-finding issue template.

## Reporting

Report privately via GitHub: Security → "Report a vulnerability" on
`alperien/hoopsh`. Do not open a public issue for an exploitable problem.
Single-maintainer project: acknowledgment is best-effort, usually within a
week. Fixes land on `main` and ship in the next tagged release.
