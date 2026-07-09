# 快速上手

5 分钟，把 one-api 跑起来并用四种方式访问同一个业务库。

## 1. 启动服务

```bash
npx @1api/serve
```

无需 clone 仓库。`npx @1api/serve` 一个进程同时提供 `/api/*` 数据接口、`/admin` 管理界面和 `/mcp` 服务。默认监听 `http://localhost:3000`。

::: tip 全局安装后可省略 npx
`npm install -g @1api/serve` 之后直接用 `1api` 命令。启动选项见 [安装与部署](./install)。
:::

## 2. 打开管理界面

浏览器访问 `http://localhost:3000/admin`，用默认管理员登录：

- 账号：`admin`
- 密码：`123456`

首次登录会**强制改密**，请设置一个新密码。

## 3. 创建第一个模型

在管理界面进入「表管理」，可以：

- **导入已有表**——如果你本地已有 SQLite 表，一键导入并生成元数据；
- **新建模型**——直接定义字段（如 `name: string`、`age: integer`），引擎会自动建表。

比如建一张 `posts` 表，字段 `title (string)`、`views (integer)`。

## 4. 生成 Token

进入「Token 管理」，创建一个 Token，权限设为：

```json
{ "tables": ["*"], "actions": ["read", "write", "schema"] }
```

保存后得到形如 `oa_xxxxxxxxxxxxxxxx` 的 Token，后续所有前端消费都用它。

## 5. 用四种方式访问

同一个 `posts` 表，现在可以这样访问：

::: code-group

```bash [curl]
curl http://localhost:3000/api/data/posts \
  -H "Authorization: Bearer oa_xxx"
```

```ts [SDK]
import { createClient } from '@1api/sdk';
const client = createClient('http://localhost:3000/api/data', 'oa_xxx');
const list = await client.list('posts');
```

```bash [CLI]
one-api-cli connect --host http://localhost:3000 --token oa_xxx
one-api-cli list posts
```

```jsonc [MCP（AI agent 配置）]
// 在 Claude Desktop / Cursor 里把 MCP server 指向：
//   http://localhost:3000/mcp   （headers: Authorization: Bearer oa_xxx）
// 之后 AI 即可调用 describe / list / get / create 等工具
```

:::

四种方式的详细说明见 [前端消费](../clients/http-api)。

## 下一步

- 理解 [核心概念](./concepts)：系统库 / 业务库 / 元数据 / 权限模型。
- 了解 [安装与部署](./install)：环境变量与生产部署。
- 选择你的消费方式：[HTTP API](../clients/http-api)、[管理界面](../clients/admin-ui)、[MCP](../clients/mcp)、[CLI](../clients/cli)、[SDK](../clients/sdk)。
