import type { ApiResponse, ApiError } from '@1api/shared';

/** 成功信封 */
export function ok<T>(data: T): ApiResponse<T> {
  return { success: true, data };
}

/** 失败信封 */
export function fail(code: string, message: string): ApiError {
  return { success: false, error: { code, message } };
}
