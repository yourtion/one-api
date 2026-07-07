# one-api-cli

> one-api 终端工具。远程模式走 SDK 对接 server，本地直连模式直接操作 SQLite（不经 HTTP）。

## 安装

```bash
npm install -g one-api-cli
```

## 快速开始

### 远程模式（对接运行中的 server）

```bash
# 连接 server（host/token 保存到 ~/.one-api-cli/config.json）
one-api-cli connect --host http://localhost:3000 --token oa_your_token

# 操作
one-api-cli tables
one-api-cli list users --limit 10
one-api-cli get users 1
one-api-cli create users '{"name":"alice","age":30}'
one-api-cli update users 1 '{"age":31}'
one-api-cli delete users 1
```

### 本地直连模式（不经 HTTP）

```bash
one-api-cli --db ~/.one-api/business.db list users
```

## 输出格式

`--format` 支持 `table`（默认）/ `json` / `csv`：

```bash
one-api-cli list users --format json
one-api-cli list users --format csv > users.csv
```

## 命令一览

| 命令 | 说明 |
|---|---|
| `connect` | 连接 server（保存配置） |
| `tables` / `tables-create` / `add-field` | 表管理 |
| `describe` | 查看表结构 |
| `list` / `get` / `create` / `update` / `delete` | 数据 CRUD |
| `export` / `import` | 数据导入导出 |
| `config` | 查看配置 |

运行 `one-api-cli --help` 查看完整命令。

## License

MIT
