import type { AppContext } from '../types/context.js';

/**
 * 对外 data 通道的宽松 CORS（admin 通道不挂，默认同源）。
 * 普通中间件（单参数）：OPTIONS 预检直接 204 返回，其余继续链。
 */
export function corsForData() {
  return function corsMiddleware(ctx: AppContext): void {
    ctx.response.setHeader('access-control-allow-origin', '*');
    ctx.response.setHeader('access-control-allow-methods', 'GET,POST,PUT,DELETE,OPTIONS');
    ctx.response.setHeader('access-control-allow-headers', 'content-type, authorization');
    if (ctx.request.method === 'OPTIONS') {
      ctx.response.status(204);
      return; // 预检到此为止，不调 next
    }
    ctx.next();
  };
}
