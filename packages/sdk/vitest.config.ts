import { defineConfig } from 'vitest/config';

// test 走源码 alias，无需 build 前置（与 shared/engine/server 三包一致）
export default defineConfig({
  resolve: {
    alias: {
      '@1api/shared': new URL('./node_modules/@1api/shared/src/index.ts', import.meta.url).pathname,
    },
  },
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts'],
      thresholds: { lines: 90, branches: 85 },
    },
  },
});
