import type ERest from 'erest';

/**
 * 统一信封拆解器（供 erest 测试脚手架 success()/error() 识别 {success, data|error}）。
 *
 * 实际 HTTP 响应体始终是信封；此函数仅影响 api.test.<m>().success()/.error() 的语义：
 * - success:true → [null, data]：success() 直接返回 data
 * - success:false → [Error(code: message), null]：error() 拿到带 code/message 的 Error
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function applyEnvelopeFormat(api: ERest<any, any>): void {
  api.setFormatOutput((out: unknown): [Error | null, unknown] => {
    const body = out as { success?: boolean; data?: unknown; error?: { code?: string; message?: string } };
    if (body && typeof body === 'object' && 'success' in body) {
      if (body.success) return [null, body.data];
      const msg = body.error ? `${body.error.code}: ${body.error.message}` : '请求失败';
      return [new Error(msg), null];
    }
    return [null, out];
  });
}
