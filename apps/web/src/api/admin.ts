import { api } from './index.js';
import type { AdminVO } from './types.js';

export function listAdmins(): Promise<AdminVO[]> {
  return api('get', '/admin/admins');
}

export function createAdmin(name: string, nickname: string, password: string): Promise<AdminVO> {
  return api('post', '/admin/admins', { data: { name, nickname, password } });
}

export function updateAdmin(id: number, patch: { nickname?: string; password?: string }): Promise<{ success: boolean }> {
  return api('put', `/admin/admins/${id}`, { data: patch });
}

export function deleteAdmin(id: number): Promise<{ success: boolean }> {
  return api('delete', `/admin/admins/${id}`);
}
