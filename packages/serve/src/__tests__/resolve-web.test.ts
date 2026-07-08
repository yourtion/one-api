import { describe, expect, it } from 'vitest';
import { resolveWebDist } from '../resolve-web.js';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';

describe('resolveWebDist', () => {
  it('monorepo 内能解析到 @1api/web/dist（workspace 包已装）', () => {
    const dist = resolveWebDist();
    // monorepo 内 @1api/web 作为 workspace 包存在，应解析成功
    expect(dist).toBeDefined();
    // 仅在已 build 时才断言存在（CI 可能未 build web）——此处只断言路径以 dist 结尾
    expect(dist!.endsWith('dist')).toBe(true);
  });

  it('解析路径的父目录含 package.json（确认是包路径）', () => {
    const dist = resolveWebDist();
    expect(dist).toBeDefined();
    const pkgDir = dirname(dist!);
    expect(existsSync(`${pkgDir}/package.json`)).toBe(true);
  });
});
