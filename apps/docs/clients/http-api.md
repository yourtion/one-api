# HTTP REST API

`/api/data/*` 是 one-api 的核心数据通道。所有数据读写都通过它，并被 Token 鉴权与权限模型保护。

## 鉴权

每个请求需在 `Authorization` 头携带 Bearer Token：

```
Authorization: Bearer oa_xxxxxxxxxxxxxxxx
```

Token 在管理界面「Token 管理」创建，权限由 `{ tables, actions }` 声明（见 [核心概念](../guide/concepts#token-与权限模型)）。被访问的表必须 `is_published`，写操作还要求 `is_editable`。

## 响应信封

所有响应统一信封格式：

```jsonc
// 成功
{ "success": true, "data": { /* 结果 */ } }

// 失败
{ "success": false, "error": { "code": "TABLE_NOT_FOUND", "message": "表 users 不存在" } }
```

`data` 的具体结构随接口而定（单条记录为对象，列表为 `{ items, total, page, size }`）。

## 常用接口示例

以下示例假设服务运行在 `http://localhost:3000`，Token 存于环境变量 `$TOKEN`。

### 列出所有表

```bash
curl http://localhost:3000/api/data/ \
  -H "Authorization: Bearer $TOKEN"
```

### 查询记录列表

```bash
# 分页 + 排序
curl "http://localhost:3000/api/data/posts?page=1&size=10&order=views:desc" \
  -H "Authorization: Bearer $TOKEN"
```

支持 `page`、`size`、`order`（`字段:asc|desc`）、`q`（模糊搜索）、`filters`（条件过滤）。

### 查询单条

```bash
curl http://localhost:3000/api/data/posts/1 \
  -H "Authorization: Bearer $TOKEN"
```

### 新建记录

```bash
curl -X POST http://localhost:3000/api/data/posts \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"hello","views":0}'
```

### 更新记录

```bash
curl -X PUT http://localhost:3000/api/data/posts/1 \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"updated"}'
```

### 删除记录

```bash
curl -X DELETE http://localhost:3000/api/data/posts/1 \
  -H "Authorization: Bearer $TOKEN"
```

### Schema 演进（需 `schema` action）

```bash
# 新建表
curl -X POST http://localhost:3000/api/data/_schema/tables \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"comments","fields":[{"name":"body","jsonType":"string"}]}'

# 新增字段
curl -X POST http://localhost:3000/api/data/_schema/tables/comments/fields \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"author","jsonType":"string"}'
```

## 错误码

常见错误码（完整列表见 API 参考，即将上线）：

| code | HTTP | 含义 |
| --- | --- | --- |
| `UNAUTHORIZED` | 401 | 未提供 Token 或 Token 无效 |
| `FORBIDDEN` | 403 | Token 无权限访问该表 / 操作 |
| `TABLE_NOT_FOUND` | 404 | 表不存在或未发布 |
| `RECORD_NOT_FOUND` | 404 | 记录不存在 |
| `VALIDATION_ERROR` | 400 | 入参校验失败 |
| `INTERNAL_ERROR` | 500 | 服务端异常 |

## 下一步

- 完整接口签名见 API 参考（自动生成，即将上线）。
- 不想手写 HTTP？用 [SDK](./sdk) 封装好的客户端。
- 让 AI 直接调用？看 [MCP 服务](./mcp)。
