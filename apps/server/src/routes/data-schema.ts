import type { ERest, Middleware } from 'erest';
import { z } from 'erest';
import { isReservedName, Errors, type FieldMetaInput } from '@1api/shared';
import { getEngine } from '../core/engine.js';
import { requireToken, checkPermission } from '../hooks.js';
import { getSystemDb } from '../core/system-db.js';
import { CreateModelSchema, TableParam } from './schemas.js';

/**
 * 对外 Schema /api/data/_schema/*（data 组，Token schema action）。
 * 路径相对 data 组前缀 /api/data：/_schema/tables、/_schema/tables/:table/fields。
 * _schema 下划线前缀不与合法表名（^[a-z][a-z0-9_]*$）冲突。
 */
export function registerDataSchemaRoutes(api: ERest<Middleware>): void {
  const data = api.group('data').before(requireToken(getSystemDb()));
  const engine = () => getEngine();

  // —— 建表 ——（表名在 body.name，checkPermission 从 body 取）
  data
    .post('/_schema/tables')
    .title('新建模型（token）')
    .example({
      name: '通过 Token 新建 users 模型',
      headers: { Authorization: 'Bearer oa_a3f9c2e8b1d7e6f5a4b3c2d1' },
      input: {
        name: 'users',
        label: '用户',
        fields: [
          { name: 'id', type: 'integer', pk: true },
          { name: 'name', type: 'text' },
          { name: 'age', type: 'integer' },
        ],
        autoTimestamps: true,
      },
      output: { id: 1, name: 'users', label: '用户', fields: [{ name: 'id', type: 'integer', pk: true }], isPublished: false, isEditable: true },
    })
    .before(checkPermission('schema', { tableFromBody: 'name' }))
    .registerTyped(
      { body: CreateModelSchema },
      async (req) => {
        if (isReservedName(req.body.name)) throw Errors.reservedName(req.body.name);
        const opts: {
          name: string;
          label: string;
          fields: FieldMetaInput[];
          note?: string | null;
          autoTimestamps?: boolean;
        } = { name: req.body.name, label: req.body.label, fields: req.body.fields as unknown as FieldMetaInput[] };
        if (req.body.note !== undefined) opts.note = req.body.note;
        if (req.body.autoTimestamps !== undefined) opts.autoTimestamps = req.body.autoTimestamps;
    return await engine().schema.createModel(opts);      },
    );

  // —— 加字段 ——
  data
    .post('/_schema/tables/:table/fields')
    .title('加字段（token）')
    .example({
      name: '给 users 表加 email 字段',
      path: '/_schema/tables/users/fields',
      headers: { Authorization: 'Bearer oa_a3f9c2e8b1d7e6f5a4b3c2d1' },
      input: { field: { name: 'email', type: 'text' } },
      output: { name: 'email', type: 'text' },
    })
    .before(checkPermission('schema', { tableKey: 'table' }))
    .registerTyped(
      { params: TableParam, body: z.object({ field: z.record(z.string(), z.unknown()) }) },
      async (req) => {
    return await engine().schema.addField(req.params.table, req.body.field as unknown as FieldMetaInput);      },
    );
}
