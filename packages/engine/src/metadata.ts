import type Database from 'better-sqlite3';
import { type Kysely } from 'kysely';
import { type FieldMeta, type TableMeta } from '@1api/shared';
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

type TableMetaDbRow = {
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
};

function rowToMeta(row: TableMetaDbRow): TableMeta {
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
      const meta = rowToMeta(r as TableMetaDbRow);
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
    const meta = rowToMeta(inserted as TableMetaDbRow);
    this.cache.set(meta.name, meta);
    return meta;
  }

  async updateMeta(
    id: number,
    patch: Partial<
      Pick<TableMeta, 'label' | 'note' | 'isPublished' | 'isEditable' | 'fields' | 'primaryKey'>
    >,
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
      const meta = rowToMeta(updated as TableMetaDbRow);
      this.cache.set(meta.name, meta);
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
    const oldByName = new Map(current.fields.map((fld) => [fld.name, fld]));
    const merged: FieldMeta[] = reflected.map((rf) => {
      const old = oldByName.get(rf.name);
      if (!old) return rf; // 新字段：纯反射结果（label 默认 = name）
      // 保留用户标记，结构用反射最新值
      const mergedField: FieldMeta = {
        ...rf,
        label: old.label,
        isHidden: old.isHidden,
        isReadonly: old.isReadonly,
      };
      // exactOptionalPropertyTypes：仅在显式提供时挂载 enumValues
      if (old.enumValues !== undefined) mergedField.enumValues = old.enumValues;
      return mergedField;
    });

    await this.updateMeta(id, { fields: merged, primaryKey });
    const after = await this.getMeta(id);
    return after!;
  }
}
