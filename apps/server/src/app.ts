import * as web from '@leizm/web';
import { LeizmWebAdapter } from '@erest/leizmweb';
import { ERestError } from 'erest';
import { AppError } from '@1api/shared';
import { resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { log } from './utils/logger.js';
import { getSystemDb } from './core/system-db.js';
import { createMcpMiddleware } from './modules/mcp/transport.js';

// 当前模块目录（dist 下，静态根默认相对此处的 static/admin）
const here = fileURLToPath(new URL('.', import.meta.url));
const require = createRequire(import.meta.url);
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
 * 解析 /admin 静态根目录，优先级：
 * 1. options.adminRoot（serve 注入，生产路径）
 * 2. ONE_API_ADMIN_ROOT env（测试注入）
 * 3. require.resolve('@1api/web/dist') —— @1api/web 包已装（monorepo 内 / serve 包）
 * 4. 仓库内 apps/web/dist（纯源码开发兜底）
 * 5. 都没有 → undefined（纯 API 模式，不挂 web）
 */
function resolveAdminRoot(injected?: string): string | undefined {
  if (injected) return injected;
  const envRoot = process.env['ONE_API_ADMIN_ROOT'];
  if (envRoot) return envRoot;
  try {
    const pkgPath = require.resolve('@1api/web/package.json');
    return resolvePath(pkgPath, '../dist');
  } catch { /* @1api/web 未装，继续 */ }
  const devPath = resolvePath(here, '../../web/dist');
  return existsSync(devPath) ? devPath : undefined;
}

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
export function buildApp(options?: { adminRoot?: string }): web.Application {
  const app = new web.Application();

  // 1. 全局前置中间件
  // /mcp 必须在 bodyParser 之前注册：handler 直接拿原始 Node 流交给 MCP transport，
  // 不调 ctx.next() 短路 → bodyParser 永远不会读到 /mcp 请求体（transport 需自读流）。
  // 非 /mcp 路径由框架按前缀自动跳过本中间件。
  app.use('/mcp', createMcpMiddleware(getSystemDb()));
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

  // 3.5 Phase 3：/admin 静态托管 + SPA history fallback
  // 静态根由 resolveAdminRoot 决定（options 注入 > env > @1api/web 包 > 仓库兜底 > undefined 纯 API）
  // ⚠️ fallback 中间件保持原模式：serveStatic {index:false,fallthrough:true} + app.use('/admin', serve indexFile)。
  //   不能用裸 '*'（path-to-regexp v6 抛 Unexpected MODIFIER）；不能用 router.get('/admin/:splat*')（不匹配 /admin/ 空 splat）。
  const ADMIN_ROOT = resolveAdminRoot(options?.adminRoot);
  if (ADMIN_ROOT && existsSync(ADMIN_ROOT)) {
    app.use('/admin', web.component.serveStatic(ADMIN_ROOT, { index: false, fallthrough: true }));
    const indexFile = resolvePath(ADMIN_ROOT, 'index.html');
    app.use('/admin', (ctx) => {
      ctx.response.file(indexFile);
    });
  }

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
