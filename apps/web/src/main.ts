import { createApp } from 'vue';
import App from './App.vue';
import { createRouter, createWebHistory } from 'vue-router';
// element-plus 基础样式（组件 JS 由 unplugin 自动按需导入，样式需手动引一次）
import 'element-plus/dist/index.css';
import './styles/global.css';

const router = createRouter({
  history: createWebHistory('/admin/'),
  routes: [{ path: '/', component: { template: '<div class="page"><h1 class="page-title">one-api 控制台</h1></div>' } }],
});

createApp(App).use(router).mount('#app');
