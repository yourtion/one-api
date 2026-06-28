import type { Context, Middleware } from 'erest';

/**
 * erest register handler 的入参类型。
 *
 * erest 的 register(fn: T) 在泛型 T=unknown 下不会推导 fn 参数类型（implicit any），
 * 故各路由 handler 显式标注：`(ctx: HandlerCtx, next: NextFn) => ...`。
 * - ctx：erest 标准化上下文（headers/state/params/query/body/reply/$params/$body 等）
 * - next：调用链下一个中间件
 */
export type HandlerCtx = Context;
export type NextFn = Parameters<Middleware>[1];
