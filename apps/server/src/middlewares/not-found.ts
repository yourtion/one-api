import { fail } from '../utils/response.js';
import { log } from '../utils/logger.js';
import type { AppContext } from '../types/context.js';

/**
 * 兜底 404 中间件（普通中间件，单参数 —— @leizm/web 按函数参数个数区分：
 * length>1 视为错误处理中间件，仅在出错时调用；故此处必须单参数才会被「无错误」链调用）。
 * 放在路由组之后、错误中间件之前注册：路由未匹配且无错误时，写出 404 JSON 信封。
 */
export function notFoundMiddleware(ctx: AppContext): void {
  // 链已走完仍未响应 → 404
  if (!ctx.response.headersSent) {
    log.request('404 %s', ctx.request.path ?? '');
    ctx.response.status(404).json(fail('NOT_FOUND', '资源不存在'));
  }
}
