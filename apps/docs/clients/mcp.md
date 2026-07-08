# MCP 服务

`/mcp` 端点让 AI agent 通过 **MCP（Model Context Protocol）** 直接读写 one-api 的业务数据，甚至自主建表。无需为每个 AI 应用单独写集成层——连上 MCP，AI 就拥有了结构化的数据操作能力。

## 端点与传输

- **端点**：`http://<host>:3000/mcp`
- **传输方式**：Streamable HTTP
- **鉴权**：与 HTTP API 一致，使用 Bearer Token（`Authorization: Bearer oa_xxx`）

Token 的 `tables` / `actions` 权限同样生效：AI 只能做 Token 允许的事。

## 接入 AI Agent

### Claude Desktop

在 Claude Desktop 配置文件（`claude_desktop_config.json`）中添加：

```json
{
  "mcpServers": {
    "one-api": {
      "url": "http://localhost:3000/mcp",
      "headers": {
        "Authorization": "Bearer oa_xxx"
      }
    }
  }
}
```

### Cursor

在 Cursor 的 MCP 设置里新增一个 Streamable HTTP server，URL 填 `http://localhost:3000/mcp`，并加上 `Authorization: Bearer oa_xxx` 请求头。

配置完成后，AI 即可在对话中调用下方的 tools 操作你的业务库。

## Tools 清单

共 **9 个 tools**：

**数据操作（7 个）**

| Tool | 作用 |
| --- | --- |
| `describe` | 查看表结构（字段、类型） |
| `list` | 查询记录列表（支持分页 / 排序 / 搜索 / 过滤） |
| `get` | 查询单条记录 |
| `create` | 新建记录 |
| `update` | 更新记录 |
| `delete` | 删除记录 |
| `incr` | 字段自增（如浏览量 +1） |

**Schema 演进（2 个）**

| Tool | 作用 | 权限要求 |
| --- | --- | --- |
| `createTable` | 新建表 | Token 需含 `schema` action |
| `addField` | 向表新增字段 | Token 需含 `schema` action |

::: warning Schema 操作需显式授权
`createTable` / `addField` 改动库结构，要求 Token 的 `actions` 显式包含 `schema`。给 AI 配 Token 时，如不需要它建表，**不要**加 `schema`，避免 AI 自主改库结构。
:::

## 使用示例

接入后，你可以这样对 AI 说：

- 「列出 posts 表里浏览量最高的 5 篇」→ AI 调用 `list`
- 「给 posts 表加一个 `author` 字符串字段」→ AI 调用 `addField`（需 schema 权限）
- 「把 id 为 3 的文章浏览量 +1」→ AI 调用 `incr`

AI 会自动选择合适的 tool 并处理返回结果。

## 安全建议

- 给 AI 的 Token **最小授权**：只授必要的表，默认只给 `read`；
- 需要让 AI 写数据时再开 `write`；需要它改结构时再开 `schema`；
- 敏感表保持 `is_published = false`，AI 完全不可见。

## 下一步

- [Token 与权限模型](../guide/concepts#token-与权限模型)：理解 `tables` / `actions`。
- 偏好代码方式？看 [SDK](./sdk) 或 [CLI](./cli)。
