import { createRequire } from 'node:module';
import type { ERestInstance } from 'erest';

/**
 * erest 是 CJS 模块（package.json type:null）。其运行时导出挂在 module.exports：
 *   - module.exports.default = ERest 构造器
 *   - module.exports.z = zod
 * 在 verbatimModuleSyntax + NodeNext 下，`import ERest from 'erest'` 经 tsc 原样输出后，
 * 运行时 ERest = 整个 module.exports 命名空间（不可 new）。故用 createRequire 取 .default。
 * 类型由 apps/server/src/types/erest.d.ts 桥接。
 */
const require = createRequire(import.meta.url);
const erestModule = require('erest') as {
  default: new <T = unknown>(opts?: Record<string, unknown>) => ERestInstance<T>;
};
const ERest = erestModule.default;

/**
 * 创建一个独立的 erest 实例（每个路由组各自一个，避免跨组路由污染 + 测试重复注册问题）。
 *
 * 真实绑定（官方 leizmweb 模式）：`instance.bind({ framework: 'leizmweb', router })`，
 * checker 把 Zod 校验结果挂到 `ctx.request.$params`（扁平合并 params+query+body+headers）。
 */
export function createApi(): ERestInstance<unknown> {
  return new ERest<unknown>({
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
}
