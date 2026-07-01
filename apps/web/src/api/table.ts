import type { TableMeta } from '@1api/shared';
import { api } from './index.js';
import type { CreateModelInput } from './types.js';

export function listTables(): Promise<TableMeta[]> {
  return api('get', '/admin/tables');
}

export function getTable(id: number): Promise<TableMeta> {
  return api('get', `/admin/tables/${id}`);
}

export function importTable(name: string): Promise<TableMeta> {
  return api('post', '/admin/tables/import', { data: { name } });
}

export function createTable(input: CreateModelInput): Promise<TableMeta> {
  return api('post', '/admin/tables', { data: input });
}

export function updateTable(
  id: number,
  patch: { label?: string; note?: string | null; isPublished?: boolean; isEditable?: boolean },
): Promise<TableMeta> {
  return api('put', `/admin/tables/${id}`, { data: patch });
}

export function refreshTable(id: number): Promise<TableMeta> {
  return api('post', `/admin/tables/${id}/refresh`);
}

export function deleteTable(id: number): Promise<{ success: boolean }> {
  return api('delete', `/admin/tables/${id}`, { params: { confirm: true } });
}
