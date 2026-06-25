import * as web from '@leizm/web';

/**
 * 全局共享的 session 存储单例。
 *
 * 关键：auth 路由登录时写入 session（adminId），admin 路由组读取同一 session 校验登录态。
 * 若各组各自 new SessionMemoryStore()，session 数据无法跨组共享 → admin 路由永远 401。
 * 故必须共享同一个 store 实例。
 */
export const sharedSessionStore = new web.component.SessionMemoryStore();

/** session 有效期 1 天（@leizm/web 默认 maxAge=0 会立即过期，必须传正值） */
export const SESSION_MAX_AGE = 86_400_000;

/** 统一的 session 中间件（共享 store + maxAge），供所有 session 鉴权路由组复用 */
export const sessionMiddleware = web.component.session({
  store: sharedSessionStore,
  maxAge: SESSION_MAX_AGE,
});
