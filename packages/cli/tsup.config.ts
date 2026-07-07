import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'es2022',
  platform: 'node',
  clean: true,
  splitting: false,
  sourcemap: false,
  // better-sqlite3 是原生模块，不打包进 bundle
  external: ['better-sqlite3'],
});
