# Phase 6：生态分发（npm 发包 + VitePress 文档站）

> 状态：已确认 ｜ 日期：2026-07-07 ｜ 作者：Yourtion
> 前置：Phase 1-5 全部合入 main（shared/engine/server/web/mcp/sdk/cli 均已实现）
> 配套：`2026-06-24-one-api-overview.md`

## 1. 定位与目标

**one-api 的核心能力（四种前端消费同一个 SQLite 业务库）已全部实现。** Phase 6 聚焦「生态分发」——让外部用户第一次能装上、跑起来、看懂怎么用。

**核心目标：首次可用分发。** 不追求建立完整发布工程（changesets/CI 自动化留待后期），本轮收敛到最小可分发版本。

**三条工作线（一次性整体交付）：**

1. **npm 发包**：`@1api/shared`、`@1api/engine`、`@1api/sdk`、`one-api-cli` 四个包配齐发布元信息，手动 `npm publish` 发首个公开版本 `0.1.0`
2. **VitePress 文档站**：新建 `apps/docs/`，搭首页 + 导航 + 主题；写快速上手、核心概念、四前端消费指南
3. **erest 自动 API 文档**：复用 server 测试夹具已装配的 erest 实例，调 `api.docs.generateDocs` 导出 markdown，随测试自动刷新，嵌入 VitePress

## 2. 在/不在范围内

### 在范围内

- 四个 npm 包的发布元信息补齐 + 手动发包
- VitePress 文档站搭建与内容写作
- erest 自动 API 文档生成（复用测试夹具路由装配）
- 文档站托管到 GitHub Pages（手动 deploy 脚本）
- 包级 README 与 CHANGELOG

### 不在范围内（明确划线）

| 项 | 理由 |
|---|---|
| ❌ Docker 化 | 当前 SQLite-only 尚未达「线上可用」；待后续补 MySQL 等数据库能力后再做生产化 |
| ❌ Changesets / CI 自动发版 | 本轮手动本地发包；自动化发版管线留待后期 |
| ❌ 生产化能力（session 持久化、多副本、监控、备份） | 属于「生产化/健壮性」方向，非本轮分发主题 |
| ❌ 多业务库 / 复合主键 / MySQL 支持等能力增强 | 属于「能力增强」方向 |
| ❌ 发 `apps/server` 聚合 bin 包 | 本轮只发 4 个库/工具包；server 通过 clone 源码运行 |

### 关键约束

- 发的包必须能 `pnpm pack` 验证产物完整、本地 `npm link` 跑通
- 文档站的所有安装命令/示例代码必须用 0.1.0 真实包验证一遍
- `apps/docs/` 构建独立，不纳入 `pnpm -r build` 主链，不拖慢现有构建
- 文档生成脚本复用测试夹具，不破坏 server 现有测试

## 3. npm 发包设计

### 3.1 现状盘点

四个包当前状态：

| 包 | 当前 | 发包相关字段 |
|---|---|---|
| `@1api/shared` | `private:true`, `version:"0.0.0"` | 已有 `files:[dist]` + `exports`，缺版本/元信息 |
| `@1api/engine` | 同上 | 同上 |
| `@1api/sdk` | 同上 | 同上，依赖 `@1api/shared: workspace:*`（运行时）+ `@1api/server`（devDep，集成测试用，不发） |
| `one-api-cli` | 同上，已有 `bin` | tsup 已配 `external:['better-sqlite3']`，依赖三 workspace 包 + commander/inquirer/cli-table3 |

**SDK 依赖澄清**：AGENTS.md 曾称 SDK「零运行时依赖」，准确说法是——SDK 仅依赖 `@1api/shared`（运行时）+ 原生 fetch（无第三方 HTTP 库）。`@1api/shared` 是 runtime dependency。

### 3.2 版本号

- 四包统一首版 **`0.1.0`**（语义化版本，0.x 表示仍在迭代期、API 可能变）
- 后续按各包独立节奏升版本（不强制四包同步）

### 3.3 发布元信息（每个包补齐）

```jsonc
{
  "private": false,              // 或删除 private 字段
  "version": "0.1.0",
  "license": "MIT",
  "author": "Yourtion <yourtion@gmail.com>",
  "repository": {
    "type": "git",
    "url": "https://github.com/yourtion/one-api.git",
    "directory": "packages/<pkg>"   // 各包填实际目录名
  },
  "homepage": "https://github.com/yourtion/one-api#readme",
  "bugs": { "url": "https://github.com/yourtion/one-api/issues" },
  "keywords": [/* 各包不同，见下 */],
  "publishConfig": { "access": "public" },   // scoped 包默认 restricted，需显式 public
  "engines": { "node": ">=18" }              // 原生 fetch + better-sqlite3 v12 支持
}
```

**keywords 建议：**
- `@1api/shared`：`["one-api","ai-native","database","types","shared"]`
- `@1api/engine`：`["one-api","ai-native","database","engine","sqlite","kysely"]`
- `@1api/sdk`：`["one-api","ai-native","database","sdk","http-client","fetch"]`
- `one-api-cli`：`["one-api","ai-native","database","cli","terminal","command-line"]`

**CLI 额外项：**
- `bin` 已配（`one-api-cli: ./dist/index.js`），首版确认命令名与包名一致
- 补 `preferGlobal: true`（提示用户全局安装）

### 3.4 协议与 LICENSE

- 协议：**MIT**
- 根目录新建 `LICENSE` 文件（MIT 全文 + 版权人 Yourtion + 年份 2026）
- 四个包 package.json 设 `"license": "MIT"`（无需各包独立 LICENSE 文件，根 LICENSE 覆盖）

### 3.5 workspace 依赖 → 发版处理

- pnpm `publish` 时自动把 `workspace:*` 替换为实际版本号（如 `^0.1.0`）—— pnpm 默认行为，无需手工处理
- `@1api/server` 是 SDK/CLI 的 **devDependency**（集成测试用，见 Phase 5 踩坑表），它是 `private` app 不发布，保持 `workspace:*` 即可（devDependencies 不进发布产物，不影响消费方）

### 3.6 包级 README 与 CHANGELOG

每个包目录下新增：
- `README.md`：该包定位 + 安装 + 快速上手 + API 概览（链接到文档站对应页）
- `CHANGELOG.md`：`## 0.1.0 (2026-07-07)` + 首版内容摘要

### 3.7 发包前演练（验证产物完整）

1. `pnpm -r build` 后对每个包 `pnpm pack --dry-run` → 检查 tarball 只含 `dist` + `README` + `CHANGELOG` + `LICENSE` + `package.json`
2. 本地建临时目录 `npm i <tarball>`，import 能用：
   - SDK：Node 侧 fetch 冒烟（对接临时 server）
   - CLI：`pnpm link --global` 后任意目录跑 `one-api-cli --help`
3. 发版后验证 `@1api/sdk` 的 dependencies 里 `@1api/shared` 是 `^0.1.0`（非 `workspace:*`）

### 3.8 发包前硬性预检

| 检查项 | 命令 |
|---|---|
| `@1api` scope 归本项目所有 | `npm org ls 1api`（或尝试创建 org） |
| `one-api-cli` 名字未被占用 | `npm view one-api-cli`（404 即可用） |
| npm 登录态有效 | `npm whoami` |

## 4. VitePress 文档站设计

### 4.1 站点选址与构建

- **位置**：新建 `apps/docs/`（与 server/web 并列，符合 monorepo 习惯）
- **VitePress**：最新稳定版，markdown 编写、Vite 驱动
- **构建产物**：`apps/docs/dist/`（独立，不进 server 的 static 目录——文档站是独立站点，不和 admin 后台混在一起）
- **不纳入 `pnpm -r build`**：避免拖慢主构建；独立 `pnpm --filter docs build` / `pnpm --filter docs dev`
- docs 包 `private: true`（不发包），仅本地构建 + GitHub Pages 部署

### 4.2 信息架构

```
apps/docs/
├── .vitepress/
│   ├── config.ts          # 站点配置 + 导航 + 侧边栏 + 主题
│   └── theme/             # Control Console 主题覆盖
├── public/                # 静态资源（Logo 等）
├── index.md               # 首页（Hero + Features + 快速上手入口）
├── guide/
│   ├── introduction.md    # one-api 是什么、为什么、灵感来源
│   ├── quick-start.md     # 5 分钟跑通（启动 → 建表 → 四前端访问）
│   ├── concepts.md        # 核心概念（系统/业务库、元数据驱动、token/权限、is_published/is_editable）
│   ├── install.md         # 安装与部署（开发/生产单进程/环境变量）
│   └── roadmap.md         # 路线图（含「后续：MySQL → Docker」）
├── clients/               # 前端消费指南
│   ├── http-api.md        # HTTP REST API（/api/data/* + curl 示例）
│   ├── admin-ui.md        # 管理界面（/admin 浏览器操作 + 建模表单）
│   ├── mcp.md             # MCP 服务（/mcp 接入 AI agent）
│   ├── cli.md             # CLI 全命令手册
│   └── sdk.md             # SDK 程序化调用
├── api-reference/         # erest 自动生成（见 4.3）
│   ├── auth.md
│   ├── admin.md
│   └── data.md
└── about/
    ├── contributing.md    # 贡献指南
    ├── design-docs.md     # 链接 docs/superpowers/specs
    └── changelog.md       # 更新日志（聚合各包）
```

**写作原则：**
- 所有安装命令、示例代码用 **0.1.0 发版后的真实包** 验证一遍
- 中文为主（与项目沟通一致），代码示例可中英注释混用
- 概念页引用 overview spec 的决策表，避免重复维护

### 4.3 erest 自动 API 文档（技术重点）

**方案：复用 server 测试夹具已装配的 erest 实例。**

server 的测试夹具 `setupTest()`（`apps/server/src/__tests__/helpers.ts`）已经把全部路由注册到一个 erest 实例上（Phase 2 踩坑表验证过）。文档生成脚本复用这条路径：

1. 写一个文档生成脚本（放 `apps/docs/scripts/gen-api-docs.ts`），import server 测试夹具的 `setupTest()` 装配路由
2. 装配完成后调 `api.docs.generateDocs({ markdown: 'apps/docs/api-reference/<group>.md' })`
3. markdown 按分组（auth/admin/data）导出三份文件，VitePress 自动收录到侧边栏
4. **随测试自动刷新**：把生成步骤挂到测试流程里（或独立 npm script `gen:api-docs`），每次跑测试/CI 时文档自动更新，永不与实际路由漂移

**已知问题处理：**
- 当前 `API_INFO.basePath: ''`（为测试脚手架 findApi 完整路径匹配留的）→ 文档生成场景需设 `basePath: '/api'`，让导出文档路径正确显示为 `/api/data/*`
- 复用测试夹具的公开入口，**不深入 server 私有模块**，避免跨边界耦合
- 脚本断言关键字段非空（三组 group 都要有内容），否则报错退出非零状态

**为什么不用其它方案：**
- ❌ 重构 server 路由装配出 `buildRoutesOnly()`：多余的重构，测试夹具已是现成的「仅装配路由」入口
- ❌ 手写 API 参考 markdown：易与实际路由不同步
- ❌ server 暴露 `/api/_docs` 端点拉取：文档生成依赖 server 运行中，构建链复杂

### 4.4 托管部署

- **GitHub Pages**：仓库 Settings → Pages，源设 `apps/docs/dist`
- **部署方式**：一个简单的 deploy 脚本（`pnpm --filter docs deploy`，内部 `gh-pages` 或 git push 到 `gh-pages` 分支）
- 本轮**不做 CI 自动部署**（手动触发 deploy 脚本）

### 4.5 主题与品牌

- 遵循 web 管理界面的 **"Control Console"** 美学方向（翡翠青主色 + Manrope/JetBrains Mono），文档站与产品视觉统一
- VitePress 主题配置：`--vp-c-brand`（翡翠青）、`--vp-font-family`（Manrope 正文 / JetBrains Mono 代码）、Logo
- 配色与 `apps/web` 共享 CSS 变量值（不共享文件，文档站独立）

## 5. 错误处理与风险

### 5.1 错误处理

本轮不引入新运行时错误路径。唯一相关的是**文档生成脚本的健壮性**：
- `api.docs.generateDocs` 失败（路由未装配）→ 脚本报错退出非零，CI 可发现
- 导出 markdown 为空 / 分组缺失 → 脚本断言关键字段非空，否则报错
- `pnpm publish` 失败（未登录 / 包名被占）→ 本地手动发包直接暴露原始错误

### 5.2 风险与对策

| 风险 | 对策 |
|---|---|
| `@1api` scope 未在 npm 注册 | 发包前 `npm org ls 1api`，未注册则先注册 org 或改名 |
| `one-api-cli` 名字被占用 | 发包前 `npm view one-api-cli`，被占则改 `@1api/cli` scoped 名 |
| 文档生成脚本依赖 server 内部模块，跨边界耦合 | 复用测试夹具公开入口，脚本放 docs 包，不深入 server 私有模块 |
| VitePress 与 monorepo ESM/TS 配置冲突 | docs 包独立 tsconfig + vite config，隔离于主链 |
| 文档与实际版本漂移 | API 参考随测试刷新；安装命令锁定 0.1.0 验证 |
| 发包后 `workspace:*` 未被替换 | pnpm publish 默认替换；发版后 `npm view` 复核依赖版本 |

## 6. 测试策略

本轮**不新增业务逻辑测试**（无新运行时代码），重点是**验证产物正确性**：

| 验证项 | 方式 |
|---|---|
| 包产物完整 | 每包 `pnpm pack --dry-run`，检查只含 dist + README + CHANGELOG + LICENSE + package.json |
| 包可独立安装 | 临时目录 `npm i <tarball>`，SDK/CLI 跑冒烟 |
| workspace 依赖正确解析 | 发版后 `@1api/sdk` dependencies 里 `@1api/shared` 应是 `^0.1.0` |
| CLI 全局可用 | `pnpm link --global` 后任意目录跑 `one-api-cli --help` |
| SDK Node 侧 | 临时项目 `npm i @1api/sdk` + fetch 冒烟 |
| erest 文档导出 | 生成脚本跑通，产出 markdown 含三组路由 |
| VitePress 构建 | `pnpm --filter docs build` 产 `dist/` 无错误，死链检查 |

**不放宽现有门槛**：`pnpm -r typecheck` / `pnpm -r test` / `pnpm -r build` / `pnpm lint` 全绿仍是前置条件。

## 7. 验收标准（Definition of Done）

### npm 发包

- [ ] 四个包发布元信息齐全（version/license/author/repo/keywords/publishConfig/engines）
- [ ] 根目录有 `LICENSE`（MIT）文件
- [ ] 每个包有包级 `README.md` + `CHANGELOG.md`
- [ ] `@1api/shared@0.1.0`、`@1api/engine@0.1.0`、`@1api/sdk@0.1.0`、`one-api-cli@0.1.0` 在 npm 上可查、可装
- [ ] 本地 `npm link` / 临时项目安装跑通冒烟

### 文档站

- [ ] `apps/docs/` VitePress 站点可 `dev` 预览、`build` 产出静态站
- [ ] 首页 + 指南 + 四前端消费指南 + API 参考 + 关于 全部成文
- [ ] API 参考由 erest 自动生成（随测试刷新），含 auth/admin/data 三组
- [ ] 文档内所有安装命令用 0.1.0 真实包验证过
- [ ] Control Console 主题（翡翠青 + Manrope/JetBrains Mono）落地
- [ ] 部署到 GitHub Pages，可通过仓库 URL 访问

### 整体

- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build && pnpm lint` 全绿
- [ ] 新增 `apps/docs/` 不破坏 `pnpm -r build`（docs 构建独立，不进主链）
- [ ] 文档生成脚本不破坏 server 现有测试

## 8. 工作项分解（供 plan 阶段细化）

1. **LICENSE + 根 README**：根目录 LICENSE（MIT）+ 项目级 README（入口介绍）
2. **发包元信息**：四包 package.json 补齐发布字段（version/license/author/repo/keywords/publishConfig/engines），`private:false`
3. **包级 README + CHANGELOG**：四包各写 README + CHANGELOG（0.1.0 条目）
4. **发包演练**：`pnpm pack --dry-run` 验证 + 临时目录安装冒烟
5. **npm 预检 + 发包**：scope/包名预检 → `npm publish` 四包
6. **VitePress 站点骨架**：`apps/docs/` 初始化 + 配置 + 主题 + 首页
7. **文档内容写作**：guide / clients 各页成文（安装命令用 0.1.0 验证）
8. **erest 自动 API 文档**：gen-api-docs 脚本（复用 setupTest）+ 挂到测试流程
9. **文档站部署**：GitHub Pages + deploy 脚本
10. **整体验收**：typecheck/test/build/lint 全绿 + e2e 冒烟 + 死链检查

## 9. 与 overview 的关系

本 spec 不修改 overview 的核心决策，仅补齐 overview §7 分期策略表中未列的「Phase 6」。完成后：

- overview §1 的「四种前端消费」从「已实现」升级到「可被外部用户消费」
- overview §7 分期表追加 Phase 6 行
- 后续 Phase（MySQL/多库 → Docker/生产化）作为路线图写入文档站 roadmap 页
