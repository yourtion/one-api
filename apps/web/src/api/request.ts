import type { AxiosInstance, AxiosRequestConfig, Method } from 'axios';

/** 解析后的业务错误（统一形态） */
export class ApiRequestError extends Error {
  readonly code: string;
  readonly status: number;
  readonly isUnauthorized: boolean;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'ApiRequestError';
    this.code = code;
    this.status = status;
    this.isUnauthorized = status === 401 || code === 'UNAUTHORIZED' || code === 'INVALID_TOKEN';
  }
}

interface EnvelopeOk<T> { success: true; data: T }
interface EnvelopeErr { success: false; error: { code: string; message: string } }

/**
 * 统一请求：解包信封。
 * - 成功 → 返回 data
 * - 业务错误信封 → 抛 ApiRequestError(code, message)
 * - HTTP 异常（axios throw）→ 从 error.response.data.error 取，否则 INTERNAL_ERROR
 */
export async function request<T = unknown>(
  ax: AxiosInstance,
  method: Method,
  url: string,
  cfg?: AxiosRequestConfig,
): Promise<T> {
  try {
    const res = await dispatch<T>(ax, method, url, cfg);
    const body = res.data;
    if (body && typeof body === 'object' && 'success' in body) {
      if (body.success) return body.data;
      throw new ApiRequestError(body.error.code, body.error.message, 200);
    }
    // 非信封（如 CSV blob）：原样返回
    return body as T;
  } catch (err) {
    // 业务错误已解包，原样抛出，避免被当作 HTTP/网络错误重新包装
    if (err instanceof ApiRequestError) throw err;
    const e = err as { response?: { status?: number; data?: EnvelopeErr }; message?: string };
    if (e.response) {
      const status = e.response.status ?? 500;
      const errBody = e.response.data?.error;
      throw new ApiRequestError(errBody?.code ?? 'INTERNAL_ERROR', errBody?.message ?? '服务器内部错误', status);
    }
    throw new ApiRequestError('INTERNAL_ERROR', e.message ?? '网络错误', 0);
  }
}

/** 按 HTTP 方法分派到对应的 axios 调用（get/post/put/delete/patch）。 */
async function dispatch<T>(
  ax: AxiosInstance,
  method: Method,
  url: string,
  cfg?: AxiosRequestConfig,
): Promise<{ data: EnvelopeOk<T> | EnvelopeErr }> {
  const m = method.toLowerCase();
  // get/delete/head/options: (url, config?)
  // post/put/patch: (url, data?, config?)
  switch (m) {
    case 'get':
    case 'head':
    case 'options':
      return ax[m](url, cfg) as Promise<{ data: EnvelopeOk<T> | EnvelopeErr }>;
    case 'delete':
      // axios 的 delete 签名支持 (url, config?) 或 (url, data?, config?)
      return ax.delete(url, cfg) as Promise<{ data: EnvelopeOk<T> | EnvelopeErr }>;
    case 'post':
      return ax.post(url, cfg?.data, cfg) as Promise<{ data: EnvelopeOk<T> | EnvelopeErr }>;
    case 'put':
      return ax.put(url, cfg?.data, cfg) as Promise<{ data: EnvelopeOk<T> | EnvelopeErr }>;
    case 'patch':
      return ax.patch(url, cfg?.data, cfg) as Promise<{ data: EnvelopeOk<T> | EnvelopeErr }>;
    default:
      // 未知方法回退到通用 request
      return ax.request({ method, url, ...cfg }) as Promise<{ data: EnvelopeOk<T> | EnvelopeErr }>;
  }
}
