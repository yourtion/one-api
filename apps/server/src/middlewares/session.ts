import * as web from '@leizm/web';

/**
 * Session 相关常量与装配逻辑（生产 app 与测试夹具共用，确保同构）。
 *
 * 设计：admin 通道用 @leizm/web 原生 session（cookie + SessionMemoryStore），
 * 非业务库持久化——进程重启 session 失效（MVP 可接受）。
 *
 * - cookieParser 必须在 session 之前装配（session 依赖它读 SID）。
 * - session.data.adminId：login 时写入，requireAdmin 读取，logout 时 destroy。
 */
export const SESSION_NAME = 'admin.sid';
export const SESSION_MAX_AGE = 8 * 60 * 60 * 1000; // 8h（毫秒；leizm/web session 顶层 maxAge 驱动 cookie Max-Age 与 store 过期）

/**
 * 在 @leizm/web app 上装配 cookieParser + session 中间件（顺序敏感）。
 * 生产 app.ts 与测试 helpers.ts 复用同一份逻辑，避免两侧 session 配置漂移。
 */
export function applySessionMiddleware(app: web.Application): void {
  app.use('/', web.component.cookieParser());
  app.use(
    '/',
    web.component.session({
      name: SESSION_NAME,
      maxAge: SESSION_MAX_AGE,
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
      },
    }),
  );
}
