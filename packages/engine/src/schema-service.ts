import type Database from 'better-sqlite3';
import { Errors, isReservedName, isValidName, type FieldMetaInput, type TableMeta } from '@1api/shared';
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
    if (await this.store.getMetaByName(name)) throw Errors.tableAlreadyExists(name);

    const { fields, primaryKey } = readTableSchema(this.businessRaw, name); // 主键策略在此抛错并透传
    return this.store.createMeta({ name, label: '', primaryKey, fields });
  }

  /** 新建模型：name 强制正则 + 非保留字 → createTable → readTableSchema（读回真实结构）→ createMeta */
  async createModel(opts: {
    name: string;
    label: string;
    fields: FieldMetaInput[];
    note?: string | null;
    autoTimestamps?: boolean;
  }): Promise<TableMeta> {
    this.assertCreatableName(opts.name);
    if (await this.store.getMetaByName(opts.name)) throw Errors.tableAlreadyExists(opts.name);
    if (listTables(this.businessRaw).includes(opts.name)) {
      throw Errors.tableAlreadyExists(opts.name);
    }

    createTable(this.businessRaw, opts);
    const { fields, primaryKey } = readTableSchema(this.businessRaw, opts.name); // 读回真实结构
    // exactOptionalPropertyTypes：仅在显式提供时挂载 note
    const createInput: Parameters<MetadataStore['createMeta']>[0] = {
      name: opts.name,
      label: opts.label,
      primaryKey,
      fields,
    };
    if (opts.note !== undefined) createInput.note = opts.note;
    return this.store.createMeta(createInput);
  }

  /** 追加字段：field.name 强制正则 → addColumn（DDL）→ refreshMeta */
  async addField(table: string, field: FieldMetaInput): Promise<TableMeta> {
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
      // 区分：保留字 vs 非法格式（保留字本身符合小写开头，归 RESERVED_NAME）
      if (isReservedName(name) && /^[a-z]/.test(name)) throw Errors.reservedName(name);
      throw Errors.invalidName(name);
    }
  }
}
