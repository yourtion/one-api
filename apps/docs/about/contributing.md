# 贡献指南

感谢你对 one-api 的兴趣！本文档帮助你搭建开发环境并了解贡献流程。

## 开发环境

one-api 是 pnpm monorepo，需要 [Node.js](https://nodejs.org/) ≥ 18 和 [pnpm](https://pnpm.io/) 9+。

```bash
git clone https://github.com/yourtion/one-api.git
cd one-api
pnpm install
pnpm -r build       # typecheck 前必须先 build（engine 依赖 shared/dist）
pnpm -r typecheck
pnpm -r test
```

::: tip test 无需 build 前置
`pnpm -r test` 已无需先 build——各包 vitest 已配 `resolve.alias` 直走源码，全新 clone 后 `pnpm install && pnpm -r test` 直接可用。`typecheck` 仍需先 `build`（engine 的 tsconfig project reference 依赖 shared/dist）。
:::

## 项目结构

```
one-api/
├── packages/
│   ├── shared/   # @1api/shared —— 前后端共享类型 + 类型映射核心
│   ├── engine/   # @1api/engine —— 纯逻辑数据引擎（无 HTTP/UI 概念）
│   ├── sdk/      # @1api/sdk —— HTTP CRUD 客户端（基于 fetch）
│   └── cli/      # @1api/cli —— 终端工具（命令名 one-api-cli）
├── apps/
│   ├── server/   # HTTP API + MCP + 静态托管管理界面
│   ├── web/      # 管理界面（Vue 3 + element-plus）
│   └── docs/     # 本文档站（VitePress）
└── docs/superpowers/{specs,plans}/  # 设计文档与实现计划
```

包依赖拓扑：`shared` ← `engine` ← `server` / `web` / `sdk` / `cli`。`engine` 只接收 DB 句柄，不依赖任何传输层。

## 开发命令

| 命令 | 作用 |
| --- | --- |
| `pnpm install` | 安装全部 workspace 依赖 |
| `pnpm -r build` | 拓扑序构建所有包（shared → engine → ...） |
| `pnpm -r typecheck` | 全 workspace 类型检查（须先 `pnpm -r build`） |
| `pnpm -r test` | 全 workspace 测试（无需 build 前置） |
| `pnpm lint` | oxlint 全 workspace |
| `pnpm format` | oxfmt 格式化 |
| `pnpm dev` | 并行启动 server（:3000）+ web（:5173，热更新） |
| `pnpm start` | 生产单进程：`node apps/server/dist/index.js`，同时服务 `/api/*` 与 `/admin` |
| `pnpm docs:dev` | 本文档站开发预览 |
| `pnpm docs:build` | 构建文档站（含自动生成 API 参考） |

**单包操作：**

```bash
pnpm --filter @1api/shared test
pnpm --filter @1api/engine exec vitest run --coverage          # 带覆盖率
pnpm --filter @1api/engine test src/__tests__/dynamic-sql.test.ts   # 单文件
```

## 提交规范

采用 [Conventional Commits](https://www.conventionalcommits.org/)（描述可中文）：

| 前缀 | 用途 |
| --- | --- |
| `feat:` | 新特性 |
| `fix:` | 修复缺陷 |
| `docs:` | 文档变更 |
| `test:` | 仅测试 |
| `chore:` | 构建 / 工具 / 杂项 |
| `merge:` | 分支合并 |

每个 TDD task 一个 commit；大特性用 `--no-ff` merge 保留历史。

## 测试驱动开发

one-api 遵循 TDD：**先写失败测试 → 实现 → 通过 → commit**。

- 测试文件放各包 `src/__tests__/`，与源码同包。
- 临时 SQLite 用 `createTestDbs()`（`packages/engine/src/test-helpers.ts`），每次唯一路径，`afterEach` 清理。
- **覆盖率门槛：core 逻辑行覆盖 > 90%，分支 > 85%。** 不达标就补针对性单测，不要放宽阈值。

## 隔离工作区约定

实现工作在 **git worktree**（`.worktrees/<branch>/`，已 gitignore）中隔离，**不在 main 直接实施**。完成时按既定流程合并 / 提 PR / 保留分支。

## 完整研发规范

本文档只覆盖入门要点。详细的研发规范、技术栈硬约束与各期踩坑教训见仓库根目录的 [AGENTS.md](https://github.com/yourtion/one-api/blob/main/AGENTS.md)。

- 设计依据：[设计总览](https://github.com/yourtion/one-api/blob/main/docs/superpowers/specs/2026-06-24-one-api-overview.md) + 各期 spec（见 [设计文档](./design-docs)）。
- 路线与排期见 [路线图](../guide/roadmap)，更新历史见 [更新日志](./changelog)。
