import { Errors, type ListOptions, type ListResult, type TableMeta } from '@1api/shared';
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
