import { describe, expect, it, vi } from 'vitest';
import type { Middleware } from 'erest';
import { checkPermission, logMiddleware } from '../hooks.js';
import { log } from '../utils/logger.js';

type Context = Parameters<Middleware>[0];
function context(overrides: Record<string, unknown> = {}): Context {
  return { state: {}, params: {}, ...overrides } as unknown as Context;
}
const currentToken = {
  id: 1,
  name: 'test',
  permissions: { tables: ['allowed'], actions: ['read'] },
};

describe('权限钩子的缺失上下文与自定义表名来源', () => {
  it('缺少身份时拒绝，不能进入数据处理器', async () => {
    const next = vi.fn();
    await expect(checkPermission('read')(context(), next)).rejects.toMatchObject({
      code: 'INVALID_TOKEN',
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('缺少 params/body 表名时拒绝，不能把空表名当成已授权表', async () => {
    const ctx = context({ state: { currentToken } });
    const next = vi.fn();
    await expect(checkPermission('read')(ctx, next)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      checkPermission('read', { tableFromBody: 'name' })(ctx, next),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(next).not.toHaveBeenCalled();
  });

  it('自定义路径键选择实际表名，仅授权 action 可执行', async () => {
    const next = vi.fn();
    const ctx = context({ state: { currentToken }, params: { resource: 'allowed' } });
    await checkPermission('read', { tableKey: 'resource' })(ctx, next);
    expect(next).toHaveBeenCalledOnce();
    await expect(
      checkPermission('write', { tableKey: 'resource' })(ctx, next),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(next).toHaveBeenCalledOnce();
  });

  it('日志记录方法和路径并继续处理请求', async () => {
    const request = vi.spyOn(log, 'request').mockImplementation(() => {});
    const next = vi.fn();
    try {
      await logMiddleware()(context({ method: 'GET', path: '/data/items' }), next);
      expect(request).toHaveBeenCalledWith('%s %s', 'GET', '/data/items');
      expect(next).toHaveBeenCalledOnce();
    } finally {
      request.mockRestore();
    }
  });
});
