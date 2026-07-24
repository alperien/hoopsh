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
    testTimeout: 60_000
  }
});
