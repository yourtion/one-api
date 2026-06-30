import { createERest } from '@erest/leizmweb';
import type { ERest, Middleware } from 'erest';
import { ERestError } from 'erest';
import type { Context as LeiContext } from '@leizm/web';
import { AppError } from '@1api/shared';
import { API_INFO, GROUPS } from './groups.js';
import type { CurrentAdmin, CurrentToken } from '../hooks.js';

/**
 * erest Zod 校验失败错误码 → 项目统一业务码 VALIDATION_FAIL 的归一化映射。
 * erest 抛 ERestError（code ∈ MISSING_PARAM/INVALID_PARAM/VALIDATION_ERROR 等），
 * 但项目错误契约统一用 VALIDATION_FAIL，前端按此匹配，故需归一化。
 */
function normalizeErrorCode(code: unknown): string {
  if (code === 'MISSING_PARAM' || code === 'INVALID_PARAM' || code === 'VALIDATION_ERROR') return 'VALIDATION_FAIL';
  return (code as string | undefined) ?? 'INTERNAL_ERROR';
}

/**
 * 全局响应信封配置（success/error/testUnwrapper）。
 *
 * 导出供 __tests__/helpers.ts 复用（测试用独立 erest 实例，需同样注册）。
 * - success：handler return data → { success: true, data }
 * - error：抛错 → { success: false, error: { code, message } } + statusCode
 *   * AppError/ERestError（已知业务/校验错误）：返回真实 message + 归一化 code
 *   * 未知错误（如 better-sqlite3/TypeError）：固定返回「服务器内部错误」，
 *     避免泄露内部结构（文件路径/SQL 片段/变量名，OWASP 信息泄露），真实 message 仅 log.error
 * - testUnwrapper：测试脚手架从信封拆出内层 data/error（供 success()/error() 语义）
 */
export const responseEnvelopers = {
  success: (data: unknown) => ({ success: true, data }),
  error: (err: unknown) => {
    const e = err as { statusCode?: number; code?: string; message?: string };
    const isKnown = err instanceof AppError || err instanceof ERestError;
    const code = normalizeErrorCode(e.code);
    return {
      body: {
        success: false,
        error: { code, message: isKnown ? (e.message ?? '服务器内部错误') : '服务器内部错误' },
      },
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

/** 应用级 ERest 实例类型（含 AppState + LeizmWebRaw，供 route 注册函数使用以获得 typed state/raw） */
export type AppApi = ERest<Middleware, LeiContext, AppState>;

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
