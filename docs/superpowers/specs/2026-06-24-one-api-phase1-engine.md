# Phase 1：基础 + 数据引擎

> 所属：one-api ｜ 前置：无（地基）｜ 成果：纯逻辑数据引擎

## 目标

搭建 monorepo 骨架，实现 `packages/shared`（类型 + 类型映射）和 `packages/engine`（数据引擎）。

**本期不含任何 HTTP / UI / 传输层概念。** engine 只接收 DB 句柄，提供 `data.*` / `schema.*` 方法，是 Phase 2/3/4/5 的共同基础。

## 验收标准

- [ ] monorepo 可 `pnpm install`，`pnpm -r typecheck` / `pnpm -r test` / `pnpm -r build` 全绿
- [ ] `packages/shared` 导出 `FieldMeta` / `TableMeta` / `ApiResponse` / `TokenPermissions` 等类型与常量
- [ ] 类型映射三端一致性测试通过（SQLite ↔ JSON Schema ↔ Zod）
- [ ] `packages/engine` 的 `DataEngine` 对临时 SQLite 文件能完成：
  - 导入已有表（反射 → 存元数据）
  - 新建模型（建表 + 存元数据）
  - 刷新表结构（diff 保留用户标记）
  - 数据 CRUD（list 过滤/排序/分页、get、create、update、delete、incr、describe）
  - schema 演进（addField）
- [ ] 白名单校验：非法表名/列名被拒绝（防注入测试通过）
- [ ] Vitest 覆盖率达标（core 逻辑 > 90%）

## 工作项

### 1.1 Monorepo 骨架

- `package.json`（根）：workspace 配置 + 公共 scripts（dev/build/lint/format/typecheck/test/start）
- `pnpm-workspace.yaml`：`packages/*` + `apps/*`
- `tsconfig.base.json`：strict，target ES2022，module NodeNext
- `oxlint.config.json`：TS 规则，按目录覆盖 node/vue 规则
- `.gitignore` / `.npmrc`
- 各包 `package.json`：名称 `@1api/shared` / `@1api/engine`，type module，exports 配置

### 1.2 `packages/shared`

**`src/types.ts`**
- `FieldMeta`、`TableMeta`（结构见 overview §5）
- `TokenPermissions`：`{ tables: string[] | ['*']; actions: ('read'|'write'|'schema')[] }`
- `ApiResponse<T>` / `ApiError`（信封结构）
- `ListOptions`：`{ page?, size?, order?, q?, filters?: Record<string, [op, value]> }`（op ∈ eq/ne/gt/gte/lt/lte/like/in）
- `ListResult<T>`：`{ rows: T[]; total: number; page: number; size: number }`
- `CreateModelOptions`：`{ name; label; fields: FieldMetaInput[]; note?; autoTimestamps? }`

**`src/constants.ts`**
- `DEFAULT_PAGE = 1`、`DEFAULT_SIZE = 20`、`MAX_SIZE = 100`
- API 路径前缀：`/api/auth` / `/api/admin` / `/api/data` / `/mcp`
- 错误码常量（前缀分类）
- 角色枚举、动作枚举
- 表名/字段名校验正则 `^[a-z][a-z0-9_]*$`

**`src/schema/mapping.ts`** —— 类型映射核心
- `sqliteTypeToJsonType(sqliteType, enumValues?)`：SQLite 类型 + 枚举 → jsonType
- `jsonTypeToSqliteType(jsonType)`：jsonType → SQLite 类型（建表用）
- `fieldToJsonSchema(field: FieldMeta)`：FieldMeta → JSON Schema 片段（供 vue-json-ui-editor）
- `fieldsToJsonSchema(fields: FieldMeta[])`：字段数组 → 完整 JSON Schema object
- `fieldToZod(field: FieldMeta)`：FieldMeta → Zod schema（供 node-erest 校验）
- `buildCreateColumnSql(field: FieldMeta)`：FieldMeta → `CREATE TABLE` 的列定义片段

**`src/schema/parsers.ts`** —— 共享严格转换器（见 overview §5）
- `coerceBool` / `coerceInt` / `coerceNum`：`fieldToZod` 内部使用，替代 `z.coerce.boolean()`（禁止使用，`"false"` truthiness 问题）
- 单独导出供 server/web 直接复用

**`src/index.ts`**：统一导出

**测试** `src/**/*.test.ts`：
- 映射函数三端一致性（**每个 SQLite 类型含 NUMERIC、REAL** + 每个操作符）
- `coerceBool` 严格性（`"false"`→false、`"true"`→true、`"yes"`→报错、`"1"`→true、`1`→true）
- 校验正则（合法/非法表名）
- 边界：BLOB 不接受输入、datetime 转换、enum 处理

### 1.3 `packages/engine`

**`src/schema-reader.ts`** —— 反射推断
- `readTableSchema(businessDb: Database, tableName)`：执行 `PRAGMA table_info` + `PRAGMA table_xinfo` + 读 `sqlite_master` → 推断 `FieldMeta[]` + 主键 + 自增
- `listTables(businessDb)`：`SELECT name FROM sqlite_master WHERE type='table'`
- **主键策略**：只接受**单主键**。读 `PRAGMA table_info` 的 `pk` 列：
  - 无主键（所有字段 pk=0）→ 抛 `TABLE_NO_PRIMARY_KEY`
  - 复合主键（多个字段 pk>0）→ 抛 `TABLE_COMPOSITE_PRIMARY_KEY`
  - 单主键 → 正常返回
- 类型推断规则：`INTEGER`→integer（除非默认值是 0/1 且字段名暗示 boolean 如 `is_*`/`has_*` → boolean）、`REAL`/`NUMERIC`→number、`TEXT`→string（除非字段名是 `*_at`/`*_time`/`time`→datetime）
- **datetime 字段读取（业务库，多格式适配）**：业务表的时间字段存储格式不统一，data-service 返回 datetime 字段值时按以下优先级解析：ISO8601（含 `T`/`Z`）→ SQLite 原生 `'YYYY-MM-DD HH:MM:SS'`（按 UTC 拼接 `Z` 解析）→ 纯数字（按 Unix 秒/毫秒启发式，>1e12 视为毫秒，否则秒）→ 解析失败原样返回字符串。**不强加存储格式给业务表**。
- 注意：用 better-sqlite3 同步 API（不经 kysely）

**`src/schema-ddl.ts`** —— DDL 生成与执行
- `createTable(businessDb, opts: CreateModelOptions)`：生成 `CREATE TABLE` 语句（含主键、时间戳），执行
- `addColumn(businessDb, tableName, field)`：`ALTER TABLE ... ADD COLUMN`
- 列定义生成复用 `shared/schema/mapping.buildCreateColumnSql`
- 主键约定：默认 `id INTEGER PRIMARY KEY AUTOINCREMENT`（可自定义主键字段）
- 时间戳约定：`autoTimestamps` 为真 → 加 `created_at INTEGER` + `updated_at INTEGER`（isReadonly，存毫秒时间戳）。createModel 建表时由 engine 填入 `Date.now()`；update 操作时 engine 刷新 `updated_at`（SQLite 无 `ON UPDATE`，由 engine 层负责）

**`src/metadata.ts`** —— 元数据存储（系统库）
- 接收 `systemDb: Kysely<SystemDB>`
- `listMetas()` / `getMeta(id)` / `getMetaByName(name)`：查 table_meta
- `createMeta(input)` / `updateMeta(id, patch)` / `deleteMeta(id)`：写 table_meta
- `refreshMeta(id, currentFields)`：重新反射业务库 → diff → 保留用户标记（label/isHidden/isReadonly/enumValues）→ 更新 fields JSON
- 内存缓存：`Map<name, TableMeta>`，变更后失效

**`src/dynamic-sql.ts`** —— 动态查询（业务库，kysely）
- 接收 `businessDb: Kysely`
- 所有表名/列名先经 `assertTableExists(meta, name)` / `assertFieldExists(meta, name)` 白名单校验；动态拼标识符时一律用双引号包裹（`"TableName"`），支持导入的非 snake_case 表名/字段名
- `selectList(meta, opts)`：SELECT + WHERE（filters）+ ORDER + LIMIT/OFFSET + COUNT
- `selectOne(meta, pk)`：WHERE primaryKey = ?
- `insertRow(meta, data)`：INSERT 命名字段
- `updateRow(meta, pk, patch)`：UPDATE 命名字段 WHERE pk
- `deleteRow(meta, pk)`：DELETE WHERE pk
- `incrementField(meta, pk, field, n)`：UPDATE SET field = field + n
- 过滤操作符实现：eq/ne/gt/gte/lt/lte/like（LIKE）/in（拆分逗号）
- `q` 模糊搜索：所有 TEXT/非主键字段 OR LIKE `%q%`。**性能边界**：LIKE `%q%` 无法走索引，为全表扫描，仅适合中小数据量（SQLite 单机工具定位）；MVP 不做 FTS/索引优化，文档标注适用数据量上限

**`src/data-service.ts`** —— 高层数据操作（组合 metadata + dynamic-sql）
- 所有方法签名：`(table, ..., options?: { internal?: boolean })`
- `describe(table, opts)`：返回 TableMeta
- `list(table, opts)`：`internal` 为 false（默认）→ 校验 is_published；true → 跳过校验
- `get/create/update/delete`：`internal` 为 false → 写操作校验 is_editable（否则 `TABLE_NOT_EDITABLE`）；true → 跳过
- `incr(table, pk, field, n, opts)`：**校验 field 的 jsonType 必须为 integer/number**（否则抛 `VALIDATION_FAIL`，禁止对 TEXT 字段自增，避免 SQLite 类型亲和导致 `'5'+3` 拼接）；`internal` 同上
- 说明：`internal` 仅控制 is_published/is_editable 校验，**不**绕过白名单等注入防护

**`src/schema-service.ts`** —— 高层 schema 操作
- `importExisting(name)`：listTables 确认存在 → readTableSchema（**无主键/复合主键抛错透传**）→ createMeta（label 留空待填）。导入表名**不强制**正则，按 SQLite 实际表名保留
- `createModel(opts)`：opts.name **必须**匹配 `^[a-z][a-z0-9_]*$` 且非保留字 → createTable（DDL）→ readTableSchema（读回真实结构）→ createMeta
- `addField(table, field)`：field.name 同样强制正则 → addColumn（DDL）→ refreshMeta
- `refresh(table)`：refreshMeta

**`src/engine.ts`** —— DataEngine 装配
```ts
export class DataEngine {
  constructor(
    private businessDbRaw: Database,         // better-sqlite3 原生（反射/DDL 用）
    private businessDb: Kysely,              // kysely（查询用）
    private systemDb: Kysely<SystemDB>,      // 元数据
  ) {}
  data: DataService;     // 数据操作（含 internal 选项）
  schema: SchemaService; // schema 操作
}
```
- 构造时初始化 metadata 缓存（预热所有 table_meta）
- 工厂函数 `createEngine(opts: {businessDbPath, systemDbPath})`：创建连接 + 实例化

**测试** `src/**/*.test.ts`：
- 每个测试用 `tmpdir` 下随机 SQLite 文件，afterEach 清理
- schema-reader：各类 SQLite 类型推断（含 boolean/datetime/NUMERIC 启发式）
- schema-reader：**无主键表 → TABLE_NO_PRIMARY_KEY；复合主键表 → TABLE_COMPOSITE_PRIMARY_KEY**
- data-service：datetime 字段多格式读取（ISO8601 / SQLite 原生 / Unix 秒 / 毫秒 / 无法解析原样返回）
- dynamic-sql：CRUD + 每个过滤操作符 + 排序 + 分页 + incr + 白名单拒绝
- data-service incr：对 TEXT 字段自增 → `VALIDATION_FAIL`；对 integer 字段自增正常
- schema-service createModel：非法表名（大写/数字开头/保留字）→ 拒绝；importExisting 非正则表名 → 允许
- metadata：CRUD + refresh diff（用户标记保留）
- data-service：默认（is_published/is_editable 约束生效）+ `internal:true`（约束跳过）
- schema-service：导入/新建/addField/refresh 完整流程
- engine 工厂：从路径创建 + 缓存预热

## 依赖

```jsonc
// packages/shared
{ "devDependencies": { "typescript": "^5.8", "vitest": "^3", "zod": "^4" } }

// packages/engine
{ "dependencies": {
    "@1api/shared": "workspace:*",
    "kysely": "^0.29",
    "better-sqlite3": "^11",
    "bcrypt": "^5"
  },
  "devDependencies": { "@types/better-sqlite3": "*", "vitest": "^3" } }
```

## 不在本期范围

- HTTP server / node-erest / @leizm/web（Phase 2）
- 管理界面（Phase 3）
- MCP（Phase 4）
- SDK / CLI（Phase 5）
- 鉴权中间件（Phase 2，engine 不关心鉴权，只做数据操作）
