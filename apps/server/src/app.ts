import { AppApplication, AppRouter, type AppContext, type Middleware } from './types/context.js';
import { errorMiddleware } from './middlewares/error.js';
import { notFoundMiddleware } from './middlewares/not-found.js';
import { log } from './utils/logger.js';
import { ok } from './utils/response.js';

export interface BuildAppOptions {
  sessionSecret: string;
  /** 挂载各业务路由组（各 module 提供 register 函数） */
  registerRoutes: (app: AppApplication) => void;
}

/** API 概览（spec 验收：node-erest 自动文档「可访问」）。返回分组与端点约定。 */
const API_OVERVIEW = {
  title: 'one-api',
  description: 'AI native 数据库 HTTP API',
  groups: {
    auth: '鉴权：POST /api/auth/login、POST /api/auth/logout、GET /api/auth/me、PUT /api/auth/password（session）',
    table: '表管理：GET/POST /api/admin/tables、POST /api/admin/tables/import、PUT/DELETE /api/admin/tables/:id、POST /api/admin/tables/:id/refresh（session）',
    'admin-data': '数据浏览：GET/POST /api/admin/tables/:id/data、GET/PUT/DELETE .../data/:pk、GET .../export（session, internal）',
    token: 'Token 管理：GET/POST /api/admin/tokens、PUT/DELETE /api/admin/tokens/:id（session）',
    admin: '管理员管理：GET/POST /api/admin/admins、PUT/DELETE /api/admin/admins/:id（session）',
    data: '对外数据：GET /api/data/:table、GET .../schema、GET/POST/PUT/DELETE .../records[/:pk]、POST .../incr（Token）',
    'data-schema': '对外 Schema：POST /api/data/_schema/tables、POST /api/data/_schema/tables/:table/fields（Token, schema action）',
  },
  health: 'GET /healthz',
  authScheme: '管理通道用 session cookie；对外通道用 Authorization: Bearer oa_xxx',
};

/**
 * 装配 @leizm/web app：全局中间件链 + healthz + 业务路由组 + 404/错误兜底。
 * 业务路由组通过 registerRoutes 注入。
 *
 * 中间件顺序（@leizm/web 按函数参数个数区分普通/错误处理中间件）：
 *   1. 请求日志（普通）
 *   2. healthz 路由
 *   3. 业务路由组（registerRoutes）
 *   4. notFound 兜底（普通，路由未匹配时写 404 JSON）
 *   5. errorMiddleware（错误处理，length=2，仅出错时调用）
 */
export function buildApp(opts: BuildAppOptions): AppApplication {
  const app = new AppApplication();

  // 1. 请求日志（普通中间件：单参数 + 末尾 ctx.next()）
  app.use('/', (ctx: AppContext) => {
    log.request('%s %s', ctx.request.method, ctx.request.path);
    ctx.next();
  });

  // 2. healthz（健康检查，无需鉴权）+ API 文档概览
  const health = new AppRouter();
  health.get(
    '/healthz',
    ((ctx) => {
      ctx.response.json(ok({ status: 'ok' }));
    }) as Middleware,
  );
  health.get(
    '/api/_docs',
    ((ctx) => {
      ctx.response.json(ok(API_OVERVIEW));
    }) as Middleware,
  );
  app.use('/', health);

  // 3. 业务路由组（auth/admin/data）由 registerRoutes 挂载
  opts.registerRoutes(app);

  // 4. 404 兜底（普通中间件，单参数）
  app.use('/', notFoundMiddleware);
  // 5. 错误中间件（错误处理中间件，双参数，仅出错时调用）
  app.use('/', errorMiddleware);

  return app;
}
