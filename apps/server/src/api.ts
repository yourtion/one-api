import ERest from 'erest';

/**
 * erest 单例；各 module 用 `api.api.<method>(path)` 注册路由。
 *
 * erest 是 CJS 模块，类型由 apps/server/src/types/erest.d.ts 桥接（修 CJS default 互操作：
 * 原生 .d.ts 的 `import X from 'erest'` 在 NodeNext 下不可 new）。
 */
export const api = new ERest<unknown>({
  info: {
    title: 'one-api',
    description: 'AI native 数据库 HTTP API',
    version: new Date(),
    host: 'http://localhost:3000',
    basePath: '/api',
  },
  groups: {
    auth: '鉴权（登录/登出/改密）',
    table: '表管理（导入/新建/刷新/删除）',
    'admin-data': '管理员数据浏览编辑',
    token: 'Token 管理',
    admin: '管理员管理',
    data: '对外数据 CRUD（Token 鉴权）',
    'data-schema': '对外 Schema（Token 鉴权）',
  },
});
