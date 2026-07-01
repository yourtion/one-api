import axios from 'axios';
import { request, ApiRequestError } from './request.js';

/** 全局 axios 实例：session cookie 携带 + JSON */
export const http = axios.create({
  baseURL: '/api',
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
  timeout: 30_000,
});

/** 便捷封装（解包信封） */
export async function api<T = unknown>(method: string, url: string, cfg?: Parameters<typeof request>[3]): Promise<T> {
  return request<T>(http, method as never, url, cfg);
}

export { ApiRequestError } from './request.js';
export * from './auth.js';
export * from './table.js';
export * from './admin-data.js';
export * from './token.js';
export * from './admin.js';
export * from './types.js';
