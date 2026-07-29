// TYPECHECK vs RUNTIME for this import: `npm run typecheck` resolves
// 'vitest/config' via tsconfig paths to the type-only stub
// tools/shims/vitest-config.d.ts (the zero-install environment has no real
// vitest). `npm run test:vitest` is unaffected — vitest loads this config
// with its own transpiler and node_modules resolution, where tsconfig paths
// do not apply, so the REAL 'vitest/config' is what executes here. Using a
// config option beyond the stub's subset means widening the stub in the same
// change (see its header).
import { defineConfig } from 'vitest/config';
import path from 'node:path';

const r = (p: string) => path.resolve(import.meta.dirname, p);

export default defineConfig({
  resolve: {
    alias: {
      '@hoopsh/engine': r('packages/engine/src/index.ts'),
      '@hoopsh/stats': r('packages/stats/src/index.ts'),
      '@hoopsh/data': r('packages/data/src/index.ts'),
      '@hoopsh/narration': r('packages/narration/src/index.ts')
    }
  },
  test: {
    include: ['packages/*/test/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/readme.test.ts', '**/examples.test.ts'], // CI-PROBE 1
    testTimeout: 60_000
  }
});
