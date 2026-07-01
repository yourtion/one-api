<script setup lang="ts">
import { computed } from 'vue';
import { useRouter, RouterView } from 'vue-router';
import { useAuthStore } from '../stores/auth.js';

const router = useRouter();
const auth = useAuthStore();

const navItems = [
  { name: 'dashboard', label: '概览', icon: 'Dashboard' },
  { name: 'tables', label: '表管理', icon: 'Files' },
  { name: 'tokens', label: 'Token', icon: 'Key' },
  { name: 'admins', label: '管理员', icon: 'UserFilled' },
  { name: 'settings', label: '设置', icon: 'Setting' },
];

async function onLogout() {
  await auth.logout();
  router.replace({ name: 'login' });
}

const currentName = computed(() => auth.currentUser?.nickname || auth.currentUser?.name || '');
</script>

<template>
  <div class="layout">
    <aside class="sidebar">
      <div class="brand">
        <span class="brand-mark">◆</span>
        <span class="brand-text">one-api</span>
      </div>
      <nav class="nav">
        <router-link v-for="item in navItems" :key="item.name" :to="{ name: item.name }" class="nav-item" active-class="active">
          <el-icon><component :is="item.icon" /></el-icon>
          <span>{{ item.label }}</span>
        </router-link>
      </nav>
    </aside>
    <div class="main">
      <header class="topbar">
        <div class="topbar-user">
          <el-icon><UserFilled /></el-icon>
          <span class="mono">{{ currentName }}</span>
        </div>
        <el-button link type="primary" @click="onLogout">登出</el-button>
      </header>
      <main class="content">
        <RouterView v-slot="{ Component }">
          <transition name="fade" mode="out-in">
            <component :is="Component" />
          </transition>
        </RouterView>
      </main>
    </div>
  </div>
</template>

<style scoped>
.layout {
  display: flex;
  height: 100%;
}
.sidebar {
  width: 232px;
  background: var(--c-sidebar);
  color: var(--c-sidebar-fg);
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
}
.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 20px 22px;
  font-weight: 800;
  font-size: 17px;
  color: #fff;
  letter-spacing: -0.01em;
}
.brand-mark {
  color: var(--c-primary);
}
.nav {
  display: flex;
  flex-direction: column;
  padding: 8px 12px;
  gap: 2px;
}
.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: var(--radius-sm);
  color: var(--c-sidebar-fg);
  text-decoration: none;
  font-size: 14px;
  font-weight: 500;
  transition: background 0.12s, color 0.12s;
}
.nav-item:hover {
  background: rgba(255, 255, 255, 0.06);
  color: #fff;
}
.nav-item.active {
  background: rgba(16, 185, 129, 0.14);
  color: var(--c-sidebar-active);
}
.main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.topbar {
  height: 56px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 24px;
  background: var(--c-surface);
  border-bottom: 1px solid var(--c-border);
}
.topbar-user {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--c-text-muted);
  font-size: 14px;
}
.content {
  flex: 1;
  overflow: auto;
}
</style>
