# 稳定性修复与 Phase 7 收尾实施计划

> 使用 subagent-driven-development；每项 TDD 后提交，先 spec review，再代码质量 review。

**Goal:** 修复已复现的数据与鉴权问题，使 Phase 7 达到可发布、可安装、可验证的状态。

**Architecture:** 保持 shared 类型映射、engine 数据逻辑、server 传输适配的职责。复用既有 Phase 7 worktree，先实施修复任务，再修改分发代码。

**Tech Stack:** TypeScript strict / ESM / pnpm 9 / SQLite / Kysely / Zod 4 / Vitest 3。

## 执行环境

本机已装 SQLite 原生二进制对应 Node 24；每条验证命令使用：

```sh
export PATH="/Users/yourtionguo/.version-fox/cache/nodejs/v-24.4.0/nodejs-24.4.0/bin:$PATH"
```

工作目录：`.worktrees/phase7-serve-distribution`。HTTP/MCP 测试需允许监听本机随机端口。

## Task 1：搜索条件组合

- [x] 在 `packages/engine/src/__tests__/dynamic-sql.test.ts` 先加入跨多个 TEXT 列、同时存在字段过滤的回归用例；分别断言 rows 与 total。
- [x] `pnpm --filter @1api/engine exec vitest run src/__tests__/dynamic-sql.test.ts` 观察失败。
- [x] 在 `dynamic-sql.ts` 将 q 的 OR 子句括起来；保持参数化与白名单。
- [x] 运行 engine 测试；提交并完成两阶段审查（`2571d42`，engine 64 测试通过）。

## Task 2：建模元数据保留

- [x] 在 schema-service / metadata 测试中加入 boolean、datetime、label、enum、只读/隐藏的建表、加字段、刷新和重启回读案例。
- [x] 运行目标测试确认新断言失败（10 项失败）。
- [x] 在 `schema-service.ts` 合并建模输入与反射结果；在 `metadata.ts` 刷新时保留兼容逻辑类型。DDL 结构仍以反射为准。
- [x] 运行 engine 测试与构建；提交并完成两阶段审查（`7b8bd64`，engine 74 测试通过）。

## Task 3：engine 写入校验

- [x] 在 data-service 测试中加入非法整数/枚举/布尔值、非空字段 null、未知字段、缺失必填、默认值、补丁及系统字段案例。
- [x] 运行目标测试确认红灯；审查补充表达式默认值、括号 NULL、触发器忽略插入等真实 SQLite 回归。
- [x] 接入 shared 的 `fieldToZod`，统一验证并复制输入，布尔值转换为 SQLite 整数；保护只读与系统字段。转换错误归为 `VALIDATION_FAIL`；无法取得主键的插入在事务中回滚。
- [x] 通过 engine 测试和 HTTP/MCP/SDK/CLI 回归；提交并完成两阶段审查（`cbd093d` / `f78d9f2` / `ba3bc0b`，engine 137 测试，覆盖率 97.87% / 92.26%）。

## Task 4：CSV 导出完整性

- [x] 先加入 105 行完整导出、超过 10000 行严格行数及筛选条件保留的 HTTP 回归用例。
- [x] 运行新用例观察 100 行截断失败（5 失败 / 1 通过）。
- [x] 修复 `apps/server/src/routes/admin-data.ts` 的导出读取流程，保留普通 list 的 100 行限制、CSV 转义和真实截断提示；Web load/export 共用当前筛选条件。
- [x] 运行 server 相关测试；提交并完成两阶段审查（`7de6ac1`，server 100 / web 32 测试通过）。

## Task 5：服务端强制改密

- [x] 真实 HTTP 测试覆盖：待改密账号被拒绝 21 种管理读写且无副作用，允许 me/password/logout；改密后放行；重置密码后再次拦截；相同密码被拒。
- [x] 运行目标用例确认旧实现失败（6 HTTP / 1 shared 新断言失败）。
- [x] 修改 `hooks.ts`、`routes/auth.ts` 及 shared 错误工厂；调整已完成初始化的测试夹具，不绕过新鉴权回归测试。
- [x] 运行 server、SDK、CLI 与文档生成；提交并完成两阶段审查（`3d1dfa7`，shared 104 / server 106 / SDK 28 / CLI 76；API 文档 34/34，全量 build/typecheck/lint 通过）。

## Task 6：质量门与运行时契约

执行说明：先完成 Task 7 的生命周期/参数修复，再收紧本项质量门，避免为旧生命周期补即将失效的测试。CLI 基线覆盖率为 89.71% / 82.63%；测试退出监听器告警已定位到 erest `initTest()` 默认的 `genDocs().saveOnExit()`，应关闭测试夹具的退出文档生成而非调高监听器上限。

- [x] 运行所有 core 包覆盖率，记录缺失分支；用行为测试补齐，使行 90%、分支 85% 门槛全绿，server 纳入 hooks；修复逐例测试资源与退出监听器清理。
- [x] 四个运行时包 `engines` 调整为 `^22.13.0 || >=24`；统一覆盖率脚本与 CI（22.13.0 / 24），七包统一 `0.1.1` 及实际版本身份；新增离线发布预检和声明入口检查。
- [x] 执行 build → typecheck → test/coverage → lint，API 文档 34/34；提交并完成两阶段审查（`0067985`，六包最低行 95.74%、分支 86.25%；oxfmt 0.74.0 已精确固定）。

## Task 7：Phase 7 收尾

- [x] 补参数边界、web 探测、启动失败清理、关闭幂等的失败测试，再实施修复；每 app 独立 API/session，关闭后支持下一生命周期。质量审查补齐 Kysely 未初始化 driver 的原生连接关闭（`b34e4f1` / `00aeba5`，两阶段审查通过）。
- [x] 将 smoke 改为随机端口与严格默认 web 断言，测试进程退出码与二次信号等边界（engine 142 / server 126 / serve 41 通过）。
- [x] 检查七个 tarball 的版本、声明入口、内容和 bin 0755 权限；Node 22.13.0 / 24.4.0 仓库外干净安装及 HTTP/SDK/CSV/元数据冒烟通过；Node 24 省略 optional 依赖纯 API 模式通过。最终安装包浏览器验收通过。
- [x] 更新 README、安装文档、变更日志与 Phase 7 状态，保留本地发布方式（`4bf5a0e`，两阶段审查与 docs:build 通过）。
- [x] 最终质量门、独立审查和验收记录完成；集成方式为本地 main `--no-ff` 合并，不 push、不发布 npm。

发布范围确认（2026-10-24）：前置核验 `pnpm whoami` 返回 npm E401 后，用户明确选择「本次仅完成代码和打包验收」。不执行 npm publish；保留供后续使用的本地发布质量门。

## 浏览器验收补充：日期显示与时间选择

- [x] 真实浏览器复现：选择日期后数据库正确存 ISO，管理列表却显示「—」；新表单 datetime 控件只显示日期选择。
- [x] 为 ISO、时区偏移、epoch/null/无效值及 datetime 控件配置补失败测试（6 项红灯），保留系统毫秒时间戳行为。
- [x] 最小修改 Web 格式化和日期控件配置，Web 39 项测试与两阶段审查通过（`509f2b1`）；浏览器实际保存 false、枚举与日期时分秒，重启为安装包后回读及筛选导出通过。

## 最终验收（2026-10-24）

- `pnpm quality`：573 项 Vitest 测试 + 5 项发布契约测试、build、typecheck、coverage、lint 全通过；六 core 包最低行覆盖率 95.74%、分支覆盖率 86.25%。
- `pnpm release:preflight`：七包 0.1.1 的入口、版本身份与 MCP 内存 initialize 契约通过。`pnpm docs:build`：34/34 API 路由及文档站构建通过。
- 七包 tarball 已独立安装：Node 22.13.0 / 24.4.0 默认安装及 Node 24 省略 optional 安装，均执行强制改密、SDK 读写、105 行 CSV、元数据刷新；每次安装另启动显式 `--no-web` 验证 health 200 与 admin 404。
- 实际安装包浏览器验证：重启后原 session 失效，重新登录回读日期/布尔/枚举；关键词筛选两行至一行，下载 CSV 仅含匹配记录。
- 产物与 SHA-256、场景报告归档于 `.artifacts/phase7-0.1.1/`（忽略入 Git）。源码实现截至 `509f2b1`；验收记录随本地集成提交保存。
- 发布状态：**未执行 npm publish**，符合用户本次仅代码与打包验收的范围。
