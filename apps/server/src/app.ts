import * as web from '@leizm/web';
import { LeizmWebAdapter } from '@erest/leizmweb';
import { ERestError } from 'erest';
import { AppError } from '@1api/shared';
import { log } from './utils/logger.js';
import { applySessionMiddleware } from './middlewares/session.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerTableRoutes } from './routes/table.js';
import { registerAdminDataRoutes } from './routes/admin-data.js';
import { registerTokenRoutes } from './routes/token.js';
import { registerAdminRoutes } from './routes/admins.js';
import { registerDataRoutes } from './routes/data.js';
import { registerDataSchemaRoutes } from './routes/data-schema.js';
import { api } from './api/instance.js';

/**
 * 装配 @leizm/web app（纯 erest-first）：
 * 1. 全局前置中间件：bodyParser + 请求日志
 * 2. healthz 等非 /api 端点挂在根 /（原生 router，留给 Phase3 web 静态等）
 * 3. 全部 /api/* 归 erest：建一个 web.Router 作为 erest 的挂载载体，bind 后挂到 app /api
 * 4. app 级错误中间件（双参数）：兜底信封 {success:false, error:{code,message}}
 *    （erest 路由的错误已由 enveloper 的 error 函数统一包装；此中间件兜底非 erest 路由）
 *
 * routes 直接从全局单例（api / getSystemDb）取依赖，无需传参。
 */
export function buildApp(): web.Application {
  const app = new web.Application();

  // 1. 全局前置中间件
  app.use('/', web.component.bodyParser.json());
  app.use('/', web.component.bodyParser.urlencoded({ extended: true }));
  // cookieParser + session（admin 通道会话载体；顺序敏感，须在读取 session 的路由前装配）
  applySessionMiddleware(app);
  app.use('/', (ctx) => {
    log.request('%s %s', ctx.request.method, ctx.request.path);
    ctx.next();
  });

  // 2. healthz（非 /api，挂在根）
  const rootRouter = new web.Router();
    rootRouter.get('/healthz', (ctx) => {
    ctx.response.json({ success: true, data: { status: 'ok' } });
  });
  app.use('/', rootRouter);

  // 3. 注册全部路由组（传全局 api 单例；systemDb 从 getSystemDb() 取）
  registerAuthRoutes(api);
  registerTableRoutes(api);
  registerAdminDataRoutes(api);
  registerTokenRoutes(api);
  registerAdminRoutes(api);
  registerDataRoutes(api);
  registerDataSchemaRoutes(api);

  // erest 挂在单一 /api web.Router 下
  const apiRouter = new web.Router();
  api.bind({ adapter: new LeizmWebAdapter(), app: apiRouter, router: web.Router });
  app.use('/api', apiRouter);

  // 4. app 级错误中间件（双参数）：统一信封
  app.use('/', (ctx, err) => {
    if (!err) {
      ctx.next();
      return;
    }
    // erest /api/* 路由的错误已由 enveloper 的 error 函数统一包装（wrapWithEnvelope catch）。
    // 此中间件兜底非 erest 路由 / 逃逸到 app 级的异常，统一按信封格式响应。
    // 未知错误（非 AppError/ERestError）仅 log.error 记录 stack，响应体不泄露内部 message。
    const e = err as Error & { statusCode?: number; code?: string };
    const isKnown = err instanceof AppError || err instanceof ERestError;
    log.error('未捕获错误: %s', e.stack ?? e.message);
    if (!ctx.response.headersSent) {
      ctx.response.status(e.statusCode ?? 500).json({
        success: false,
        error: { code: e.code ?? 'INTERNAL_ERROR', message: isKnown ? e.message : '服务器内部错误' },
      });
    }
  });

  return app;
}
