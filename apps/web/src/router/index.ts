import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';
import { useAuthStore } from '../stores/auth.js';

const routes: RouteRecordRaw[] = [
  { path: '/login', name: 'login', component: () => import('../views/Login.vue'), meta: { public: true } },
  {
    path: '/change-password',
    name: 'change-password',
    component: () => import('../views/ChangePassword.vue'),
    meta: { public: false, allowMustChange: true },
  },
  {
    path: '/',
    component: () => import('../components/Layout.vue'),
    children: [
      { path: '', redirect: { name: 'dashboard' } },
      { path: 'dashboard', name: 'dashboard', component: () => import('../views/Dashboard.vue') },
      { path: 'tables', name: 'tables', component: () => import('../views/tables/TableList.vue') },
      { path: 'tables/new', name: 'table-new', component: () => import('../views/tables/TableNew.vue') },
      { path: 'tables/import', name: 'table-import', component: () => import('../views/tables/TableImport.vue') },
      { path: 'tables/:id', name: 'table-detail', component: () => import('../views/tables/TableDetail.vue') },
      { path: 'tables/:id/data', name: 'table-data', component: () => import('../views/tables/DataBrowse.vue') },
      { path: 'tokens', name: 'tokens', component: () => import('../views/Tokens.vue') },
      { path: 'admins', name: 'admins', component: () => import('../views/Admins.vue') },
      { path: 'settings', name: 'settings', component: () => import('../views/Settings.vue') },
    ],
  },
  { path: '/:pathMatch(.*)*', redirect: { name: 'dashboard' } },
];

const router = createRouter({ history: createWebHistory('/admin/'), routes });

router.beforeEach(async (to) => {
  const auth = useAuthStore();
  // 首次进入拉取登录态（仅一次）
  if (!auth.currentUser && !auth.loading) {
    try {
      await auth.fetchMe();
    } catch {
      /* 401 已清空 */
    }
  }
  if (to.meta.public) return true;
  if (!auth.isLoggedIn) return { name: 'login' };
  // 强制改密：除 change-password 外一律拦截
  if (auth.mustChangePassword && !to.meta.allowMustChange) return { name: 'change-password' };
  return true;
});

export default router;
