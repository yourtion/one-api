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
    const opts: ListOptions = {
      page: 2,
      size: 50,
      order: 'id:desc',
      q: 'foo',
      filters: { age: ['gt', 18] },
    };
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
