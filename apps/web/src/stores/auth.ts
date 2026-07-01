import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import * as api from '../api/index.js';
import type { CurrentAdmin } from '../api/types.js';

export const useAuthStore = defineStore('auth', () => {
  const currentUser = ref<CurrentAdmin | null>(null);
  const loading = ref(false);

  const isLoggedIn = computed(() => currentUser.value !== null);
  const mustChangePassword = computed(() => currentUser.value?.mustChangePassword ?? false);

  async function fetchMe(): Promise<void> {
    loading.value = true;
    try {
      currentUser.value = await api.fetchMe();
    } catch (e) {
      const err = e as { isUnauthorized?: boolean };
      if (err.isUnauthorized) currentUser.value = null;
      else throw e;
    } finally {
      loading.value = false;
    }
  }

  async function login(name: string, password: string): Promise<void> {
    const r = await api.login(name, password);
    currentUser.value = r.admin;
  }

  async function changePassword(oldPassword: string, newPassword: string): Promise<void> {
    await api.changeMyPassword(oldPassword, newPassword);
    if (currentUser.value) currentUser.value = { ...currentUser.value, mustChangePassword: false };
  }

  async function logout(): Promise<void> {
    try { await api.logout(); } finally { currentUser.value = null; }
  }

  return { currentUser, loading, isLoggedIn, mustChangePassword, fetchMe, login, changePassword, logout };
});
