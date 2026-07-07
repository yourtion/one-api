# CLI

`one-api-cli` 是 one-api 的终端工具（npm 包 `@1api/cli`）。它既能**远程**操作运行中的服务，也能**本地直连** SQLite 文件，适合脚本化、数据导入导出与无 UI 场景。

## 安装

```bash
npm i -g @1api/cli
```

验证安装：

```bash
one-api-cli --version
```

## 两种工作模式

### 远程模式

通过 `connect` 保存连接配置（指向运行中的服务），之后所有命令走 HTTP：

```bash
one-api-cli connect --host http://localhost:3000 --token oa_xxx
```

保存后即可使用全部命令，无需每次重复传参。

### 本地直连模式

不连服务，直接读写本地 SQLite 文件（适合离线 / 运维）：

```bash
one-api-cli --db ~/.one-api/business.db list posts
```

::: tip
本地直连走 `@1api/engine` 直接操作业务库，**绕过** Token 与 `is_published` 校验——因为它本身就是「管理员级」的本地访问。
:::

## 命令一览

### 配置

| 命令 | 作用 |
| --- | --- |
| `connect` | 保存连接配置（远程 `--host`+`--token` 或本地 `--db`） |
| `config` | 查看当前连接配置 |

### 表结构

| 命令 | 作用 |
| --- | --- |
| `tables` | 列出所有表 |
| `tables-create <name>` | 新建表（`--fields a:string,b:integer`） |
| `add-field <table> <field> <type>` | 新增字段（type 为 jsonType：`string\|integer\|number\|boolean\|datetime`） |
| `describe <table>` | 查看表结构 |

### 数据操作

| 命令 | 作用 |
| --- | --- |
| `list <table>` | 查询记录列表 |
| `get <table> <pk>` | 查询单条记录 |
| `create <table>` | 创建记录（`--data` JSON 或 `--data-file` 路径，或 `@file` 简写） |
| `update <table> <pk>` | 更新记录 |
| `delete <table> <pk>` | 删除记录（交互确认，`--yes` 跳过） |

### 导入导出

| 命令 | 作用 |
| --- | --- |
| `export <table>` | 导出全部数据（分页拉取） |
| `import <table> <file>` | 从 CSV / JSON 文件导入（逐行 create） |

## 示例

```bash
# 远程：连接服务
one-api-cli connect --host http://localhost:3000 --token oa_xxx

# 查看所有表
one-api-cli tables

# 建一张 posts 表
one-api-cli tables-create posts --fields title:string,views:integer

# 新建记录
one-api-cli create posts --data '{"title":"hello","views":0}'

# 列出记录（JSON 格式）
one-api-cli list posts --format json

# 导出为 CSV
one-api-cli export posts --format csv > posts.csv

# 从 CSV 导入
one-api-cli import posts posts.csv
```

## 输出格式

所有输出类命令支持 `--format`：

- `table`（默认）—— 对齐的表格，适合人读；
- `json` —— 机器可读，适合管道处理；
- `csv` —— 适合导出 / 电子表格。

## 配置持久化

连接配置保存在 `~/.one-api-cli/config.json`：

```
~/.one-api-cli/
└── config.json   # host / token / 或本地 db 路径
```

`connect` 会创建该目录与文件（若不存在），后续命令自动读取。需要切换环境时重新 `connect` 即可覆盖。

## 下一步

- [HTTP REST API](./http-api)：CLI 远程模式底层即调用它。
- [SDK](./sdk)：在代码里完成同样的操作。
