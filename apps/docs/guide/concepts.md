# 核心概念

理解 one-api 的五个关键概念，就能掌握它的全部设计。

## 系统库与业务库

one-api 用**两个 SQLite 文件**各司其职：

| 库 | 默认路径 | 存什么 |
| --- | --- | --- |
| 系统库 `system.db` | `~/.one-api/system.db` | 管理员账号、Token、表元数据（`table_meta`） |
| 业务库 `business.db` | `~/.one-api/business.db` | 用户的真实业务数据（你建的表都在这里） |

这种分离意味着：**系统配置不会污染业务数据**，业务库可以单独备份、迁移，甚至将来替换成 MySQL 而不影响系统库结构。

> 路径可通过环境变量覆盖，见 [安装与部署](./install)。

## 元数据驱动

one-api 是**元数据驱动**的：每张业务表的结构都记录在系统库的 `table_meta` 里，存储的是 `FieldMeta[]`（字段名、类型、是否可空、默认值等）。

引擎（`@1api/engine`）拿到 `FieldMeta[]` 后，就能：

- 动态生成 `INSERT / UPDATE / SELECT / DELETE` 语句；
- 对入参做类型校验；
- 让管理界面据此自动渲染表单 / 列表。

也就是说，**你定义一次模型，CRUD、校验、界面全部自动就位**——这就是「四扇门」共用一个底座的关键。

## 类型映射

one-api 在三套类型系统间建立了映射：

```
SQLite 类型  ⇄  JSONSchema  ⇄  Zod
```

- **SQLite** 是实际存储格式（`TEXT` / `INTEGER` / `REAL`）；
- **JSONSchema** 是对外契约（HTTP API 返回的 schema、MCP 的 describe）；
- **Zod** 是运行时校验（入参验证）。

这套映射由 `@1api/shared` 统一维护，前后端共享同一套类型定义，避免「接口类型对不上」的问题。

## Token 与权限模型

所有对外访问（`/api/data/*`、`/mcp`、远程 CLI、SDK）都通过 **Bearer Token** 鉴权。每个 Token 携带权限声明：

```json
{
  "tables": ["posts", "users"],
  "actions": ["read", "write", "schema"]
}
```

- `tables`：允许访问的表，`["*"]` 表示全部；
- `actions`：允许的操作，`read` / `write` / `schema`（`schema` 用于建表、加字段等结构演进）。

权限在请求处理时被严格校验：表不在 `tables` 里、或操作不在 `actions` 里，一律拒绝。

## is_published 与 is_editable

针对**对外通道**（`/api/data/*`、`/mcp`），每张表有两个开关：

- **`is_published`**：表是否对 Token 开放。未发布的表，对外通道直接拒绝访问。
- **`is_editable`**：表是否允许通过对外通道写入。设为 `false` 时只能读不能写。

而**管理通道**（`/admin` 管理界面、`internal: true` 的调用）会跳过这两个校验——管理员始终可以维护未发布或只读的表。这样你可以安全地把业务库暴露给 AI / 第三方，同时保留管理员的完全控制权。

## 时间戳约定

- **系统库**（管理员、Token、元数据）：统一使用**毫秒级 Unix 时间戳**（`number`）。
- **业务库**：**不强加**时间戳字段。是否需要 `created_at` / `updated_at` 完全由你的模型定义决定，引擎不会自动注入。

## 下一步

- [安装与部署](./install)：如何配置数据库路径、端口、管理员。
- [HTTP REST API](../clients/http-api)：Token 与权限在 HTTP 层如何体现。
