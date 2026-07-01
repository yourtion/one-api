import { createApp } from 'vue';
import App from './App.vue';

// 最小占位 router（Task 8 替换为真实 router）
import { createRouter, createWebHistory } from 'vue-router';
const router = createRouter({
  history: createWebHistory('/admin/'),
  routes: [{ path: '/', component: { template: '<div>one-api web ok</div>' } }],
});

createApp(App).use(router).mount('#app');
