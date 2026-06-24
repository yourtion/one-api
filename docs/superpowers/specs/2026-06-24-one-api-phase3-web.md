# Phase 3：管理界面

> 所属：one-api ｜ 前置：Phase 2（HTTP API）｜ 成果：单进程一键启动 = API + 后台

## 目标

实现 `apps/web`：Vue3 + Vite + element-plus + vue-json-ui-editor 的管理界面。构建产物嵌入 server，生产环境单进程同时提供 API 和后台，达成真正的一键启动体验。

## 验收标准

- [ ] `pnpm dev` 并行启动 server + web（vite proxy `/api`）
- [ ] `pnpm build && pnpm start` 单进程：`http://localhost:3000/admin` 可访问完整后台
- [ ] 登录页：默认 admin/123456，首登强制改密
- [ ] 表管理：列表 / 导入已有表 / 新建模型（可视化字段表单）/ 编辑元数据 / 刷新结构 / 删除注册
- [ ] 数据浏览：列表（筛选/排序/搜索/分页）+ 新增/编辑（vue-json-ui-editor 渲染）+ 删除 + 导出
- [ ] Token 管理：创建（明文仅显示一次）/ 启停 / 编辑 permissions
- [ ] 管理员管理：列表 / 新建 / 改密 / 删除
- [ ] 响应式适配（桌面优先，移动端基本可用）
- [ ] 类型与 API 封装复用 `@1api/shared`

## 页面结构

```
/login                登录页
/admin                布局壳（顶栏 + 侧边栏 + 内容区）
  /dashboard          概览（表数/数据量/Token数/管理员数）
  /tables             表管理列表
    /tables/new       新建模型（可视化字段表单）
    /tables/import    导入已有表
    /tables/:id       表详情（元数据 + 字段编辑）
    /tables/:id/data  数据浏览
  /tokens             Token 管理
  /admins             管理员管理
  /settings           系统设置（业务库路径等，只读展示）
```

## 工作项

### 3.1 web 骨架

**`vite.config.ts`**
- Vue 插件 + element-plus 自动按需导入
- `build.outDir` → `path.resolve(__dirname, '../server/static/admin')`（注意：从 `apps/web` 出发是 `../server/`，不是 `../apps/server/`）
- dev 模式 `server.proxy`：`/api` → `http://localhost:3000`
- base: `/admin/`（生产由 server 托管在该路径）

**`src/main.ts`** —— Vue 应用初始化（element-plus / Pinia / router）
**`src/App.vue`** —— 根组件 + 全局错误处理
**`src/router/index.ts`** —— Vue Router + 路由守卫（未登录跳 `/login`）
**`src/stores/auth.ts`** —— 登录态（调 `/api/auth/me`）、`mustChangePassword` 标记
**`src/stores/table.ts`** —— 当前表元数据缓存（供数据浏览/表单复用）

### 3.2 API 封装（`src/api/`）

- `request.ts`：fetch/axios 封装，统一信封解包、错误码提示、session cookie 携带
- `auth.ts` / `table.ts` / `admin-data.ts` / `token.ts` / `admin.ts`：各模块 API 方法
- 类型从 `@1api/shared` 导入

### 3.3 vue-json-ui-editor 的两处核心用途

**用途①：数据编辑表单（浏览/编辑表数据）**
```
FieldMeta[]（table store）──shared 类型映射──→ JSON Schema
                                                 ↓
                                    vue-json-ui-editor 渲染表单
                                                 ↓
                                         用户填写 → 提交 API
```
- 进入「新增/编辑」时，用 `fieldsToJsonSchema(meta.fields)` 实时生成 schema
- `isHidden` 字段：从 properties 移除；`isReadonly`：设 `readOnly: true`
- 自增主键、`created_at`/`updated_at`：自动只读或不显示
- 用 element-plus 组件注册到 JsonEditor（按 README 的 `setComponent` API）

**用途②：模型字段编辑器（新建/编辑模型）**
- 「新建模型」页用固定预定义 schema 驱动一个 vue-json-ui-editor 表单，渲染「字段定义」本身
- 用户点「添加字段」→ 增加一行字段配置（名称/标签/类型/jsonType/可空/默认值/枚举）
- 提交时收集字段数组 → `POST /api/admin/tables`

### 3.4 页面实现

**登录页 `views/Login.vue`**
- 账号密码表单 → `/api/auth/login`
- `mustChangePassword` 为 true → 跳转改密页（强制）

**布局壳 `components/Layout.vue`**
- 顶栏：Logo + 当前用户 + 登出
- 侧边栏：导航（Dashboard / 表管理 / Token / 管理员 / 设置）
- 内容区：`<router-view>`

**Dashboard `views/Dashboard.vue`**
- 统计卡片：已注册表数、活跃 Token 数、管理员数（调 admin API 汇总）
- 最近注册的表列表

**表管理列表 `views/tables/TableList.vue`**
- el-table：表名 / 标签 / 字段数 / 记录数 / 状态（已发布/可编辑） / 操作
- 操作：查看数据 / 编辑元数据 / 刷新结构 / 删除注册（确认框）

**新建模型 `views/tables/TableNew.vue`**
- 表单：表名（蛇形校验+唯一）、标签、备注
- 字段配置区（vue-json-ui-editor 用途②）：动态字段行
- 选项：自动主键 id（默认勾选）/ 自动时间戳（默认勾选）
- 提交 → `POST /api/admin/tables` → 跳转数据浏览

**导入已有表 `views/tables/TableImport.vue`**
- 输入业务库已有表名 → `POST /api/admin/tables/import` → 返回推断的 FieldMeta
- 预览页：调整 label/标记 → `PUT /api/admin/tables/:id` 保存

**表详情 `views/tables/TableDetail.vue`**
- 基本信息编辑（label/note/is_published/is_editable）
- 字段列表（实际结构只读 + 可编辑 label/isHidden/isReadonly/enumValues）
- 「刷新结构」按钮

**数据浏览 `views/tables/DataBrowse.vue`**
- 筛选条：字段过滤 + 关键词搜索 + 排序
- el-table：列由 FieldMeta 生成（isHidden 不显示），datetime 格式化，boolean 渲染开关
- 分页（el-pagination）
- 操作：新增 / 编辑（vue-json-ui-editor 用途①）/ 删除（确认框）/ 导出
- `is_editable=false`：隐藏写操作按钮

**Token 管理 `views/Tokens.vue`**
- 列表 + 新建（name + permissions：表多选 + 动作多选，含「允许 Schema 变更」=schema action）
- 创建后明文仅显示一次（复制按钮 + 确认已保存）
- 启用/停用切换 / 编辑 / 删除

**管理员管理 `views/Admins.vue`**
- 列表 + 新建（name/nickname/password）+ 改密 + 删除（不可删自己）

**设置 `views/Settings.vue`**
- 只读展示：业务库路径、系统库路径、端口、已注册表数

### 3.5 静态文件集成验证

- `pnpm build`：web 产物输出到 `apps/server/static/admin/`
- `pnpm start`：server 的 static 中间件托管 `/admin/*`，入口 index.html
- 验证 SPA history fallback（所有 `/admin/*` 未命中 → 返回 index.html）

### 3.6 测试

- `@vue/test-utils` 组件测试：
  - `fieldsToJsonSchema` 生成正确（各类型字段 → 对应 schema）
  - 数据浏览列表列生成（isHidden 过滤）
  - 表单提交数据收集
- 纯函数测试（类型映射已在 Phase 1 覆盖，此处测 UI 适配层）
- E2E 可选（后期）

## 依赖

```jsonc
// apps/web
{ "dependencies": {
    "@1api/shared": "workspace:*",
    "vue": "^3.5",
    "vue-router": "^4",
    "pinia": "^2",
    "element-plus": "^2.11",
    "vue-json-ui-editor": "^3.0",
    "axios": "^1"
  },
  "devDependencies": {
    "vite": "^5", "@vitejs/plugin-vue": "^5",
    "unplugin-auto-import": "*", "unplugin-vue-components": "*",
    "typescript": "^5.8", "vue-tsc": "^2",
    "@vue/test-utils": "^2", "vitest": "^3", "jsdom": "*"
  } }
```

## 不在本期范围

- MCP（Phase 4）
- SDK / CLI（Phase 5）
- Token 管理的 schema action 选项实际生效（Phase 4 接入 MCP tools 后有意义，但 UI 本期提供）
