# one-api Phase 1（基础 + 数据引擎）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 搭建 pnpm monorepo 骨架，实现 `@1api/shared`（类型 + 类型映射核心）和 `@1api/engine`（纯逻辑数据引擎），对临时 SQLite 文件完成反射/建表/演进/CRUD，Vitest 全覆盖。

**Architecture:** `engine` 不含任何 HTTP/UI/传输层概念，只接收 DB 句柄，对外暴露 `data.*`（含 `internal` 选项控制 `is_published`/`is_editable` 校验）和 `schema.*`。所有表名/列名先经 `FieldMeta` 白名单校验，动态标识符用双引号包裹（kysely `sql` 模板 + `sql.id()`）。系统库（元数据）与业务库（用户数据）物理分离。

**Tech Stack:** TypeScript 5.8（strict，ES2022，NodeNext）、pnpm workspace、Vitest 3、zod 4、kysely 0.29（官方 SqliteDialect，底层 better-sqlite3）、better-sqlite3 11、oxlint。

---

## 关键决策与 spec 偏差说明（执行前必读）

以下 3 处相对 spec/overview 做了有据可依的工程决策，**执行时按本计划为准**：

1. **`AppError` / `Errors` 工厂放在 `@1api/shared`，而非 `apps/server`。**
   - overview §5 写在 `apps/server/src/utils/errors.ts`，但 Phase 1 的 engine 必须能独立抛出 `TABLE_NOT_EDITABLE` / `VALIDATION_FAIL` / `TABLE_NO_PRIMARY_KEY` 等类型化错误（验收标准要求 engine 对临时 SQLite 完成全流程、不依赖 server）。错误码本就归 `shared/constants.ts`。把 `AppError` 类与工厂也放进 `shared`，engine 与 server 共用，避免循环依赖与重复定义。Phase 2 server 可直接 re-export。

2. **`SystemDB` 接口只覆盖 `table_meta`（Phase 1 唯一接入 engine 的系统表）。**
   - `admin` / `api_token` 属鉴权层，Phase 2 才接入。engine 不关心它们。按 YAGNI，engine 包内 `SystemDB` 仅含 `table_meta`，Phase 2 再扩展。系统库建表迁移也只 `CREATE TABLE IF NOT EXISTS table_meta`。

3. **依赖更正：`zod` 是 `@1api/shared` 的运行时依赖（非 devDependency）。**
   - spec 依赖块把 `zod` 列为 shared 的 devDep，但 `fieldToZod` / `coerceBool` 等在运行时返回 zod schema，web/server 导入 shared 时必须能解析 zod。故列为 `dependencies`。`bcrypt` 暂不加入 engine（Phase 1 无鉴权逻辑），spec 误列，按 YAGNI 推迟到 Phase 2。

---

## 文件结构总览

```
one-api/
├── package.json                      # workspace 根 + 公共脚本
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── oxlint.config.json
├── .gitignore
├── .npmrc
├── vitest.config.ts                  # 根 vitest（仅用于 -r 聚合，各包自带配置）
│
├── packages/
│   ├── shared/
│   │   ├── package.json              # @1api/shared
│   │   ├── tsconfig.json
│   │   ├── vitest.config.ts
│   │   └── src/
│   │       ├── types.ts              # FieldMeta/TableMeta/TokenPermissions/ApiResponse/...
│   │       ├── constants.ts          # 正则、保留字、角色/动作枚举、错误码、路径前缀、分页常量
│   │       ├── errors.ts             # AppError 类 + Errors 工厂（偏差1）
│   │       ├── schema/
│   │       │   ├── parsers.ts        # coerceBool / coerceInt / coerceNum
│   │       │   └── mapping.ts        # sqliteTypeToJsonType / jsonTypeToSqliteType / *JsonSchema / fieldToZod / buildCreateColumnSql
│   │       ├── index.ts              # barrel 导出
│   │       └── __tests__/*.test.ts
│   │
│   └── engine/
│       ├── package.json              # @1api/engine
│       ├── tsconfig.json
│       ├── vitest.config.ts
│       └── src/
│           ├── system-db.ts          # SystemDB 接口 + TableMetaRow（偏差2）
│           ├── schema-reader.ts      # 反射：readTableSchema / listTables + 主键策略 + 类型推断
│           ├── schema-ddl.ts         # createTable / addColumn
│           ├── metadata.ts           # table_meta CRUD + 内存缓存 + refreshMeta diff
│           ├── dynamic-sql.ts        # 白名单校验 + CRUD + 过滤/排序/分页 + incr + datetime 归一
│           ├── data-service.ts       # 高层数据操作（组合 metadata + dynamic-sql，internal 选项）
│           ├── schema-service.ts     # importExisting / createModel / addField / refresh
│           ├── engine.ts             # DataEngine 装配 + createEngine 工厂
│           └── __tests__/*.test.ts
```

**职责边界**：每个文件单一职责；`dynamic-sql`（业务库查询）与 `metadata`（系统库元数据）严格分离；`data-service`/`schema-service` 是组合层，不直接碰 SQL/DDL。

---

## Task 0：Monorepo 骨架

**Files:**
- Create: `package.json`（根）
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `oxlint.config.json`
- Create: `.gitignore`
- Create: `.npmrc`

- [ ] **Step 0.1：根 `package.json`**

```jsonc
{
  "name": "one-api",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "packageManager": "pnpm@9.12.0",
  "scripts": {
    "dev": "pnpm -r --parallel dev",
    "build": "pnpm -r build",
    "lint": "oxlint .",
    "format": "oxfmt --write .",
    "typecheck": "pnpm -r typecheck",
    "test": "pnpm -r test",
    "start": "node apps/server/dist/index.js"
  },
  "devDependencies": {
    "oxlint": "^0.9.0",
    "typescript": "^5.8.0"
  }
}
```

- [ ] **Step 0.2：`pnpm-workspace.yaml`**

```yaml
packages:
  - "packages/*"
  - "apps/*"
```

- [ ] **Step 0.3：`tsconfig.base.json`**

```jsonc
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true
  }
}
```

- [ ] **Step 0.4：`oxlint.config.json`**

```jsonc
{
  "$schema": "https://raw.githubusercontent.com/oxc-project/oxc/main/npm/oxlint/configuration_schema.json",
  "categories": { "correctness": "error", "suspicious": "warn", "perf": "warn" },
  "rules": { "no-console": "off" },
  "overrides": [
    { "files": ["apps/server/**"], "env": ["node"] },
    { "files": ["apps/web/**"], "env": ["browser"] },
    { "files": ["**/*.test.ts"], "rules": { "no-explicit-any": "off" } }
  ]
}
```

- [ ] **Step 0.5：`.gitignore`**

```gitignore
node_modules/
dist/
*.tsbuildinfo
coverage/
.DS_Store
*.log
.env
.env.local
```

- [ ] **Step 0.6：`.npmrc`**

```ini
# pnpm workspace 严格隔离
shamefully-hoist=false
strict-peer-dependencies=false
auto-install-peers=true
```

- [ ] **Step 0.7：验证骨架可装**

Run: `pnpm install`
Expected: 安装成功，无 workspace 报错（此时还没有子包，pnpm 会提示无包匹配但不应失败）。

- [ ] **Step 0.8：Commit**

```bash
git add -A
git commit -m "chore: monorepo 骨架（pnpm workspace + tsconfig + oxlint）"
```

---

## Task 1：`@1api/shared` 包骨架

**Files:**
- Create: `packages/shared/package.json`
- Create: `packages/shared/tsconfig.json`
- Create: `packages/shared/vitest.config.ts`
- Create: `packages/shared/src/index.ts`（暂空桶，后续任务填充）

- [ ] **Step 1.1：`packages/shared/package.json`**

注意偏差 3：`zod` 为运行时依赖（`dependencies`）。

```jsonc
{
  "name": "@1api/shared",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "zod": "^4.0.0"
  },
  "devDependencies": {
    "typescript": "^5.8.0",
    "vitest": "^3.0.0"
  }
}
```

- [ ] **Step 1.2：`packages/shared/tsconfig.json`**

```jsonc
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "./src",
    "outDir": "./dist",
    "composite": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["src/**/*.test.ts", "dist"]
}
```

- [ ] **Step 1.3：`packages/shared/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/index.ts'],
      thresholds: { lines: 90, functions: 90, statements: 90, branches: 85 },
    },
  },
});
```

- [ ] **Step 1.4：占位 `src/index.ts`（下一任务起逐步替换）**

```ts
// @1api/shared 入口；后续任务在此追加导出。
export const __SHARED_VERSION = '0.0.0';
```

- [ ] **Step 1.5：安装依赖并验证 typecheck/build**

Run:
```bash
pnpm install
pnpm --filter @1api/shared typecheck
pnpm --filter @1api/shared build
```
Expected: typecheck 通过；`dist/index.js` 生成。

- [ ] **Step 1.6：Commit**

```bash
git add -A
git commit -m "feat(shared): 包骨架（package.json/tsconfig/vitest）"
```

---

## Task 2：`shared/src/constants.ts`

**Files:**
- Create: `packages/shared/src/constants.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 2.1：写失败测试 `packages/shared/src/__tests__/constants.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PAGE,
  DEFAULT_SIZE,
  MAX_SIZE,
  NAME_REGEX,
  RESERVED_NAMES,
  isValidName,
  isReservedName,
  ErrorCode,
  API_PATHS,
  ROLE,
  ACTION,
} from '../index.js';

describe('constants', () => {
  describe('分页常量', () => {
    it('默认值与上限', () => {
      expect(DEFAULT_PAGE).toBe(1);
      expect(DEFAULT_SIZE).toBe(20);
      expect(MAX_SIZE).toBe(100);
    });
  });

  describe('名称正则', () => {
    it('合法名', () => {
      expect(NAME_REGEX.test('users')).toBe(true);
      expect(NAME_REGEX.test('user_posts')).toBe(true);
      expect(NAME_REGEX.test('a')).toBe(true);
      expect(NAME_REGEX.test('t1')).toBe(true);
    });
    it('非法名', () => {
      expect(NAME_REGEX.test('Users')).toBe(false); // 大写
      expect(NAME_REGEX.test('1users')).toBe(false); // 数字开头
      expect(NAME_REGEX.test('user-posts')).toBe(false); // 连字符
      expect(NAME_REGEX.test('user posts')).toBe(false); // 空格
      expect(NAME_REGEX.test('')).toBe(false);
    });
  });

  describe('保留字', () => {
    it('含 schema/records/incr', () => {
      expect(RESERVED_NAMES.has('schema')).toBe(true);
      expect(RESERVED_NAMES.has('records')).toBe(true);
      expect(RESERVED_NAMES.has('incr')).toBe(true);
    });
    it('isReservedName', () => {
      expect(isReservedName('schema')).toBe(true);
      expect(isReservedName('users')).toBe(false);
    });
    it('isValidName 综合校验', () => {
      expect(isValidName('users')).toBe(true);
      expect(isValidName('Schema')).toBe(false); // 大写非法
      expect(isValidName('schema')).toBe(false); // 保留字
      expect(isValidName('records')).toBe(false);
    });
  });

  describe('错误码前缀分类', () => {
    it('TABLE_* / VALIDATION_* / DB_* 存在', () => {
      expect(ErrorCode.TABLE_NOT_FOUND).toBe('TABLE_NOT_FOUND');
      expect(ErrorCode.TABLE_NOT_EDITABLE).toBe('TABLE_NOT_EDITABLE');
      expect(ErrorCode.VALIDATION_FAIL).toBe('VALIDATION_FAIL');
      expect(ErrorCode.DB_ERROR).toBe('DB_ERROR');
    });
  });

  describe('API 路径前缀', () => {
    it('四类前缀', () => {
      expect(API_PATHS.auth).toBe('/api/auth');
      expect(API_PATHS.admin).toBe('/api/admin');
      expect(API_PATHS.data).toBe('/api/data');
      expect(API_PATHS.mcp).toBe('/mcp');
    });
  });

  describe('角色 / 动作枚举', () => {
    it('ROLE', () => {
      expect(ROLE.ADMIN).toBe('admin');
    });
    it('ACTION', () => {
      expect(ACTION.READ).toBe('read');
      expect(ACTION.WRITE).toBe('write');
      expect(ACTION.SCHEMA).toBe('schema');
    });
  });
});
```

- [ ] **Step 2.2：运行测试，确认失败**

Run: `pnpm --filter @1api/shared test`
Expected: FAIL（`../index.js` 未导出这些符号）。

- [ ] **Step 2.3：实现 `packages/shared/src/constants.ts`**

```ts
/** 默认分页 */
export const DEFAULT_PAGE = 1;
export const DEFAULT_SIZE = 20;
export const MAX_SIZE = 100;

/** API 路径前缀 */
export const API_PATHS = {
  auth: '/api/auth',
  admin: '/api/admin',
  data: '/api/data',
  mcp: '/mcp',
} as const;

/** 角色 */
export const ROLE = {
  ADMIN: 'admin',
} as const;

/** 动作（与 TokenPermissions.actions 对齐） */
export const ACTION = {
  READ: 'read',
  WRITE: 'write',
  SCHEMA: 'schema',
} as const;

/** 新建模型/字段的名称校验：小写字母开头，仅小写字母/数字/下划线 */
export const NAME_REGEX = /^[a-z][a-z0-9_]*$/;

/** 系统保留字（新建模型/字段时禁止使用） */
export const RESERVED_NAMES: ReadonlySet<string> = new Set([
  'schema',
  'records',
  'incr',
]);

/** 是否为保留字 */
export function isReservedName(name: string): boolean {
  return RESERVED_NAMES.has(name);
}

/** 名称是否合法（正则 + 非保留字） */
export function isValidName(name: string): boolean {
  return NAME_REGEX.test(name) && !RESERVED_NAMES.has(name);
}

/** 错误码（按前缀分类，前后端共用） */
export const ErrorCode = {
  // TABLE_*
  TABLE_NOT_FOUND: 'TABLE_NOT_FOUND',
  TABLE_NO_PRIMARY_KEY: 'TABLE_NO_PRIMARY_KEY',
  TABLE_COMPOSITE_PRIMARY_KEY: 'TABLE_COMPOSITE_PRIMARY_KEY',
  TABLE_NOT_EDITABLE: 'TABLE_NOT_EDITABLE',
  TABLE_ALREADY_EXISTS: 'TABLE_ALREADY_EXISTS',
  // VALIDATION_*
  VALIDATION_FAIL: 'VALIDATION_FAIL',
  INVALID_NAME: 'INVALID_NAME',
  RESERVED_NAME: 'RESERVED_NAME',
  // DB_*
  DB_ERROR: 'DB_ERROR',
  // INTERNAL_*
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  // AUTH_* / TOKEN_*（Phase 2 起用，此处先定义保持前缀完整）
  INVALID_TOKEN: 'INVALID_TOKEN',
  FORBIDDEN: 'FORBIDDEN',
  UNAUTHORIZED: 'UNAUTHORIZED',
} as const;

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];
```

- [ ] **Step 2.4：更新 `packages/shared/src/index.ts` 追加导出**

```ts
export const __SHARED_VERSION = '0.0.0';

export * from './constants.js';
```

- [ ] **Step 2.5：运行测试，确认通过**

Run: `pnpm --filter @1api/shared test`
Expected: PASS。

- [ ] **Step 2.6：typecheck 并 commit**

Run: `pnpm --filter @1api/shared typecheck`
Expected: 通过。

```bash
git add -A
git commit -m "feat(shared): constants（正则/保留字/错误码/路径/枚举/分页）"
```

---

## Task 3：`shared/src/errors.ts`（偏差 1：放 shared）

**Files:**
- Create: `packages/shared/src/errors.ts`
- Modify: `packages/shared/src/index.ts`
- Create: `packages/shared/src/__tests__/errors.test.ts`

- [ ] **Step 3.1：写失败测试**

```ts
import { describe, expect, it } from 'vitest';
import { AppError, Errors } from '../index.js';

describe('AppError', () => {
  it('携带 code/statusCode/message', () => {
    const e = new AppError('TABLE_NOT_FOUND', 404, '表 foo 不存在');
    expect(e).toBeInstanceOf(Error);
    expect(e.code).toBe('TABLE_NOT_FOUND');
    expect(e.statusCode).toBe(404);
    expect(e.message).toBe('表 foo 不存在');
    expect(e.name).toBe('AppError');
  });
});

describe('Errors 工厂', () => {
  it('tableNotFound', () => {
    const e = Errors.tableNotFound('foo');
    expect(e.code).toBe('TABLE_NOT_FOUND');
    expect(e.statusCode).toBe(404);
  });
  it('tableNoPrimaryKey', () => {
    expect(Errors.tableNoPrimaryKey('foo').code).toBe('TABLE_NO_PRIMARY_KEY');
    expect(Errors.tableNoPrimaryKey('foo').statusCode).toBe(422);
  });
  it('tableCompositePrimaryKey', () => {
    expect(Errors.tableCompositePrimaryKey('foo').code).toBe('TABLE_COMPOSITE_PRIMARY_KEY');
  });
  it('tableNotEditable', () => {
    expect(Errors.tableNotEditable('foo').statusCode).toBe(403);
  });
  it('tableAlreadyExists', () => {
    expect(Errors.tableAlreadyExists('foo').statusCode).toBe(409);
  });
  it('invalidName / reservedName', () => {
    expect(Errors.invalidName('Foo').code).toBe('INVALID_NAME');
    expect(Errors.reservedName('schema').code).toBe('RESERVED_NAME');
  });
  it('validationFail', () => {
    expect(Errors.validationFail('字段非法').code).toBe('VALIDATION_FAIL');
    expect(Errors.validationFail('字段非法').statusCode).toBe(400);
  });
  it('dbError / internalError', () => {
    expect(Errors.dbError().statusCode).toBe(500);
    expect(Errors.internalError('boom').code).toBe('INTERNAL_ERROR');
  });
});
```

- [ ] **Step 3.2：运行测试确认失败**

Run: `pnpm --filter @1api/shared test`
Expected: FAIL（未导出 AppError/Errors）。

- [ ] **Step 3.3：实现 `packages/shared/src/errors.ts`**

```ts
import { ErrorCode } from './constants.js';

/** 类型化应用错误（engine 与 server 共用） */
export class AppError extends Error {
  override readonly name = 'AppError';
  constructor(
    public readonly code: string,
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

/** 错误工厂：集中维护错误码、状态码、文案 */
export const Errors = {
  tableNotFound: (name: string) =>
    new AppError(ErrorCode.TABLE_NOT_FOUND, 404, `表 ${name} 不存在或未发布`),
  tableNoPrimaryKey: (name: string) =>
    new AppError(ErrorCode.TABLE_NO_PRIMARY_KEY, 422, `表 ${name} 无主键，无法导入`),
  tableCompositePrimaryKey: (name: string) =>
    new AppError(ErrorCode.TABLE_COMPOSITE_PRIMARY_KEY, 422, `表 ${name} 为复合主键，暂不支持`),
  tableNotEditable: (name: string) =>
    new AppError(ErrorCode.TABLE_NOT_EDITABLE, 403, `表 ${name} 不可编辑`),
  tableAlreadyExists: (name: string) =>
    new AppError(ErrorCode.TABLE_ALREADY_EXISTS, 409, `表 ${name} 已存在`),
  invalidName: (name: string) =>
    new AppError(ErrorCode.INVALID_NAME, 400, `名称 ${name} 不合法，需匹配 ^[a-z][a-z0-9_]*$`),
  reservedName: (name: string) =>
    new AppError(ErrorCode.RESERVED_NAME, 400, `名称 ${name} 为系统保留字`),
  validationFail: (msg: string) =>
    new AppError(ErrorCode.VALIDATION_FAIL, 400, msg),
  dbError: () => new AppError(ErrorCode.DB_ERROR, 500, '数据库错误'),
  internalError: (msg: string) =>
    new AppError(ErrorCode.INTERNAL_ERROR, 500, msg),
};
```

- [ ] **Step 3.4：`index.ts` 追加导出**

```ts
export const __SHARED_VERSION = '0.0.0';

export * from './constants.js';
export * from './errors.js';
```

- [ ] **Step 3.5：运行测试 + typecheck + commit**

Run: `pnpm --filter @1api/shared test && pnpm --filter @1api/shared typecheck`
Expected: PASS / 通过。

```bash
git add -A
git commit -m "feat(shared): AppError + Errors 工厂（放 shared，engine/server 共用）"
```

---

## Task 4：`shared/src/types.ts`

**Files:**
- Create: `packages/shared/src/types.ts`
- Modify: `packages/shared/src/index.ts`
- Create: `packages/shared/src/__tests__/types.test.ts`

- [ ] **Step 4.1：写类型守卫测试（验证类型可被构造与 narrowing）**

```ts
import { describe, expect, it } from 'vitest';
import type {
  FieldMeta,
  TableMeta,
  TokenPermissions,
  ApiResponse,
  ApiError,
  ListOptions,
  ListResult,
  CreateModelOptions,
  FieldMetaInput,
  FilterOperator,
} from '../index.js';

describe('types（编译期 + 运行期构造）', () => {
  it('FieldMeta 可构造', () => {
    const f: FieldMeta = {
      name: 'id',
      label: 'ID',
      sqliteType: 'INTEGER',
      jsonType: 'integer',
      nullable: false,
      defaultValue: null,
      isPrimary: true,
      isAutoIncrement: true,
      isHidden: false,
      isReadonly: true,
    };
    expect(f.name).toBe('id');
  });

  it('TableMeta 可构造', () => {
    const t: TableMeta = {
      id: 1,
      name: 'users',
      label: '用户',
      primaryKey: 'id',
      fields: [],
      isPublished: true,
      isEditable: true,
      note: null,
      createdAt: 0,
      updatedAt: 0,
    };
    expect(t.name).toBe('users');
  });

  it('TokenPermissions 通配与限定两种', () => {
    const all: TokenPermissions = { tables: ['*'], actions: ['read', 'write', 'schema'] };
    const scoped: TokenPermissions = { tables: ['users'], actions: ['read'] };
    expect(all.tables).toContain('*');
    expect(scoped.tables).not.toContain('*');
  });

  it('ApiResponse 信封', () => {
    const ok: ApiResponse<{ id: number }> = { success: true, data: { id: 1 } };
    const err: ApiError = {
      success: false,
      error: { code: 'TABLE_NOT_FOUND', message: 'x' },
    };
    expect(ok.success).toBe(true);
    expect(err.success).toBe(false);
  });

  it('ListOptions 全可选', () => {
    const opts: ListOptions = { page: 2, size: 50, order: 'id:desc', q: 'foo', filters: { age: ['gt', 18] } };
    expect(opts.filters!['age']![0]).toBe('gt');
  });

  it('ListResult', () => {
    const r: ListResult<{ id: number }> = { rows: [{ id: 1 }], total: 1, page: 1, size: 20 };
    expect(r.rows.length).toBe(1);
  });

  it('CreateModelOptions', () => {
    const o: CreateModelOptions = {
      name: 'posts',
      label: '文章',
      fields: [{ name: 'title', jsonType: 'string', nullable: false }],
      autoTimestamps: true,
    };
    expect(o.fields[0]!.jsonType).toBe('string');
  });

  it('FilterOperator 枚举集合', () => {
    const ops: FilterOperator[] = ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'like', 'in'];
    expect(ops).toHaveLength(8);
  });
});
```

- [ ] **Step 4.2：运行确认失败（导入报错/缺类型）**

Run: `pnpm --filter @1api/shared test`
Expected: FAIL。

- [ ] **Step 4.3：实现 `packages/shared/src/types.ts`**

```ts
/** SQLite 列存储类型 */
export type SqliteType = 'INTEGER' | 'REAL' | 'TEXT' | 'NUMERIC' | 'BLOB';

/** 逻辑类型（SQLite 无原生 boolean/datetime，用此标记） */
export type JsonType = 'string' | 'integer' | 'number' | 'boolean' | 'datetime';

/** 字段元数据 */
export interface FieldMeta {
  name: string;
  label: string;
  sqliteType: SqliteType;
  jsonType: JsonType;
  nullable: boolean;
  defaultValue: unknown;
  isPrimary: boolean;
  isAutoIncrement: boolean;
  /** —— 用户可自定义的展示层标记（导入/刷新时保留）—— */
  isHidden: boolean;
  isReadonly: boolean;
  enumValues?: string[];
}

/** 建模时的字段输入（省略由系统推断的 sqliteType 等结构字段） */
export interface FieldMetaInput {
  name: string;
  jsonType: JsonType;
  label?: string;
  nullable?: boolean;
  defaultValue?: unknown;
  isPrimary?: boolean;
  isAutoIncrement?: boolean;
  isHidden?: boolean;
  isReadonly?: boolean;
  enumValues?: string[];
}

/** 表元数据 */
export interface TableMeta {
  id: number;
  name: string;
  label: string;
  primaryKey: string;
  fields: FieldMeta[];
  isPublished: boolean;
  isEditable: boolean;
  note: string | null;
  createdAt: number; // 毫秒时间戳
  updatedAt: number;
}

/** Token 权限 */
export interface TokenPermissions {
  tables: string[] | ['*'];
  actions: ('read' | 'write' | 'schema')[];
}

/** 统一响应信封 */
export interface ApiResponse<T> {
  success: true;
  data: T;
}
export interface ApiError {
  success: false;
  error: { code: string; message: string };
}

/** 过滤操作符 */
export type FilterOperator = 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'like' | 'in';

/** 列表查询选项 */
export interface ListOptions {
  page?: number;
  size?: number;
  /** 形如 "id:desc,name:asc" */
  order?: string;
  q?: string;
  filters?: Record<string, [FilterOperator, unknown]>;
}

/** 列表结果 */
export interface ListResult<T> {
  rows: T[];
  total: number;
  page: number;
  size: number;
}

/** 新建模型选项 */
export interface CreateModelOptions {
  name: string;
  label: string;
  fields: FieldMetaInput[];
  note?: string;
  autoTimestamps?: boolean;
}
```

- [ ] **Step 4.4：`index.ts` 追加类型导出**

```ts
export const __SHARED_VERSION = '0.0.0';

export * from './constants.js';
export * from './errors.js';
export type * from './types.js';
```

> 说明：`export type *` 仅导出类型，不产生运行时代码（与 `verbatimModuleSyntax` 兼容）。

- [ ] **Step 4.5：运行测试 + typecheck + commit**

Run: `pnpm --filter @1api/shared test && pnpm --filter @1api/shared typecheck`
Expected: PASS / 通过。

```bash
git add -A
git commit -m "feat(shared): 核心类型（FieldMeta/TableMeta/TokenPermissions/ApiResponse/...）"
```

---

## Task 5：`shared/src/schema/parsers.ts`（严格 coerce）

**Files:**
- Create: `packages/shared/src/schema/parsers.ts`
- Modify: `packages/shared/src/index.ts`
- Create: `packages/shared/src/__tests__/parsers.test.ts`

> 关键：禁止用 `z.coerce.boolean()`（`"false"` 是 truthy 会误存 true）。`coerceBool` 只接受 `true/false/1/0`（含字符串形式），其余报错。

- [ ] **Step 5.1：写失败测试**

```ts
import { describe, expect, it } from 'vitest';
import { coerceBool, coerceInt, coerceNum } from '../index.js';

describe('coerceBool 严格性', () => {
  it('"false" → false（核心：避免 z.coerce.boolean 的 truthiness 坑）', () => {
    expect(coerceBool.parse('false')).toBe(false);
  });
  it('"true" → true', () => {
    expect(coerceBool.parse('true')).toBe(true);
  });
  it('"1"/1 → true，"0"/0 → false', () => {
    expect(coerceBool.parse('1')).toBe(true);
    expect(coerceBool.parse(1)).toBe(true);
    expect(coerceBool.parse('0')).toBe(false);
    expect(coerceBool.parse(0)).toBe(false);
  });
  it('boolean 原值直通', () => {
    expect(coerceBool.parse(true)).toBe(true);
    expect(coerceBool.parse(false)).toBe(false);
  });
  it('非法值报错（"yes"/"no"/空串/任意字符串）', () => {
    expect(() => coerceBool.parse('yes')).toThrow();
    expect(() => coerceBool.parse('no')).toThrow();
    expect(() => coerceBool.parse('')).toThrow();
    expect(() => coerceBool.parse('maybe')).toThrow();
  });
});

describe('coerceInt', () => {
  it('字符串数字转 int', () => {
    expect(coerceInt.parse('42')).toBe(42);
  });
  it('非整数报错', () => {
    expect(() => coerceInt.parse('3.14')).toThrow();
    expect(() => coerceInt.parse('abc')).toThrow();
  });
});

describe('coerceNum', () => {
  it('字符串数字转 number', () => {
    expect(coerceNum.parse('3.14')).toBe(3.14);
    expect(coerceNum.parse('42')).toBe(42);
  });
  it('非数字报错', () => {
    expect(() => coerceNum.parse('abc')).toThrow();
  });
});
```

- [ ] **Step 5.2：运行确认失败**

Run: `pnpm --filter @1api/shared test`
Expected: FAIL。

- [ ] **Step 5.3：实现 `packages/shared/src/schema/parsers.ts`**

```ts
import { z } from 'zod';

/**
 * 严格布尔转换器：只接受 true/false/1/0（含字符串形式）。
 * 禁止使用 z.coerce.boolean()：其对 "false" 按 JS truthiness 判定为 true。
 */
export const coerceBool = z
  .union([z.boolean(), z.string(), z.number()])
  .transform((v): boolean => {
    if (typeof v === 'boolean') return v;
    if (v === 'true' || v === 1 || v === '1') return true;
    if (v === 'false' || v === 0 || v === '0') return false;
    throw new Error(`无法解析为布尔值: ${v}`);
  });

/** 整数转换（字符串/数字均可） */
export const coerceInt = z.coerce.number().int();

/** 数字转换（字符串/数字均可） */
export const coerceNum = z.coerce.number();
```

- [ ] **Step 5.4：`index.ts` 追加 schema 导出**

```ts
export const __SHARED_VERSION = '0.0.0';

export * from './constants.js';
export * from './errors.js';
export type * from './types.js';
export * from './schema/parsers.js';
```

- [ ] **Step 5.5：运行测试 + typecheck + commit**

Run: `pnpm --filter @1api/shared test && pnpm --filter @1api/shared typecheck`
Expected: PASS / 通过。

```bash
git add -A
git commit -m "feat(shared): 严格 coerce 解析器（coerceBool 拒绝 'yes' 等）"
```

---

## Task 6：`shared/src/schema/mapping.ts`（类型映射核心）

**Files:**
- Create: `packages/shared/src/schema/mapping.ts`
- Modify: `packages/shared/src/index.ts`
- Create: `packages/shared/src/__tests__/mapping.test.ts`

- [ ] **Step 6.1：写失败测试（三端一致性：每个 SQLite 类型 + 每个操作符）**

```ts
import { describe, expect, it } from 'vitest';
import {
  sqliteTypeToJsonType,
  jsonTypeToSqliteType,
  fieldToJsonSchema,
  fieldsToJsonSchema,
  fieldToZod,
  buildCreateColumnSql,
} from '../index.js';
import type { FieldMeta } from '../index.js';

function field(over: Partial<FieldMeta>): FieldMeta {
  return {
    name: 'f',
    label: 'F',
    sqliteType: 'TEXT',
    jsonType: 'string',
    nullable: false,
    defaultValue: null,
    isPrimary: false,
    isAutoIncrement: false,
    isHidden: false,
    isReadonly: false,
    ...over,
  };
}

describe('sqliteTypeToJsonType', () => {
  it('INTEGER → integer', () => {
    expect(sqliteTypeToJsonType('INTEGER')).toBe('integer');
  });
  it('REAL / NUMERIC → number', () => {
    expect(sqliteTypeToJsonType('REAL')).toBe('number');
    expect(sqliteTypeToJsonType('NUMERIC')).toBe('number');
  });
  it('TEXT → string（枚举存在仍为 string）', () => {
    expect(sqliteTypeToJsonType('TEXT')).toBe('string');
    expect(sqliteTypeToJsonType('TEXT', ['a', 'b'])).toBe('string');
  });
  it('BLOB → 抛错（不支持）', () => {
    expect(() => sqliteTypeToJsonType('BLOB')).toThrow();
  });
});

describe('jsonTypeToSqliteType（建表用）', () => {
  it('boolean/integer → INTEGER', () => {
    expect(jsonTypeToSqliteType('integer')).toBe('INTEGER');
    expect(jsonTypeToSqliteType('boolean')).toBe('INTEGER');
  });
  it('number → REAL', () => {
    expect(jsonTypeToSqliteType('number')).toBe('REAL');
  });
  it('string/datetime → TEXT', () => {
    expect(jsonTypeToSqliteType('string')).toBe('TEXT');
    expect(jsonTypeToSqliteType('datetime')).toBe('TEXT');
  });
});

describe('fieldToJsonSchema', () => {
  it('integer', () => {
    expect(fieldToJsonSchema(field({ jsonType: 'integer' }))).toEqual({ type: 'integer' });
  });
  it('boolean', () => {
    expect(fieldToJsonSchema(field({ jsonType: 'boolean' }))).toEqual({ type: 'boolean' });
  });
  it('number', () => {
    expect(fieldToJsonSchema(field({ jsonType: 'number' }))).toEqual({ type: 'number' });
  });
  it('string', () => {
    expect(fieldToJsonSchema(field({ jsonType: 'string' }))).toEqual({ type: 'string' });
  });
  it('string + enum', () => {
    expect(fieldToJsonSchema(field({ jsonType: 'string', enumValues: ['a', 'b'] }))).toEqual({
      type: 'string',
      enum: ['a', 'b'],
    });
  });
  it('datetime', () => {
    expect(fieldToJsonSchema(field({ jsonType: 'datetime' }))).toEqual({
      type: 'string',
      format: 'date-time',
    });
  });
  it('nullable 产生 [type,"null"]', () => {
    expect(fieldToJsonSchema(field({ jsonType: 'string', nullable: true }))).toEqual({
      type: ['string', 'null'],
    });
  });
});

describe('fieldsToJsonSchema', () => {
  it('聚合为 object + required', () => {
    const schema = fieldsToJsonSchema([
      field({ name: 'id', jsonType: 'integer', nullable: false }),
      field({ name: 'name', jsonType: 'string', nullable: true }),
    ]);
    expect(schema).toEqual({
      type: 'object',
      properties: { id: { type: 'integer' }, name: { type: ['string', 'null'] } },
      required: ['id'],
    });
  });
});

describe('fieldToZod', () => {
  it('integer（coerceInt）', () => {
    expect(fieldToZod(field({ jsonType: 'integer' })).parse('5')).toBe(5);
  });
  it('boolean（coerceBool，"false"→false）', () => {
    expect(fieldToZod(field({ jsonType: 'boolean' })).parse('false')).toBe(false);
    expect(() => fieldToZod(field({ jsonType: 'boolean' })).parse('yes')).toThrow();
  });
  it('number（coerceNum）', () => {
    expect(fieldToZod(field({ jsonType: 'number' })).parse('3.14')).toBe(3.14);
  });
  it('string', () => {
    expect(fieldToZod(field({ jsonType: 'string' })).parse('x')).toBe('x');
  });
  it('string + enum', () => {
    const s = fieldToZod(field({ jsonType: 'string', enumValues: ['a', 'b'] }));
    expect(s.parse('a')).toBe('a');
    expect(() => s.parse('c')).toThrow();
  });
  it('datetime', () => {
    const s = fieldToZod(field({ jsonType: 'datetime' }));
    expect(s.parse('2024-01-01T00:00:00Z')).toBe('2024-01-01T00:00:00Z');
    expect(() => s.parse('not-a-date')).toThrow();
  });
  it('nullable 接受 null', () => {
    expect(fieldToZod(field({ jsonType: 'string', nullable: true })).parse(null)).toBeNull();
  });
});

describe('buildCreateColumnSql', () => {
  it('主键自增', () => {
    expect(
      buildCreateColumnSql(field({ name: 'id', sqliteType: 'INTEGER', jsonType: 'integer', isPrimary: true, isAutoIncrement: true })),
    ).toBe('"id" INTEGER PRIMARY KEY AUTOINCREMENT');
  });
  it('NOT NULL 字符串', () => {
    expect(
      buildCreateColumnSql(field({ name: 'title', sqliteType: 'TEXT', jsonType: 'string', nullable: false })),
    ).toBe('"title" TEXT NOT NULL');
  });
  it('可空 + 默认值（字符串转义）', () => {
    expect(
      buildCreateColumnSql(field({ name: 'status', sqliteType: 'TEXT', jsonType: 'string', nullable: true, defaultValue: 'ok' })),
    ).toBe('"status" TEXT DEFAULT \'ok\'');
  });
  it('布尔默认 0/1', () => {
    expect(
      buildCreateColumnSql(field({ name: 'is_active', sqliteType: 'INTEGER', jsonType: 'boolean', nullable: false, defaultValue: false })),
    ).toBe('"is_active" INTEGER NOT NULL DEFAULT 0');
  });
  it('数字默认值', () => {
    expect(
      buildCreateColumnSql(field({ name: 'age', sqliteType: 'REAL', jsonType: 'number', nullable: false, defaultValue: 18 })),
    ).toBe('"age" REAL NOT NULL DEFAULT 18');
  });
});
```

- [ ] **Step 6.2：运行确认失败**

Run: `pnpm --filter @1api/shared test`
Expected: FAIL。

- [ ] **Step 6.3：实现 `packages/shared/src/schema/mapping.ts`**

```ts
import type { FieldMeta, JsonType, SqliteType } from '../types.js';
import { coerceBool, coerceInt, coerceNum } from './parsers.js';
import { z } from 'zod';

/** SQLite 存储类型 → 逻辑类型（结构性，不含命名推断；datetime 由反射层按列名判定） */
export function sqliteTypeToJsonType(sqliteType: SqliteType, _enumValues?: string[]): JsonType {
  switch (sqliteType) {
    case 'INTEGER':
      return 'integer';
    case 'REAL':
    case 'NUMERIC':
      return 'number';
    case 'TEXT':
      return 'string';
    case 'BLOB':
      throw new Error('BLOB 类型不支持映射（无法编辑/校验）');
  }
}

/** 逻辑类型 → SQLite 建表类型 */
export function jsonTypeToSqliteType(jsonType: JsonType): SqliteType {
  switch (jsonType) {
    case 'integer':
    case 'boolean':
      return 'INTEGER';
    case 'number':
      return 'REAL';
    case 'string':
    case 'datetime':
      return 'TEXT';
  }
}

/** 单字段 → JSON Schema 片段（供 vue-json-ui-editor） */
export function fieldToJsonSchema(f: FieldMeta): Record<string, unknown> {
  let base: Record<string, unknown>;
  switch (f.jsonType) {
    case 'integer':
      base = { type: 'integer' };
      break;
    case 'boolean':
      base = { type: 'boolean' };
      break;
    case 'number':
      base = { type: 'number' };
      break;
    case 'datetime':
      base = { type: 'string', format: 'date-time' };
      break;
    case 'string':
    default:
      base = f.enumValues && f.enumValues.length > 0 ? { type: 'string', enum: f.enumValues } : { type: 'string' };
  }
  if (f.nullable) {
    const t = base['type'];
    base['type'] = Array.isArray(t) ? [...t, 'null'] : [t, 'null'];
  }
  return base;
}

/** 字段数组 → 完整 object JSON Schema */
export function fieldsToJsonSchema(fields: FieldMeta[]): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const f of fields) {
    properties[f.name] = fieldToJsonSchema(f);
    if (!f.nullable) required.push(f.name);
  }
  return { type: 'object', properties, required };
}

/** 单字段 → Zod schema（供 node-erest 校验） */
export function fieldToZod(f: FieldMeta): z.ZodType {
  let s: z.ZodType;
  switch (f.jsonType) {
    case 'integer':
      s = coerceInt;
      break;
    case 'boolean':
      s = coerceBool;
      break;
    case 'number':
      s = coerceNum;
      break;
    case 'datetime':
      s = z.string().datetime();
      break;
    case 'string':
    default:
      s = f.enumValues && f.enumValues.length > 0 ? z.enum(f.enumValues as [string, ...string[]]) : z.string();
  }
  return f.nullable ? s.nullable() : s;
}

/** 字段默认值 → SQL 字面量片段 */
function defaultValueLiteral(f: FieldMeta): string | null {
  const v = f.defaultValue;
  if (v === undefined) return null;
  if (v === null) return 'NULL';
  if (f.jsonType === 'boolean') return v ? '1' : '0';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  if (typeof v === 'string') return `'${v.replace(/'/g, "''")}'`;
  return null; // 对象/数组等不支持作为列默认值
}

/** FieldMeta → CREATE TABLE 列定义片段（标识符双引号包裹） */
export function buildCreateColumnSql(f: FieldMeta): string {
  const sqliteType = f.sqliteType;
  // 主键自增（仅 INTEGER 主键支持 AUTOINCREMENT）
  if (f.isPrimary && f.isAutoIncrement) {
    return `"${f.name}" ${sqliteType} PRIMARY KEY AUTOINCREMENT`;
  }
  if (f.isPrimary) {
    return `"${f.name}" ${sqliteType} PRIMARY KEY`;
  }
  const parts = [`"${f.name}"`, sqliteType];
  if (!f.nullable) parts.push('NOT NULL');
  const def = defaultValueLiteral(f);
  if (def !== null) parts.push(`DEFAULT ${def}`);
  return parts.join(' ');
}
```

- [ ] **Step 6.4：`index.ts` 追加 mapping 导出**

```ts
export const __SHARED_VERSION = '0.0.0';

export * from './constants.js';
export * from './errors.js';
export type * from './types.js';
export * from './schema/parsers.js';
export * from './schema/mapping.js';
```

- [ ] **Step 6.5：运行测试 + typecheck + commit**

Run: `pnpm --filter @1api/shared test && pnpm --filter @1api/shared typecheck`
Expected: PASS / 通过。

```bash
git add -A
git commit -m "feat(shared): 类型映射核心（SQLite↔JSONSchema↔Zod + 列定义生成）"
```

---

## Task 7：`@1api/engine` 包骨架 + SystemDB 类型（偏差 2）+ DB 工具

**Files:**
- Create: `packages/engine/package.json`
- Create: `packages/engine/tsconfig.json`
- Create: `packages/engine/vitest.config.ts`
- Create: `packages/engine/src/system-db.ts`

- [ ] **Step 7.1：`packages/engine/package.json`**

注意偏差 3：不引入 bcrypt（Phase 1 无鉴权）。

```jsonc
{
  "name": "@1api/engine",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@1api/shared": "workspace:*",
    "kysely": "^0.29.0",
    "better-sqlite3": "^11.0.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.0",
    "typescript": "^5.8.0",
    "vitest": "^3.0.0"
  }
}
```

- [ ] **Step 7.2：`packages/engine/tsconfig.json`**

```jsonc
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "./src",
    "outDir": "./dist",
    "composite": true
  },
  "references": [{ "path": "../shared" }],
  "include": ["src/**/*.ts"],
  "exclude": ["src/**/*.test.ts", "dist"]
}
```

- [ ] **Step 7.3：`packages/engine/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/index.ts'],
      thresholds: { lines: 90, functions: 90, statements: 90, branches: 85 },
    },
  },
});
```

- [ ] **Step 7.4：`packages/engine/src/system-db.ts`**

偏差 2：仅 `table_meta`。`fields` 列存 `FieldMeta[]` 的 JSON 字符串。

```ts
import type { Generated } from 'kysely';

/** table_meta 行（系统库，snake_case） */
export interface TableMetaRow {
  id: Generated<number>;
  name: string;
  label: string;
  primary_key: string;
  fields: string; // JSON: FieldMeta[]
  is_published: number; // 0/1
  is_editable: number; // 0/1
  note: string | null;
  created_at: number; // 毫秒时间戳
  updated_at: number;
}

/**
 * 系统库类型。Phase 1 只覆盖 table_meta（engine 唯一接入的系统表）。
 * admin / api_token 属鉴权层，Phase 2 扩展。
 */
export interface SystemDB {
  table_meta: TableMetaRow;
}

/** 系统库建表 SQL（Phase 1 仅 table_meta） */
export const SYSTEM_DB_MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS table_meta (
     id           INTEGER PRIMARY KEY AUTOINCREMENT,
     name         TEXT NOT NULL UNIQUE,
     label        TEXT NOT NULL,
     primary_key  TEXT NOT NULL,
     fields       TEXT NOT NULL,
     is_published INTEGER NOT NULL DEFAULT 1,
     is_editable  INTEGER NOT NULL DEFAULT 1,
     note         TEXT,
     created_at   INTEGER NOT NULL,
     updated_at   INTEGER NOT NULL
   )`,
] as const;
```

- [ ] **Step 7.5：安装依赖并验证**

Run:
```bash
pnpm install
pnpm --filter @1api/engine typecheck
```
Expected: typecheck 通过。

- [ ] **Step 7.6：Commit**

```bash
git add -A
git commit -m "feat(engine): 包骨架 + SystemDB 类型（table_meta）"
```

---

## Task 8：测试基础设施（临时 SQLite + 连接工厂）

**Files:**
- Create: `packages/engine/src/test-helpers.ts`

> 各测试用 `tmpdir` 下随机 SQLite 文件，afterEach 清理。提供统一工厂，避免每个测试文件重复样板。

- [ ] **Step 8.1：写测试（验证工厂可创建临时库并执行 DDL）**

`packages/engine/src/__tests__/test-helpers.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { createTestDbs } from '../test-helpers.js';

describe('createTestDbs', () => {
  it('创建临时库且可执行原生 DDL', async () => {
    const dbs = await createTestDbs();
    expect(dbs.businessDbPath).toMatch(/\.db$/);
    expect(dbs.systemDbPath).toMatch(/\.db$/);
    // 原生 better-sqlite3 句柄可建表
    dbs.businessRaw.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)');
    dbs.businessRaw.prepare('INSERT INTO t (name) VALUES (?)').run('a');
    expect(dbs.businessRaw.prepare('SELECT COUNT(*) AS c FROM t').get()).toEqual({ c: 1 });
    await dbs.cleanup();
  });
});
```

- [ ] **Step 8.2：运行确认失败**

Run: `pnpm --filter @1api/engine test`
Expected: FAIL（test-helpers 未实现）。

- [ ] **Step 8.3：实现 `packages/engine/src/test-helpers.ts`**

```ts
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import Database from 'better-sqlite3';
import { Kysely, SqliteDialect } from 'kysely';
import type { SystemDB } from './system-db.js';

export interface TestDbs {
  businessDbPath: string;
  systemDbPath: string;
  businessRaw: Database.Database; // better-sqlite3 原生（反射/DDL）
  businessDb: Kysely<Record<string, never>>; // 动态业务库（无静态 schema）
  systemRaw: Database.Database;
  systemDb: Kysely<SystemDB>;
  cleanup: () => Promise<void>;
}

let counter = 0;

/** 创建临时业务库 + 系统库（每次唯一路径），返回句柄与 cleanup。 */
export async function createTestDbs(): Promise<TestDbs> {
  const dir = mkdtempSync(join(tmpdir(), `1api-${randomBytes(4).toString('hex')}-`));
  const businessDbPath = join(dir, `biz-${counter}.db`);
  const systemDbPath = join(dir, `sys-${counter}.db`);
  counter += 1;

  const businessRaw = new Database(businessDbPath);
  businessRaw.pragma('journal_mode = WAL');
  const systemRaw = new Database(systemDbPath);

  const businessDb = new Kysely<Record<string, never>>({
    dialect: new SqliteDialect({ database: businessRaw }),
  });
  const systemDb = new Kysely<SystemDB>({
    dialect: new SqliteDialect({ database: systemRaw }),
  });

  return {
    businessDbPath,
    systemDbPath,
    businessRaw,
    businessDb,
    systemRaw,
    systemDb,
    cleanup: async () => {
      await businessDb.destroy();
      await systemDb.destroy();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
```

- [ ] **Step 8.4：运行测试 + typecheck + commit**

Run: `pnpm --filter @1api/engine test && pnpm --filter @1api/engine typecheck`
Expected: PASS / 通过。

```bash
git add -A
git commit -m "test(engine): 临时 SQLite 测试工厂（createTestDbs）"
```

---

## Task 9：`engine/src/schema-reader.ts`（反射 + 主键策略 + 类型推断）

**Files:**
- Create: `packages/engine/src/schema-reader.ts`
- Create: `packages/engine/src/__tests__/schema-reader.test.ts`

- [ ] **Step 9.1：写失败测试**

```ts
import { describe, expect, it } from 'vitest';
import { beforeEach } from 'vitest';
import { Errors } from '@1api/shared';
import { createTestDbs, type TestDbs } from '../test-helpers.js';
import { listTables, readTableSchema } from '../schema-reader.js';

describe('schema-reader', () => {
  let dbs: TestDbs;
  beforeEach(async () => {
    dbs = await createTestDbs();
  });
  afterEach(async () => {
    await dbs.cleanup();
  });

  function exec(sql: string) {
    dbs.businessRaw.exec(sql);
  }

  describe('listTables', () => {
    it('列出用户表（排除 sqlite_ 内部表）', () => {
      exec('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)');
      exec('CREATE TABLE posts (id INTEGER PRIMARY KEY)');
      const tables = listTables(dbs.businessRaw);
      expect(tables.sort()).toEqual(['posts', 'users']);
    });
  });

  describe('readTableSchema 类型推断', () => {
    it('INTEGER → integer；字段名 is_*/has_* + 默认 0/1 → boolean', () => {
      exec('CREATE TABLE t (id INTEGER PRIMARY KEY, is_active INTEGER DEFAULT 1, has_pet INTEGER DEFAULT 0)');
      const { fields, primaryKey } = readTableSchema(dbs.businessRaw, 't');
      expect(primaryKey).toBe('id');
      const isActive = fields.find((f) => f.name === 'is_active')!;
      expect(isActive.jsonType).toBe('boolean');
      expect(isActive.sqliteType).toBe('INTEGER');
      const hasPet = fields.find((f) => f.name === 'has_pet')!;
      expect(hasPet.jsonType).toBe('boolean');
    });

    it('REAL/NUMERIC → number', () => {
      exec('CREATE TABLE t (id INTEGER PRIMARY KEY, price REAL, amount NUMERIC)');
      const { fields } = readTableSchema(dbs.businessRaw, 't');
      expect(fields.find((f) => f.name === 'price')!.jsonType).toBe('number');
      expect(fields.find((f) => f.name === 'amount')!.jsonType).toBe('number');
    });

    it('TEXT → string；*_at/*_time/time → datetime', () => {
      exec('CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT, created_at TEXT, login_time TEXT, time TEXT, other TEXT)');
      const { fields } = readTableSchema(dbs.businessRaw, 't');
      expect(fields.find((f) => f.name === 'name')!.jsonType).toBe('string');
      expect(fields.find((f) => f.name === 'created_at')!.jsonType).toBe('datetime');
      expect(fields.find((f) => f.name === 'login_time')!.jsonType).toBe('datetime');
      expect(fields.find((f) => f.name === 'time')!.jsonType).toBe('datetime');
      expect(fields.find((f) => f.name === 'other')!.jsonType).toBe('string');
    });

    it('主键、自增、可空、默认值回填', () => {
      exec('CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, note TEXT)');
      const { fields, primaryKey } = readTableSchema(dbs.businessRaw, 't');
      expect(primaryKey).toBe('id');
      const id = fields.find((f) => f.name === 'id')!;
      expect(id.isPrimary).toBe(true);
      expect(id.isAutoIncrement).toBe(true);
      const name = fields.find((f) => f.name === 'name')!;
      expect(name.nullable).toBe(false);
      const note = fields.find((f) => f.name === 'note')!;
      expect(note.nullable).toBe(true);
    });

    it('created_at/updated_at 默认标记 isReadonly', () => {
      exec('CREATE TABLE t (id INTEGER PRIMARY KEY, created_at TEXT, updated_at TEXT, name TEXT)');
      const { fields } = readTableSchema(dbs.businessRaw, 't');
      expect(fields.find((f) => f.name === 'created_at')!.isReadonly).toBe(true);
      expect(fields.find((f) => f.name === 'updated_at')!.isReadonly).toBe(true);
      expect(fields.find((f) => f.name === 'name')!.isReadonly).toBe(false);
    });
  });

  describe('主键策略', () => {
    it('无主键 → TABLE_NO_PRIMARY_KEY', () => {
      exec('CREATE TABLE t (a INTEGER, b INTEGER)');
      expect(() => readTableSchema(dbs.businessRaw, 't')).toThrow(Errors.tableNoPrimaryKey('t'));
    });

    it('复合主键 → TABLE_COMPOSITE_PRIMARY_KEY', () => {
      exec('CREATE TABLE t (a INTEGER, b INTEGER, PRIMARY KEY (a, b))');
      expect(() => readTableSchema(dbs.businessRaw, 't')).toThrow(Errors.tableCompositePrimaryKey('t'));
    });
  });
});
```

> 导入：文件顶部用 `import { afterEach, beforeEach, describe, expect, it } from 'vitest';`（与各测试文件一致）。

- [ ] **Step 9.2：运行确认失败**

Run: `pnpm --filter @1api/engine test`
Expected: FAIL（schema-reader 未实现）。

- [ ] **Step 9.3：实现 `packages/engine/src/schema-reader.ts`**

```ts
import type Database from 'better-sqlite3';
import { Errors, type FieldMeta, type JsonType, type SqliteType } from '@1api/shared';

interface PragmaRow {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
}

const DATETIME_NAME_RE = /(^|_)(at|time)$/i;

/** 列出业务库所有用户表（排除 sqlite_ 内部表） */
export function listTables(db: Database.Database): string[] {
  const rows = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    .all() as { name: string }[];
  return rows.map((r) => r.name);
}

/** 主键策略：只接受单主键 */
function resolvePrimaryKey(rows: PragmaRow[], tableName: string): { pkField: string } {
  const pkRows = rows.filter((r) => r.pk > 0);
  if (pkRows.length === 0) throw Errors.tableNoPrimaryKey(tableName);
  if (pkRows.length > 1) throw Errors.tableCompositePrimaryKey(tableName);
  return { pkField: pkRows[0]!.name };
}

/** SQLite 原生类型串归一为五类之一 */
function normalizeSqliteType(raw: string): SqliteType {
  const t = raw.toUpperCase();
  if (t === '') return 'BLOB'; // 无类型声明 → BLOB 亲和
  if (t.includes('INT')) return 'INTEGER';
  if (t.includes('CHAR') || t.includes('CLOB') || t.includes('TEXT')) return 'TEXT';
  if (t.includes('BLOB')) return 'BLOB';
  if (t.includes('REAL') || t.includes('FLOA') || t.includes('DOUB')) return 'REAL';
  return 'NUMERIC';
}

/** jsonType 推断（含命名启发式） */
function inferJsonType(
  sqliteType: SqliteType,
  colName: string,
  defaultValue: string | null,
): JsonType {
  const lower = colName.toLowerCase();
  const isBooleanish = (lower.startsWith('is_') || lower.startsWith('has_')) && sqliteType === 'INTEGER';
  if (isBooleanish && (defaultValue === '0' || defaultValue === '1')) return 'boolean';
  if (sqliteType === 'INTEGER') return 'integer';
  if (sqliteType === 'REAL' || sqliteType === 'NUMERIC') return 'number';
  if (sqliteType === 'BLOB') return 'string'; // BLOB 作为 string 读取（不接受输入由上层校验）
  // TEXT
  if (DATETIME_NAME_RE.test(lower)) return 'datetime';
  return 'string';
}

/** 反射单表 → FieldMeta[] + 主键 */
export function readTableSchema(
  db: Database.Database,
  tableName: string,
): { fields: FieldMeta[]; primaryKey: string } {
  const rows = db.prepare(`PRAGMA table_info(${JSON.stringify(tableName)})`).all() as PragmaRow[];
  if (rows.length === 0) throw Errors.tableNotFound(tableName);
  const { pkField } = resolvePrimaryKey(rows, tableName);

  const fields: FieldMeta[] = rows
    .sort((a, b) => a.cid - b.cid)
    .map((r) => {
      const sqliteType = normalizeSqliteType(r.type);
      const jsonType = inferJsonType(sqliteType, r.name, r.dflt_value);
      const isPrimary = r.name === pkField;
      const lower = r.name.toLowerCase();
      const isReadonly =
        jsonType === 'datetime' && (lower === 'created_at' || lower === 'updated_at');
      return {
        name: r.name,
        label: r.name,
        sqliteType,
        jsonType,
        nullable: r.notnull === 0,
        defaultValue: parseDefaultValue(r.dflt_value, jsonType),
        isPrimary,
        isAutoIncrement: isPrimary && sqliteType === 'INTEGER',
        isHidden: false,
        isReadonly,
      } satisfies FieldMeta;
    });

  return { fields, primaryKey: pkField };
}

/** 解析 PRAGMA 的 dflt_value 字符串为合适的 JS 值 */
function parseDefaultValue(raw: string | null, jsonType: JsonType): unknown {
  if (raw === null) return null;
  const v = raw;
  if (jsonType === 'boolean') return v === '1' ? true : v === '0' ? false : null;
  if (jsonType === 'integer') {
    const n = Number.parseInt(v, 10);
    return Number.isFinite(n) ? n : null;
  }
  if (jsonType === 'number') {
    const n = Number.parseFloat(v);
    return Number.isFinite(n) ? n : null;
  }
  // string / datetime：去掉外层单引号（SQLite 默认值字符串以 'xxx' 形式存储）
  return v.replace(/^'|'$/g, '').replace(/''/g, "'");
}
```

- [ ] **Step 9.4：运行测试 + typecheck + commit**

Run: `pnpm --filter @1api/engine test && pnpm --filter @1api/engine typecheck`
Expected: PASS / 通过。

```bash
git add -A
git commit -m "feat(engine): schema-reader 反射（类型推断 + 单主键策略）"
```

---

## Task 10：`engine/src/schema-ddl.ts`（CREATE/ALTER）

**Files:**
- Create: `packages/engine/src/schema-ddl.ts`
- Create: `packages/engine/src/__tests__/schema-ddl.test.ts`

- [ ] **Step 10.1：写失败测试**

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDbs, type TestDbs } from '../test-helpers.js';
import { addColumn, createTable } from '../schema-ddl.js';
import { readTableSchema } from '../schema-reader.js';
import type { CreateModelOptions } from '@1api/shared';

describe('schema-ddl', () => {
  let dbs: TestDbs;
  beforeEach(async () => {
    dbs = await createTestDbs();
  });
  afterEach(async () => {
    await dbs.cleanup();
  });

  it('createTable：主键 + 字段 + 时间戳', () => {
    const opts: CreateModelOptions = {
      name: 'posts',
      label: '文章',
      fields: [
        { name: 'title', jsonType: 'string', nullable: false },
        { name: 'views', jsonType: 'integer', nullable: false, defaultValue: 0 },
      ],
      autoTimestamps: true,
    };
    createTable(dbs.businessRaw, opts);
    const { fields, primaryKey } = readTableSchema(dbs.businessRaw, 'posts');
    expect(primaryKey).toBe('id');
    const names = fields.map((f) => f.name);
    expect(names).toEqual(['id', 'title', 'views', 'created_at', 'updated_at']);
    expect(fields.find((f) => f.name === 'title')!.nullable).toBe(false);
    expect(fields.find((f) => f.name === 'views')!.defaultValue).toBe(0);
  });

  it('createTable：自定义主键字段', () => {
    const opts: CreateModelOptions = {
      name: 't',
      label: 'T',
      fields: [{ name: 'code', jsonType: 'string', nullable: false, isPrimary: true }],
    };
    createTable(dbs.businessRaw, opts);
    const { primaryKey } = readTableSchema(dbs.businessRaw, 't');
    expect(primaryKey).toBe('code');
  });

  it('addColumn：追加字段后可反射读回', () => {
    createTable(dbs.businessRaw, { name: 't', label: 'T', fields: [{ name: 'a', jsonType: 'string' }] });
    addColumn(dbs.businessRaw, 't', {
      name: 'b',
      label: 'b',
      sqliteType: 'TEXT',
      jsonType: 'string',
      nullable: true,
      defaultValue: null,
      isPrimary: false,
      isAutoIncrement: false,
      isHidden: false,
      isReadonly: false,
    });
    const { fields } = readTableSchema(dbs.businessRaw, 't');
    expect(fields.map((f) => f.name)).toEqual(['id', 'a', 'b']);
  });
});
```

- [ ] **Step 10.2：运行确认失败**

Run: `pnpm --filter @1api/engine test`
Expected: FAIL。

- [ ] **Step 10.3：实现 `packages/engine/src/schema-ddl.ts`**

```ts
import type Database from 'better-sqlite3';
import {
  buildCreateColumnSql,
  jsonTypeToSqliteType,
  type CreateModelOptions,
  type FieldMeta,
  type FieldMetaInput,
} from '@1api/shared';

/** FieldMetaInput（建模输入）→ FieldMeta（完整），补齐 sqliteType 与默认标记 */
export function inputToField(input: FieldMetaInput): FieldMeta {
  const sqliteType = jsonTypeToSqliteType(input.jsonType);
  return {
    name: input.name,
    label: input.label ?? input.name,
    sqliteType,
    jsonType: input.jsonType,
    nullable: input.nullable ?? true,
    defaultValue: input.defaultValue ?? null,
    isPrimary: input.isPrimary ?? false,
    isAutoIncrement: input.isAutoIncrement ?? false,
    isHidden: input.isHidden ?? false,
    isReadonly: input.isReadonly ?? false,
    enumValues: input.enumValues,
  };
}

/** CREATE TABLE（含主键约定 + 可选时间戳），执行后由调用方反射读回 */
export function createTable(db: Database.Database, opts: CreateModelOptions): void {
  const cols: string[] = [];

  const hasExplicitPk = opts.fields.some((f) => f.isPrimary);
  // 默认主键：id INTEGER PRIMARY KEY AUTOINCREMENT
  if (!hasExplicitPk) {
    cols.push('"id" INTEGER PRIMARY KEY AUTOINCREMENT');
  }
  for (const input of opts.fields) {
    cols.push(buildCreateColumnSql(inputToField(input)));
  }
  if (opts.autoTimestamps) {
    cols.push('"created_at" INTEGER');
    cols.push('"updated_at" INTEGER');
  }

  const sql = `CREATE TABLE "${opts.name}" (${cols.join(', ')})`;
  db.exec(sql);
}

/** ALTER TABLE ... ADD COLUMN（标识符双引号包裹，支持非 snake_case） */
export function addColumn(db: Database.Database, tableName: string, field: FieldMeta): void {
  const colSql = buildCreateColumnSql(field);
  // ADD COLUMN 不支持 PRIMARY KEY/AUTOINCREMENT，剥离
  const colSafe = colSql.replace(/\s+PRIMARY KEY(\s+AUTOINCREMENT)?/i, '');
  db.exec(`ALTER TABLE "${tableName}" ADD COLUMN ${colSafe}`);
}
```

- [ ] **Step 10.4：运行测试 + typecheck + commit**

Run: `pnpm --filter @1api/engine test && pnpm --filter @1api/engine typecheck`
Expected: PASS / 通过。

```bash
git add -A
git commit -m "feat(engine): schema-ddl（createTable + addColumn）"
```

---

## Task 11：`engine/src/metadata.ts`（系统库元数据 CRUD + 缓存 + refreshMeta diff）

**Files:**
- Create: `packages/engine/src/metadata.ts`
- Create: `packages/engine/src/__tests__/metadata.test.ts`

- [ ] **Step 11.1：写失败测试**

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDbs, type TestDbs } from '../test-helpers.js';
import { SYSTEM_DB_MIGRATIONS } from '../system-db.js';
import { MetadataStore } from '../metadata.js';
import type { FieldMeta } from '@1api/shared';

function f(name: string, over: Partial<FieldMeta> = {}): FieldMeta {
  return {
    name,
    label: name,
    sqliteType: 'TEXT',
    jsonType: 'string',
    nullable: true,
    defaultValue: null,
    isPrimary: false,
    isAutoIncrement: false,
    isHidden: false,
    isReadonly: false,
    ...over,
  };
}

describe('MetadataStore', () => {
  let dbs: TestDbs;
  let store: MetadataStore;
  beforeEach(async () => {
    dbs = await createTestDbs();
    for (const m of SYSTEM_DB_MIGRATIONS) dbs.systemRaw.exec(m);
    store = new MetadataStore(dbs.systemDb, dbs.businessRaw);
  });
  afterEach(async () => {
    await dbs.cleanup();
  });

  it('createMeta + getMeta + getMetaByName + listMetas', async () => {
    const meta = await store.createMeta({
      name: 'users',
      label: '用户',
      primaryKey: 'id',
      fields: [f('id', { sqliteType: 'INTEGER', jsonType: 'integer', isPrimary: true }), f('name')],
    });
    expect(meta.id).toBeGreaterThan(0);
    expect(meta.name).toBe('users');
    expect(meta.fields).toHaveLength(2);

    const byId = await store.getMeta(meta.id);
    expect(byId?.name).toBe('users');
    const byName = await store.getMetaByName('users');
    expect(byName?.id).toBe(meta.id);
    const list = await store.listMetas();
    expect(list).toHaveLength(1);
  });

  it('缓存命中：第二次 getMetaByName 走内存', async () => {
    const created = await store.createMeta({
      name: 't', label: 'T', primaryKey: 'id',
      fields: [f('id', { isPrimary: true, sqliteType: 'INTEGER', jsonType: 'integer' })],
    });
    await store.getMetaByName('t'); // 触发缓存
    // 删库后再读仍返回缓存（证明未查库）
    await dbs.systemDb.deleteFrom('table_meta').where('id', '=', created.id).execute();
    const cached = await store.getMetaByName('t');
    expect(cached?.name).toBe('t');
  });

  it('updateMeta：修改 label/is_published', async () => {
    const created = await store.createMeta({
      name: 't', label: 'T', primaryKey: 'id',
      fields: [f('id', { isPrimary: true, sqliteType: 'INTEGER', jsonType: 'integer' })],
    });
    await store.updateMeta(created.id, { label: 'TT', isPublished: false });
    const after = await store.getMeta(created.id);
    expect(after?.label).toBe('TT');
    expect(after?.isPublished).toBe(false);
  });

  it('deleteMeta：缓存失效 + 删除', async () => {
    const created = await store.createMeta({
      name: 't', label: 'T', primaryKey: 'id',
      fields: [f('id', { isPrimary: true, sqliteType: 'INTEGER', jsonType: 'integer' })],
    });
    await store.deleteMeta(created.id);
    expect(await store.getMeta(created.id)).toBeUndefined();
    expect(await store.getMetaByName('t')).toBeUndefined();
  });

  describe('refreshMeta diff（保留用户标记）', () => {
    it('保留 label/isHidden/isReadonly/enumValues；结构随反射更新；新增/删除字段同步', async () => {
      // 业务库先建表
      dbs.businessRaw.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT NOT NULL, status TEXT)');
      // 首次导入
      const created = await store.createMeta({
        name: 't', label: '原标签', primaryKey: 'id',
        fields: [
          f('id', { isPrimary: true, sqliteType: 'INTEGER', jsonType: 'integer', label: 'ID' }),
          f('name', { label: '姓名', isReadonly: true }),
          f('status', { label: '状态', enumValues: ['a', 'b'], isHidden: true }),
        ],
      });
      // 业务库演进：删 status、加 age、改 name 为可空
      dbs.businessRaw.exec('ALTER TABLE t RENAME COLUMN status TO status_old');
      dbs.businessRaw.exec('ALTER TABLE t DROP COLUMN status_old');
      dbs.businessRaw.exec('ALTER TABLE t ADD COLUMN age INTEGER');

      await store.refreshMeta(created.id);
      const after = await store.getMeta(created.id);
      const fields = after!.fields;
      const names = fields.map((x) => x.name);
      expect(names).toEqual(['id', 'name', 'age']); // status 删除、age 新增
      // 保留：id 的 label=ID、name 的 isReadonly
      expect(fields.find((x) => x.name === 'id')!.label).toBe('ID');
      expect(fields.find((x) => x.name === 'name')!.isReadonly).toBe(true);
      // 新增 age：label 默认 = name
      expect(fields.find((x) => x.name === 'age')!.label).toBe('age');
      expect(fields.find((x) => x.name === 'age')!.jsonType).toBe('integer');
    });
  });
});
```

- [ ] **Step 11.2：运行确认失败**

Run: `pnpm --filter @1api/engine test`
Expected: FAIL。

- [ ] **Step 11.3：实现 `packages/engine/src/metadata.ts`**

```ts
import type Database from 'better-sqlite3';
import { type Kysely } from 'kysely';
import type { FieldMeta, TableMeta } from '@1api/shared';
import { readTableSchema } from './schema-reader.js';
import type { SystemDB } from './system-db.js';

export interface CreateMetaInput {
  name: string;
  label: string;
  primaryKey: string;
  fields: FieldMeta[];
  note?: string | null;
  isPublished?: boolean;
  isEditable?: boolean;
}

function rowToMeta(row: {
  id: number;
  name: string;
  label: string;
  primary_key: string;
  fields: string;
  is_published: number;
  is_editable: number;
  note: string | null;
  created_at: number;
  updated_at: number;
}): TableMeta {
  return {
    id: row.id,
    name: row.name,
    label: row.label,
    primaryKey: row.primary_key,
    fields: JSON.parse(row.fields) as FieldMeta[],
    isPublished: row.is_published === 1,
    isEditable: row.is_editable === 1,
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class MetadataStore {
  private cache = new Map<string, TableMeta>(); // 按 name 索引

  constructor(
    private readonly systemDb: Kysely<SystemDB>,
    private readonly businessRaw: Database.Database,
  ) {}

  /** 预热：启动时加载全部 table_meta 到缓存 */
  async warmup(): Promise<void> {
    const rows = await this.systemDb.selectFrom('table_meta').selectAll().execute();
    this.cache.clear();
    for (const r of rows) {
      const meta = rowToMeta(r);
      this.cache.set(meta.name, meta);
    }
  }

  async listMetas(): Promise<TableMeta[]> {
    return [...this.cache.values()];
  }

  async getMeta(id: number): Promise<TableMeta | undefined> {
    for (const m of this.cache.values()) if (m.id === id) return m;
    return undefined;
  }

  async getMetaByName(name: string): Promise<TableMeta | undefined> {
    return this.cache.get(name);
  }

  async createMeta(input: CreateMetaInput): Promise<TableMeta> {
    const now = Date.now();
    const inserted = await this.systemDb
      .insertInto('table_meta')
      .values({
        name: input.name,
        label: input.label,
        primary_key: input.primaryKey,
        fields: JSON.stringify(input.fields),
        is_published: input.isPublished === false ? 0 : 1,
        is_editable: input.isEditable === false ? 0 : 1,
        note: input.note ?? null,
        created_at: now,
        updated_at: now,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    const meta = rowToMeta(inserted);
    this.cache.set(meta.name, meta);
    return meta;
  }

  async updateMeta(
    id: number,
    patch: Partial<Pick<TableMeta, 'label' | 'note' | 'isPublished' | 'isEditable' | 'fields' | 'primaryKey'>>,
  ): Promise<void> {
    const now = Date.now();
    const sets: Record<string, unknown> = { updated_at: now };
    if (patch.label !== undefined) sets['label'] = patch.label;
    if (patch.note !== undefined) sets['note'] = patch.note;
    if (patch.isPublished !== undefined) sets['is_published'] = patch.isPublished ? 1 : 0;
    if (patch.isEditable !== undefined) sets['is_editable'] = patch.isEditable ? 1 : 0;
    if (patch.fields !== undefined) sets['fields'] = JSON.stringify(patch.fields);
    if (patch.primaryKey !== undefined) sets['primary_key'] = patch.primaryKey;

    const updated = await this.systemDb
      .updateTable('table_meta')
      .set(sets)
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirst();
    if (updated) {
      this.cache.set(updated.name, rowToMeta(updated));
    }
  }

  async deleteMeta(id: number): Promise<void> {
    const meta = await this.getMeta(id);
    await this.systemDb.deleteFrom('table_meta').where('id', '=', id).execute();
    if (meta) this.cache.delete(meta.name);
  }

  /** 重新反射业务库 → diff → 保留用户标记（label/isHidden/isReadonly/enumValues）→ 更新 fields */
  async refreshMeta(id: number): Promise<TableMeta> {
    const current = await this.getMeta(id);
    if (!current) throw new Error(`meta ${id} not found`);
    const { fields: reflected, primaryKey } = readTableSchema(this.businessRaw, current.name);

    // 按 name 索引旧字段，保留用户标记
    const oldByName = new Map(current.fields.map((f) => [f.name, f]));
    const merged: FieldMeta[] = reflected.map((rf) => {
      const old = oldByName.get(rf.name);
      if (!old) return rf; // 新字段：纯反射结果（label 默认 = name）
      // 保留用户标记，结构用反射最新值
      return {
        ...rf,
        label: old.label,
        isHidden: old.isHidden,
        isReadonly: old.isReadonly,
        enumValues: old.enumValues,
      };
    });

    await this.updateMeta(id, { fields: merged, primaryKey });
    const after = await this.getMeta(id);
    return after!;
  }
}
```

- [ ] **Step 11.4：运行测试 + typecheck + commit**

Run: `pnpm --filter @1api/engine test && pnpm --filter @1api/engine typecheck`
Expected: PASS / 通过。

```bash
git add -A
git commit -m "feat(engine): metadata store（系统库 CRUD + 缓存 + refreshMeta diff）"
```

---

## Task 12：`engine/src/dynamic-sql.ts`（白名单 + CRUD + 过滤/排序/分页 + incr + datetime 归一）

**Files:**
- Create: `packages/engine/src/dynamic-sql.ts`
- Create: `packages/engine/src/__tests__/dynamic-sql.test.ts`

> 用 kysely `sql` 模板 + `sql.id()` 包裹动态标识符（双引号），支持非 snake_case。所有标识符先经白名单校验。

- [ ] **Step 12.1：写失败测试**

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Errors, type TableMeta } from '@1api/shared';
import { createTestDbs, type TestDbs } from '../test-helpers.js';
import { DynamicSql } from '../dynamic-sql.js';

function meta(over: Partial<TableMeta> = {}): TableMeta {
  return {
    id: 1, name: 'posts', label: '文章', primaryKey: 'id',
    isPublished: true, isEditable: true, note: null, createdAt: 0, updatedAt: 0,
    fields: [
      { name: 'id', label: 'ID', sqliteType: 'INTEGER', jsonType: 'integer', nullable: false, defaultValue: null, isPrimary: true, isAutoIncrement: true, isHidden: false, isReadonly: true },
      { name: 'title', label: '标题', sqliteType: 'TEXT', jsonType: 'string', nullable: false, defaultValue: null, isPrimary: false, isAutoIncrement: false, isHidden: false, isReadonly: false },
      { name: 'views', label: '浏览', sqliteType: 'INTEGER', jsonType: 'integer', nullable: false, defaultValue: 0, isPrimary: false, isAutoIncrement: false, isHidden: false, isReadonly: false },
      { name: 'created_at', label: '创建', sqliteType: 'TEXT', jsonType: 'datetime', nullable: true, defaultValue: null, isPrimary: false, isAutoIncrement: false, isHidden: false, isReadonly: true },
    ],
    ...over,
  };
}

describe('DynamicSql', () => {
  let dbs: TestDbs;
  let dyn: DynamicSql;
  beforeEach(async () => {
    dbs = await createTestDbs();
    dbs.businessRaw.exec('CREATE TABLE posts (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, views INTEGER NOT NULL DEFAULT 0, created_at TEXT)');
    const ins = dbs.businessRaw.prepare('INSERT INTO posts (title, views, created_at) VALUES (?, ?, ?)');
    ins.run('a', 5, '2024-01-01T00:00:00Z');
    ins.run('b', 10, '2024-01-02T00:00:00Z');
    ins.run('c', 10, '2024-01-03 10:00:00'); // SQLite 原生格式
    dyn = new DynamicSql(dbs.businessDb);
  });
  afterEach(async () => {
    await dbs.cleanup();
  });

  describe('selectList', () => {
    it('基础 + 分页 + total', async () => {
      const r = await dyn.selectList(meta(), { page: 1, size: 2 });
      expect(r.rows).toHaveLength(2);
      expect(r.total).toBe(3);
      expect(r.page).toBe(1);
      expect(r.size).toBe(2);
    });

    it('排序 order=id:desc', async () => {
      const r = await dyn.selectList(meta(), { order: 'id:desc' });
      expect(r.rows.map((x: any) => x.id)).toEqual([3, 2, 1]);
    });

    it('过滤 eq / gt / in', async () => {
      expect((await dyn.selectList(meta(), { filters: { views: ['eq', 10] } })).total).toBe(2);
      expect((await dyn.selectList(meta(), { filters: { views: ['gt', 5] } })).total).toBe(2);
      expect((await dyn.selectList(meta(), { filters: { id: ['in', '1,3'] } })).total).toBe(2);
    });

    it('过滤 like', async () => {
      expect((await dyn.selectList(meta(), { filters: { title: ['like', '%a%'] } })).total).toBe(1);
    });

    it('q 模糊（TEXT 非主键 OR LIKE）', async () => {
      expect((await dyn.selectList(meta(), { q: 'b' })).total).toBe(1);
    });

    it('datetime 字段多格式归一为 ISO8601（ISO8601 / SQLite 原生 / Unix 秒 / 毫秒 / 无法解析原样返回）', async () => {
      // 基础数据见 beforeEach（3 行）：
      //   id=1: '2024-01-01T00:00:00Z'  → ISO8601
      //   id=3: '2024-01-03 10:00:00'    → SQLite 原生，按 UTC 拼 Z
      const r3 = await dyn.selectList(meta(), { filters: { id: ['eq', 3] } });
      expect(r3.rows[0]!.created_at).toBe('2024-01-03T10:00:00.000Z');
      const r1 = await dyn.selectList(meta(), { filters: { id: ['eq', 1] } });
      expect(r1.rows[0]!.created_at).toBe('2024-01-01T00:00:00.000Z');

      // 追加 Unix 秒 / 毫秒 / 无法解析 三种
      const ins = dbs.businessRaw.prepare('INSERT INTO posts (title, views, created_at) VALUES (?, ?, ?)');
      ins.run('sec', 0, '1700000000'); // Unix 秒（< 1e12）
      ins.run('ms', 0, '1700000000000'); // Unix 毫秒（> 1e12）
      ins.run('garbage', 0, 'not-a-date');

      const idSec = dbs.businessRaw.prepare('SELECT id FROM posts WHERE title=?').get('sec') as { id: number };
      const idMs = dbs.businessRaw.prepare('SELECT id FROM posts WHERE title=?').get('ms') as { id: number };
      const idBad = dbs.businessRaw.prepare('SELECT id FROM posts WHERE title=?').get('garbage') as { id: number };

      const sec = (await dyn.selectOne(meta(), idSec.id))!.created_at;
      const ms = (await dyn.selectOne(meta(), idMs.id))!.created_at;
      const bad = (await dyn.selectOne(meta(), idBad.id))!.created_at;
      // 1700000000s = 2023-11-14T22:13:20.000Z
      expect(sec).toBe('2023-11-14T22:13:20.000Z');
      expect(ms).toBe('2023-11-14T22:13:20.000Z');
      expect(bad).toBe('not-a-date'); // 无法解析原样返回
    });
  });

  describe('selectOne', () => {
    it('按主键取一条', async () => {
      const row = await dyn.selectOne(meta(), 2);
      expect(row?.title).toBe('b');
    });
    it('不存在返回 undefined', async () => {
      expect(await dyn.selectOne(meta(), 999)).toBeUndefined();
    });
  });

  describe('insertRow / updateRow / deleteRow', () => {
    it('insert 返回新主键', async () => {
      const id = await dyn.insertRow(meta(), { title: 'x', views: 0 });
      expect(id).toBe(4);
    });
    it('update 改字段', async () => {
      await dyn.updateRow(meta(), 1, { views: 100 });
      const row = await dyn.selectOne(meta(), 1);
      expect(row?.views).toBe(100);
    });
    it('delete', async () => {
      await dyn.deleteRow(meta(), 1);
      expect(await dyn.selectOne(meta(), 1)).toBeUndefined();
    });
  });

  describe('incrementField', () => {
    it('integer 自增', async () => {
      await dyn.incrementField(meta(), 1, 'views', 3);
      expect((await dyn.selectOne(meta(), 1))?.views).toBe(8);
    });
  });

  describe('白名单（防注入）', () => {
    it('filters 中未知列名被拒', async () => {
      await expect(dyn.selectList(meta(), { filters: { evil: ['eq', 1] } })).rejects.toThrow(
        /VALIDATION_FAIL|字段不存在/,
      );
    });
    it('非法排序字段被拒', async () => {
      await expect(dyn.selectList(meta(), { order: 'evil:asc' })).rejects.toThrow(
        /VALIDATION_FAIL|字段不存在/,
      );
    });
  });
});
```

- [ ] **Step 12.2：运行确认失败**

Run: `pnpm --filter @1api/engine test`
Expected: FAIL。

- [ ] **Step 12.3：实现 `packages/engine/src/dynamic-sql.ts`**

> 用 kysely 官方 `sql.join(parts, sql.raw(' AND '))` 组合子句（替代手写 reduce），标识符一律 `sql.id()`（双引号包裹）。时间戳约定：表若含 `created_at`/`updated_at` 字段（INTEGER，由 createModel 在 schema-ddl 建表时生成），insert 时 engine 填 `Date.now()`、update 时刷新 `updated_at`（SQLite 无 `ON UPDATE`，由本层负责）——见 overview §1.3 时间戳约定。

```ts
import { type Kysely, sql } from 'kysely';
import {
  DEFAULT_PAGE,
  DEFAULT_SIZE,
  Errors,
  MAX_SIZE,
  type FieldMeta,
  type ListOptions,
  type ListResult,
  type TableMeta,
} from '@1api/shared';

type Row = Record<string, unknown>;
type SqlFragment = ReturnType<typeof sql>;

const TIMESTAMP_CREATED = 'created_at';
const TIMESTAMP_UPDATED = 'updated_at';

/** 校验字段在 meta 白名单中 */
export function assertFieldExists(meta: TableMeta, name: string): FieldMeta {
  const f = meta.fields.find((x) => x.name === name);
  if (!f) throw Errors.validationFail(`字段不存在: ${name}`);
  return f;
}

/** 解析 order 字符串 → [{field, dir}]，全部字段经白名单 */
interface OrderClause {
  field: string;
  dir: 'ASC' | 'DESC';
}
function parseOrder(meta: TableMeta, order?: string): OrderClause[] {
  if (!order) return [];
  const out: OrderClause[] = [];
  for (const part of order.split(',')) {
    const seg = part.trim();
    if (!seg) continue;
    const [field, dirRaw] = seg.split(':');
    if (!field) continue;
    assertFieldExists(meta, field); // 白名单
    const dir = (dirRaw ?? 'asc').toLowerCase() === 'desc' ? 'DESC' : 'ASC';
    out.push({ field, dir });
  }
  return out;
}

/** datetime 值归一为 ISO8601；失败原样返回（业务库多格式适配） */
export function normalizeDatetime(value: unknown): unknown {
  if (typeof value !== 'string' || value === '') return value;
  // 3. 纯数字（Unix 秒/毫秒启发式：>1e12 视为毫秒）
  if (/^\d+$/.test(value)) {
    const n = Number(value);
    const ms = n > 1e12 ? n : n * 1000;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? value : d.toISOString();
  }
  // 2. SQLite 原生 'YYYY-MM-DD HH:MM:SS' → 按 UTC 拼接 Z
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}/.test(value)) {
    const iso = value.replace(' ', 'T');
    const withTz = /[zZ]|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : `${iso}Z`;
    const d = new Date(withTz);
    return Number.isNaN(d.getTime()) ? value : d.toISOString();
  }
  // 1. ISO8601（含 T/Z）或 Date 可解析
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toISOString();
}

/** 对行中的 datetime 字段做归一 */
function transformRow(meta: TableMeta, row: Row): Row {
  for (const f of meta.fields) {
    if (f.jsonType === 'datetime' && row[f.name] !== undefined) {
      row[f.name] = normalizeDatetime(row[f.name]);
    }
  }
  return row;
}

/** 双引号包裹标识符（支持非 snake_case） */
function col(name: string) {
  return sql.id(name);
}

/** 是否含自动时间戳字段 */
function hasTimestamps(meta: TableMeta): boolean {
  return meta.fields.some((f) => f.name === TIMESTAMP_CREATED || f.name === TIMESTAMP_UPDATED);
}

export class DynamicSql {
  constructor(private readonly businessDb: Kysely<Record<string, never>>) {}

  /** SELECT 列表 + WHERE + ORDER + LIMIT/OFFSET + COUNT */
  async selectList(meta: TableMeta, opts: ListOptions): Promise<ListResult<Row>> {
    const page = Math.max(opts.page ?? DEFAULT_PAGE, 1);
    const size = Math.min(Math.max(opts.size ?? DEFAULT_SIZE, 1), MAX_SIZE);
    const offset = (page - 1) * size;
    const table = sql.id(meta.name);

    const whereParts: SqlFragment[] = [];

    // filters
    if (opts.filters) {
      for (const [name, [op, value]] of Object.entries(opts.filters)) {
        const field = assertFieldExists(meta, name);
        whereParts.push(this.buildFilterClause(field, op, value));
      }
    }
    // q：所有 TEXT/非主键字段 OR LIKE
    if (opts.q) {
      const qFields = meta.fields.filter((f) => f.sqliteType === 'TEXT' && !f.isPrimary);
      if (qFields.length > 0) {
        const likes = qFields.map((f) => sql`${col(f.name)} LIKE ${'%' + opts.q + '%'}`);
        whereParts.push(sql.join(likes, sql.raw(' OR ')));
      }
    }

    const whereClause: SqlFragment =
      whereParts.length > 0 ? sql` WHERE ${sql.join(whereParts, sql.raw(' AND '))}` : sql``;

    // COUNT
    const countSql = sql<{ total: number }>`SELECT COUNT(*) AS total FROM ${table}${whereClause}`;
    const countRes = await countSql.execute(this.businessDb);
    const total = Number(countRes.rows[0]?.total ?? 0);

    // DATA
    const orderClauses = parseOrder(meta, opts.order);
    const orderBy: SqlFragment =
      orderClauses.length > 0
        ? sql` ORDER BY ${sql.join(
            orderClauses.map((o) => sql`${col(o.field)} ${sql.raw(o.dir)}`),
            sql.raw(', '),
          )}`
        : sql``;

    const dataSql = sql<Row>`SELECT * FROM ${table}${whereClause}${orderBy} LIMIT ${size} OFFSET ${offset}`;
    const dataRes = await dataSql.execute(this.businessDb);
    const rows = dataRes.rows.map((r) => transformRow(meta, { ...r }));

    return { rows, total, page, size };
  }

  async selectOne(meta: TableMeta, pk: unknown): Promise<Row | undefined> {
    const res = await sql<Row>`SELECT * FROM ${sql.id(meta.name)} WHERE ${col(meta.primaryKey)} = ${pk}`
      .execute(this.businessDb);
    const row = res.rows[0];
    return row ? transformRow(meta, { ...row }) : undefined;
  }

  async insertRow(meta: TableMeta, data: Record<string, unknown>): Promise<unknown> {
    // 只接受 meta 白名单内、且非只读时间戳（由本层填）的字段
    const cols = Object.keys(data).filter(
      (k) => meta.fields.some((f) => f.name === k) && k !== TIMESTAMP_CREATED && k !== TIMESTAMP_UPDATED,
    );
    if (cols.length === 0) throw Errors.validationFail('无可写入字段');

    // 时间戳约定：建表含 created_at/updated_at 时由 engine 填 Date.now()
    if (hasTimestamps(meta)) {
      const now = Date.now();
      if (meta.fields.some((f) => f.name === TIMESTAMP_CREATED) && data[TIMESTAMP_CREATED] === undefined) {
        cols.push(TIMESTAMP_CREATED);
        data[TIMESTAMP_CREATED] = now;
      }
      if (meta.fields.some((f) => f.name === TIMESTAMP_UPDATED) && data[TIMESTAMP_UPDATED] === undefined) {
        cols.push(TIMESTAMP_UPDATED);
        data[TIMESTAMP_UPDATED] = now;
      }
    }

    const colNodes = sql.join(cols.map((c) => col(c)), sql.raw(', '));
    const valNodes = sql.join(
      cols.map((c) => sql`${data[c]}`),
      sql.raw(', '),
    );
    const res = await sql<Row>`INSERT INTO ${sql.id(meta.name)} (${colNodes}) VALUES (${valNodes}) RETURNING ${col(
      meta.primaryKey,
    )}`.execute(this.businessDb);
    const inserted = res.rows[0];
    if (inserted && inserted[meta.primaryKey] !== undefined) return inserted[meta.primaryKey];
    // 兜底：last_insert_rowid()
    const r = await sql<{ id: number }>`SELECT last_insert_rowid() AS id`.execute(this.businessDb);
    return r.rows[0]?.id;
  }

  async updateRow(meta: TableMeta, pk: unknown, patch: Record<string, unknown>): Promise<void> {
    // 只读字段忽略（如 created_at/updated_at 由本层管理）；updated_at 由本层刷新
    const sets = Object.keys(patch).filter((k) => {
      const f = meta.fields.find((x) => x.name === k);
      return f && !f.isReadonly;
    });
    if (sets.length === 0 && !meta.fields.some((f) => f.name === TIMESTAMP_UPDATED)) return;

    const setNodes: SqlFragment[] = sets.map((c) => sql`${col(c)} = ${patch[c]}`);
    // 刷新 updated_at（SQLite 无 ON UPDATE，由 engine 负责）
    if (meta.fields.some((f) => f.name === TIMESTAMP_UPDATED)) {
      setNodes.push(sql`${col(TIMESTAMP_UPDATED)} = ${Date.now()}`);
    }
    if (setNodes.length === 0) return;
    const setNode = sql.join(setNodes, sql.raw(', '));
    await sql`UPDATE ${sql.id(meta.name)} SET ${setNode} WHERE ${col(meta.primaryKey)} = ${pk}`.execute(
      this.businessDb,
    );
  }

  async deleteRow(meta: TableMeta, pk: unknown): Promise<void> {
    await sql`DELETE FROM ${sql.id(meta.name)} WHERE ${col(meta.primaryKey)} = ${pk}`.execute(
      this.businessDb,
    );
  }

  async incrementField(meta: TableMeta, pk: unknown, field: string, n: number): Promise<void> {
    const f = assertFieldExists(meta, field);
    if (f.jsonType !== 'integer' && f.jsonType !== 'number') {
      throw Errors.validationFail(`字段 ${field} 非数值类型，不可自增`);
    }
    await sql`UPDATE ${sql.id(meta.name)} SET ${col(field)} = ${col(field)} + ${n} WHERE ${col(
      meta.primaryKey,
    )} = ${pk}`.execute(this.businessDb);
  }

  // —— 内部：过滤子句 ——

  private buildFilterClause(field: FieldMeta, op: string, value: unknown): SqlFragment {
    const name = col(field.name);
    switch (op) {
      case 'eq':
        return sql`${name} = ${value}`;
      case 'ne':
        return sql`${name} <> ${value}`;
      case 'gt':
        return sql`${name} > ${value}`;
      case 'gte':
        return sql`${name} >= ${value}`;
      case 'lt':
        return sql`${name} < ${value}`;
      case 'lte':
        return sql`${name} <= ${value}`;
      case 'like':
        return sql`${name} LIKE ${value}`;
      case 'in': {
        const arr = String(value)
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s.length > 0);
        if (arr.length === 0) throw Errors.validationFail('in 操作符值非法');
        const nodes = sql.join(arr.map((a) => sql`${a}`), sql.raw(', '));
        return sql`${name} IN (${nodes})`;
      }
      default:
        throw Errors.validationFail(`不支持的过滤操作符: ${op}`);
    }
  }
}
```

- [ ] **Step 12.4：运行测试 + typecheck + commit**

Run: `pnpm --filter @1api/engine test && pnpm --filter @1api/engine typecheck`
Expected: PASS / 通过。

> 若 `sql.join(parts, sql.raw(sep))` 在 TS 里提示泛型不匹配，将 `SqlFragment` 局部别名调整为 `import('kysely').RawBuilder<unknown>` 或对 parts 数组显式标注为 `ReturnType<typeof sql>[]`。子句拼接逻辑不变。

```bash
git add -A
git commit -m "feat(engine): dynamic-sql（白名单 + CRUD + 过滤/排序/分页 + incr + datetime 归一）"
```

---

## Task 13：`engine/src/data-service.ts`（组合层 + internal 选项 + incr 校验）

**Files:**
- Create: `packages/engine/src/data-service.ts`
- Create: `packages/engine/src/__tests__/data-service.test.ts`

- [ ] **Step 13.1：写失败测试**

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Errors, type TableMeta } from '@1api/shared';
import { createTestDbs, type TestDbs } from '../test-helpers.js';
import { SYSTEM_DB_MIGRATIONS } from '../system-db.js';
import { MetadataStore } from '../metadata.js';
import { DynamicSql } from '../dynamic-sql.js';
import { DataService } from '../data-service.js';

function meta(over: Partial<TableMeta> = {}): TableMeta {
  return {
    id: 1, name: 'posts', label: '文章', primaryKey: 'id',
    isPublished: true, isEditable: true, note: null, createdAt: 0, updatedAt: 0,
    fields: [
      { name: 'id', label: 'ID', sqliteType: 'INTEGER', jsonType: 'integer', nullable: false, defaultValue: null, isPrimary: true, isAutoIncrement: true, isHidden: false, isReadonly: true },
      { name: 'title', label: '标题', sqliteType: 'TEXT', jsonType: 'string', nullable: false, defaultValue: null, isPrimary: false, isAutoIncrement: false, isHidden: false, isReadonly: false },
      { name: 'views', label: '浏览', sqliteType: 'INTEGER', jsonType: 'integer', nullable: false, defaultValue: 0, isPrimary: false, isAutoIncrement: false, isHidden: false, isReadonly: false },
    ],
    ...over,
  };
}

describe('DataService', () => {
  let dbs: TestDbs;
  let svc: DataService;
  beforeEach(async () => {
    dbs = await createTestDbs();
    for (const m of SYSTEM_DB_MIGRATIONS) dbs.systemRaw.exec(m);
    dbs.businessRaw.exec('CREATE TABLE posts (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, views INTEGER NOT NULL DEFAULT 0)');
    dbs.businessRaw.prepare('INSERT INTO posts (title, views) VALUES (?, ?)').run('a', 1);
    const store = new MetadataStore(dbs.systemDb, dbs.businessRaw);
    const dyn = new DynamicSql(dbs.businessDb);
    svc = new DataService(store, dyn);
  });
  afterEach(async () => {
    await dbs.cleanup();
  });

  // service 通过 store.getMetaByName 取 meta；测试里先把 posts 入库
  async function seedMeta(over: Partial<TableMeta> = {}) {
    const store = (svc as any).store as MetadataStore;
    return store.createMeta({
      name: 'posts', label: '文章', primaryKey: 'id',
      fields: meta(over).fields,
      isPublished: over.isPublished ?? true,
      isEditable: over.isEditable ?? true,
    });
  }

  describe('is_published / is_editable 约束', () => {
    it('list 未发布表（默认）→ TABLE_NOT_FOUND；internal:true → 放行', async () => {
      await seedMeta({ isPublished: false });
      await expect(svc.list('posts')).rejects.toThrow();
      const r = await svc.list('posts', {}, { internal: true });
      expect(r.total).toBe(1);
    });
    it('create 不可编辑表（默认）→ TABLE_NOT_EDITABLE；internal:true → 放行', async () => {
      await seedMeta({ isEditable: false });
      await expect(svc.create('posts', { title: 'x' })).rejects.toThrow(
        Errors.tableNotEditable('posts'),
      );
      const id = await svc.create('posts', { title: 'x' }, { internal: true });
      expect(id).toBeDefined();
    });
  });

  describe('incr 校验', () => {
    it('integer 字段自增 OK', async () => {
      await seedMeta();
      await svc.incr('posts', 1, 'views', 5);
      const row = await svc.get('posts', 1);
      expect(row?.views).toBe(6);
    });
    it('对 TEXT 字段自增 → VALIDATION_FAIL', async () => {
      await seedMeta();
      await expect(svc.incr('posts', 1, 'title', 1)).rejects.toThrow(Errors.validationFail(''));
    });
  });

  describe('时间戳自动维护（engine 填 Date.now()）', () => {
    it('insert 时 created_at/updated_at 被填入；update 时 updated_at 刷新', async () => {
      // 用含时间戳的表
      dbs.businessRaw.exec(
        'CREATE TABLE logs (id INTEGER PRIMARY KEY AUTOINCREMENT, msg TEXT, created_at INTEGER, updated_at INTEGER)',
      );
      const store = (svc as any).store as MetadataStore;
      await store.createMeta({
        name: 'logs', label: '日志', primaryKey: 'id',
        fields: [
          { name: 'id', label: 'id', sqliteType: 'INTEGER', jsonType: 'integer', nullable: false, defaultValue: null, isPrimary: true, isAutoIncrement: true, isHidden: false, isReadonly: true },
          { name: 'msg', label: 'msg', sqliteType: 'TEXT', jsonType: 'string', nullable: true, defaultValue: null, isPrimary: false, isAutoIncrement: false, isHidden: false, isReadonly: false },
          { name: 'created_at', label: 'created_at', sqliteType: 'INTEGER', jsonType: 'datetime', nullable: true, defaultValue: null, isPrimary: false, isAutoIncrement: false, isHidden: false, isReadonly: true },
          { name: 'updated_at', label: 'updated_at', sqliteType: 'INTEGER', jsonType: 'datetime', nullable: true, defaultValue: null, isPrimary: false, isAutoIncrement: false, isHidden: false, isReadonly: true },
        ],
      });
      const before = Date.now();
      const row = await svc.create('logs', { msg: 'hi' }, { internal: true });
      const created = Number(row.created_at);
      const updated0 = Number(row.updated_at);
      expect(created).toBeGreaterThanOrEqual(before);
      expect(updated0).toBe(created);

      // 等 1ms 后 update，updated_at 应变大
      await new Promise((r) => setTimeout(r, 5));
      await svc.update('logs', row.id, { msg: 'hi2' }, { internal: true });
      const after = await svc.get('logs', row.id, { internal: true });
      expect(Number(after!.updated_at)).toBeGreaterThan(updated0);
      // created_at 不变
      expect(Number(after!.created_at)).toBe(created);
    });
  });

  describe('describe', () => {
    it('返回 TableMeta', async () => {
      await seedMeta();
      const m = await svc.describe('posts');
      expect(m.name).toBe('posts');
    });
    it('未知表 → TABLE_NOT_FOUND', async () => {
      await expect(svc.describe('nope')).rejects.toThrow(Errors.tableNotFound('nope'));
    });
  });
});
```

- [ ] **Step 13.2：运行确认失败**

Run: `pnpm --filter @1api/engine test`
Expected: FAIL。

- [ ] **Step 13.3：实现 `packages/engine/src/data-service.ts`**

```ts
import {
  Errors,
  type ListOptions,
  type ListResult,
  type TableMeta,
} from '@1api/shared';
import { DynamicSql } from './dynamic-sql.js';
import { MetadataStore } from './metadata.js';

export interface DataServiceOptions {
  /** true = 跳过 is_published/is_editable 校验（管理通道用）。默认 false。不绕过白名单等注入防护。 */
  internal?: boolean;
}

type Row = Record<string, unknown>;

export class DataService {
  constructor(
    private readonly store: MetadataStore,
    private readonly dyn: DynamicSql,
  ) {}

  /** 取 meta + is_published 校验（对外通道）。internal 跳过。 */
  private async resolveForRead(table: string, opts: DataServiceOptions): Promise<TableMeta> {
    const meta = await this.store.getMetaByName(table);
    if (!meta) throw Errors.tableNotFound(table);
    if (!opts.internal && !meta.isPublished) throw Errors.tableNotFound(table);
    return meta;
  }

  /** 取 meta + is_editable 校验（对外写通道）。internal 跳过。 */
  private async resolveForWrite(table: string, opts: DataServiceOptions): Promise<TableMeta> {
    const meta = await this.resolveForRead(table, opts);
    if (!opts.internal && !meta.isEditable) throw Errors.tableNotEditable(table);
    return meta;
  }

  async describe(table: string, opts: DataServiceOptions = {}): Promise<TableMeta> {
    // describe 仅需存在性（不强制 is_published，便于管理通道预览）
    const meta = await this.store.getMetaByName(table);
    if (!meta) throw Errors.tableNotFound(table);
    void opts;
    return meta;
  }

  async list(
    table: string,
    options: ListOptions = {},
    svcOpts: DataServiceOptions = {},
  ): Promise<ListResult<Row>> {
    const meta = await this.resolveForRead(table, svcOpts);
    return this.dyn.selectList(meta, options);
  }

  async get(table: string, pk: unknown, opts: DataServiceOptions = {}): Promise<Row | undefined> {
    const meta = await this.resolveForRead(table, opts);
    return this.dyn.selectOne(meta, pk);
  }

  async create(
    table: string,
    data: Record<string, unknown>,
    opts: DataServiceOptions = {},
  ): Promise<Row> {
    const meta = await this.resolveForWrite(table, opts);
    const id = await this.dyn.insertRow(meta, data);
    const row = await this.dyn.selectOne(meta, id);
    if (!row) throw Errors.internalError('创建后回查失败');
    return row;
  }

  async update(
    table: string,
    pk: unknown,
    patch: Record<string, unknown>,
    opts: DataServiceOptions = {},
  ): Promise<void> {
    const meta = await this.resolveForWrite(table, opts);
    await this.dyn.updateRow(meta, pk, patch);
  }

  async delete(table: string, pk: unknown, opts: DataServiceOptions = {}): Promise<void> {
    const meta = await this.resolveForWrite(table, opts);
    await this.dyn.deleteRow(meta, pk);
  }

  async incr(
    table: string,
    pk: unknown,
    field: string,
    n: number,
    opts: DataServiceOptions = {},
  ): Promise<void> {
    const meta = await this.resolveForWrite(table, opts);
    await this.dyn.incrementField(meta, pk, field, n);
  }
}
```

- [ ] **Step 13.4：运行测试 + typecheck + commit**

Run: `pnpm --filter @1api/engine test && pnpm --filter @1api/engine typecheck`
Expected: PASS / 通过。

```bash
git add -A
git commit -m "feat(engine): data-service（组合层 + internal 选项 + incr 类型校验）"
```

---

## Task 14：`engine/src/schema-service.ts`（import/create/addField/refresh + 名称校验）

**Files:**
- Create: `packages/engine/src/schema-service.ts`
- Create: `packages/engine/src/__tests__/schema-service.test.ts`

- [ ] **Step 14.1：写失败测试**

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Errors } from '@1api/shared';
import { createTestDbs, type TestDbs } from '../test-helpers.js';
import { SYSTEM_DB_MIGRATIONS } from '../system-db.js';
import { MetadataStore } from '../metadata.js';
import { SchemaService } from '../schema-service.js';

describe('SchemaService', () => {
  let dbs: TestDbs;
  let svc: SchemaService;
  beforeEach(async () => {
    dbs = await createTestDbs();
    for (const m of SYSTEM_DB_MIGRATIONS) dbs.systemRaw.exec(m);
    const store = new MetadataStore(dbs.systemDb, dbs.businessRaw);
    svc = new SchemaService(dbs.businessRaw, store);
  });
  afterEach(async () => {
    await dbs.cleanup();
  });

  describe('importExisting', () => {
    it('正常导入单主键表（label 留空待填）', async () => {
      dbs.businessRaw.exec('CREATE TABLE FooBar (id INTEGER PRIMARY KEY, name TEXT)');
      const meta = await svc.importExisting('FooBar');
      expect(meta.name).toBe('FooBar'); // 保留实际表名
      expect(meta.label).toBe(''); // 留空待填
      expect(meta.primaryKey).toBe('id');
    });
    it('无主键表 → 透传 TABLE_NO_PRIMARY_KEY', async () => {
      dbs.businessRaw.exec('CREATE TABLE t (a INTEGER, b INTEGER)');
      await expect(svc.importExisting('t')).rejects.toThrow(Errors.tableNoPrimaryKey('t'));
    });
    it('复合主键表 → 透传 TABLE_COMPOSITE_PRIMARY_KEY', async () => {
      dbs.businessRaw.exec('CREATE TABLE t (a INTEGER, b INTEGER, PRIMARY KEY(a,b))');
      await expect(svc.importExisting('t')).rejects.toThrow(Errors.tableCompositePrimaryKey('t'));
    });
    it('表不存在 → TABLE_NOT_FOUND', async () => {
      await expect(svc.importExisting('nope')).rejects.toThrow(Errors.tableNotFound('nope'));
    });
    it('重复导入 → TABLE_ALREADY_EXISTS', async () => {
      dbs.businessRaw.exec('CREATE TABLE t (id INTEGER PRIMARY KEY)');
      await svc.importExisting('t');
      await expect(svc.importExisting('t')).rejects.toThrow(Errors.tableAlreadyExists('t'));
    });
  });

  describe('createModel 名称校验', () => {
    it('合法名建表 + 读回真实结构 + 存元数据', async () => {
      const meta = await svc.createModel({
        name: 'posts', label: '文章',
        fields: [{ name: 'title', jsonType: 'string', nullable: false }],
        autoTimestamps: true,
      });
      expect(meta.name).toBe('posts');
      expect(meta.fields.map((f) => f.name)).toEqual(['id', 'title', 'created_at', 'updated_at']);
    });
    it('大写名 → INVALID_NAME', async () => {
      await expect(svc.createModel({ name: 'Posts', label: 'X', fields: [] })).rejects.toThrow(
        Errors.invalidName('Posts'),
      );
    });
    it('数字开头 → INVALID_NAME', async () => {
      await expect(svc.createModel({ name: '1posts', label: 'X', fields: [] })).rejects.toThrow(
        Errors.invalidName('1posts'),
      );
    });
    it('保留字 schema → RESERVED_NAME', async () => {
      await expect(svc.createModel({ name: 'schema', label: 'X', fields: [] })).rejects.toThrow(
        Errors.reservedName('schema'),
      );
    });
  });

  describe('addField', () => {
    it('追加字段 + refresh', async () => {
      dbs.businessRaw.exec('CREATE TABLE t (id INTEGER PRIMARY KEY)');
      await svc.importExisting('t');
      await svc.addField('t', { name: 'age', jsonType: 'integer', nullable: true });
      const after = await svc.refresh('t');
      expect(after.fields.map((f) => f.name)).toEqual(['id', 'age']);
    });
    it('非法字段名 → INVALID_NAME', async () => {
      dbs.businessRaw.exec('CREATE TABLE t (id INTEGER PRIMARY KEY)');
      await svc.importExisting('t');
      await expect(svc.addField('t', { name: 'Age', jsonType: 'integer' })).rejects.toThrow(
        Errors.invalidName('Age'),
      );
    });
  });

  describe('refresh', () => {
    it('业务库演进后元数据同步', async () => {
      dbs.businessRaw.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, a TEXT)');
      await svc.importExisting('t');
      dbs.businessRaw.exec('ALTER TABLE t ADD COLUMN b TEXT');
      const after = await svc.refresh('t');
      expect(after.fields.map((f) => f.name)).toEqual(['id', 'a', 'b']);
    });
  });
});
```

- [ ] **Step 14.2：运行确认失败**

Run: `pnpm --filter @1api/engine test`
Expected: FAIL。

- [ ] **Step 14.3：实现 `packages/engine/src/schema-service.ts`**

```ts
import type Database from 'better-sqlite3';
import { Errors, isReservedName, isValidName, type TableMeta } from '@1api/shared';
import { addColumn, createTable, inputToField } from './schema-ddl.js';
import { listTables, readTableSchema } from './schema-reader.js';
import { MetadataStore } from './metadata.js';

export class SchemaService {
  constructor(
    private readonly businessRaw: Database.Database,
    private readonly store: MetadataStore,
  ) {}

  /** 导入已有表：listTables 确认 → readTableSchema（无/复合主键透传）→ createMeta（label 留空）。表名不强制正则。 */
  async importExisting(name: string): Promise<TableMeta> {
    const tables = listTables(this.businessRaw);
    if (!tables.includes(name)) throw Errors.tableNotFound(name);
    if ((await this.store.getMetaByName(name))) throw Errors.tableAlreadyExists(name);

    const { fields, primaryKey } = readTableSchema(this.businessRaw, name); // 主键策略在此抛错并透传
    return this.store.createMeta({ name, label: '', primaryKey, fields });
  }

  /** 新建模型：name 强制正则 + 非保留字 → createTable → readTableSchema（读回真实结构）→ createMeta */
  async createModel(opts: {
    name: string;
    label: string;
    fields: Parameters<typeof inputToField>[0][];
    note?: string | null;
    autoTimestamps?: boolean;
  }): Promise<TableMeta> {
    this.assertCreatableName(opts.name);
    if ((await this.store.getMetaByName(opts.name))) throw Errors.tableAlreadyExists(opts.name);
    if (listTables(this.businessRaw).includes(opts.name)) {
      throw Errors.tableAlreadyExists(opts.name);
    }

    createTable(this.businessRaw, opts);
    const { fields, primaryKey } = readTableSchema(this.businessRaw, opts.name); // 读回真实结构
    return this.store.createMeta({
      name: opts.name,
      label: opts.label,
      primaryKey,
      fields,
      note: opts.note,
    });
  }

  /** 追加字段：field.name 强制正则 → addColumn（DDL）→ refreshMeta */
  async addField(
    table: string,
    field: Parameters<typeof inputToField>[0],
  ): Promise<TableMeta> {
    this.assertCreatableName(field.name);
    const meta = await this.store.getMetaByName(table);
    if (!meta) throw Errors.tableNotFound(table);
    if (meta.fields.some((f) => f.name === field.name)) {
      throw Errors.validationFail(`字段已存在: ${field.name}`);
    }
    addColumn(this.businessRaw, table, inputToField(field));
    return this.store.refreshMeta(meta.id);
  }

  /** 刷新元数据（重新反射 + diff） */
  async refresh(table: string): Promise<TableMeta> {
    const meta = await this.store.getMetaByName(table);
    if (!meta) throw Errors.tableNotFound(table);
    return this.store.refreshMeta(meta.id);
  }

  /** 新建模型/字段用的严格名称校验：正则 + 保留字 */
  private assertCreatableName(name: string): void {
    if (!isValidName(name)) {
      // 区分：保留字 vs 非法格式
      if (isReservedName(name) && /^[a-z]/.test(name)) throw Errors.reservedName(name);
      throw Errors.invalidName(name);
    }
  }
}
```

- [ ] **Step 14.4：运行测试 + typecheck + commit**

Run: `pnpm --filter @1api/engine test && pnpm --filter @1api/engine typecheck`
Expected: PASS / 通过。

```bash
git add -A
git commit -m "feat(engine): schema-service（import/create/addField/refresh + 名称校验）"
```

---

## Task 15：`engine/src/engine.ts`（DataEngine 装配 + createEngine 工厂 + 缓存预热）+ 包入口

**Files:**
- Create: `packages/engine/src/engine.ts`
- Create: `packages/engine/src/index.ts`
- Create: `packages/engine/src/__tests__/engine.test.ts`

- [ ] **Step 15.1：写失败测试**

```ts
import { rmSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createEngine } from '../engine.js';

describe('createEngine + DataEngine', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), '1api-engine-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('从路径创建 + 系统库建 table_meta + 缓存预热（空）', async () => {
    const engine = await createEngine({
      businessDbPath: join(dir, 'biz.db'),
      systemDbPath: join(dir, 'sys.db'),
    });
    // 空库预热：list 返回空
    expect(await engine.data.list('__any__', {}, { internal: true }).catch(() => 'err')).toBe('err');
    // schema.import 一张表，data.list 能读到
    engine.businessRaw.exec('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)');
    await engine.schema.importExisting('users');
    const r = await engine.data.list('users', {}, { internal: true });
    expect(r.total).toBe(0);
    await engine.destroy();
  });

  it('describe 返回导入表元数据', async () => {
    const engine = await createEngine({
      businessDbPath: join(dir, 'biz.db'),
      systemDbPath: join(dir, 'sys.db'),
    });
    engine.businessRaw.exec('CREATE TABLE posts (id INTEGER PRIMARY KEY, title TEXT)');
    await engine.schema.importExisting('posts');
    const m = await engine.data.describe('posts');
    expect(m.name).toBe('posts');
    await engine.destroy();
  });
});
```

> 需补 `import { beforeEach } from 'vitest';`。

- [ ] **Step 15.2：运行确认失败**

Run: `pnpm --filter @1api/engine test`
Expected: FAIL。

- [ ] **Step 15.3：实现 `packages/engine/src/engine.ts`**

```ts
import Database from 'better-sqlite3';
import { Kysely, SqliteDialect } from 'kysely';
import { DataService } from './data-service.js';
import { DynamicSql } from './dynamic-sql.js';
import { MetadataStore } from './metadata.js';
import { SchemaService } from './schema-service.js';
import { SYSTEM_DB_MIGRATIONS, type SystemDB } from './system-db.js';

export interface CreateEngineOptions {
  businessDbPath: string;
  systemDbPath: string;
}

export class DataEngine {
  readonly data: DataService;
  readonly schema: SchemaService;
  readonly metadata: MetadataStore;
  /** 暴露原生业务库句柄（迁移/测试建表用） */
  readonly businessRaw: Database.Database;

  constructor(
    businessRaw: Database.Database,
    businessDb: Kysely<Record<string, never>>,
    systemDb: Kysely<SystemDB>,
  ) {
    this.businessRaw = businessRaw;
    this.metadata = new MetadataStore(systemDb, businessRaw);
    const dyn = new DynamicSql(businessDb);
    this.data = new DataService(this.metadata, dyn);
    this.schema = new SchemaService(businessRaw, this.metadata);
  }

  async destroy(): Promise<void> {
    // 由 createEngine 持有连接句柄，destroy 在 createEngine 闭包内处理
  }
}

/** 工厂：创建连接 + 系统库迁移 + 缓存预热 + 返回 DataEngine */
export async function createEngine(opts: CreateEngineOptions): Promise<DataEngine & { destroy(): Promise<void> }> {
  const businessRaw = new Database(opts.businessDbPath);
  businessRaw.pragma('journal_mode = WAL');
  const systemRaw = new Database(opts.systemDbPath);

  // 系统库迁移（Phase 1 仅 table_meta）
  for (const m of SYSTEM_DB_MIGRATIONS) systemRaw.exec(m);

  const businessDb = new Kysely<Record<string, never>>({
    dialect: new SqliteDialect({ database: businessRaw }),
  });
  const systemDb = new Kysely<SystemDB>({
    dialect: new SqliteDialect({ database: systemRaw }),
  });

  const engine = new DataEngine(businessRaw, businessDb, systemDb);
  await engine.metadata.warmup(); // 缓存预热

  return Object.assign(engine, {
    async destroy() {
      await businessDb.destroy();
      await systemDb.destroy();
    },
  });
}
```

- [ ] **Step 15.4：实现 `packages/engine/src/index.ts`（包入口）**

```ts
export { DataEngine, createEngine } from './engine.js';
export type { CreateEngineOptions } from './engine.js';
export { SchemaService } from './schema-service.js';
export { DataService } from './data-service.js';
export type { DataServiceOptions } from './data-service.js';
export { MetadataStore } from './metadata.js';
export { DynamicSql } from './dynamic-sql.js';
export { readTableSchema, listTables } from './schema-reader.js';
export { createTable, addColumn } from './schema-ddl.js';
export type { SystemDB, TableMetaRow } from './system-db.js';
```

- [ ] **Step 15.5：运行测试 + typecheck + commit**

Run: `pnpm --filter @1api/engine test && pnpm --filter @1api/engine typecheck`
Expected: PASS / 通过。

```bash
git add -A
git commit -m "feat(engine): DataEngine 装配 + createEngine 工厂（迁移 + 缓存预热）"
```

---

## Task 16：根脚本贯通 + 全量验收

**Files:**
- Modify: `package.json`（根，已在 Task 0 建，确认 scripts 完整）

- [ ] **Step 16.1：全量 typecheck**

Run: `pnpm -r typecheck`
Expected: shared 与 engine 均通过。

- [ ] **Step 16.2：全量测试 + 覆盖率**

Run: `pnpm -r test`
Expected: 全部 PASS。覆盖率 thresholds（core 逻辑 > 90%）达标。

> 若某文件覆盖率不达标，补针对性单测（优先 parsers/mapping/dynamic-sql/metadata 的分支），不放宽阈值。

- [ ] **Step 16.3：全量 build**

Run: `pnpm -r build`
Expected: shared → engine 依拓扑序构建，`packages/*/dist` 生成。

- [ ] **Step 16.4：lint**

Run: `pnpm lint`
Expected: 无 error（warn 可接受）。

- [ ] **Step 16.5：人工冒烟（覆盖验收标准里的端到端场景）**

Run（在临时目录跑一段脚本，可用 `pnpm --filter @1api/engine exec tsx` 或写一次性脚本）：

```ts
// smoke.ts（可临时置于 packages/engine 下，跑完删）
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEngine } from './src/index.js';

const dir = mkdtempSync(join(tmpdir(), '1api-smoke-'));
const engine = await createEngine({
  businessDbPath: join(dir, 'biz.db'),
  systemDbPath: join(dir, 'sys.db'),
});
// 1. 导入已有表
engine.businessRaw.exec('CREATE TABLE legacy (id INTEGER PRIMARY KEY, name TEXT)');
const m1 = await engine.schema.importExisting('legacy');
console.log('imported', m1.name, m1.fields.map((f) => f.name));
// 2. 新建模型
const m2 = await engine.schema.createModel({
  name: 'posts', label: '文章',
  fields: [{ name: 'title', jsonType: 'string', nullable: false }],
  autoTimestamps: true,
});
console.log('created', m2.name, m2.fields.map((f) => f.name));
// 3. CRUD
const created = await engine.data.create('posts', { title: 'hello' }, { internal: true });
console.log('created row', created);
await engine.data.incr('posts', created.id, 'id', 0, { internal: true }).catch(() => {});
const list = await engine.data.list('posts', { order: 'id:desc' }, { internal: true });
console.log('list', list.total);
// 4. schema 演进
await engine.schema.addField('posts', { name: 'views', jsonType: 'integer', nullable: true });
const refreshed = await engine.schema.refresh('posts');
console.log('refreshed', refreshed.fields.map((f) => f.name));
// 5. 刷新表结构 diff（删字段）
engine.businessRaw.exec('ALTER TABLE posts DROP COLUMN title');
const after = await engine.schema.refresh('posts');
console.log('after drop', after.fields.map((f) => f.name));
await engine.destroy();
rmSync(dir, { recursive: true, force: true });
console.log('SMOKE OK');
```

Expected: 控制台输出 `SMOKE OK`，且各步骤日志符合预期（imported/created/created row/list/refreshed/after drop）。

- [ ] **Step 16.6：删除冒烟脚本并 commit**

```bash
rm -f packages/engine/smoke.ts
git add -A
git commit -m "chore: Phase 1 贯通验收（typecheck/test/build/lint/smoke 全绿）"
```

---

## 验收对照（spec 验收标准）

| spec 验收项 | 实现任务 |
|---|---|
| monorepo 可 install/typecheck/test/build 全绿 | Task 0, 1, 7, 16 |
| shared 导出 FieldMeta/TableMeta/ApiResponse/TokenPermissions 类型与常量 | Task 2, 4, 6 |
| 类型映射三端一致性测试（含 NUMERIC/REAL + 每操作符） | Task 6（mapping.test） |
| DataEngine 对临时 SQLite 完成：导入/新建/刷新/CRUD/incr/describe/addField | Task 9–15, 16 |
| 白名单校验（防注入） | Task 12（dynamic-sql 白名单） |
| Vitest 覆盖率 core > 90% | Task 1/7 vitest thresholds + Task 16 |

---

## 备注：执行环境提示

- better-sqlite3 为原生模块，首次 `pnpm install` 会编译；如遇 node-gyp 问题，确认 Node 版本与 better-sqlite3 11 兼容（Node 20+）。
- `tsconfig.base.json` 开启 `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`：测试/实现里访问数组/对象需处理 `undefined`（计划代码已用 `!` 或显式判空）。
- kysely `sql.join(parts, sql.raw(sep))` 的子句拼接若 TS 提示泛型不匹配，把 `SqlFragment` 局部别名（`type SqlFragment = ReturnType<typeof sql>`）改注为 `RawBuilder<unknown>`，或对 parts 数组显式 `as` 断言；拼接逻辑不变。
