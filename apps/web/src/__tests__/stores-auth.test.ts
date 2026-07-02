import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

// mock 整个 api/index 模块
vi.mock('../api/index.js', () => ({
  ApiRequestError: class ApiRequestError extends Error {},
  login: vi.fn(),
  fetchMe: vi.fn(),
  changeMyPassword: vi.fn(),
  logout: vi.fn(),
}));

import { useAuthStore } from '../stores/auth.js';
import * as apiMod from '../api/index.js';

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
});
afterEach(() => vi.restoreAllMocks());

describe('auth store', () => {
  it('初始：未登录', () => {
    const s = useAuthStore();
    expect(s.isLoggedIn).toBe(false);
    expect(s.currentUser).toBeNull();
  });

  it('login 成功 → 设置 currentUser + mustChangePassword', async () => {
    vi.mocked(apiMod.login).mockResolvedValue({
      admin: { id: 1, name: 'admin', nickname: 'A', mustChangePassword: true },
      mustChangePassword: true,
    });
    const s = useAuthStore();
    await s.login('admin', '123456');
    expect(s.currentUser?.id).toBe(1);
    expect(s.mustChangePassword).toBe(true);
    expect(s.isLoggedIn).toBe(true);
  });

  it('fetchMe 401 → 清空登录态', async () => {
    vi.mocked(apiMod.fetchMe).mockRejectedValue(Object.assign(new Error('未登录'), { isUnauthorized: true }));
    const s = useAuthStore();
    s.currentUser = { id: 1, name: 'admin', nickname: 'A', mustChangePassword: false };
    await s.fetchMe();
    expect(s.currentUser).toBeNull();
  });

  it('changePassword 成功 → mustChangePassword 置 false', async () => {
    vi.mocked(apiMod.changeMyPassword).mockResolvedValue({ success: true });
    const s = useAuthStore();
    s.currentUser = { id: 1, name: 'admin', nickname: 'A', mustChangePassword: true };
    await s.changePassword('123456', 'newpass');
    expect(s.mustChangePassword).toBe(false);
  });

  it('logout → 清空', async () => {
    vi.mocked(apiMod.logout).mockResolvedValue({ success: true });
    const s = useAuthStore();
    s.currentUser = { id: 1, name: 'admin', nickname: 'A', mustChangePassword: false };
    await s.logout();
    expect(s.currentUser).toBeNull();
  });

  it('fetchMe 非 401 错误 → 重抛且不清空登录态', async () => {
    vi.mocked(apiMod.fetchMe).mockRejectedValue(Object.assign(new Error('服务器错误'), { isUnauthorized: false }));
    const s = useAuthStore();
    s.currentUser = { id: 1, name: 'admin', nickname: 'A', mustChangePassword: false };
    await expect(s.fetchMe()).rejects.toThrow('服务器错误');
    expect(s.currentUser?.id).toBe(1); // 未被清空
  });

  it('logout 即使 API 失败也清空登录态', async () => {
    vi.mocked(apiMod.logout).mockRejectedValue(new Error('网络错误'));
    const s = useAuthStore();
    s.currentUser = { id: 1, name: 'admin', nickname: 'A', mustChangePassword: false };
    await expect(s.logout()).rejects.toThrow('网络错误');
    expect(s.currentUser).toBeNull(); // finally 仍清空
  });
});
