import { AppError, ErrorCode } from '@1api/shared';
import { fail } from '../utils/response.js';
import { log } from '../utils/logger.js';
import type { AppContext } from '../types/context.js';
import type { ErrorReason } from '@leizm/web';

/** 判断是否 node-erest 的 Zod 校验错误（ERestError） */
function isERestError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { name?: string }).name === 'ERestError';
}

/**
 * 全局错误中间件。@leizm/web 在 handler 抛错或 ctx.next(err) 时进入（err 形参有值）。
 * - AppError → 对应 statusCode + 错误码
 * - ERestError（erest Zod 校验失败）→ 400 VALIDATION_FAIL
 * - 其他 → 500 INTERNAL_ERROR（记录 stack）
 *
 * 无 err 时透传给下一个中间件（允许作为普通中间件挂在链尾）。
 */
export function errorMiddleware(ctx: AppContext, err?: ErrorReason): void {
  if (!err) {
    ctx.next();
    return;
  }
  const e = err as Error & { statusCode?: number; code?: string };
  if (e instanceof AppError) {
    log.error('AppError %s: %s', e.code, e.message);
    if (!ctx.response.headersSent) {
      ctx.response.status(e.statusCode).json(fail(e.code, e.message));
    }
    return;
  }
  if (isERestError(e)) {
    log.error('ERestError: %s', e.message);
    if (!ctx.response.headersSent) {
      ctx.response.status(400).json(fail(ErrorCode.VALIDATION_FAIL, e.message));
    }
    return;
  }
  log.error('未知错误: %s', e.stack ?? e.message);
  if (!ctx.response.headersSent) {
    ctx.response.status(500).json(fail(ErrorCode.INTERNAL_ERROR, '服务器内部错误'));
  }
}
