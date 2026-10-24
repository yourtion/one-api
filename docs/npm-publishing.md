# npm 自动发布

七个公开包统一版本，目前工作区版本为 `0.1.1`。发布集合与 `release:preflight` 共用 `scripts/release-preflight.mjs` 的 `publishedDirectories`；私有根包和 `@1api/docs` 不发布。此改动只准备、验证 CI 流程，不代表 npm 后台已绑定，也没有执行真实发布或推送发布 tag。`0.1.1` 仍未发布。

## 每个包的一次性设置

维护者登录 npm，在以下七个包的设置页分别添加 GitHub Actions Trusted Publisher：

| 包             | npm 设置                                                      |
| -------------- | ------------------------------------------------------------- |
| `@1api/shared` | [settings](https://www.npmjs.com/package/@1api/shared/access) |
| `@1api/engine` | [settings](https://www.npmjs.com/package/@1api/engine/access) |
| `@1api/sdk`    | [settings](https://www.npmjs.com/package/@1api/sdk/access)    |
| `@1api/cli`    | [settings](https://www.npmjs.com/package/@1api/cli/access)    |
| `@1api/server` | [settings](https://www.npmjs.com/package/@1api/server/access) |
| `@1api/web`    | [settings](https://www.npmjs.com/package/@1api/web/access)    |
| `@1api/serve`  | [settings](https://www.npmjs.com/package/@1api/serve/access)  |

所有包使用相同的绑定值：

| 字段                 | 值                                                    |
| -------------------- | ----------------------------------------------------- |
| Organization or user | `yourtion`                                            |
| Repository           | `one-api`                                             |
| Workflow filename    | `release.yml`（文件名，不是 workflow 名称或完整路径） |
| Environment          | 留空；workflow 没有设置 GitHub environment            |
| Allowed actions      | 必须允许直接 `npm publish`                            |

新建 publisher 可能默认只允许 `npm stage publish`。本流程使用直接 `npm publish`，必须显式允许该动作；否则需另行实现暂存后人工审批流程。包级 “Require two-factor authentication and disallow tokens” 限制传统 token，不禁止已获准的 OIDC publisher 直接发布。更改 workflow 文件名或新增 environment 时，须同步更新七个包的绑定。

不配置 `NPM_TOKEN`，也不通过长期 token 兜底。按 [npm 官方 Trusted Publishers 文档](https://docs.npmjs.com/trusted-publishers/)，需要 npm CLI `>=11.5.1`、Node `>=22.14`，且 GitHub Actions 使用 GitHub 托管 runner。workflow 选 Ubuntu 和当前 Node 24，并运行时输出、核对 npm 版本；早期 Node 24.4.0 自带 npm 11.4.2，不能据“Node 24”就判定满足要求。setup-node 不设置 `registry-url`，避免生成 token 认证占位配置。

代码、离线 mock、真实 pack 和仓库外安装可以验证发布逻辑与产物，无法证明 npm 后台绑定或实际 OIDC 认证已生效。七项后台设置仍须维护者逐项核验。公开仓库的 npm OIDC 发布通常自动生成 npm provenance；这与 GitHub Release 附件 attestation 是两套机制，本流程没有额外生成附件 attestation。

## 版本与触发

1. 在同一次变更中手动更新七个包版本、构建共享版本来源及各包变更日志，保持 HTTP、CLI、MCP 身份与版本一致；流程不会自动 bump。先执行 `pnpm quality && pnpm release:preflight`，通过 review 后合入 `main`。
2. 维护者确认本次允许真实发版后，为 `main` 中该提交创建 `v<版本>` tag 并推送。例如 `v0.1.2`、`v0.2.0-rc.1`。annotated 和 lightweight tag 均可。不要为尚未授权发布的 `0.1.1` 推送 tag。
3. 在 [Release workflow](https://github.com/yourtion/one-api/actions/workflows/release.yml) 检查执行结果及 npm/GitHub Release。

tag 必须是严格 SemVer，且与七个 manifest 完全一致。不接受缺少 `v`、前导零、数值预发布标识符前导零或 `+build`（npm 无法原样保留 build metadata）。稳定版本使用 `latest`；所有预发布版本使用 `next`，GitHub Release 同时标记 prerelease。tag 在安装依赖前必须解析到检出的提交，且该提交属于 `origin/main` 历史。

所有版本共用串行发布组，`cancel-in-progress: false`。GitHub 默认并发队列只保留一个 pending，且不保证先后顺序；必须等待当前 tag 的 run 完成后再推下一个版本 tag，不能一次积压多个版本。详见 [GitHub 并发控制](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency)。

## 校验与发布产物

workflow 先运行完整 `pnpm quality` 和 `pnpm release:preflight`，再由 pnpm 9 workspace-aware pack 转换 `workspace:` 依赖；npm CLI 只负责精确版本查询与发布 tarball。依赖与 optionalDependencies 共同决定拓扑顺序，依赖包先发；循环、遗漏内部包或不支持/不兼容的范围立即失败。

当前支持 `workspace:*` → 精确目标版本（包括预发布）、`workspace:^`/`workspace:~` → 相应前缀加目标版本，以及明确锚定本次版本的 `version`/`^version`/`~version`（可带 `workspace:`）。其他范围主动拒绝，需要添加支持与测试，不能猜测预发布兼容性。

helper 从真实 `.tgz` 读取清单和内容，校验包名、版本、公开性、仓库、所有具体 exports/main/types/bin、web index、LICENSE、CHANGELOG、bin shebang 和执行权限。不会将 tar 内容解压到文件系统；拒绝危险路径、链接和不支持的 archive 类型。发布 lifecycle 当前不存在；未来新增 prepare/prepack/prepublish 等会被拒绝，须显式适配，不能静默跳过必要构建。

每次打包保存七个 tarball、`release-manifest.json` 与 `SHA256SUMS`。manifest 记录发布顺序和 SHA256，发布前重新检查全部内容，并在每次 `npm publish <同一文件> --ignore-scripts` 前复核 hash。稳定/预发布渠道显式传给 npm，不允许 lifecycle 重建被检查过的文件。

本地可检查产物而不发布：

```bash
pnpm quality
pnpm release:preflight
node scripts/npm-release.mjs pack v0.1.1 /tmp/one-api-pack
```

`pnpm release` 现在只执行完整质量门、预检并打印 workflow 指引，不会直接递归发布。`pack` 无需创建 tag；workflow 的 `check` 与实际 `publish` 入口会严格校验 Git tag 和 main 归属。

## 失败与重跑

在 GitHub Actions 对同一个 tag 的原 workflow run 选择 **Re-run failed jobs**（或 **Re-run all jobs**）。每包查询精确 `name@version`，仅结构化 npm `E404` 才视为未发布；认证、网络、限流、无效 JSON 等错误均停止。已经存在的精确版本跳过，因此 A 发布成功、B 失败时，重跑从 B 继续。跳过已有版本不会重新调整 npm dist-tag。

全部 npm 包成功后才操作 GitHub Release。先分页查询；缺少 Release 时创建 draft，补传七个 tarball 与两份清单，最后公开并校正 prerelease 标记。已有 Release 也会补缺失附件；不会静默覆盖同名资产。已有资产必须具有 GitHub 提供的 SHA256 digest，且 size/digest 与本次文件一致，否则停止。旧资产缺少 digest 时同样停止，须维护者核对已有附件并显式解决冲突，或使用新版本，不能完成混合字节的校验集。

若 npm 已全部成功而 GitHub API/附件失败，重跑会跳过 npm，继续完成 GitHub；若 npm 任一包失败，不会完成 GitHub Release。已发布的 npm 版本不可覆写，没有跨包自动回滚。涉及代码修改时使用新版本和新 tag；不要移动旧 tag 或尝试覆盖已发布版本。
