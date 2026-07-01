import { http } from './index.js';
import type { ListQuery, ListResult } from './types.js';
import { request } from './request.js';

export async function listData<T = Record<string, unknown>>(tableId: number, query: ListQuery): Promise<ListResult<T>> {
  return request(http, 'get', `/admin/tables/${tableId}/data`, { params: query });
}

export async function getRecord<T = Record<string, unknown>>(tableId: number, pk: string): Promise<T> {
  return request<T>(http, 'get', `/admin/tables/${tableId}/data/${encodeURIComponent(pk)}`);
}

export async function createRecord(tableId: number, row: Record<string, unknown>): Promise<Record<string, unknown>> {
  return request(http, 'post', `/admin/tables/${tableId}/data`, { data: row });
}

export async function updateRecord(tableId: number, pk: string, row: Record<string, unknown>): Promise<{ success: boolean }> {
  return request(http, 'put', `/admin/tables/${tableId}/data/${encodeURIComponent(pk)}`, { data: row });
}

export async function deleteRecord(tableId: number, pk: string): Promise<{ success: boolean }> {
  return request(http, 'delete', `/admin/tables/${tableId}/data/${encodeURIComponent(pk)}`);
}

/** CSV 导出：返回 blob + 截断标记。直接用 http（绕开信封解包，responseType blob） */
export async function exportCsv(tableId: number, query: ListQuery): Promise<{ blob: Blob; truncated: boolean; total: number | null }> {
  const res = await http.get(`/admin/tables/${tableId}/export`, { params: query, responseType: 'blob' });
  const h = res.headers as Record<string, string>;
  return {
    blob: res.data as Blob,
    truncated: String(h['x-export-truncated'] ?? '') === 'true',
    total: h['x-export-total'] ? Number(h['x-export-total']) : null,
  };
}
