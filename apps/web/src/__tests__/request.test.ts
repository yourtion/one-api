import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AxiosInstance } from 'axios';
import { request, ApiRequestError } from '../api/request.js';

function mockAxios(handler: (url: string, cfg?: unknown) => unknown): AxiosInstance {
  return { get: vi.fn(handler), post: vi.fn(handler), put: vi.fn(handler), delete: vi.fn(handler) } as unknown as AxiosInstance;
}

describe('request 信封解包', () => {
  afterEach(() => vi.clearAllMocks());

  it('成功信封 → 返回 data', async () => {
    const ax = mockAxios(() => ({ data: { success: true, data: { id: 1 } } }));
    expect(await request(ax, 'get', '/x')).toEqual({ id: 1 });
  });

  it('业务错误信封 → 抛 ApiRequestError', async () => {
    const ax = mockAxios(() => ({ data: { success: false, error: { code: 'TABLE_NOT_FOUND', message: '表 x 不存在' } } }));
    await expect(request(ax, 'get', '/x')).rejects.toMatchObject({ code: 'TABLE_NOT_FOUND', message: '表 x 不存在' });
  });

  it('401 HTTP → isUnauthorized=true', async () => {
    const ax = mockAxios(() => {
      throw { response: { status: 401, data: { success: false, error: { code: 'UNAUTHORIZED', message: '未登录' } } } };
    });
    await expect(request(ax, 'get', '/x')).rejects.toMatchObject({ isUnauthorized: true, code: 'UNAUTHORIZED' });
  });

  it('网络错误 → INTERNAL_ERROR', async () => {
    const ax = mockAxios(() => { throw new Error('Network Error'); });
    await expect(request(ax, 'get', '/x')).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
  });
});
