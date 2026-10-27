# npm Trusted Publishing 实施计划

基线：本地 main `4feddf7`；此前完整质量门通过。隔离目录 `.worktrees/npm-trusted-publish`，分支 `ci/npm-trusted-publish`。使用 npm-trusted-publish、using-git-worktrees 与 subagent-driven-development；不真实发版。

## Task 1：适配七包自动发包

- [x] 先为 tag/manifest、依赖顺序、真实 tarball 校验、精确 E404、发布失败和部分成功重跑、GitHub 失败与附件补传补离线失败测试。
- [x] 适配技能 helper 到 `scripts/npm-release.mjs` 和测试；复用发布预检目录定义并支持严格预发布版本。按依赖图排序、pnpm pack 转 workspace、校验真实归档及哈希，npm 发布同一文件。
- [x] 增加 release.yml：安装前验证 tag/commit/main、Node/npm 工具链、完整质量门、打包/发布/Release，普通 CI 接入新增 helper 测试。七包 repository 元数据完整，必要时将旧本地发布命令改为安全的预检或明确 CI 引导，避免继续使用不具备 OIDC 的 pnpm publish。
- [x] 增加维护者文档 `docs/npm-publishing.md` 并链接 README，列出一次性 npm 绑定、稳定/预发布和重跑操作、边界和未执行真实发布状态。
- [x] TDD 通过后提交；独立 spec review 通过，再独立代码质量 review，修复后复审。

## 最终验收与集成

- [x] actionlint 实际 workflow；`pnpm quality`、`pnpm release:preflight`、文档构建。
- [x] 新 helper 打包七个真实 tarball；仓库外消费者安装并运行 CLI/HTTP，保留校验清单和 smoke 证据。全部发布 API 测试用 mock，不执行发布。
- [x] 完整审查通过后本地 --no-ff 合入 main，再验证合并结果；不 push、不创建 tag、不发布 npm。保留最终代码与验收记录及未完成的外部 npm 绑定说明。


## 验收记录（2026-10-24）

- 实现提交 `d2eb21c`；先完成规范审查，再完成代码质量审查，两者均无待修复问题。范围为全部自动发包改动。
- `pnpm quality`：573 项 Vitest 业务测试、21 项 Node 发布测试全部通过；build、typecheck、六个 core 覆盖率、lint 全绿。覆盖率最低行 95.74%、分支 86.25%，未放宽阈值。
- `pnpm release:preflight`：七包 `0.1.1` 及 HTTP/CLI/MCP 实际版本身份通过；`pnpm docs:build`：34/34 API 示例、VitePress 构建通过。
- actionlint v1.7.12 校验实际 release.yml 与 ci.yml 通过；独立审查也重跑了 21 项发布测试。
- 最终 helper 真实打包七个 `.tgz`、release-manifest.json 与 SHA256SUMS；与仓库外已验收的七个安装包逐字节一致。消费者使用 Node 24.4.0、pnpm 9.12.0 安装本地 tarball，CLI/HTTP/SDK/鉴权/105 行 CSV/元数据刷新、默认后台与 --no-web 均通过。
- 产物与日志归档于仓库根 `.artifacts/npm-trusted-publish-0.1.1/`（忽略目录）；合并后的提交身份及验证结果记录在 verification.json。集成采用本地 main --no-ff，合并后运行发布测试、预检与 actionlint。
- npm API/GitHub 故障和重跑均为离线 mock，不代表实际 OIDC 身份认证成功。未发布、未创建 tag、未推送；七包 npm 后台 Trusted Publisher 绑定尚未核验，准确设置见 docs/npm-publishing.md。
