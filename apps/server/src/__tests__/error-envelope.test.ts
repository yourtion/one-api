import { describe, expect, it } from 'vitest';
import { Errors } from '@1api/shared';
import { AppApplication, AppRouter, type Middleware } from '../types/context.js';
import { errorMiddleware } from '../middlewares/error.js';
import { notFoundMiddleware } from '../middlewares/not-found.js';
import { startServer } from './helpers.js';

function buildTestApp() {
  const app = new AppApplication();
  const router = new AppRouter();
  router.get(
    '/throw-app-error',
    (() => {
      throw Errors.tableNotFound('demo');
    }) as Middleware,
  );
  router.get(
    '/throw-unknown',
    (() => {
      throw new Error('boom');
    }) as Middleware,
  );
  app.use('/', router);
  // 404 兜底（普通中间件：单参数，路由未匹配且无错误时调用）
  app.use('/', notFoundMiddleware);
  // 错误中间件（length>1 → 错误处理中间件，仅在出错时调用）
  app.use('/', errorMiddleware);
  return app;
}

describe('错误信封', () => {
  it('AppError → 对应状态码 + 信封', async () => {
    const { baseURL, close } = await startServer({
      build: async () => ({ app: buildTestApp(), close: async () => {} }),
    });
    const res = await fetch(baseURL + '/throw-app-error');
    expect(res.status).toBe(404);
    const body = (await res.json()) as { success: false; error: { code: string; message: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('TABLE_NOT_FOUND');
    await close();
  });

  it('未知错误 → 500 INTERNAL_ERROR', async () => {
    const { baseURL, close } = await startServer({
      build: async () => ({ app: buildTestApp(), close: async () => {} }),
    });
    const res = await fetch(baseURL + '/throw-unknown');
    expect(res.status).toBe(500);
    const body = (await res.json()) as { success: false; error: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('INTERNAL_ERROR');
    await close();
  });

  it('未匹配路由 → 404 信封', async () => {
    const { baseURL, close } = await startServer({
      build: async () => ({ app: buildTestApp(), close: async () => {} }),
    });
    const res = await fetch(baseURL + '/no-such-path');
    expect(res.status).toBe(404);
    const body = (await res.json()) as { success: false; error: { code: string } };
    expect(body.error.code).toBe('NOT_FOUND');
    await close();
  });
});
