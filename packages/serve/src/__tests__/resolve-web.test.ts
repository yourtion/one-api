import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ resolve: vi.fn(), exists: vi.fn() }));
vi.mock('node:module', () => ({ createRequire: () => ({ resolve: mocks.resolve }) }));
vi.mock('node:fs', () => ({ existsSync: mocks.exists }));
import { resolveWebDist } from '../resolve-web.js';

describe('resolveWebDist', () => {
  beforeEach(() => { vi.resetAllMocks(); });
  it('包存在且构建 index 存在才返回路径', () => {
    mocks.resolve.mockReturnValue('/web/package.json');
    mocks.exists.mockImplementation((path) => path === '/web/dist/index.html');
    expect(resolveWebDist()).toBe('/web/dist');
  });
  it('未构建的包返回 undefined', () => {
    mocks.resolve.mockReturnValue('/web/package.json');
    mocks.exists.mockReturnValue(false);
    expect(resolveWebDist()).toBeUndefined();
  });
  it('未安装的 optional 包返回 undefined', () => {
    mocks.resolve.mockImplementation(() => { throw new Error('MODULE_NOT_FOUND'); });
    expect(resolveWebDist()).toBeUndefined();
  });
});
