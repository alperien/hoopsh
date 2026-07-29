/**
 * Type-only stub for 'vitest/config', mapped in via tsconfig `paths` so
 * vitest.config.ts stays inside the `npm run typecheck` gate in the
 * zero-install environment (the npm registry is firewalled — there is no real
 * vitest package to supply these types; see tools/shims/vitest.ts for the
 * matching runtime story).
 *
 * NO RUNTIME COUNTERPART, and none needed: `npm test` (node:test) never loads
 * vitest.config.ts at all, and `npm run test:vitest` — the path for users who
 * DO have vitest installed — loads the config with vitest's own transpiler
 * and node_modules resolution, where tsconfig paths do not apply. The real
 * 'vitest/config' resolves there; this file only ever serves tsc.
 *
 * Same covenant as the vitest shim's matcher surface: this declares exactly
 * the subset of the config API vitest.config.ts uses, not all of vitest's
 * UserConfig. Growing the config file to use a new option means widening this
 * stub in the same change — a compile error here is that reminder, not an
 * obstacle to route around.
 */

/** The subset of vitest's UserConfig that vitest.config.ts exercises. */
export interface UserConfig {
  resolve?: {
    /** bare-specifier -> absolute file path, mirroring tools/hooks.mjs branch 2 */
    alias?: Record<string, string>;
  };
  test?: {
    /** glob patterns of test files to collect */
    include?: string[];
    /** per-test timeout in milliseconds */
    testTimeout?: number;
  };
}

/** Identity helper (as in real vitest) — exists so the config gets typed. */
export function defineConfig(config: UserConfig): UserConfig;
