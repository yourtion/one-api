import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ exists: vi.fn(), resolve: vi.fn() }));
vi.mock('node:fs', async (importActual) => ({ ...await importActual<typeof import('node:fs')>(), existsSync: mocks.exists }));
vi.mock('node:module', async (importActual) => ({ ...await importActual<typeof import('node:module')>(), createRequire: () => ({ resolve: mocks.resolve }) }));
import { resolveAdminRoot } from '../app.js';

describe('admin 静态目录探测', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.resolve.mockImplementation(() => { throw new Error('missing optional package'); });
  });
  afterEach(() => { delete process.env['ONE_API_ADMIN_ROOT']; });
  it('null 显式禁用，不读取环境和自动探测', () => {
    process.env['ONE_API_ADMIN_ROOT'] = '/env';
    expect(resolveAdminRoot(null)).toBeUndefined();
    expect(mocks.exists).not.toHaveBeenCalled();
    expect(mocks.resolve).not.toHaveBeenCalled();
  });
  it('显式路径只在有 index.html 时启用且不回退', () => {
    mocks.exists.mockReturnValue(false);
    expect(resolveAdminRoot('/explicit')).toBeUndefined();
    expect(mocks.resolve).not.toHaveBeenCalled();
    mocks.exists.mockImplementation((path) => path === '/explicit/index.html');
    expect(resolveAdminRoot('/explicit')).toBe('/explicit');
  });
  it('有效环境静态目录优先', () => {
    process.env['ONE_API_ADMIN_ROOT'] = '/env';
    mocks.exists.mockImplementation((path) => path === '/env/index.html');
    expect(resolveAdminRoot(undefined)).toBe('/env');
    expect(mocks.resolve).not.toHaveBeenCalled();
  });
  it('无效环境和未构建 optional 包均跳过，保留仓库开发兜底', () => {
    process.env['ONE_API_ADMIN_ROOT'] = '/unbuilt';
    mocks.resolve.mockReturnValue('/web/package.json');
    mocks.exists.mockImplementation((path: string) => path.endsWith('/apps/web/dist/index.html'));
    expect(resolveAdminRoot(undefined)).toMatch(/\/apps\/web\/dist$/);
  });
  it('optional 包有 index 时启用，否则无构建目录返回 undefined', () => {
    mocks.resolve.mockReturnValue('/web/package.json');
    mocks.exists.mockImplementation((path) => path === '/web/dist/index.html');
    expect(resolveAdminRoot(undefined)).toBe('/web/dist');
    mocks.exists.mockReturnValue(false);
    expect(resolveAdminRoot(undefined)).toBeUndefined();
  });
});
