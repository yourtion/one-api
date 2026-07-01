import { createApp } from 'vue';
import { createPinia } from 'pinia';
import ElementPlus from 'element-plus';
import * as ElementPlusIconsVue from '@element-plus/icons-vue';
import App from './App.vue';
import router from './router/index.js';
import { setupEditor } from './lib/editor.js';
import 'element-plus/dist/index.css';
import './styles/global.css';

const app = createApp(App);
app.use(createPinia());
// element-plus 全量注册（图标 + setComponent 用字符串名 'el-input' 等依赖全局注册）
app.use(ElementPlus);
for (const [key, comp] of Object.entries(ElementPlusIconsVue)) {
  app.component(key, comp);
}
setupEditor();
app.use(router);
app.mount('#app');
