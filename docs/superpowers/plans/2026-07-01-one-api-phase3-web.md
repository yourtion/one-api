# Phase 3：管理界面（apps/web）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **设计技能：** 界面设计/开发**必须**遵循 `frontend-design` 技能（已读取）。本计划在 Task 2 锁定一个明确的美学方向（"Control Console"）并在全局样式中落地。

**Goal:** 实现 `apps/web`——Vue3 + Vite + element-plus + vue-json-ui-editor 的管理界面。构建产物输出到 `apps/server/static/admin/`，由 server 单进程托管，达成 `pnpm build && pnpm start` 一键启动 = API + 后台。

**Architecture:** 前端是 Phase 2 HTTP API 的消费者。`src/api/` 用 axios 封装统一信封解包 + session cookie 携带；Pinia 管 auth/table 状态；vue-router 守卫拦未登录。vue-json-ui-editor 用于**数据编辑表单**（`FieldMeta[]`→JSONSchema→表单，复用 `@1api/shared` 的 `fieldsToJsonSchema`）；**模型字段编辑器**因该库不支持动态数组（详见 Task 9 背景说明），改用 element-plus 手搓动态字段行（用户已授权"有问题可直接迭代优化"）。

**Tech Stack:** Vue 3.5 + Vite 5 + element-plus 2.11（按需自动导入）+ Pinia 2 + vue-router 4 + axios 1 + vue-json-ui-editor 3.0.1 + @1api/shared（workspace）。测试：@vue/test-utils 2 + Vitest 3 + jsdom。TS strict（ESM）。

---

## 关键背景知识（实施前必读）

> 这些是从 Phase 2 server 源码 + vue-json-ui-editor 源码 + @leizm/web 源码**确认**的事实，后续 task 直接引用。

### 响应信封（所有 /api/* 通用）

```jsonc
// 成功
{ "success": true, "data": <任意> }
// 失败
{ "success": false, "error": { "code": "<CODE>", "message": "<msg>" } }
```
- 已知错误（AppError / erest ERestError）透传真实 message；未知错误 message 固定 `"服务器内部错误"`（不泄露内部结构）。
- erest 校验错误码统一归一为 `VALIDATION_FAIL`。

### Session 鉴权（admin 通道）

- Cookie 名 **`admin.sid`**（httpOnly + sameSite:lax + path:/）。axios 必须 `withCredentials: true`，浏览器自动携带。
- 登录 `POST /api/auth/login` 后 cookie 自动写入；登出 `POST /api/auth/logout` 销毁。
- `/api/auth/*` 与 `/api/admin/*` 走 session；`/api/data/*` 走 `Authorization: Bearer oa_xxx`（本期 admin 界面不直接用 data 通道，走 admin-data 通道）。

### 关键 API 端点（完整清单，后续 task 直接用）

**Auth：**
| Method+Path | Body/Query | 成功 data |
|---|---|---|
| `POST /api/auth/login` | `{name,password}` | `{admin:{id,name,nickname,mustChangePassword}, mustChangePassword}` |
| `GET /api/auth/me` | — | `{id,name,nickname,mustChangePassword}` (mustChangePassword 为 boolean) |
| `PUT /api/auth/password` | `{oldPassword,newPassword}` (newPassword min 6) | `{success:true}` (并清除 mustChangePassword) |
| `POST /api/auth/logout` | — | `{success:true}` |

**表管理（`/api/admin/tables`，session）：**
| Method+Path | 输入 | 成功 data |
|---|---|---|
| `GET /api/admin/tables` | — | `TableMeta[]` |
| `GET /api/admin/tables/:id` | path:id | `TableMeta` |
| `POST /api/admin/tables/import` | `{name}` | `TableMeta` |
| `POST /api/admin/tables` | `CreateModelInput`（见下） | `TableMeta` |
| `PUT /api/admin/tables/:id` | `{label?,note?,isPublished?,isEditable?}`（全可选） | `TableMeta` |
| `POST /api/admin/tables/:id/refresh` | path:id | `TableMeta` |
| `DELETE /api/admin/tables/:id?confirm=true` | **query** confirm=true | `{success:true}` |

`CreateModelInput`（提交新建模型）：
```ts
{ name: string; label: string; fields: FieldMetaInput[]; note?: string | null; autoTimestamps?: boolean }
```
`FieldMetaInput`（每行字段配置）：
```ts
{ name: string; jsonType: 'string'|'integer'|'number'|'boolean'|'datetime';
  label?: string; nullable?: boolean; defaultValue?: unknown;
  isPrimary?: boolean; isAutoIncrement?: boolean; isHidden?: boolean; isReadonly?: boolean; enumValues?: string[] }
```

**管理员数据浏览（`/api/admin/tables/:id/...`，session，internal 通道，绕过 isPublished/isEditable）：**
| Method+Path | 输入 | 成功 data |
|---|---|---|
| `GET .../data` | query: `page,size,order,q,field__op=v` | `ListResult` = `{rows,total,page,size}` |
| `GET .../export` | 同上 query | **CSV blob**（非信封！`text/csv`，头 `X-Export-Truncated`/`X-Export-Total` 标记截断，上限 10000 行） |
| `GET .../data/:pk` | path:pk | 行对象（404 若无） |
| `POST .../data` | body:任意行对象 | 创建的行 |
| `PUT .../data/:pk` | body:任意行对象 | `{success:true}` |
| `DELETE .../data/:pk` | path:pk | `{success:true}` |

**Token（`/api/admin/tokens`，session）：**
| Method+Path | 输入 | 成功 data |
|---|---|---|
| `GET` | — | `TokenListVO[]`（**snake_case**：id,name,token_prefix,permissions,is_active,expires_at,last_used_at,created_at,updated_at） |
| `POST` | `{name, permissions:{tables, actions:['read','write','schema']}}` | `TokenCreateVO`（**camelCase**：id,name,**token(明文,仅一次)**,tokenPrefix,permissions） |
| `PUT /:id` | `{name?,permissions?,isActive?,expiresAt?}`（全可选） | `{success:true}` |
| `DELETE /:id` | — | `{success:true}` |

`permissions.tables` 可含 `'*'`（通配）。`actions` 的 `'schema'` 即"允许 Schema 变更"。

**管理员（`/api/admin/admins`，session）：**
| Method+Path | 输入 | 成功 data |
|---|---|---|
| `GET` | — | `AdminVO[]`（**snake_case**：id,name,nickname,must_change_password,created_at,updated_at） |
| `POST` | `{name,nickname,password}` (password min 6) | `AdminVO` |
| `PUT /:id` | `{nickname?,password?}`（password min 6；改密会重置 must_change_password=1） | `{success:true}` |
| `DELETE /:id` | — | `{success:true}`（删自己 → 400 `VALIDATION_FAIL 不可删除自己`） |

### 类型来源（直接从 `@1api/shared` import type）

- `FieldMeta`：`{name,label,sqliteType,jsonType,nullable,defaultValue,isPrimary,isAutoIncrement,isHidden,isReadonly,enumValues?}`（注意是 `nullable` 不是 `isNullable`）。
- `TableMeta`：`{id,name,label,primaryKey,fields:FieldMeta[],isPublished,isEditable,note:string|null,createdAt,updatedAt}`。
- `JsonType = 'string'|'integer'|'number'|'boolean'|'datetime'`。
- `ListResult<T> = {rows:T[], total, page, size}`（**rows 不是 items；无 hasMore**）。
- `ApiResponse<T>` / `ApiError`（信封类型）。
- `NAME_REGEX = /^[a-z][a-z0-9_]*$/`；`isValidName(name)` / `isReservedName(name)`（保留字：`schema`/`records`/`incr`）。
- `fieldsToJsonSchema(fields): Record<string,unknown>` —— **已存在**，返回 `{type:'object', properties, required}`。本期 Task 8 在其基础上写一个**编辑器适配器**（处理 isHidden/isReadonly/datetime widget）。
- `DEFAULT_PAGE=1, DEFAULT_SIZE=20, MAX_SIZE=100`。
- `ErrorCode`（含 `UNAUTHORIZED`/`INVALID_TOKEN`/`FORBIDDEN`/`VALIDATION_FAIL`/`TABLE_NOT_FOUND` 等）。

> **类型导入约定：** `@1api/shared` 的接口用 `export type *` 导出，**必须** `import type { FieldMeta } from '@1api/shared'`；常量/函数/class 用普通 import。受 `verbatimModuleSyntax` 约束。

### vue-json-ui-editor（v3.0.1）关键 API

```ts
import JsonEditor, { type JsonSchema } from 'vue-json-ui-editor';
import { ElOption } from 'element-plus';

// 静态注册（模块级单例，应用启动时调一次）：
JsonEditor.setComponent('form', 'el-form', ({ vm }) => ({ labelWidth: '120px', model: vm.model /* +rules */ }));
JsonEditor.setComponent('label', 'el-form-item', ({ field }) => ({ prop: field.name }));
JsonEditor.setComponent('error', 'el-alert', ({ vm }) => ({ type: 'error', title: vm.error }));
JsonEditor.setComponent('text', 'el-input');
JsonEditor.setComponent('textarea', 'el-input');
JsonEditor.setComponent('number', 'el-input-number');
JsonEditor.setComponent('select', 'el-select');
JsonEditor.setComponent('option', ElOption);
JsonEditor.setComponent('switch', 'el-switch');
JsonEditor.setComponent('date', 'el-date-picker'); // datetime 用，自定义类型
```

- Props：`schema`(必填)、`modelValue`(v-model)、`noValidate`、`autoComplete`、`inputWrappingClass`。
- Events：`update:modelValue`、`change`、`submit`、`invalid`。
- ref 暴露方法：`form()`（返回 el-form 实例，可 `.validate(cb)`）、`reset()`、`validate()`、`setErrorMessage(msg)`、`clearErrorMessage()`。
- 字符串组件名（`'el-input'` 等）依赖**全局注册** element-plus（`app.use(ElementPlus)`）。
- **核心限制：不支持动态数组编辑**（不能 add/remove 行编辑一组子对象）→ 模型字段编辑器不用它（Task 9 说明）。
- 字段 widget 由 schema 的 `attrs` 决定：如 `{ ..., attrs: { type: 'switch' } }` → switch；`type:'date'` → 自定义 date picker。

### @leizm/web 静态托管（Task 17）

- `web.component.serveStatic(root, { index:false, fallthrough:true })` 包装 serve-static。
- SPA fallback：`app.router.get('/admin/:splat*', (ctx) => ctx.response.file(absIndexPath))` —— **必须用 `:splat*`，裸 `*` 在 path-to-regexp v6 会抛 `Unexpected MODIFIER`**。
- `ctx.response.file(absPath)` 发送文件（按扩展名设 Content-Type）。
- 挂载：`app.use('/admin', serveStatic(...))`，use 是前缀匹配会剥掉 `/admin` 前缀。

---

## 文件结构（apps/web）

```
apps/web/
├── package.json
├── tsconfig.json
├── tsconfig.node.json          # vite.config 用
├── vite.config.ts
├── vitest.config.ts            # jsdom 环境 + vue 插件 + alias
├── index.html                  # 入口（base /admin/）
├── .gitignore
├── src/
│   ├── main.ts                 # 应用初始化（element-plus / Pinia / router / JsonEditor 组件注册）
│   ├── App.vue                 # 根组件
│   ├── env.d.ts                // vite/vue 类型补充
│   ├── styles/
│   │   ├── theme.ts            // element-plus 主题变量覆盖（"Control Console" 美学）
│   │   ├── tokens.css          // CSS 变量（色板/字体/间距）
│   │   └── global.css          // 全局样式 + element-plus 覆盖
│   ├── router/
│   │   └── index.ts            // 路由 + 守卫（未登录跳 /login，mustChange 强制改密）
│   ├── stores/
│   │   ├── auth.ts             // 登录态（fetchMe/login/logout/changePassword）
│   │   └── table.ts            // 表列表 + 当前表元数据缓存
│   ├── api/
│   │   ├── request.ts          // axios 实例：信封解包 + withCredentials + 错误提示
│   │   ├── auth.ts
│   │   ├── table.ts
│   │   ├── admin-data.ts
│   │   ├── token.ts
│   │   ├── admin.ts
│   │   └── types.ts            // wire 类型（TokenListVO/AdminVO 等 snake_case 适配）
│   ├── lib/
│   │   ├── editor.ts           // JsonEditor.setComponent 注册（启动一次）
│   │   ├── schema-adapter.ts   // FieldMeta[] → JsonEditor schema（isHidden/isReadonly/datetime）
│   │   └── format.ts           // 时间戳/布尔/枚举 展示格式化
│   ├── components/
│   │   ├── Layout.vue          // 顶栏 + 侧边栏 + <router-view>
│   │   ├── StatCard.vue        // Dashboard 统计卡
│   │   ├── EmptyState.vue      // 空状态
│   │   └── FieldRowsEditor.vue // 模型字段动态行编辑器（element-plus 手搓，Task 9）
│   └── views/
│       ├── Login.vue
│       ├── ChangePassword.vue
│       ├── Dashboard.vue
│       ├── tables/
│       │   ├── TableList.vue
│       │   ├── TableNew.vue
│       │   ├── TableImport.vue
│       │   ├── TableDetail.vue
│       │   └── DataBrowse.vue
│       ├── Tokens.vue
│       ├── Admins.vue
│       └── Settings.vue
└── src/__tests__/
    ├── schema-adapter.test.ts   // 纯函数：isHidden 过滤 / readonly / datetime widget
    ├── format.test.ts           // 时间戳/布尔格式化
    ├── request.test.ts          // 信封解包 + 错误抛出（mock axios）
    └── stores-auth.test.ts      // auth store 状态流转（mock api）
```

**职责边界：** `api/*` 只做 HTTP 调用 + 信封解包（无业务）；`stores/*` 管状态；`lib/*` 是纯函数（高单测价值）；`views/*` + `components/*` 是 UI（按 spec §3.6 聚焦测 UI 适配层与关键行为，不逐视图穷尽渲染测试）。

---

## 前置确认（每个 task 开始前）

- 工作在 **git worktree**（`.worktrees/phase3-web/`）中隔离，不在 main 直接实施（`using-git-worktrees` 技能创建）。
- `pnpm install` 前置（新增 web 包依赖）。
- vite/vitest 用 `resolve.alias` 让 `@1api/shared` 直走源码（`../../packages/shared/src/index.ts`），test 无需 build。
- typecheck 需先 `pnpm -r build`（project reference 依赖 shared/dist）—— 详见 AGENTS §3。

---

## Task 1：web 包骨架（package.json / tsconfig / vite / vitest / index.html / main.ts）

**Files:**
- Create: `apps/web/package.json`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/tsconfig.node.json`
- Create: `apps/web/vite.config.ts`
- Create: `apps/web/vitest.config.ts`
- Create: `apps/web/index.html`
- Create: `apps/web/.gitignore`
- Create: `apps/web/src/env.d.ts`
- Create: `apps/web/src/main.ts`
- Create: `apps/web/src/App.vue`
- Modify: `apps/web/.gitignore`（忽略产物；注意 static/admin 产物在 server 侧忽略）

- [ ] **Step 1：创建 web package.json**

`apps/web/package.json`：
```json
{
  "name": "@1api/web",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vue-tsc --noEmit -p tsconfig.json && vite build",
    "preview": "vite preview",
    "typecheck": "vue-tsc --noEmit -p tsconfig.json",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@1api/shared": "workspace:*",
    "axios": "^1.7.0",
    "element-plus": "^2.11.0",
    "pinia": "^2.2.0",
    "vue": "^3.5.0",
    "vue-json-ui-editor": "^3.0.1",
    "vue-router": "^4.4.0"
  },
  "devDependencies": {
    "@vitejs/plugin-vue": "^5.1.0",
    "@vue/test-utils": "^2.4.0",
    "jsdom": "^25.0.0",
    "typescript": "^5.8.0",
    "unplugin-auto-import": "^0.18.0",
    "unplugin-vue-components": "^0.27.0",
    "vite": "^5.4.0",
    "vitest": "^3.0.0",
    "vue-tsc": "^2.1.0"
  }
}
```

- [ ] **Step 2：创建 tsconfig.json（web）**

`apps/web/tsconfig.json`：
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": ".",
    "outDir": "dist",
    "jsx": "preserve",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["vite/client"],
    "useDefineForClassFields": true,
    "noEmit": true,
    "composite": true
  },
  "references": [{ "path": "../../packages/shared" }],
  "include": ["src/**/*.ts", "src/**/*.tsx", "src/**/*.vue", "env.d.ts"],
  "exclude": ["dist", "node_modules"]
}
```

`apps/web/tsconfig.node.json`（给 vite.config.ts 用）：
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "lib": ["ES2022"], "types": ["node"] },
  "include": ["vite.config.ts", "vitest.config.ts"]
}
```

- [ ] **Step 3：创建 vite.config.ts**

`apps/web/vite.config.ts`：
```typescript
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import AutoImport from 'unplugin-auto-import/vite';
import Components from 'unplugin-vue-components/vite';
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  // 生产由 server 托管在 /admin/ 路径
  base: '/admin/',
  plugins: [
    vue(),
    AutoImport({ resolvers: [ElementPlusResolver()] }),
    Components({ resolvers: [ElementPlusResolver()] }),
  ],
  resolve: {
    alias: {
      '@1api/shared': resolve(here, '../../packages/shared/src/index.ts'),
    },
  },
  build: {
    // 产物直接输出到 server 静态目录（相对 apps/web 出发是 ../server/static/admin）
    outDir: resolve(here, '../server/static/admin'),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      // dev 模式 /api 代理到 server
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
      '/healthz': { target: 'http://localhost:3000', changeOrigin: true },
    },
  },
});
```

- [ ] **Step 4：创建 vitest.config.ts（jsdom + vue + alias）**

`apps/web/vitest.config.ts`：
```typescript
import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@1api/shared': resolve(here, '../../packages/shared/src/index.ts'),
      '@': resolve(here, 'src'),
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
    globals: false,
  },
});
```

- [ ] **Step 5：创建 index.html + .gitignore + env.d.ts**

`apps/web/index.html`：
```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>one-api 控制台</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

`apps/web/.gitignore`：
```
dist/
node_modules/
*.tsbuildinfo
```

`apps/web/src/env.d.ts`：
```typescript
/// <reference types="vite/client" />
declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<object, object, unknown>;
  export default component;
}
```

- [ ] **Step 6：创建最小 main.ts + App.vue（仅跑通挂载）**

`apps/web/src/App.vue`：
```vue
<script setup lang="ts"></script>
<template>
  <div class="app-root">
    <router-view />
  </div>
</template>
```

`apps/web/src/main.ts`（最小版，路由/状态在后续 task 接入；本步只为构建跑通）：
```typescript
import { createApp } from 'vue';
import App from './App.vue';

// 最小占位 router（Task 5 替换为真实 router）
import { createRouter, createWebHistory } from 'vue-router';
const router = createRouter({
  history: createWebHistory('/admin/'),
  routes: [{ path: '/', component: { template: '<div>one-api web ok</div>' } }],
});

createApp(App).use(router).mount('#app');
```

- [ ] **Step 7：install + 构建跑通（产物输出到 server/static/admin）**

```bash
pnpm install
pnpm --filter @1api/web build 2>&1 | tail -20
```
Expected: 构建成功，产物写入 `apps/server/static/admin/index.html` + `assets/`。

- [ ] **Step 8：确认 pnpm-workspace.yaml 含 apps/web（应已被 apps/* 覆盖）**

读 `pnpm-workspace.yaml`，确认 `packages:` 含 `apps/*`（web 属其下，无需改）。若不含则补。

- [ ] **Step 9：Commit**

```bash
git add apps/web pnpm-workspace.yaml
git commit -m "feat(web): 包骨架 + vite/vitest 配置 + index.html/main.ts 最小挂载"
```

---

## Task 2：美学方向锁定 + 全局样式 + element-plus 主题（"Control Console"）

> **遵循 `frontend-design` 技能。** 本期定位是面向开发者的「AI native 数据库」控制台——一个**数据密集、技术感强**的 power-user 工具。锁定美学方向：**"Control Console"**——深石板色侧边栏 + 浅色内容画布，**翡翠青（emerald-teal）** 作主色调（避开默认蓝/紫渐变），**JetBrains Mono** 用于数据/标识符/代码，**Manrope** 用于 UI 文本。克制、精密、信息密度高。

**Files:**
- Create: `apps/web/src/styles/tokens.css`
- Create: `apps/web/src/styles/global.css`
- Create: `apps/web/src/styles/theme.ts`
- Modify: `apps/web/src/main.ts`（挂全局样式 + element-plus）

- [ ] **Step 1：tokens.css（CSS 变量：色板/字体/间距/阴影）**

`apps/web/src/styles/tokens.css`：
```css
:root {
  /* —— 色板：深石板 + 翡翠青主色 —— */
  --c-bg: #f5f6f8;            /* 内容画布 */
  --c-surface: #ffffff;       /* 卡片/面板 */
  --c-sidebar: #0f172a;       /* 侧边栏深石板 */
  --c-sidebar-fg: #cbd5e1;
  --c-sidebar-fg-muted: #64748b;
  --c-sidebar-active: #10b981;

  --c-primary: #0d9488;       /* 翡翠青（主色，比默认蓝更具识别度） */
  --c-primary-strong: #0f766e;
  --c-primary-soft: #ccfbf1;

  --c-text: #0f172a;
  --c-text-muted: #64748b;
  --c-border: #e2e8f0;

  --c-success: #059669;
  --c-warning: #d97706;
  --c-danger: #dc2626;

  /* —— 字体 —— */
  --font-ui: 'Manrope', system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', 'IBM Plex Mono', ui-monospace, monospace;

  /* —— 间距/圆角/阴影 —— */
  --radius: 10px;
  --radius-sm: 6px;
  --shadow-sm: 0 1px 2px rgba(15, 23, 42, 0.06);
  --shadow-md: 0 4px 16px rgba(15, 23, 42, 0.08);
}
```

> 字体通过 Google Fonts 在 index.html 引入（Task 1 的 index.html 末尾补 `<link>`）。补 `apps/web/index.html` 的 `<head>` 增加：
```html
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&family=Manrope:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
```

- [ ] **Step 2：global.css（基础重置 + element-plus 变量覆盖 + 数据密集样式）**

`apps/web/src/styles/global.css`：
```css
@import './tokens.css';

* { box-sizing: border-box; }
html, body, #app { height: 100%; margin: 0; }
body {
  font-family: var(--font-ui);
  color: var(--c-text);
  background: var(--c-bg);
  -webkit-font-smoothing: antialiased;
}

/* element-plus 主色覆盖（按其 CSS 变量） */
:root {
  --el-color-primary: var(--c-primary);
  --el-color-primary-light-3: #2dd4bf;
  --el-color-primary-light-5: #5eead4;
  --el-color-primary-light-7: #99f6e4;
  --el-color-primary-light-8: #ccfbf1;
  --el-color-primary-light-9: #f0fdfa;
  --el-color-primary-dark-2: var(--c-primary-strong);
  --el-border-radius-base: var(--radius-sm);
  --el-font-family: var(--font-ui);
}

/* 数据/标识符统一用等宽 */
.mono, .el-table td.code, .el-table th.code { font-family: var(--font-mono); }

/* 页面卡片容器 */
.page { padding: 24px; }
.page-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; }
.page-title { font-size: 22px; font-weight: 700; letter-spacing: -0.01em; margin: 0; }
.card { background: var(--c-surface); border: 1px solid var(--c-border); border-radius: var(--radius); box-shadow: var(--shadow-sm); }

/* fade 过渡 */
.fade-enter-active, .fade-leave-active { transition: opacity 0.15s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
```

- [ ] **Step 3：theme.ts（element-plus 按需已由 resolver 处理；此文件仅集中深色侧边栏等覆盖常量，供组件复用）**

`apps/web/src/styles/theme.ts`：
```typescript
// 供 JS 侧读取的样式常量（侧边栏菜单等）
export const SIDEBAR = {
  width: '232px',
  bg: 'var(--c-sidebar)',
  activeColor: 'var(--c-sidebar-active)',
} as const;
```

- [ ] **Step 4：main.ts 挂全局样式（element-plus 由 resolver 自动按需，样式需显式引）**

把 `apps/web/src/main.ts` 替换为：
```typescript
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
```

- [ ] **Step 5：构建验证（含字体 link）**

```bash
pnpm --filter @1api/web build 2>&1 | tail -10
```
Expected: 构建成功。

- [ ] **Step 6：Commit**

```bash
git add apps/web/src/styles apps/web/src/main.ts apps/web/index.html
git commit -m "feat(web): Control Console 美学（翡翠青主色 + Manrope/JetBrains Mono + element-plus 主题覆盖）"
```

---

## Task 3：API 层 —— request.ts 信封解包 + 错误处理（TDD）

**Files:**
- Create: `apps/web/src/api/request.ts`
- Test: `apps/web/src/__tests__/request.test.ts`

- [ ] **Step 1：写失败测试——信封解包成功 / 错误抛 ApiRequestError / 401 特殊标记**

`apps/web/src/__tests__/request.test.ts`：
```typescript
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AxiosInstance } from 'axios';
import { request, ApiRequestError } from '../api/request.js';

// 用工厂注入 mock axios 实例，避免打真实网络
function mockAxios(get: (url: string, cfg?: unknown) => unknown): AxiosInstance {
  return { get: vi.fn(get) } as unknown as AxiosInstance;
}

describe('request 信封解包', () => {
  it('成功信封 → 返回 data', async () => {
    const ax = mockAxios(() => ({ data: { success: true, data: { id: 1 } } }));
    const r = await request(ax, 'get', '/x');
    expect(r).toEqual({ id: 1 });
  });

  it('业务错误信封 → 抛 ApiRequestError(code,message)', async () => {
    const ax = mockAxius(); // 见下
    const ax2 = mockAxios(() => ({ data: { success: false, error: { code: 'TABLE_NOT_FOUND', message: '表 x 不存在' } } }));
    await expect(request(ax2, 'get', '/x')).rejects.toMatchObject({
      code: 'TABLE_NOT_FOUND',
      message: '表 x 不存在',
    });
  });

  it('401 HTTP → ApiRequestError.isUnauthorized=true', async () => {
    const ax = mockAxios(() => {
      const e: unknown = { response: { status: 401, data: { success: false, error: { code: 'UNAUTHORIZED', message: '未登录' } } } };
      throw e;
    });
    await expect(request(ax, 'get', '/x')).rejects.toMatchObject({ isUnauthorized: true, code: 'UNAUTHORIZED' });
  });

  it('网络错误（无 response）→ INTERNAL_ERROR', async () => {
    const ax = mockAxios(() => { throw new Error('Network Error'); });
    await expect(request(ax, 'get', '/x')).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
  });
});

// 占位避免上面 mockAxius 笔误触发——实际删掉这行
function mockAxius(): AxiosInstance { return mockAxios(() => ({})); }
afterEach(() => vi.clearAllMocks());
```

> 注：测试里有个故意留的 `mockAxius` 辅助；实施时把第二个用例直接用 `mockAxios` 即可，删掉 `mockAxius`/占位行。最终干净版测试：
```typescript
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AxiosInstance } from 'axios';
import { request, ApiRequestError } from '../api/request.js';

function mockAxios(handler: (url: string, cfg?: unknown) => unknown): AxiosInstance {
  return { get: vi.fn(handler), post: vi.fn(handler), put: vi.fn(handler), delete: vi.fn(handler) } as unknown as AxiosInstance;
}

describe('request 信封解包', () => {
  afterEach(() => vi.clearAllMocks());

  it('成功信封 → 返回 data', async () => {
    const ax = mockAxios(() => ({ data: { success: true, data: { id: 1 } } }));
    expect(await request(ax, 'get', '/x')).toEqual({ id: 1 });
  });

  it('业务错误信封 → 抛 ApiRequestError', async () => {
    const ax = mockAxios(() => ({ data: { success: false, error: { code: 'TABLE_NOT_FOUND', message: '表 x 不存在' } } }));
    await expect(request(ax, 'get', '/x')).rejects.toMatchObject({ code: 'TABLE_NOT_FOUND', message: '表 x 不存在' });
  });

  it('401 HTTP → isUnauthorized=true', async () => {
    const ax = mockAxios(() => {
      throw { response: { status: 401, data: { success: false, error: { code: 'UNAUTHORIZED', message: '未登录' } } } };
    });
    await expect(request(ax, 'get', '/x')).rejects.toMatchObject({ isUnauthorized: true, code: 'UNAUTHORIZED' });
  });

  it('网络错误 → INTERNAL_ERROR', async () => {
    const ax = mockAxios(() => { throw new Error('Network Error'); });
    await expect(request(ax, 'get', '/x')).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
  });
});
```
（用上述干净版。）

- [ ] **Step 2：运行测试确认失败**

```bash
pnpm --filter @1api/web exec vitest run src/__tests__/request.test.ts 2>&1 | tail -15
```
Expected: FAIL（`api/request.ts` 不存在）。

- [ ] **Step 3：实现 request.ts**

`apps/web/src/api/request.ts`：
```typescript
import type { AxiosInstance, AxiosRequestConfig, Method } from 'axios';

/** 解析后的业务错误（统一形态） */
export class ApiRequestError extends Error {
  readonly code: string;
  readonly status: number;
  readonly isUnauthorized: boolean;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'ApiRequestError';
    this.code = code;
    this.status = status;
    this.isUnauthorized = status === 401 || code === 'UNAUTHORIZED' || code === 'INVALID_TOKEN';
  }
}

interface EnvelopeOk<T> { success: true; data: T }
interface EnvelopeErr { success: false; error: { code: string; message: string } }

/**
 * 统一请求：解包信封。
 * - 成功 → 返回 data
 * - 业务错误信封 → 抛 ApiRequestError(code, message)
 * - HTTP 异常（axios throw）→ 从 error.response.data.error 取，否则 INTERNAL_ERROR
 */
export async function request<T = unknown>(
  ax: AxiosInstance,
  method: Method,
  url: string,
  cfg?: AxiosRequestConfig,
): Promise<T> {
  try {
    const res = await ax.request<EnvelopeOk<T> | EnvelopeErr>({ method, url, ...cfg });
    const body = res.data;
    if (body && typeof body === 'object' && 'success' in body) {
      if (body.success) return body.data;
      throw new ApiRequestError(body.error.code, body.error.message, 200);
    }
    // 非信封（如 CSV blob）：原样返回
    return body as T;
  } catch (err) {
    const e = err as { response?: { status?: number; data?: EnvelopeErr }; message?: string };
    if (e.response) {
      const status = e.response.status ?? 500;
      const errBody = e.response.data?.error;
      throw new ApiRequestError(errBody?.code ?? 'INTERNAL_ERROR', errBody?.message ?? '服务器内部错误', status);
    }
    throw new ApiRequestError('INTERNAL_ERROR', e.message ?? '网络错误', 0);
  }
}
```

- [ ] **Step 4：运行测试确认通过**

```bash
pnpm --filter @1api/web exec vitest run src/__tests__/request.test.ts 2>&1 | tail -10
```
Expected: PASS（4 用例）。

- [ ] **Step 5：Commit**

```bash
git add apps/web/src/api/request.ts apps/web/src/__tests__/request.test.ts
git commit -m "feat(web): request.ts 信封解包 + ApiRequestError（401/业务错误/网络错误）"
```

---

## Task 4：API 层 —— axios 实例 + 各模块 API 方法 + wire 类型

**Files:**
- Create: `apps/web/src/api/types.ts`
- Create: `apps/web/src/api/auth.ts`
- Create: `apps/web/src/api/table.ts`
- Create: `apps/web/src/api/admin-data.ts`
- Create: `apps/web/src/api/token.ts`
- Create: `apps/web/src/api/admin.ts`
- Create: `apps/web/src/api/index.ts`（axios 实例 + 统一导出）

- [ ] **Step 1：wire 类型（snake_case VO 适配）**

`apps/web/src/api/types.ts`：
```typescript
import type { FieldMeta, TableMeta, TokenPermissions } from '@1api/shared';

/** /api/auth/me 与 login.admin 返回（camelCase） */
export interface CurrentAdmin {
  id: number;
  name: string;
  nickname: string;
  mustChangePassword: boolean;
}

/** Token 列表项（snake_case，DB 透传，无 hash/明文） */
export interface TokenListVO {
  id: number;
  name: string;
  token_prefix: string;
  permissions: TokenPermissions;
  is_active: boolean;
  expires_at: number | null;
  last_used_at: number | null;
  created_at: number;
  updated_at: number;
}

/** Token 创建返回（camelCase，含明文 token 仅一次） */
export interface TokenCreateVO {
  id: number;
  name: string;
  token: string;
  tokenPrefix: string;
  permissions: TokenPermissions;
}

/** 管理员列表项（snake_case） */
export interface AdminVO {
  id: number;
  name: string;
  nickname: string;
  must_change_password: number; // 0/1
  created_at: number;
  updated_at: number;
}

/** 新建模型入参 */
export interface CreateModelInput {
  name: string;
  label: string;
  fields: FieldMetaInput[];
  note?: string | null;
  autoTimestamps?: boolean;
}

/** 单字段配置入参（提交新建/编辑模型用） */
export interface FieldMetaInput {
  name: string;
  jsonType: 'string' | 'integer' | 'number' | 'boolean' | 'datetime';
  label?: string;
  nullable?: boolean;
  defaultValue?: unknown;
  isPrimary?: boolean;
  isAutoIncrement?: boolean;
  isHidden?: boolean;
  isReadonly?: boolean;
  enumValues?: string[];
}

/** 列表结果（与 shared ListResult 对齐，rows 非 items） */
export interface ListResult<T> { rows: T[]; total: number; page: number; size: number }

/** 列表查询参数 */
export interface ListQuery {
  page?: number;
  size?: number;
  order?: string;
  q?: string;
  [key: string]: unknown; // field__op=v 过滤
}

export type { TableMeta, FieldMeta, TokenPermissions };
```

- [ ] **Step 2：axios 实例（withCredentials + 401 拦截）+ 统一导出**

`apps/web/src/api/index.ts`：
```typescript
import axios from 'axios';
import { request, ApiRequestError } from './request.js';

/** 全局 axios 实例：session cookie 携带 + JSON */
export const http = axios.create({
  baseURL: '/api',
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
  timeout: 30_000,
});

/** 便捷封装（解包信封） */
export async function api<T = unknown>(method: string, url: string, cfg?: Parameters<typeof request>[3]): Promise<T> {
  return request<T>(http, method as never, url, cfg);
}

export { ApiRequestError } from './request.js';
export * from './auth.js';
export * from './table.js';
export * from './admin-data.js';
export * from './token.js';
export * from './admin.js';
export * from './types.js';
```

- [ ] **Step 3：auth.ts**

`apps/web/src/api/auth.ts`：
```typescript
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
```

- [ ] **Step 4：table.ts**

`apps/web/src/api/table.ts`：
```typescript
import type { TableMeta } from '@1api/shared';
import { api } from './index.js';
import type { CreateModelInput } from './types.js';

export function listTables(): Promise<TableMeta[]> {
  return api('get', '/admin/tables');
}

export function getTable(id: number): Promise<TableMeta> {
  return api('get', `/admin/tables/${id}`);
}

export function importTable(name: string): Promise<TableMeta> {
  return api('post', '/admin/tables/import', { data: { name } });
}

export function createTable(input: CreateModelInput): Promise<TableMeta> {
  return api('post', '/admin/tables', { data: input });
}

export function updateTable(
  id: number,
  patch: { label?: string; note?: string | null; isPublished?: boolean; isEditable?: boolean },
): Promise<TableMeta> {
  return api('put', `/admin/tables/${id}`, { data: patch });
}

export function refreshTable(id: number): Promise<TableMeta> {
  return api('post', `/admin/tables/${id}/refresh`);
}

export function deleteTable(id: number): Promise<{ success: boolean }> {
  return api('delete', `/admin/tables/${id}`, { params: { confirm: true } });
}
```

- [ ] **Step 5：admin-data.ts（含 CSV 导出 blob）**

`apps/web/src/api/admin-data.ts`：
```typescript
import { http } from './index.js';
import type { ListQuery, ListResult } from './types.js';
import { request } from './request.js';

export async function listData<T = Record<string, unknown>>(tableId: number, query: ListQuery): Promise<ListResult<T>> {
  return request(http, 'get', `/admin/tables/${tableId}/data`, { params: query });
}

export async function getRecord<T = Record<string, unknown>>(tableId: number, pk: string): Promise<T> {
  return request<T>(http, 'get', `/admin/tables/${tableId}/data/${encodeURIComponent(pk)}`);
}

export async function createRecord(tableId: number, row: Record<string, unknown>): Promise<Record<string, unknown>> {
  return request(http, 'post', `/admin/tables/${tableId}/data`, { data: row });
}

export async function updateRecord(tableId: number, pk: string, row: Record<string, unknown>): Promise<{ success: boolean }> {
  return request(http, 'put', `/admin/tables/${tableId}/data/${encodeURIComponent(pk)}`, { data: row });
}

export async function deleteRecord(tableId: number, pk: string): Promise<{ success: boolean }> {
  return request(http, 'delete', `/admin/tables/${tableId}/data/${encodeURIComponent(pk)}`);
}

/** CSV 导出：返回 blob + 截断标记。直接用 http（绕开信封解包，responseType blob） */
export async function exportCsv(tableId: number, query: ListQuery): Promise<{ blob: Blob; truncated: boolean; total: number | null }> {
  const res = await http.get(`/admin/tables/${tableId}/export`, { params: query, responseType: 'blob' });
  const h = res.headers as Record<string, string>;
  return {
    blob: res.data as Blob,
    truncated: String(h['x-export-truncated'] ?? '') === 'true',
    total: h['x-export-total'] ? Number(h['x-export-total']) : null,
  };
}
```

- [ ] **Step 6：token.ts + admin.ts**

`apps/web/src/api/token.ts`：
```typescript
import type { TokenPermissions } from '@1api/shared';
import { api } from './index.js';
import type { TokenCreateVO, TokenListVO } from './types.js';

export function listTokens(): Promise<TokenListVO[]> {
  return api('get', '/admin/tokens');
}

export function createToken(name: string, permissions: TokenPermissions): Promise<TokenCreateVO> {
  return api('post', '/admin/tokens', { data: { name, permissions } });
}

export function updateToken(
  id: number,
  patch: { name?: string; permissions?: TokenPermissions; isActive?: boolean; expiresAt?: number | null },
): Promise<{ success: boolean }> {
  return api('put', `/admin/tokens/${id}`, { data: patch });
}

export function deleteToken(id: number): Promise<{ success: boolean }> {
  return api('delete', `/admin/tokens/${id}`);
}
```

`apps/web/src/api/admin.ts`：
```typescript
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
```

> 注意循环导入：`./auth.js` 等 import `./index.js`，而 `./index.js` 又 `export * from './auth.js'`。ESM 处理这种循环通常无碍（函数体内才引用 `api`），但为稳妥，把 `index.ts` 里 `export *` 改为延后引用——实际 ESM live binding 可工作。若 typecheck 报循环告警，把 `auth.ts` 等改为从 `./request.js` 直接 import `api` 的等价。实施时以 `pnpm --filter @1api/web typecheck` 通过为准。

- [ ] **Step 7：typecheck（需先 build shared）**

```bash
pnpm --filter @1api/shared build
pnpm --filter @1api/web typecheck 2>&1 | tail -15
```
Expected: 通过（若循环导入报错，按 Step 6 注释调整）。

- [ ] **Step 8：Commit**

```bash
git add apps/web/src/api
git commit -m "feat(web): axios 实例 + auth/table/admin-data/token/admin API 封装 + wire 类型"
```

---

## Task 5：Pinia stores —— auth + table（TDD auth store）

**Files:**
- Create: `apps/web/src/stores/auth.ts`
- Create: `apps/web/src/stores/table.ts`
- Test: `apps/web/src/__tests__/stores-auth.test.ts`

- [ ] **Step 1：写失败测试——auth store 状态流转（mock api）**

`apps/web/src/__tests__/stores-auth.test.ts`：
```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

// mock 整个 api/auth 模块
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
});
```

- [ ] **Step 2：运行测试确认失败**

```bash
pnpm --filter @1api/web exec vitest run src/__tests__/stores-auth.test.ts 2>&1 | tail -10
```
Expected: FAIL（`stores/auth.ts` 不存在）。

- [ ] **Step 3：实现 auth store**

`apps/web/src/stores/auth.ts`：
```typescript
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
```

- [ ] **Step 4：实现 table store**

`apps/web/src/stores/table.ts`：
```typescript
import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { TableMeta } from '@1api/shared';
import * as api from '../api/index.js';

export const useTableStore = defineStore('table', () => {
  const tables = ref<TableMeta[]>([]);
  const current = ref<TableMeta | null>(null);
  const loading = ref(false);

  async function loadAll(): Promise<void> {
    loading.value = true;
    try { tables.value = await api.listTables(); } finally { loading.value = false; }
  }

  async function loadOne(id: number): Promise<TableMeta> {
    loading.value = true;
    try {
      const m = await api.getTable(id);
      current.value = m;
      // 同步刷新列表中该项
      const idx = tables.value.findIndex((t) => t.id === id);
      if (idx >= 0) tables.value[idx] = m;
      return m;
    } finally { loading.value = false; }
  }

  function clearCurrent(): void { current.value = null; }

  return { tables, current, loading, loadAll, loadOne, clearCurrent };
});
```

- [ ] **Step 5：运行测试确认通过**

```bash
pnpm --filter @1api/web exec vitest run src/__tests__/stores-auth.test.ts 2>&1 | tail -10
```
Expected: PASS（5 用例）。

- [ ] **Step 6：Commit**

```bash
git add apps/web/src/stores apps/web/src/__tests__/stores-auth.test.ts
git commit -m "feat(web): Pinia auth/table stores（auth store 状态流转测试）"
```

---

## Task 6：vue-json-ui-editor 注册 + 格式化工具（TDD）

**Files:**
- Create: `apps/web/src/lib/editor.ts`
- Create: `apps/web/src/lib/format.ts`
- Test: `apps/web/src/__tests__/format.test.ts`

- [ ] **Step 1：写失败测试——格式化纯函数**

`apps/web/src/__tests__/format.test.ts`：
```typescript
import { describe, expect, it } from 'vitest';
import { formatTs, formatBool, formatCell } from '../lib/format.js';

describe('formatTs', () => {
  it('毫秒时间戳 → YYYY-MM-DD HH:mm', () => {
    expect(formatTs(1717200000000)).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });
  it('null → —', () => {
    expect(formatTs(null)).toBe('—');
  });
  it('0 → —（视为无值）', () => {
    expect(formatTs(0)).toBe('—');
  });
});

describe('formatBool', () => {
  it('true/1 → 是', () => { expect(formatBool(true)).toBe('是'); expect(formatBool(1)).toBe('是'); });
  it('false/0 → 否', () => { expect(formatBool(false)).toBe('否'); expect(formatBool(0)).toBe('否'); });
});

describe('formatCell', () => {
  it('datetime 字段 → 格式化时间', () => {
    expect(formatCell(1717200000000, { jsonType: 'datetime' } as never)).toMatch(/^\d{4}-\d{2}-\d{2}/);
  });
  it('boolean 字段 → 是/否', () => {
    expect(formatCell(true, { jsonType: 'boolean' } as never)).toBe('是');
  });
  it('null → —', () => {
    expect(formatCell(null, { jsonType: 'string' } as never)).toBe('—');
  });
  it('对象/数组 → JSON', () => {
    expect(formatCell({ a: 1 }, { jsonType: 'string' } as never)).toBe('{"a":1}');
  });
});
```

- [ ] **Step 2：运行测试确认失败**

```bash
pnpm --filter @1api/web exec vitest run src/__tests__/format.test.ts 2>&1 | tail -10
```
Expected: FAIL。

- [ ] **Step 3：实现 format.ts**

`apps/web/src/lib/format.ts`：
```typescript
import type { FieldMeta } from '@1api/shared';

/** 毫秒时间戳 → YYYY-MM-DD HH:mm；无值返回 — */
export function formatTs(ts: number | null | undefined): string {
  if (!ts) return '—';
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 布尔（兼容 0/1）→ 是/否 */
export function formatBool(v: boolean | number | null | undefined): string {
  return v === true || v === 1 ? '是' : '否';
}

/** 按字段类型渲染单元格值 */
export function formatCell(value: unknown, field: Pick<FieldMeta, 'jsonType'>): string {
  if (value === null || value === undefined) return '—';
  if (field.jsonType === 'datetime') return formatTs(typeof value === 'number' ? value : Number(value));
  if (field.jsonType === 'boolean') return formatBool(value as boolean | number);
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
```

- [ ] **Step 4：实现 editor.ts（JsonEditor.setComponent 注册，模块级单例，启动调一次）**

`apps/web/src/lib/editor.ts`：
```typescript
import JsonEditor from 'vue-json-ui-editor';
import { ElOption } from 'element-plus';

let registered = false;

/**
 * 注册 element-plus 组件到 JsonEditor（模块级单例，应用启动调一次）。
 * 字段 widget 由 schema 的 attrs.type 决定：switch/date/textarea 等。
 */
export function setupEditor(): void {
  if (registered) return;
  registered = true;

  JsonEditor.setComponent('form', 'el-form', ({ vm }) => ({ labelWidth: '110px', model: vm.model }));
  JsonEditor.setComponent('label', 'el-form-item', ({ field }) => ({ prop: field.name }));
  JsonEditor.setComponent('error', 'el-alert', ({ vm }) => ({ type: 'error', title: vm.error, closable: false }));

  JsonEditor.setComponent('text', 'el-input');
  JsonEditor.setComponent('textarea', 'el-input');
  JsonEditor.setComponent('number', 'el-input-number');
  JsonEditor.setComponent('select', 'el-select');
  JsonEditor.setComponent('option', ElOption);
  JsonEditor.setComponent('switch', 'el-switch');
  JsonEditor.setComponent('date', 'el-date-picker'); // datetime 自定义类型
}

export { JsonEditor };
```

> 实施时若 `setComponent` 类型报错（库内 `(JsonEditor as any).setComponent`），在 `editor.ts` 顶部加：
> ```typescript
> type SetComp = (type: string, component: string | object, option?: object | ((ctx: { vm: unknown; field: unknown; item: unknown }) => object)) => void;
> const setComponent = (JsonEditor as unknown as { setComponent: SetComp }).setComponent.bind(JsonEditor);
> ```
> 然后所有 `JsonEditor.setComponent(...)` 改用 `setComponent(...)`。

- [ ] **Step 5：运行测试确认通过 + typecheck**

```bash
pnpm --filter @1api/web exec vitest run src/__tests__/format.test.ts 2>&1 | tail -10
pnpm --filter @1api/web typecheck 2>&1 | tail -10
```
Expected: format 测试 PASS；typecheck 通过。

- [ ] **Step 6：Commit**

```bash
git add apps/web/src/lib/format.ts apps/web/src/lib/editor.ts apps/web/src/__tests__/format.test.ts
git commit -m "feat(web): JsonEditor 组件注册 + 时间/布尔/单元格格式化工具"
```

---

## Task 7：schema-adapter —— FieldMeta[] → JsonEditor schema（TDD 核心）

> 这是 spec §3.3「用途①」的核心适配层。`@1api/shared` 的 `fieldsToJsonSchema` 已生成标准 JSON Schema，但 JsonEditor 需要：(1) 移除 isHidden 字段；(2) isReadonly/autoInc主键/时间戳 → readOnly；(3) datetime → `attrs:{type:'date'}` 触发 el-date-picker；(4) enumValues 字符串 → select widget。本 task 写一个纯适配器并测各类型映射。
>
> **实施前必读**：打开 `vue-json-ui-editor/src/parser.ts`（`/Users/yourtionguo/codes/open/vue-json-ui-editor/src/parser.ts`）确认它如何从 JSON Schema property 决定 widget（重点看 `parseString`/`parseArray` 对 `enum`、`attrs.type` 的处理）。若实际映射与下方假设不符，按源码调整 adapter 的 `attrs` 写法——这属于"有问题直接迭代优化"的范畴。

**Files:**
- Create: `apps/web/src/lib/schema-adapter.ts`
- Test: `apps/web/src/__tests__/schema-adapter.test.ts`

- [ ] **Step 1：读 vue-json-ui-editor/src/parser.ts 确认 widget 映射规则**

```bash
sed -n '1,160p' /Users/yourtionguo/codes/open/vue-json-ui-editor/src/parser.ts
```
记录：string+enum 如何渲染（select?）、`attrs.type` 如何决定 widget、datetime 的 `format:'date-time'` 是否被识别。据此修正 Step 3 的 adapter。

- [ ] **Step 2：写失败测试——adapter 各类型/隐藏/只读/datetime/enum**

`apps/web/src/__tests__/schema-adapter.test.ts`：
```typescript
import { describe, expect, it } from 'vitest';
import type { FieldMeta } from '@1api/shared';
import { fieldsToEditorSchema, isSystemManaged } from '../lib/schema-adapter.js';

const f = (over: Partial<FieldMeta> & Pick<FieldMeta, 'name' | 'jsonType'>): FieldMeta => ({
  name: over.name, label: over.label ?? over.name, sqliteType: 'TEXT', jsonType: over.jsonType,
  nullable: over.nullable ?? false, defaultValue: over.defaultValue ?? null,
  isPrimary: over.isPrimary ?? false, isAutoIncrement: over.isAutoIncrement ?? false,
  isHidden: over.isHidden ?? false, isReadonly: over.isReadonly ?? false,
  enumValues: over.enumValues,
});

describe('fieldsToEditorSchema', () => {
  it('isHidden 字段不出现在 properties', () => {
    const s = fieldsToEditorSchema([f({ name: 'a', jsonType: 'string' }), f({ name: 'sec', jsonType: 'string', isHidden: true })]);
    expect(s.properties).toHaveProperty('a');
    expect(s.properties).not.toHaveProperty('sec');
  });

  it('datetime 字段 → attrs.type=date（触发 el-date-picker）', () => {
    const s = fieldsToEditorSchema([f({ name: 't', jsonType: 'datetime' })]);
    const prop = (s.properties as Record<string, Record<string, unknown>>)['t'];
    // date 类型由 attrs 携带（具体键名按 parser.ts 确认后可能调整）
    expect(JSON.stringify(prop)).toContain('date');
  });

  it('字符串 enumValues → 含 enum', () => {
    const s = fieldsToEditorSchema([f({ name: 'st', jsonType: 'string', enumValues: ['draft', 'pub'] })]);
    const prop = (s.properties as Record<string, Record<string, unknown>>)['st'];
    expect(prop).toMatchObject({ enum: ['draft', 'pub'] });
  });

  it('nullable=false → 进 required', () => {
    const s = fieldsToEditorSchema([f({ name: 'a', jsonType: 'string', nullable: false }), f({ name: 'b', jsonType: 'string', nullable: true })]);
    expect(s.required).toContain('a');
    expect(s.required).not.toContain('b');
  });

  it('isReadonly → readOnly: true', () => {
    const s = fieldsToEditorSchema([f({ name: 'r', jsonType: 'string', isReadonly: true })]);
    const prop = (s.properties as Record<string, Record<string, unknown>>)['r'];
    expect(prop.readOnly).toBe(true);
  });
});

describe('isSystemManaged', () => {
  it('自增主键/created_at/updated_at 视为系统管理', () => {
    expect(isSystemManaged(f({ name: 'id', jsonType: 'integer', isPrimary: true, isAutoIncrement: true }))).toBe(true);
    expect(isSystemManaged(f({ name: 'created_at', jsonType: 'datetime' }))).toBe(true);
    expect(isSystemManaged(f({ name: 'updated_at', jsonType: 'datetime' }))).toBe(true);
    expect(isSystemManaged(f({ name: 'title', jsonType: 'string' }))).toBe(false);
  });
});
```

- [ ] **Step 3：运行测试确认失败**

```bash
pnpm --filter @1api/web exec vitest run src/__tests__/schema-adapter.test.ts 2>&1 | tail -10
```
Expected: FAIL。

- [ ] **Step 4：实现 schema-adapter.ts**

`apps/web/src/lib/schema-adapter.ts`：
```typescript
import type { FieldMeta } from '@1api/shared';

/** 系统管理字段：自增主键 / created_at / updated_at —— 新建时不显示/只读 */
export function isSystemManaged(field: FieldMeta): boolean {
  if (field.isAutoIncrement && field.isPrimary) return true;
  return field.name === 'created_at' || field.name === 'updated_at';
}

/**
 * FieldMeta[] → vue-json-ui-editor 可用的 JSON Schema。
 * 规则：
 *  - isHidden → 移除
 *  - isReadonly / 系统管理 → readOnly:true
 *  - datetime → attrs.type='date'（触发 el-date-picker）
 *  - 字符串 enumValues → enum + select widget
 *  - nullable=false → required
 */
export function fieldsToEditorSchema(fields: FieldMeta[]): {
  type: 'object';
  properties: Record<string, Record<string, unknown>>;
  required: string[];
} {
  const properties: Record<string, Record<string, unknown>> = {};
  const required: string[] = [];

  for (const field of fields) {
    if (field.isHidden) continue;

    const prop: Record<string, unknown> = { title: field.label || field.name };

    // 类型映射
    if (field.jsonType === 'datetime') {
      prop['type'] = 'string';
      prop['format'] = 'date-time';
      // 触发 el-date-picker（按 parser.ts 确认的键名）
      prop['attrs'] = { type: 'date' };
    } else if (field.jsonType === 'integer') {
      prop['type'] = 'integer';
    } else if (field.jsonType === 'number') {
      prop['type'] = 'number';
    } else if (field.jsonType === 'boolean') {
      prop['type'] = 'boolean';
      prop['attrs'] = { type: 'switch' };
    } else {
      // string
      prop['type'] = 'string';
      if (field.enumValues && field.enumValues.length > 0) {
        prop['enum'] = field.enumValues;
      }
    }

    if (field.nullable) {
      prop['nullable'] = true;
    } else {
      required.push(field.name);
    }

    if (field.isReadonly || isSystemManaged(field)) {
      prop['readOnly'] = true;
    }

    properties[field.name] = prop;
  }

  return { type: 'object', properties, required };
}
```

> 若 Step 1 读 parser.ts 发现 widget 触发键不是 `attrs.type`（例如直接读 property 的某个字段），相应调整 `prop['attrs']` 写法直至测试与实际渲染都正确。datetime 的 date picker 是最易踩坑点——务必在 Task 13 数据编辑表单里用 chrome-devtools 验证一次。

- [ ] **Step 5：运行测试确认通过**

```bash
pnpm --filter @1api/web exec vitest run src/__tests__/schema-adapter.test.ts 2>&1 | tail -10
```
Expected: PASS（6 用例）。

- [ ] **Step 6：Commit**

```bash
git add apps/web/src/lib/schema-adapter.ts apps/web/src/__tests__/schema-adapter.test.ts
git commit -m "feat(web): schema-adapter（FieldMeta[]→JsonEditor schema：隐藏/只读/datetime/enum/required）"
```

---

## Task 8：router + 路由守卫 + main.ts 装配 + Layout 组件

**Files:**
- Create: `apps/web/src/router/index.ts`
- Modify: `apps/web/src/main.ts`（接入 Pinia + router + setupEditor + 真实路由）
- Create: `apps/web/src/components/Layout.vue`
- Create: `apps/web/src/components/EmptyState.vue`

- [ ] **Step 1：router/index.ts（路由表 + 守卫）**

`apps/web/src/router/index.ts`：
```typescript
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
    try { await auth.fetchMe(); } catch { /* 401 已清空 */ }
  }
  if (to.meta.public) return true;
  if (!auth.isLoggedIn) return { name: 'login' };
  // 强制改密：除 change-password 外一律拦截
  if (auth.mustChangePassword && !to.meta.allowMustChange) return { name: 'change-password' };
  return true;
});

export default router;
```

- [ ] **Step 2：Layout.vue（顶栏 + 深色侧边栏 + 内容区）**

`apps/web/src/components/Layout.vue`：
```vue
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
.layout { display: flex; height: 100%; }
.sidebar {
  width: 232px; background: var(--c-sidebar); color: var(--c-sidebar-fg);
  display: flex; flex-direction: column; flex-shrink: 0;
}
.brand { display: flex; align-items: center; gap: 10px; padding: 20px 22px; font-weight: 800; font-size: 17px; color: #fff; letter-spacing: -0.01em; }
.brand-mark { color: var(--c-primary); }
.nav { display: flex; flex-direction: column; padding: 8px 12px; gap: 2px; }
.nav-item { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: var(--radius-sm); color: var(--c-sidebar-fg); text-decoration: none; font-size: 14px; font-weight: 500; transition: background .12s, color .12s; }
.nav-item:hover { background: rgba(255,255,255,.06); color: #fff; }
.nav-item.active { background: rgba(16,185,129,.14); color: var(--c-sidebar-active); }
.main { flex: 1; display: flex; flex-direction: column; min-width: 0; }
.topbar { height: 56px; display: flex; align-items: center; justify-content: space-between; padding: 0 24px; background: var(--c-surface); border-bottom: 1px solid var(--c-border); }
.topbar-user { display: flex; align-items: center; gap: 8px; color: var(--c-text-muted); font-size: 14px; }
.content { flex: 1; overflow: auto; }
</style>
```

> element-plus 图标（Dashboard/Files/Key/UserFilled/Setting）需全局注册。在 main.ts 用 `app.use(ElementPlusIconsVue)` 注册全部图标（见 Step 4），需装 `@element-plus/icons-vue`。

- [ ] **Step 3：EmptyState.vue（复用空状态）**

`apps/web/src/components/EmptyState.vue`：
```vue
<script setup lang="ts">
defineProps<{ text?: string }>();
</script>
<template>
  <div class="empty">
    <el-icon :size="34" color="var(--c-text-muted)"><Files /></el-icon>
    <p>{{ text ?? '暂无数据' }}</p>
  </div>
</template>
<style scoped>
.empty { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 56px 0; color: var(--c-text-muted); }
</style>
```

- [ ] **Step 4：main.ts 装配（Pinia + router + element-plus 图标 + setupEditor）**

把 `apps/web/src/main.ts` 替换为：
```typescript
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
```

并在 `apps/web/package.json` 的 dependencies 增加：
```json
"@element-plus/icons-vue": "^2.3.0"
```

> 注：本 task 引用了若干尚未创建的 view 文件（Login/Dashboard/...）。typecheck 会报找不到模块——这些 view 在 Task 9-16 逐一创建。为让本 task 能 typecheck/build，先创建每个 view 的**最小占位**（见 Step 5），后续 task 替换为真实实现。

- [ ] **Step 5：为被 router 引用的所有 view 创建最小占位（让 build 跑通）**

对以下每个文件创建内容为最小占位组件（后续 task 替换）：
`src/views/Login.vue`、`src/views/ChangePassword.vue`、`src/views/Dashboard.vue`、`src/views/tables/TableList.vue`、`src/views/tables/TableNew.vue`、`src/views/tables/TableImport.vue`、`src/views/tables/TableDetail.vue`、`src/views/tables/DataBrowse.vue`、`src/views/Tokens.vue`、`src/views/Admins.vue`、`src/views/Settings.vue`。

每个占位内容（以 Login.vue 为例，其余同理、改文本）：
```vue
<script setup lang="ts"></script>
<template><div class="page"><h1 class="page-title">登录（占位）</h1></div></template>
```

- [ ] **Step 6：install + typecheck + build**

```bash
pnpm install
pnpm --filter @1api/shared build
pnpm --filter @1api/web typecheck 2>&1 | tail -10
pnpm --filter @1api/web build 2>&1 | tail -10
```
Expected: 全绿。

- [ ] **Step 7：Commit**

```bash
git add apps/web/src/router apps/web/src/components/Layout.vue apps/web/src/components/EmptyState.vue apps/web/src/main.ts apps/web/src/views apps/web/package.json
git commit -m "feat(web): router + 守卫（未登录/强制改密）+ Layout 控制台壳 + 全局装配"
```

---

## Task 9：Login + ChangePassword（强制改密流程）

**Files:**
- Modify: `apps/web/src/views/Login.vue`（替换占位）
- Modify: `apps/web/src/views/ChangePassword.vue`（替换占位）

- [ ] **Step 1：Login.vue**

`apps/web/src/views/Login.vue`：
```vue
<script setup lang="ts">
import { ref, reactive } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { useAuthStore } from '../stores/auth.js';
import { ApiRequestError } from '../api/index.js';

const router = useRouter();
const auth = useAuthStore();
const form = reactive({ name: 'admin', password: '' });
const loading = ref(false);

async function onSubmit() {
  if (!form.name || !form.password) { ElMessage.warning('请输入账号和密码'); return; }
  loading.value = true;
  try {
    await auth.login(form.name, form.password);
    if (auth.mustChangePassword) router.replace({ name: 'change-password' });
    else router.replace({ name: 'dashboard' });
  } catch (e) {
    const msg = e instanceof ApiRequestError ? e.message : '登录失败';
    ElMessage.error(msg);
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="login-wrap">
    <div class="login-card card">
      <div class="login-brand">
        <span class="brand-mark">◆</span>
        <h1 class="login-title">one-api</h1>
        <p class="login-sub">AI native 数据库 · 控制台</p>
      </div>
      <el-form label-position="top" @submit.prevent="onSubmit">
        <el-form-item label="账号">
          <el-input v-model="form.name" placeholder="admin" />
        </el-form-item>
        <el-form-item label="密码">
          <el-input v-model="form.password" type="password" show-password placeholder="123456" @keyup.enter="onSubmit" />
        </el-form-item>
        <el-button type="primary" :loading="loading" @click="onSubmit" style="width:100%">登录</el-button>
      </el-form>
      <p class="login-hint">默认账号 admin / 123456，首次登录需修改密码</p>
    </div>
  </div>
</template>

<style scoped>
.login-wrap { height: 100%; display: flex; align-items: center; justify-content: center; background: radial-gradient(1200px 600px at 50% -10%, var(--c-primary-soft), var(--c-bg)); }
.login-card { width: 380px; padding: 36px 32px; }
.login-brand { text-align: center; margin-bottom: 24px; }
.brand-mark { color: var(--c-primary); font-size: 30px; }
.login-title { margin: 6px 0 2px; font-size: 24px; font-weight: 800; letter-spacing: -0.02em; }
.login-sub { margin: 0; color: var(--c-text-muted); font-size: 13px; }
.login-hint { margin: 16px 0 0; color: var(--c-text-muted); font-size: 12px; text-align: center; }
</style>
```

- [ ] **Step 2：ChangePassword.vue**

`apps/web/src/views/ChangePassword.vue`：
```vue
<script setup lang="ts">
import { ref, reactive } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { useAuthStore } from '../stores/auth.js';
import { ApiRequestError } from '../api/index.js';

const router = useRouter();
const auth = useAuthStore();
const form = reactive({ oldPassword: '', newPassword: '', confirm: '' });
const loading = ref(false);

async function onSubmit() {
  if (form.newPassword.length < 6) { ElMessage.warning('新密码至少 6 位'); return; }
  if (form.newPassword !== form.confirm) { ElMessage.warning('两次密码不一致'); return; }
  loading.value = true;
  try {
    await auth.changePassword(form.oldPassword, form.newPassword);
    ElMessage.success('密码已修改');
    router.replace({ name: 'dashboard' });
  } catch (e) {
    ElMessage.error(e instanceof ApiRequestError ? e.message : '修改失败');
  } finally { loading.value = false; }
}
</script>

<template>
  <div class="cp-wrap">
    <div class="card cp-card">
      <h2 class="cp-title">修改密码</h2>
      <p class="cp-sub">首次登录或管理员重置后需设置新密码</p>
      <el-form label-position="top" @submit.prevent="onSubmit">
        <el-form-item label="当前密码"><el-input v-model="form.oldPassword" type="password" show-password /></el-form-item>
        <el-form-item label="新密码（≥6 位）"><el-input v-model="form.newPassword" type="password" show-password /></el-form-item>
        <el-form-item label="确认新密码"><el-input v-model="form.confirm" type="password" show-password @keyup.enter="onSubmit" /></el-form-item>
        <el-button type="primary" :loading="loading" @click="onSubmit" style="width:100%">提交</el-button>
      </el-form>
    </div>
  </div>
</template>
<style scoped>
.cp-wrap { height: 100%; display: flex; align-items: center; justify-content: center; background: var(--c-bg); }
.cp-card { width: 420px; padding: 32px; }
.cp-title { margin: 0 0 4px; font-size: 20px; font-weight: 700; }
.cp-sub { margin: 0 0 20px; color: var(--c-text-muted); font-size: 13px; }
</style>
```

- [ ] **Step 3：dev 联调（需 server 同时跑）**

```bash
# 终端1
pnpm --filter @1api/server dev
# 终端2
pnpm --filter @1api/web dev
```
浏览器打开 `http://localhost:5173/admin/login`，用 chrome-devtools 验证：admin/123456 登录后跳 change-password；改密后跳 dashboard。（用 chrome-devtools 而非 curl，CSR 页面。）

- [ ] **Step 4：Commit**

```bash
git add apps/web/src/views/Login.vue apps/web/src/views/ChangePassword.vue
git commit -m "feat(web): 登录页 + 强制改密页（首登 mustChangePassword 流程）"
```

---

## Task 10：Dashboard（概览统计）

**Files:**
- Modify: `apps/web/src/views/Dashboard.vue`（替换占位）
- Create: `apps/web/src/components/StatCard.vue`

- [ ] **Step 1：StatCard.vue**

`apps/web/src/components/StatCard.vue`：
```vue
<script setup lang="ts">
defineProps<{ label: string; value: number | string; hint?: string }>();
</script>
<template>
  <div class="stat card">
    <div class="stat-label">{{ label }}</div>
    <div class="stat-value mono">{{ value }}</div>
    <div v-if="hint" class="stat-hint">{{ hint }}</div>
  </div>
</template>
<style scoped>
.stat { padding: 20px 22px; }
.stat-label { color: var(--c-text-muted); font-size: 13px; font-weight: 600; }
.stat-value { font-size: 34px; font-weight: 800; letter-spacing: -0.02em; margin-top: 6px; color: var(--c-primary-strong); }
.stat-hint { color: var(--c-text-muted); font-size: 12px; margin-top: 4px; }
</style>
```

- [ ] **Step 2：Dashboard.vue**

`apps/web/src/views/Dashboard.vue`：
```vue
<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { listTables } from '../api/index.js';
import { listTokens } from '../api/index.js';
import { listAdmins } from '../api/index.js';
import type { TableMeta } from '@1api/shared';
import StatCard from '../components/StatCard.vue';

const router = useRouter();
const stats = ref({ tables: 0, tokens: 0, admins: 0 });
const recent = ref<TableMeta[]>([]);
const loading = ref(true);

onMounted(async () => {
  try {
    const [tables, tokens, admins] = await Promise.all([listTables(), listTokens(), listAdmins()]);
    stats.value = { tables: tables.length, tokens: tokens.length, admins: admins.length };
    recent.value = [...tables].sort((a, b) => b.createdAt - a.createdAt).slice(0, 5);
  } finally { loading.value = false; }
});
</script>

<template>
  <div class="page" v-loading="loading">
    <div class="page-header"><h1 class="page-title">概览</h1></div>
    <div class="stats-grid">
      <StatCard label="已注册表" :value="stats.tables" />
      <StatCard label="Token 数" :value="stats.tokens" />
      <StatCard label="管理员" :value="stats.admins" />
    </div>
    <div class="card recent">
      <div class="recent-head">最近注册的表</div>
      <el-table v-if="recent.length" :data="recent" size="default">
        <el-table-column prop="name" label="表名" min-width="160"><template #default="{ row }"><span class="mono">{{ row.name }}</span></template></el-table-column>
        <el-table-column prop="label" label="标签" min-width="120" />
        <el-table-column label="字段数" width="90"><template #default="{ row }">{{ row.fields.length }}</template></el-table-column>
        <el-table-column label="操作" width="110">
          <template #default="{ row }">
            <el-button link type="primary" @click="router.push({ name: 'table-data', params: { id: row.id } })">查看数据</el-button>
          </template>
        </el-table-column>
      </el-table>
      <div v-else class="recent-empty">暂无表，去 <el-button link type="primary" @click="router.push({ name: 'table-new' })">新建模型</el-button></div>
    </div>
  </div>
</template>
<style scoped>
.stats-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 20px; }
.recent { padding: 8px 16px 16px; }
.recent-head { padding: 12px 4px; font-weight: 700; font-size: 15px; }
.recent-empty { padding: 24px; color: var(--c-text-muted); }
@media (max-width: 720px) { .stats-grid { grid-template-columns: 1fr; } }
</style>
```

- [ ] **Step 3：chrome-devtools 验证**

dev 模式登录后进 `/admin/dashboard`，确认三张统计卡 + 最近表列表渲染。

- [ ] **Step 4：Commit**

```bash
git add apps/web/src/views/Dashboard.vue apps/web/src/components/StatCard.vue
git commit -m "feat(web): Dashboard 概览（表/Token/管理员统计 + 最近表）"
```

---

## Task 11：表管理列表 TableList

**Files:**
- Modify: `apps/web/src/views/tables/TableList.vue`（替换占位）

- [ ] **Step 1：TableList.vue**

`apps/web/src/views/tables/TableList.vue`：
```vue
<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { listTables, deleteTable, refreshTable } from '../api/index.js';
import { useTableStore } from '../../stores/table.js';
import { formatTs } from '../../lib/format.js';
import type { TableMeta } from '@1api/shared';
import EmptyState from '../../components/EmptyState.vue';

const router = useRouter();
const store = useTableStore();
const loading = ref(true);

onMounted(async () => {
  try { await store.loadAll(); } finally { loading.value = false; }
});

async function onRefresh(t: TableMeta) {
  try {
    await refreshTable(t.id);
    await store.loadAll();
    ElMessage.success(`已刷新「${t.name}」结构`);
  } catch (e) { ElMessage.error((e as Error).message); }
}

async function onDelete(t: TableMeta) {
  try {
    await ElMessageBox.confirm(`确定删除表「${t.name}」的注册？（不删业务库数据，仅删元数据）`, '删除确认', { type: 'warning' });
    await deleteTable(t.id);
    await store.loadAll();
    ElMessage.success('已删除注册');
  } catch (e) {
    if (e !== 'cancel') ElMessage.error((e as Error).message);
  }
}
</script>

<template>
  <div class="page" v-loading="loading">
    <div class="page-header">
      <h1 class="page-title">表管理</h1>
      <div>
        <el-button @click="router.push({ name: 'table-import' })">导入已有表</el-button>
        <el-button type="primary" @click="router.push({ name: 'table-new' })">新建模型</el-button>
      </div>
    </div>
    <div class="card">
      <el-table v-if="store.tables.length" :data="store.tables">
        <el-table-column label="表名" min-width="160"><template #default="{ row }"><span class="mono">{{ row.name }}</span></template></el-table-column>
        <el-table-column prop="label" label="标签" min-width="120" />
        <el-table-column label="字段数" width="84"><template #default="{ row }">{{ row.fields.length }}</template></el-table-column>
        <el-table-column label="状态" width="150">
          <template #default="{ row }">
            <el-tag v-if="row.isPublished" type="success" size="small">已发布</el-tag>
            <el-tag v-else type="info" size="small">未发布</el-tag>
            <el-tag v-if="row.isEditable" size="small" style="margin-left:4px">可编辑</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="创建时间" width="150"><template #default="{ row }">{{ formatTs(row.createdAt) }}</template></el-table-column>
        <el-table-column label="操作" width="280" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="router.push({ name: 'table-data', params: { id: row.id } })">数据</el-button>
            <el-button link @click="router.push({ name: 'table-detail', params: { id: row.id } })">编辑</el-button>
            <el-button link @click="onRefresh(row)">刷新结构</el-button>
            <el-button link type="danger" @click="onDelete(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
      <EmptyState v-else text="还没有注册任何表" />
    </div>
  </div>
</template>
```

- [ ] **Step 2：chrome-devtools 验证（列表/刷新/删除）**

- [ ] **Step 3：Commit**

```bash
git add apps/web/src/views/tables/TableList.vue
git commit -m "feat(web): 表管理列表（状态/字段数/刷新结构/删除确认）"
```

---

## Task 12：模型字段编辑器 FieldRowsEditor（手搓动态行）+ 新建模型 TableNew

> **背景（重要）：** vue-json-ui-editor v3.0.1 **不支持动态数组编辑**（无法 add/remove 一组子对象，见 Task 7 前置说明与 parser.ts 限制）。spec §3.3「用途②」要求"添加字段行"，该库做不到。经用户授权"有问题可直接迭代优化"，本 task 用 element-plus 手搓动态字段行编辑器（el-table 行内编辑 + 增删行），这是对该用途的务实替代。

**Files:**
- Create: `apps/web/src/components/FieldRowsEditor.vue`
- Modify: `apps/web/src/views/tables/TableNew.vue`（替换占位）

- [ ] **Step 1：FieldRowsEditor.vue（动态字段行：v-model 绑 FieldMetaInput[]）**

`apps/web/src/components/FieldRowsEditor.vue`：
```vue
<script setup lang="ts">
import { computed } from 'vue';
import { ElButton, ElIcon, ElInput, ElSelect, ElOption, ElSwitch } from 'element-plus';
import { Plus, Delete } from '@element-plus/icons-vue';
import type { FieldMetaInput } from '../api/types.js';

const props = defineProps<{ modelValue: FieldMetaInput[] }>();
const emit = defineEmits<{ 'update:modelValue': [FieldMetaInput[]] }>();

const rows = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
});

const JSON_TYPES: FieldMetaInput['jsonType'][] = ['string', 'integer', 'number', 'boolean', 'datetime'];

function blank(): FieldMetaInput {
  return { name: '', jsonType: 'string', label: '', nullable: false };
}

function add() { rows.value = [...rows.value, blank()]; }
function remove(i: number) { rows.value = rows.value.filter((_, idx) => idx !== i); }
</script>

<template>
  <div class="fre">
    <div v-if="rows.length" class="fre-rows">
      <div class="fre-head">
        <span class="c-name">字段名</span>
        <span class="c-label">标签</span>
        <span class="c-type">类型</span>
        <span class="c-bool">可空</span>
        <span class="c-act"></span>
      </div>
      <div v-for="(row, i) in rows" :key="i" class="fre-row">
        <ElInput v-model="row.name" class="c-name" placeholder="snake_case" size="small" />
        <ElInput v-model="row.label" class="c-label" placeholder="显示名" size="small" />
        <ElSelect v-model="row.jsonType" class="c-type" size="small">
          <ElOption v-for="t in JSON_TYPES" :key="t" :label="t" :value="t" />
        </ElSelect>
        <ElSwitch v-model="row.nullable" class="c-bool" size="small" />
        <span class="c-act"><ElButton :icon="Delete" link type="danger" @click="remove(i)" /></span>
      </div>
    </div>
    <ElButton :icon="Plus" plain size="small" @click="add">添加字段</ElButton>
  </div>
</template>
<style scoped>
.fre-rows { display: flex; flex-direction: column; gap: 8px; margin-bottom: 12px; }
.fre-head, .fre-row { display: grid; grid-template-columns: 1.4fr 1.2fr 1fr 60px 40px; gap: 8px; align-items: center; }
.fre-head { color: var(--c-text-muted); font-size: 12px; font-weight: 600; padding: 0 4px; }
</style>
```

> 注意 `row.label`/`row.nullable` 直接 mutate 子对象——因 `rows.value` 是 props 浅拷贝，对象内部 mutation 不会自动触发更新。为稳妥，每次输入变更后通过 emit 重新发一份：可在各 `@input`/`@change` 触发 `rows.value = [...rows.value]`。简化：把 `ElInput v-model="row.name"` 改为 `:model-value="row.name" @update:model-value="(v) => update(i, 'name', v)"`，`update` 内做 `const cp = [...rows.value]; cp[i] = { ...cp[i], name: v }; rows.value = cp;`。实施时按此模式逐字段补 `update` 函数（DRY：一个通用 `setField(i, key, v)`）。

- [ ] **Step 2：完善 FieldRowsEditor 的不可变更新（替换 Step 1 的 v-model 直改）**

把 `<script setup>` 改为不可变更新版：
```typescript
import { computed } from 'vue';
import { ElButton, ElIcon, ElInput, ElSelect, ElOption, ElSwitch } from 'element-plus';
import { Plus, Delete } from '@element-plus/icons-vue';
import type { FieldMetaInput } from '../api/types.js';

const props = defineProps<{ modelValue: FieldMetaInput[] }>();
const emit = defineEmits<{ 'update:modelValue': [FieldMetaInput[]] }>();

const JSON_TYPES: FieldMetaInput['jsonType'][] = ['string', 'integer', 'number', 'boolean', 'datetime'];

function setField(i: number, key: keyof FieldMetaInput, v: unknown) {
  const cp = [...props.modelValue];
  cp[i] = { ...cp[i], [key]: v };
  emit('update:modelValue', cp);
}
function add() { emit('update:modelValue', [...props.modelValue, { name: '', jsonType: 'string', label: '', nullable: false }]); }
function remove(i: number) { emit('update:modelValue', props.modelValue.filter((_, idx) => idx !== i)); }
```
模板里每列改为 `:model-value` + `@update:model-value="(v) => setField(i, 'name', v)"`（label/jsonType/nullable 同理）。

- [ ] **Step 3：TableNew.vue**

`apps/web/src/views/tables/TableNew.vue`：
```vue
<script setup lang="ts">
import { ref, reactive } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { createTable } from '../api/index.js';
import { isValidName, isReservedName } from '@1api/shared';
import type { FieldMetaInput } from '../api/types.js';
import FieldRowsEditor from '../components/FieldRowsEditor.vue';

const router = useRouter();
const form = reactive({ name: '', label: '', note: '', autoTimestamps: true });
const fields = ref<FieldMetaInput[]>([]);
const loading = ref(false);

async function onSubmit() {
  if (!isValidName(form.name) || isReservedName(form.name)) { ElMessage.warning('表名需匹配 ^[a-z][a-z0-9_]*$ 且非保留字'); return; }
  if (!form.label) { ElMessage.warning('请填写标签'); return; }
  const valid = fields.value.filter((f) => f.name && f.jsonType);
  if (!valid.length) { ElMessage.warning('至少添加一个字段'); return; }
  if (valid.some((f) => !isValidName(f.name))) { ElMessage.warning('字段名需 snake_case'); return; }
  loading.value = true;
  try {
    const meta = await createTable({
      name: form.name,
      label: form.label,
      fields: valid,
      note: form.note || null,
      autoTimestamps: form.autoTimestamps,
    });
    ElMessage.success('已创建');
    router.replace({ name: 'table-data', params: { id: meta.id } });
  } catch (e) { ElMessage.error((e as Error).message); } finally { loading.value = false; }
}
</script>

<template>
  <div class="page">
    <div class="page-header"><h1 class="page-title">新建模型</h1>
      <el-button @click="router.back()">返回</el-button>
    </div>
    <div class="card form-card">
      <el-form label-width="100px">
        <el-form-item label="表名"><el-input v-model="form.name" placeholder="如 articles" class="mono" /></el-form-item>
        <el-form-item label="标签"><el-input v-model="form.label" placeholder="如 文章" /></el-form-item>
        <el-form-item label="备注"><el-input v-model="form.note" type="textarea" :rows="2" /></el-form-item>
        <el-form-item label="自动时间戳"><el-switch v-model="form.autoTimestamps" /></el-form-item>
        <el-divider content-position="left">字段定义</el-divider>
        <FieldRowsEditor v-model="fields" />
        <el-form-item>
          <el-button type="primary" :loading="loading" @click="onSubmit">创建模型</el-button>
        </el-form-item>
      </el-form>
    </div>
  </div>
</template>
<style scoped>
.form-card { padding: 24px; max-width: 820px; }
</style>
```

- [ ] **Step 4：chrome-devtools 验证（建一个 articles 表 + 几个字段 → 跳数据浏览）**

- [ ] **Step 5：Commit**

```bash
git add apps/web/src/components/FieldRowsEditor.vue apps/web/src/views/tables/TableNew.vue
git commit -m "feat(web): 模型字段编辑器（element-plus 动态行）+ 新建模型（vue-json-ui-editor 不支持数组的务实替代）"
```

---

## Task 13：导入已有表 TableImport

**Files:**
- Modify: `apps/web/src/views/tables/TableImport.vue`（替换占位）

- [ ] **Step 1：TableImport.vue**

`apps/web/src/views/tables/TableImport.vue`：
```vue
<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { importTable, updateTable } from '../api/index.js';
import type { TableMeta } from '@1api/shared';

const router = useRouter();
const name = ref('');
const meta = ref<TableMeta | null>(null);
const loading = ref(false);

async function onPreview() {
  if (!name.value) { ElMessage.warning('请输入表名'); return; }
  loading.value = true;
  try {
    meta.value = await importTable(name.value);
    ElMessage.success('已推断字段');
  } catch (e) { ElMessage.error((e as Error).message); } finally { loading.value = false; }
}

async function onSave() {
  if (!meta.value) return;
  loading.value = true;
  try {
    await updateTable(meta.value.id, { label: meta.value.label, note: meta.value.note });
    ElMessage.success('已保存');
    router.replace({ name: 'table-data', params: { id: meta.value.id } });
  } catch (e) { ElMessage.error((e as Error).message); } finally { loading.value = false; }
}
</script>

<template>
  <div class="page">
    <div class="page-header"><h1 class="page-title">导入已有表</h1>
      <el-button @click="router.back()">返回</el-button>
    </div>
    <div class="card" style="padding:24px;max-width:820px">
      <el-form label-width="100px" @submit.prevent="onPreview">
        <el-form-item label="业务库表名">
          <el-input v-model="name" placeholder="如 users" class="mono" />
        </el-form-item>
        <el-form-item><el-button type="primary" :loading="loading" @click="onPreview">预览结构</el-form-item>
      </el-form>

      <template v-if="meta">
        <el-divider content-position="left">推断的字段</el-divider>
        <el-form label-width="100px">
          <el-form-item label="标签"><el-input v-model="meta.label" /></el-form-item>
          <el-form-item label="备注"><el-input v-model="meta.note" /></el-form-item>
        </el-form>
        <el-table :data="meta.fields" size="small" border>
          <el-table-column prop="name" label="字段名" min-width="140"><template #default="{ row }"><span class="mono">{{ row.name }}</span></template></el-table-column>
          <el-table-column prop="jsonType" label="类型" width="100" />
          <el-table-column label="主键" width="70"><template #default="{ row }">{{ row.isPrimary ? '是' : '' }}</template></el-table-column>
          <el-table-column label="可空" width="70"><template #default="{ row }">{{ row.nullable ? '是' : '' }}</template></el-table-column>
        </el-table>
        <div style="margin-top:16px">
          <el-button type="primary" :loading="loading" @click="onSave">保存</el-button>
        </div>
      </template>
    </div>
  </div>
</template>
```

- [ ] **Step 2：chrome-devtools 验证（导入一张已存在的业务表）**

- [ ] **Step 3：Commit**

```bash
git add apps/web/src/views/tables/TableImport.vue
git commit -m "feat(web): 导入已有表（预览推断字段 + 调整 label/备注保存）"
```

---

## Task 14：表详情 TableDetail（元数据 + 字段 label/可见/只读编辑 + 刷新）

**Files:**
- Modify: `apps/web/src/views/tables/TableDetail.vue`（替换占位）

- [ ] **Step 1：TableDetail.vue**

`apps/web/src/views/tables/TableDetail.vue`：
```vue
<script setup lang="ts">
import { ref, onMounted, watchEffect } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { getTable, updateTable, refreshTable } from '../api/index.js';
import { formatTs } from '../../lib/format.js';
import type { TableMeta } from '@1api/shared';

const route = useRoute();
const router = useRouter();
const meta = ref<TableMeta | null>(null);
const loading = ref(false);
const saving = ref(false);
const id = () => Number(route.params.id);

async function load() {
  loading.value = true;
  try { meta.value = await getTable(id()); } finally { loading.value = false; }
}
onMounted(load);

async function onSave() {
  if (!meta.value) return;
  saving.value = true;
  try {
    await updateTable(meta.value.id, {
      label: meta.value.label,
      note: meta.value.note,
      isPublished: meta.value.isPublished,
      isEditable: meta.value.isEditable,
    });
    ElMessage.success('已保存');
    await load();
  } catch (e) { ElMessage.error((e as Error).message); } finally { saving.value = false; }
}

async function onRefresh() {
  try {
    await refreshTable(id());
    await load();
    ElMessage.success('已刷新结构');
  } catch (e) { ElMessage.error((e as Error).message); }
}
</script>

<template>
  <div class="page" v-loading="loading">
    <div class="page-header">
      <h1 class="page-title">表详情 <span v-if="meta" class="mono" style="color:var(--c-text-muted);font-size:15px">{{ meta.name }}</span></h1>
      <div>
        <el-button @click="onRefresh">刷新结构</el-button>
        <el-button @click="router.push({ name: 'table-data', params: { id: id() } })">数据</el-button>
      </div>
    </div>
    <template v-if="meta">
      <div class="card" style="padding:24px;max-width:820px;margin-bottom:16px">
        <el-form label-width="100px">
          <el-form-item label="表名"><span class="mono">{{ meta.name }}</span></el-form-item>
          <el-form-item label="主键"><span class="mono">{{ meta.primaryKey }}</span></el-form-item>
          <el-form-item label="标签"><el-input v-model="meta.label" /></el-form-item>
          <el-form-item label="备注"><el-input v-model="meta.note" /></el-form-item>
          <el-form-item label="发布"><el-switch v-model="meta.isPublished" /></el-form-item>
          <el-form-item label="可编辑"><el-switch v-model="meta.isEditable" /></el-form-item>
          <el-form-item label="创建时间">{{ formatTs(meta.createdAt) }}</el-form-item>
          <el-form-item><el-button type="primary" :loading="saving" @click="onSave">保存</el-button></el-form-item>
        </el-form>
      </div>
      <div class="card" style="padding:16px">
        <div style="font-weight:700;padding:4px 0 12px">字段（结构只读，label/可见/只读可编辑需在元数据层调，本期仅展示）</div>
        <el-table :data="meta.fields" size="small" border>
          <el-table-column prop="name" label="字段名" min-width="140"><template #default="{ row }"><span class="mono">{{ row.name }}</span></template></el-table-column>
          <el-table-column prop="label" label="标签" min-width="120" />
          <el-table-column prop="jsonType" label="类型" width="100" />
          <el-table-column label="主键" width="70"><template #default="{ row }">{{ row.isPrimary ? '是' : '' }}</template></el-table-column>
          <el-table-column label="可空" width="70"><template #default="{ row }">{{ row.nullable ? '是' : '' }}</template></el-table-column>
          <el-table-column label="隐藏" width="70"><template #default="{ row }">{{ row.isHidden ? '是' : '' }}</template></el-table-column>
        </el-table>
      </div>
    </template>
  </div>
</template>
```

> spec 提到字段可编辑 label/isHidden/isReadonly/enumValues——但 Phase 2 的 `PUT /api/admin/tables/:id` 仅支持 label/note/isPublished/isEditable（不支持逐字段编辑）。本期字段列表**只读展示**，不做逐字段编辑（YAGNI，等 server 支持字段级 PATCH 再加）。

- [ ] **Step 2：chrome-devtools 验证**

- [ ] **Step 3：Commit**

```bash
git add apps/web/src/views/tables/TableDetail.vue
git commit -m "feat(web): 表详情（元数据编辑 + 字段只读展示 + 刷新结构）"
```

---

## Task 15：数据浏览 DataBrowse（列表/筛选/排序/分页）+ vue-json-ui-editor 用途①（新增/编辑表单）+ 删除 + 导出

> spec §3.3 用途①核心落地：用 `fieldsToEditorSchema` 生成 schema，vue-json-ui-editor 渲染新增/编辑表单。

**Files:**
- Modify: `apps/web/src/views/tables/DataBrowse.vue`（替换占位）

- [ ] **Step 1：DataBrowse.vue**

`apps/web/src/views/tables/DataBrowse.vue`：
```vue
<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { useRoute } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import JsonEditor from 'vue-json-ui-editor';
import { getTable, listData, createRecord, updateRecord, deleteRecord, exportCsv } from '../api/index.js';
import { fieldsToEditorSchema } from '../../lib/schema-adapter.js';
import { formatCell } from '../../lib/format.js';
import type { TableMeta } from '@1api/shared';
import EmptyState from '../../components/EmptyState.vue';

const route = useRoute();
const id = () => Number(route.params.id);

const meta = ref<TableMeta | null>(null);
const rows = ref<Record<string, unknown>[]>([]);
const total = ref(0);
const loading = ref(false);

// 查询参数
const page = ref(1);
const size = ref(20);
const order = ref('');
const q = ref('');
const filters = ref<Record<string, string>>({}); // { field: 'value' } 简单 eq 过滤

// 弹窗：新增/编辑（vue-json-ui-editor）
const dlgVisible = ref(false);
const dlgMode = ref<'create' | 'edit'>('create');
const editingPk = ref<string | null>(null);
const editorRef = ref<{ form: () => { validate: (cb: (v: boolean) => void) => void }; reset: () => void }>();
const formModel = ref<Record<string, unknown>>({});

const visibleFields = computed(() => (meta.value?.fields ?? []).filter((f) => !f.isHidden));
const canEdit = computed(() => meta.value?.isEditable ?? false);

const editorSchema = computed(() => (meta.value ? fieldsToEditorSchema(meta.value.fields) : { type: 'object', properties: {}, required: [] }));

async function load() {
  loading.value = true;
  try {
    if (!meta.value) meta.value = await getTable(id());
    const query: Record<string, unknown> = { page: page.value, size: size.value };
    if (order.value) query['order'] = order.value;
    if (q.value) query['q'] = q.value;
    for (const [k, v] of Object.entries(filters.value)) if (v) query[`${k}__eq`] = v;
    const res = await listData<Record<string, unknown>>(id(), query);
    rows.value = res.rows;
    total.value = res.total;
  } catch (e) { ElMessage.error((e as Error).message); } finally { loading.value = false; }
}
onMounted(load);

function openCreate() {
  dlgMode.value = 'create';
  editingPk.value = null;
  formModel.value = {};
  dlgVisible.value = true;
}
function openEdit(row: Record<string, unknown>) {
  dlgMode.value = 'edit';
  editingPk.value = String(row[meta.value!.primaryKey]);
  formModel.value = { ...row };
  dlgVisible.value = true;
}

async function onSubmit() {
  editorRef.value?.form().validate(async (valid) => {
    if (!valid) return;
    try {
      if (dlgMode.value === 'create') await createRecord(id(), { ...formModel.value });
      else await updateRecord(id(), editingPk.value!, { ...formModel.value });
      ElMessage.success('已保存');
      dlgVisible.value = false;
      await load();
    } catch (e) { ElMessage.error((e as Error).message); }
  });
}

async function onDelete(row: Record<string, unknown>) {
  const pk = String(row[meta.value!.primaryKey]);
  try {
    await ElMessageBox.confirm(`确定删除记录 ${pk}？`, '删除确认', { type: 'warning' });
    await deleteRecord(id(), pk);
    ElMessage.success('已删除');
    await load();
  } catch (e) { if (e !== 'cancel') ElMessage.error((e as Error).message); }
}

async function onExport() {
  try {
    const { blob, truncated, total: t } = await exportCsv(id(), { page: 1, size: 10000 });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${meta.value!.name}.csv`; a.click();
    URL.revokeObjectURL(url);
    if (truncated) ElMessage.warning(`数据超 10000 行（共 ${t}），仅导出前 10000 行`);
  } catch (e) { ElMessage.error((e as Error).message); }
}

watch([page, size], load);
</script>

<template>
  <div class="page" v-loading="loading">
    <div class="page-header">
      <h1 class="page-title">数据 <span v-if="meta" class="mono" style="font-size:15px;color:var(--c-text-muted)">{{ meta.name }}</span></h1>
      <div>
        <el-button @click="onExport">导出 CSV</el-button>
        <template v-if="canEdit">
          <el-button type="primary" @click="openCreate">新增</el-button>
        </template>
      </div>
    </div>

    <div class="card filter-bar">
      <el-input v-model="q" placeholder="关键词搜索" clearable style="width:240px" @keyup.enter="load" />
      <el-select v-model="order" placeholder="排序" clearable style="width:200px" @change="load">
        <el-option label="主键 倒序" :value="`${meta?.primaryKey}:desc`" />
        <el-option label="主键 正序" :value="`${meta?.primaryKey}:asc`" />
      </el-select>
      <el-button @click="load">查询</el-button>
    </div>

    <div class="card">
      <el-table v-if="rows.length" :data="rows" size="default">
        <el-table-column v-for="f in visibleFields" :key="f.name" :prop="f.name" :label="f.label || f.name" min-width="140">
          <template #default="{ row }">{{ formatCell(row[f.name], f) }}</template>
        </el-table-column>
        <el-table-column v-if="canEdit" label="操作" width="140" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openEdit(row)">编辑</el-button>
            <el-button link type="danger" @click="onDelete(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
      <EmptyState v-else text="暂无记录" />
    </div>

    <el-pagination
      v-if="total > 0" style="margin-top:16px;justify-content:flex-end;display:flex"
      :current-page="page" :page-size="size" :total="total"
      :page-sizes="[20, 50, 100]" layout="total, sizes, prev, pager, next"
      @update:current-page="page = $event" @update:page-size="size = $event"
    />

    <!-- vue-json-ui-editor 用途①：数据编辑表单 -->
    <el-dialog v-model="dlgVisible" :title="dlgMode === 'create' ? '新增记录' : '编辑记录'" width="560px">
      <JsonEditor ref="editorRef" :schema="editorSchema" v-model="formModel" />
      <template #footer>
        <el-button @click="dlgVisible = false">取消</el-button>
        <el-button type="primary" @click="onSubmit">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>
<style scoped>
.filter-bar { display: flex; gap: 12px; padding: 14px 16px; margin-bottom: 16px; align-items: center; }
</style>
```

- [ ] **Step 2：chrome-devtools 验证（列表/搜索/分页/新增/编辑/删除/导出 + datetime 字段是否出 date-picker）**

> 重点验证 datetime 字段：若 `el-date-picker` 没出现，回到 Task 7 Step 4 按 parser.ts 实际映射调整 `attrs` 写法（迭代优化）。

- [ ] **Step 3：Commit**

```bash
git add apps/web/src/views/tables/DataBrowse.vue
git commit -m "feat(web): 数据浏览（筛选/排序/分页）+ vue-json-ui-editor 新增/编辑表单 + 删除 + CSV 导出"
```

---

## Task 16：Token 管理 Tokens

**Files:**
- Modify: `apps/web/src/views/Tokens.vue`（替换占位）

- [ ] **Step 1：Tokens.vue**

`apps/web/src/views/Tokens.vue`：
```vue
<script setup lang="ts">
import { ref, reactive, onMounted, computed } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { listTables } from '../api/index.js';
import { listTokens, createToken, updateToken, deleteToken } from '../api/index.js';
import { formatTs } from '../lib/format.js';
import type { TokenListVO } from '../api/types.js';
import type { TableMeta, TokenPermissions } from '@1api/shared';
import EmptyState from '../components/EmptyState.vue';

const tokens = ref<TokenListVO[]>([]);
const tables = ref<TableMeta[]>([]);
const loading = ref(false);

const dlgVisible = ref(false);
const form = reactive({
  name: '',
  tables: [] as string[],
  wildcard: false,
  actions: ['read'] as TokenPermissions['actions'],
  allowSchema: false,
});
const newToken = ref<string | null>(null);

const allActions: Array<{ value: TokenPermissions['actions'][number]; label: string }> = [
  { value: 'read', label: '读' },
  { value: 'write', label: '写' },
];

onMounted(async () => {
  loading.value = true;
  try {
    [tokens.value, tables.value] = await Promise.all([listTokens(), listTables()]);
  } finally { loading.value = false; }
});

function openCreate() {
  form.name = ''; form.tables = []; form.wildcard = false; form.actions = ['read']; form.allowSchema = false;
  newToken.value = null;
  dlgVisible.value = true;
}

async function onSubmit() {
  if (!form.name) { ElMessage.warning('请填写名称'); return; }
  if (!form.wildcard && form.tables.length === 0) { ElMessage.warning('请选择表或勾选全部'); return; }
  const perms: TokenPermissions = {
    tables: form.wildcard ? ['*'] : form.tables,
    actions: form.allowSchema ? [...form.actions, 'schema'] : form.actions,
  };
  try {
    const r = await createToken(form.name, perms);
    newToken.value = r.token;
    tokens.value = await listTokens();
    ElMessage.success('已创建，请立即复制明文');
  } catch (e) { ElMessage.error((e as Error).message); }
}

async function toggleActive(t: TokenListVO) {
  try { await updateToken(t.id, { isActive: !t.is_active }); tokens.value = await listTokens(); }
  catch (e) { ElMessage.error((e as Error).message); }
}

async function onDelete(t: TokenListVO) {
  try {
    await ElMessageBox.confirm(`确定删除 Token「${t.name}」？`, '删除确认', { type: 'warning' });
    await deleteToken(t.id); tokens.value = await listTokens(); ElMessage.success('已删除');
  } catch (e) { if (e !== 'cancel') ElMessage.error((e as Error).message); }
}

async function copyToken() {
  if (!newToken.value) return;
  await navigator.clipboard.writeText(newToken.value);
  ElMessage.success('已复制');
}
</script>

<template>
  <div class="page" v-loading="loading">
    <div class="page-header"><h1 class="page-title">Token 管理</h1>
      <el-button type="primary" @click="openCreate">新建 Token</el-button>
    </div>
    <div class="card">
      <el-table v-if="tokens.length" :data="tokens">
        <el-table-column prop="name" label="名称" min-width="140" />
        <el-table-column label="前缀" width="140"><template #default="{ row }"><span class="mono">{{ row.token_prefix }}</span></template></el-table-column>
        <el-table-column label="权限" min-width="200"><template #default="{ row }"><span class="mono">{{ row.permissions.tables.join(',') }} · {{ row.permissions.actions.join(',') }}</span></template></el-table-column>
        <el-table-column label="状态" width="90">
          <template #default="{ row }"><el-switch :model-value="row.is_active" @change="toggleActive(row)" /></template>
        </el-table-column>
        <el-table-column label="最近使用" width="150"><template #default="{ row }">{{ formatTs(row.last_used_at) }}</template></el-table-column>
        <el-table-column label="创建时间" width="150"><template #default="{ row }">{{ formatTs(row.created_at) }}</template></el-table-column>
        <el-table-column label="操作" width="90" fixed="right"><template #default="{ row }"><el-button link type="danger" @click="onDelete(row)">删除</el-button></template></el-table-column>
      </el-table>
      <EmptyState v-else text="还没有 Token" />
    </div>

    <el-dialog v-model="dlgVisible" title="新建 Token" width="520px">
      <el-form label-width="90px">
        <el-form-item label="名称"><el-input v-model="form.name" /></el-form-item>
        <el-form-item label="全部表"><el-switch v-model="form.wildcard" /></el-form-item>
        <el-form-item v-if="!form.wildcard" label="表">
          <el-select v-model="form.tables" multiple placeholder="选择表" style="width:100%">
            <el-option v-for="t in tables" :key="t.id" :label="t.name" :value="t.name" />
          </el-select>
        </el-form-item>
        <el-form-item label="动作">
          <el-checkbox-group v-model="form.actions">
            <el-checkbox v-for="a in allActions" :key="a.value" :label="a.value">{{ a.label }}</el-checkbox>
          </el-checkbox-group>
        </el-form-item>
        <el-form-item label="允许 Schema 变更"><el-switch v-model="form.allowSchema" /></el-form-item>
      </el-form>

      <el-alert v-if="newToken" type="warning" :closable="false" style="margin-top:12px">
        <template #title>
          <div class="token-once">
            <span class="mono">{{ newToken }}</span>
            <el-button size="small" type="primary" @click="copyToken">复制</el-button>
          </div>
        </template>
        <div style="margin-top:6px">明文仅显示一次，离开后无法再获取。</div>
      </el-alert>

      <template #footer>
        <el-button @click="dlgVisible = false">{{ newToken ? '我已保存' : '取消' }}</el-button>
        <el-button v-if="!newToken" type="primary" @click="onSubmit">创建</el-button>
      </template>
    </el-dialog>
  </div>
</template>
<style scoped>
.token-once { display:flex; align-items:center; gap:10px; }
.token-once .mono { word-break: break-all; }
</style>
```

- [ ] **Step 2：chrome-devtools 验证（创建→明文一次显示→复制→启停→删除）**

- [ ] **Step 3：Commit**

```bash
git add apps/web/src/views/Tokens.vue
git commit -m "feat(web): Token 管理（创建明文一次显示 + 表/动作多选 + 启停 + 删除）"
```

---

## Task 17：管理员管理 Admins

**Files:**
- Modify: `apps/web/src/views/Admins.vue`（替换占位）

- [ ] **Step 1：Admins.vue**

`apps/web/src/views/Admins.vue`：
```vue
<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';
import { useAuthStore } from '../stores/auth.js';
import { ElMessage, ElMessageBox } from 'element-plus';
import { listAdmins, createAdmin, updateAdmin, deleteAdmin } from '../api/index.js';
import { formatTs } from '../lib/format.js';
import type { AdminVO } from '../api/types.js';
import EmptyState from '../components/EmptyState.vue';

const auth = useAuthStore();
const admins = ref<AdminVO[]>([]);
const loading = ref(false);

const dlgVisible = ref(false);
const form = reactive({ name: '', nickname: '', password: '' });

const resetDlg = reactive({ visible: false, id: 0, nickname: '', password: '' });

onMounted(load);
async function load() {
  loading.value = true;
  try { admins.value = await listAdmins(); } finally { loading.value = false; }
}

function openCreate() { form.name = ''; form.nickname = ''; form.password = ''; dlgVisible.value = true; }

async function onCreate() {
  if (!form.name || form.password.length < 6) { ElMessage.warning('账号必填，密码≥6位'); return; }
  try {
    await createAdmin(form.name, form.nickname || form.name, form.password);
    dlgVisible.value = false; await load(); ElMessage.success('已创建');
  } catch (e) { ElMessage.error((e as Error).message); }
}

function openReset(a: AdminVO) { resetDlg.id = a.id; resetDlg.nickname = a.nickname; resetDlg.password = ''; resetDlg.visible = true; }

async function onReset() {
  if (resetDlg.password && resetDlg.password.length < 6) { ElMessage.warning('密码≥6位'); return; }
  try {
    const patch: { nickname?: string; password?: string } = {};
    if (resetDlg.nickname) patch.nickname = resetDlg.nickname;
    if (resetDlg.password) patch.password = resetDlg.password;
    await updateAdmin(resetDlg.id, patch);
    resetDlg.visible = false; await load(); ElMessage.success('已更新');
  } catch (e) { ElMessage.error((e as Error).message); }
}

async function onDelete(a: AdminVO) {
  if (a.id === auth.currentUser?.id) { ElMessage.warning('不可删除自己'); return; }
  try {
    await ElMessageBox.confirm(`确定删除管理员「${a.name}」？`, '删除确认', { type: 'warning' });
    await deleteAdmin(a.id); await load(); ElMessage.success('已删除');
  } catch (e) { if (e !== 'cancel') ElMessage.error((e as Error).message); }
}
</script>

<template>
  <div class="page" v-loading="loading">
    <div class="page-header"><h1 class="page-title">管理员管理</h1>
      <el-button type="primary" @click="openCreate">新建管理员</el-button>
    </div>
    <div class="card">
      <el-table v-if="admins.length" :data="admins">
        <el-table-column prop="name" label="账号" min-width="140"><template #default="{ row }"><span class="mono">{{ row.name }}</span></template></el-table-column>
        <el-table-column prop="nickname" label="昵称" min-width="140" />
        <el-table-column label="待改密" width="100"><template #default="{ row }"><el-tag v-if="row.must_change_password" type="warning" size="small">待改密</el-tag><span v-else>—</span></template></el-table-column>
        <el-table-column label="创建时间" width="160"><template #default="{ row }">{{ formatTs(row.created_at) }}</template></el-table-column>
        <el-table-column label="操作" width="160" fixed="right">
          <template #default="{ row }">
            <el-button link @click="openReset(row)">编辑/改密</el-button>
            <el-button link type="danger" :disabled="row.id === auth.currentUser?.id" @click="onDelete(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
      <EmptyState v-else text="没有管理员" />
    </div>

    <el-dialog v-model="dlgVisible" title="新建管理员" width="460px">
      <el-form label-width="80px">
        <el-form-item label="账号"><el-input v-model="form.name" class="mono" /></el-form-item>
        <el-form-item label="昵称"><el-input v-model="form.nickname" /></el-form-item>
        <el-form-item label="密码"><el-input v-model="form.password" type="password" show-password /></el-form-item>
      </el-form>
      <template #footer><el-button @click="dlgVisible = false">取消</el-button><el-button type="primary" @click="onCreate">创建</el-button></template>
    </el-dialog>

    <el-dialog v-model="resetDlg.visible" title="编辑管理员" width="460px">
      <el-form label-width="80px">
        <el-form-item label="昵称"><el-input v-model="resetDlg.nickname" /></el-form-item>
        <el-form-item label="新密码"><el-input v-model="resetDlg.password" type="password" show-password placeholder="留空则不改；改密将要求对方下次登录改密" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="resetDlg.visible = false">取消</el-button><el-button type="primary" @click="onReset">保存</el-button></template>
    </el-dialog>
  </div>
</template>
```

- [ ] **Step 2：chrome-devtools 验证（新建/编辑改密/删自己被禁）**

- [ ] **Step 3：Commit**

```bash
git add apps/web/src/views/Admins.vue
git commit -m "feat(web): 管理员管理（新建/改密重置/删除-禁删自己）"
```

---

## Task 18：设置 Settings（只读展示）

**Files:**
- Modify: `apps/web/src/views/Settings.vue`（替换占位）
- Modify: `apps/web/src/api/index.ts` 或新建 `apps/web/src/api/system.ts`（增加 `/healthz` 拉系统信息，若 server 无该端点则用环境变量/前端常量只读展示）

> 注：Phase 2 server 未提供专门"系统设置"端点。本期 Settings 用 `GET /healthz`（已存在）确认服务状态，业务库/系统库路径等**只读**信息前端无来源时显示"由服务端配置"，避免编造。如需真实路径，后续 Phase 给 server 加 `/api/admin/system/info`（本期 YAGNI 不加）。

- [ ] **Step 1：Settings.vue**

`apps/web/src/views/Settings.vue`：
```vue
<script setup lang="ts">
import { ref, onMounted } from 'vue';
import http from '../api/index.js'; // 用 http 取 healthz（非 /api 前缀，绝对路径）
import { listTables } from '../api/index.js';

const status = ref<'loading' | 'ok' | 'down'>('loading');
const tableCount = ref(0);

onMounted(async () => {
  try {
    await http.get('/healthz'); // baseURL=/api，healthz 在根 → 用绝对 fetch
    status.value = 'ok';
  } catch {
    // healthz 挂在根路径非 /api，直接用原生 fetch
    try {
      const r = await fetch('/healthz');
      status.value = r.ok ? 'ok' : 'down';
    } catch { status.value = 'down'; }
  }
  try { tableCount.value = (await listTables()).length; } catch { /* ignore */ }
});
</script>

<template>
  <div class="page">
    <div class="page-header"><h1 class="page-title">系统设置</h1></div>
    <div class="card" style="padding:24px;max-width:640px">
      <el-descriptions :column="1" border>
        <el-descriptions-item label="服务状态">
          <el-tag v-if="status==='ok'" type="success" size="small">运行中</el-tag>
          <el-tag v-else-if="status==='down'" type="danger" size="small">异常</el-tag>
          <el-tag v-else type="info" size="small">检测中</el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="已注册表数">{{ tableCount }}</el-descriptions-item>
        <el-descriptions-item label="业务库路径">由服务端配置（~/.one-api/business.db）</el-descriptions-item>
        <el-descriptions-item label="系统库路径">由服务端配置（~/.one-api/system.db）</el-descriptions-item>
        <el-descriptions-item label="端口">3000（默认，PORT 可覆盖）</el-descriptions-item>
      </el-descriptions>
    </div>
  </div>
</template>
```

> 修正：`http` 是 axios 实例不是默认导出。Settings 的 import 改为 `import { http } from '../api/index.js';`。代码内 Step1 已用 `http.get`，模板无关。把 `<script setup>` 第一个 import 行改为 `import { http } from '../api/index.js';`。

- [ ] **Step 2：chrome-devtools 验证**

- [ ] **Step 3：Commit**

```bash
git add apps/web/src/views/Settings.vue
git commit -m "feat(web): 系统设置只读展示（服务状态 + 表数 + 路径说明）"
```

---

## Task 19：server 静态托管 + SPA fallback（生产单进程）

**Files:**
- Modify: `apps/server/src/app.ts`（在 erest 挂载后、错误中间件前，加 /admin 静态 + fallback）
- Test: `apps/server/src/__tests__/static-admin.test.ts`

- [ ] **Step 1：写失败测试——/admin 返回 index.html（SPA fallback），/admin/assets 真实文件 200**

`apps/server/src/__tests__/static-admin.test.ts`：
```typescript
import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildApp } from '../app.js';
import { startServer } from './helpers.js';

describe('/admin 静态 + SPA fallback', () => {
  it('未命中文件 → 返回 index.html（200, text/html）', async () => {
    const dir = mkdtempSync(join(tmpdir(), '1api-static-'));
    const adminDir = join(dir, 'admin');
    mkdirSync(adminDir, { recursive: true });
    writeFileSync(join(adminDir, 'index.html'), '<!doctype html><div id="app"></div>');
    writeFileSync(join(adminDir, 'assets', 'app.js') || '', ''); // 需先建目录
    mkdirSync(join(adminDir, 'assets'), { recursive: true });
    writeFileSync(join(adminDir, 'assets', 'app.js'), 'console.log(1)');

    // buildApp 需支持注入静态根目录（环境变量或参数）
    process.env['ONE_API_ADMIN_ROOT'] = adminDir;
    const { baseURL, close } = await startServer({ build: async () => ({ app: buildApp(), close: async () => {} }) });

    const r = await fetch(baseURL + '/admin/');
    expect(r.status).toBe(200);
    expect((await r.text()).includes('id="app"')).toBe(true);

    const r2 = await fetch(baseURL + '/admin/tables/123/data');
    expect(r2.status).toBe(200);
    expect((await r2.text()).includes('id="app"')).toBe(true);

    const asset = await fetch(baseURL + '/admin/assets/app.js');
    expect(asset.status).toBe(200);
    expect(await asset.text()).toBe('console.log(1)');

    delete process.env['ONE_API_ADMIN_ROOT'];
    await close();
    rmSync(dir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2：运行测试确认失败**

```bash
pnpm --filter @1api/server exec vitest run src/__tests__/static-admin.test.ts 2>&1 | tail -15
```
Expected: FAIL（app.ts 未挂静态）。

- [ ] **Step 3：修改 app.ts 加 /admin 静态 + SPA fallback**

在 `apps/server/src/app.ts`，`api.bind(...)` + `app.use('/api', apiRouter)` 之后、错误中间件之前，插入：
```typescript
import { resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

// —— Phase 3：/admin 静态托管 + SPA history fallback ——
// 静态根：优先环境变量（测试注入），默认 apps/server/static/admin（相对 dist）
const here = fileURLToPath(new URL('.', import.meta.url));
const ADMIN_ROOT = process.env['ONE_API_ADMIN_ROOT']
  ?? resolvePath(here, '../static/admin')
  ?? resolvePath(here, '../../static/admin');

if (existsSync(ADMIN_ROOT)) {
  // (a) 真实静态资源（assets 等）；index:false → index.html 由 fallback 统一发
  app.use('/admin', web.component.serveStatic(ADMIN_ROOT, { index: false, fallthrough: true }));
  // (b) SPA history fallback：所有 GET /admin/** 未命中文件 → index.html
  app.router.get('/admin/:splat*', (ctx) => {
    ctx.response.file(resolvePath(ADMIN_ROOT, 'index.html'));
  });
}
```

> 关键：fallback 用 `:splat*`（path-to-regexp v6 裸 `*` 会抛错）；`ctx.response.file` 接收绝对路径。静态根不存在时（dev 模式未 build）静默跳过，dev 用 vite proxy。

- [ ] **Step 4：运行测试确认通过**

```bash
pnpm --filter @1api/server exec vitest run src/__tests__/static-admin.test.ts 2>&1 | tail -15
```
Expected: PASS。

- [ ] **Step 5：确认 .gitignore 忽略 apps/server/static/admin**

读 `apps/server/.gitignore`，确认含 `static/` 或 `static/admin/`（构建产物不入库）。若无则追加。

- [ ] **Step 6：Commit**

```bash
git add apps/server/src/app.ts apps/server/src/__tests__/static-admin.test.ts apps/server/.gitignore
git commit -m "feat(server): /admin 静态托管 + SPA history fallback（生产单进程托管 web）"
```

---

## Task 20：全链路验收（build + start + e2e 冒烟）

**Files:**
- 无新增（验收为主）

- [ ] **Step 1：全量构建**

```bash
pnpm install
pnpm -r build
```
Expected: shared → engine → server → web 全绿；`apps/server/static/admin/index.html` 存在。

- [ ] **Step 2：单进程启动 + chrome-devtools 冒烟**

```bash
pnpm start   # node apps/server/dist/index.js
```
用 chrome-devtools 打开 `http://localhost:3000/admin/`，逐项验证 spec 验收标准：
1. 登录页（admin/123456）→ 强制改密 → 改密后进后台
2. Dashboard 三张统计卡 + 最近表
3. 表管理：新建模型（加字段）→ 列表 → 表详情（改 label 发布）→ 数据浏览
4. 数据浏览：新增记录（vue-json-ui-editor 表单，含 datetime/boolean/enum 字段验证）→ 编辑 → 删除 → 导出 CSV
5. Token：创建（明文一次显示 + 复制）→ 启停 → 删除
6. 管理员：新建 → 改密 → 删自己被禁
7. 设置：服务状态运行中
8. 直接访问 `http://localhost:3000/admin/tables/123/data`（SPA fallback 回 index.html 不 404）
9. 移动端窗口（窄屏）基本可用（统计卡单列、表格横向滚动）

- [ ] **Step 3：lint + 全量 test**

```bash
pnpm lint
pnpm -r test
```
Expected: 全绿。

- [ ] **Step 4：更新根 README 与 AGENTS（Phase 3 完成记录）**

在 `AGENTS.md` §1 分期进度，把 Phase 3 标 ✅；§3 补 `pnpm dev`（并行）/`pnpm start`（单进程）说明；附录补 Phase 3 踩坑（vue-json-ui-editor 不支持数组 → 手搓 FieldRowsEditor；@leizm/web SPA fallback 用 `:splat*`）。

- [ ] **Step 5：Commit**

```bash
git add README.md AGENTS.md
git commit -m "docs: Phase 3 完成记录（单进程一键启动 + 踩坑附录）"
```

---

## Self-Review（计划完成后自查）

**1. Spec 覆盖：**
- ✅ §3.1 web 骨架（vite/proxy/base/main/App/router/stores）→ Task 1/5/8
- ✅ §3.2 API 封装（request 信封 + 各模块 + 复用 @1api/shared）→ Task 3/4
- ✅ §3.3 用途①（数据编辑表单，fieldsToJsonSchema→editor）→ Task 7/15
- ⚠️ §3.3 用途②（模型字段编辑器）→ vue-json-ui-editor 不支持数组，Task 12 手搓 FieldRowsEditor 替代（用户已授权优化）
- ✅ §3.4 各页面 → Task 9-18
- ✅ §3.5 静态集成验证 → Task 19/20
- ✅ §3.6 测试（schema-adapter/format/request/store）→ Task 3/5/6/7
- ✅ 验收标准逐条 → Task 20 Step 2 对应

**2. 已知取舍（已在对应 task 标注）：**
- 模型字段编辑器手搓（库限制）
- TableDetail 字段逐项编辑暂缓（server 无字段级 PATCH 端点）
- Settings 路径只读说明（server 无系统信息端点）

**3. 类型一致性：** `ListResult.rows`（非 items）、`mustChangePassword`、snake_case VO 均已在 api/types.ts 对齐。

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-07-01-one-api-phase3-web.md`. Two execution options:**

**1. Subagent-Driven（推荐）** —— 每个 task 派独立 subagent + 两阶段 review（spec 合规 → 代码质量），快速迭代。

**2. Inline Execution** —— 本会话用 executing-plans 批量执行 + 检查点 review。

**Which approach?**
