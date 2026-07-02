import { api } from './index.js';
import type { CurrentAdmin } from './types.js';

export function login(name: string, password: string): Promise<{ admin: CurrentAdmin; mustChangePassword: boolean }> {
  return api('post', '/auth/login', { data: { name, password } });
}

export function fetchMe(): Promise<CurrentAdmin> {
  return api('get', '/auth/me');
}

export function changeMyPassword(oldPassword: string, newPassword: string): Promise<{ success: boolean }> {
  return api('put', '/auth/password', { data: { oldPassword, newPassword } });
}

export function logout(): Promise<{ success: boolean }> {
  return api('post', '/auth/logout');
}
