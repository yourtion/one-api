import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERestError } from 'erest';
import { Errors } from '@1api/shared';
import { setupTest, type TestSetup } from './helpers.js';
import { responseEnvelopers } from '../api/instance.js';

let t: TestSetup;
beforeAll(async () => {
  t = await setupTest();
});
afterAll(async () => {
  await t.cleanup();
});

describe('错误信封逻辑（C3 信息泄露脱敏 + I3 Zod 码归一化）', () => {
  const { error } = responseEnvelopers;

  it('未知 Error（非 AppError/ERestError）→ message 脱敏为「服务器内部错误」，不泄露内部信息', () => {
    const internal = new TypeError('Cannot read properties of undefined (reading "foo") at /path/secret.sql');
    const out = error(internal);
    const body = out.body as { success: boolean; error: { code: string; message: string } };
    expect(out.status).toBe(500);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('INTERNAL_ERROR');
    // 关键：原始 message 含敏感信息，不得外泄
    expect(body.error.message).toBe('服务器内部错误');
    expect(body.error.message).not.toContain('secret.sql');
  });

  it('AppError（业务错误）→ 真实 message 透传 + 业务 code', () => {
    const e = Errors.tableNotFound('posts');
    const out = error(e);
    const body = out.body as { success: boolean; error: { code: string; message: string } };
    expect(out.status).toBe(404);
    expect(body.error.code).toBe('TABLE_NOT_FOUND');
    expect(body.error.message).toBe(e.message);
  });

  it('ERestError（Zod 校验失败 VALIDATION_ERROR）→ code 归一化为 VALIDATION_FAIL，message 透传', () => {
    const e = new ERestError('VALIDATION_ERROR', 'name must be string', undefined, 422);
    const out = error(e);
    const body = out.body as { success: boolean; error: { code: string; message: string } };
    expect(out.status).toBe(422);
    expect(body.error.code).toBe('VALIDATION_FAIL');
    expect(body.error.message).toBe('name must be string');
  });

  it('ERestError（MISSING_PARAM/INVALID_PARAM）→ 均归一化为 VALIDATION_FAIL', () => {
    for (const code of ['MISSING_PARAM', 'INVALID_PARAM'] as const) {
      const e = new ERestError(code, 'missing', undefined, 400);
      const out = error(e);
      const body = out.body as { error: { code: string } };
      expect(body.error.code).toBe('VALIDATION_FAIL');
    }
  });
});

describe('错误信封端到端（真实 HTTP）', () => {
  it('Zod 校验失败 → 响应 code === VALIDATION_FAIL', async () => {
    const s = await t.adminSession();
    // login schema 要求 name:z.string()；故意传 number 触发 Zod 校验失败
    const res = await s.post('/auth/login').input({ name: 123, password: 'x' }).raw();
    expect(res.status).toBeGreaterThanOrEqual(400);
    const body = JSON.parse(res.text) as { success: boolean; error: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('VALIDATION_FAIL');
  });

  it('已知 AppError（表不存在）→ 真实 message 透传，不脱敏', async () => {
    const s = await t.adminSession();
    const res = await s.get('/admin/tables/999999/data').raw();
    const body = JSON.parse(res.text) as { success: boolean; error: { code: string; message: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('TABLE_NOT_FOUND');
    expect(body.error.message).not.toBe('服务器内部错误');
  });
});
