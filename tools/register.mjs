// Zero-dependency dev runtime: registers module hooks so Node 24's native
// TypeScript type-stripping can run the monorepo directly from source.
// (When npm access is available, tsx/vitest work on the same code unchanged.)
//
// WHY THIS FILE EXISTS: the npm registry is firewalled in this environment,
// so there is no tsx, no ts-node, no bundler, no vitest binary to reach for.
// Node 24 can strip TypeScript type syntax and run the result natively
// (--experimental-strip-types, the `--disable-warning=ExperimentalWarning`
// flag in package.json's scripts silences the associated warning) — but type
// stripping only erases types, it does not resolve module specifiers. It
// does not know that './state.js' really means './state.ts' on disk (see
// AGENTS.md §1.7's `.js`-extension-for-`.ts`-source convention), and it has
// no idea what '@hoopsh/engine' should resolve to since there's no
// node_modules symlink for it. hooks.mjs (registered below) is the bridge
// that teaches Node's resolver both of those facts, so every package in this
// monorepo can `--import ./tools/register.mjs` its way to running straight
// from source with zero installed dependencies.
import { register } from 'node:module';

// Every npm script that touches TypeScript (`sim`, `test`, `batch`, `bench`,
// `broadcast`, `sweep`, `rosters:export`) passes `--import ./tools/register.mjs`
// on the node command line specifically so this side-effecting registration
// runs before any application module is loaded — resolution hooks must be in
// place before the first import, not after.
register(new URL('./hooks.mjs', import.meta.url));
