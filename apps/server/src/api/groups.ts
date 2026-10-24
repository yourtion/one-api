import { ONE_API_VERSION } from '@1api/shared';
/**
 * 路由分组定义（forceGroup 模式）。
 *
 * prefix 不含 /api：erest 整体挂在 app 的 /api 子 router 下（app.ts），最终路径 /api/<prefix>/*。
 * 这样根 / 可留给其他用途（healthz / Phase3 web 静态等），/api/* 全归 erest 管。
 *
 * - auth：登录/登出/改密（admin token 鉴权，login 返回 admin token）
 * - admin：表管理 + 数据浏览 + token + 管理员管理（admin token 鉴权，四组靠路径区分）
 * - data：对外 CRUD + schema（对外 token 鉴权）
 */
export const API_INFO = {
  title: 'one-api',
  description: 'AI native 数据库 HTTP API',
  version: ONE_API_VERSION,
  host: 'http://localhost:3000',
  // basePath 用于文档生成；测试脚手架 findApi 用完整路径匹配，故设空（prefix 已含相对路径）。
  basePath: '',
} as const;

export const GROUPS = {
  auth: { name: '鉴权（登录/登出/改密）', prefix: '/auth' },
  admin: { name: '后台管理（表/数据/token/管理员）', prefix: '/admin' },
  data: { name: '对外数据 CRUD + Schema（Token 鉴权）', prefix: '/data' },
} as const;
