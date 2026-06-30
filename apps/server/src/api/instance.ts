import { createERest } from '@erest/leizmweb';
import type { ERest, Middleware } from 'erest';
import { API_INFO, GROUPS } from './groups.js';
import type { CurrentAdmin, CurrentToken } from '../hooks.js';

/**
 * 全局响应信封配置（success/error/testUnwrapper）。
 *
 * 导出供 __tests__/helpers.ts 复用（测试用独立 erest 实例，需同样注册）。
 * - success：handler return data → { success: true, data }
 * - error：抛错 → { success: false, error: { code, message } } + statusCode
 * - testUnwrapper：测试脚手架从信封拆出内层 data/error（供 success()/error() 语义）
 */
export const responseEnvelopers = {
  success: (data: unknown) => ({ success: true, data }),
  error: (err: unknown) => {
    const e = err as { statusCode?: number; code?: string; message?: string };
    return {
      body: { success: false, error: { code: e.code ?? 'INTERNAL_ERROR', message: e.message ?? '服务器内部错误' } },
      status: e.statusCode ?? 500,
    };
  },
  testUnwrapper: (out: unknown): [Error | null, unknown] => {
    const o = out as { success?: boolean; data?: unknown; error?: { code?: string; message?: string } };
    if (o && typeof o === 'object' && 'success' in o) {
      if (o.success) return [null, o.data];
      return [new Error(o.error ? `${o.error.code}: ${o.error.message}` : '请求失败'), null];
    }
    return [null, out];
  },
} as const;

/**
 * 应用级 state 类型（before 钩子注入，handler 类型安全读取）。
 *
 * 注意：必须用 `type` alias 而非 `interface`——erest 的 State 约束为
 * `extends Record<string, unknown>`，type alias 对象有隐式 index signature 可满足，
 * interface 则无（会触发 TS2344）。
 */
type AppState = {
  currentToken?: CurrentToken;
  currentUser?: CurrentAdmin;
};

/** 应用级 ERest 实例类型（含 AppState，供 route 注册函数使用以获得 typed state） */
export type AppApi = ERest<Middleware, unknown, AppState>;

/**
 * 全局唯一 ERest 单例（forceGroup 模式 + AppState 类型安全）。
 *
 * 用 @erest/leizmweb 的 createERest 工厂创建（v3.2：构造时锁定 LeizmWebRaw + State），
 * handler 内 ctx.reply.raw 自动推导，ctx.state 类型安全。
 */
export const api = createERest<AppState>({
  info: API_INFO,
  groups: GROUPS,
  forceGroup: true,
});

// 注册全局响应信封（替代 utils/response.ts 的 ok/fail + 每处 reply.json(ok())）
api.setResponseEnvelopers(responseEnvelopers);
