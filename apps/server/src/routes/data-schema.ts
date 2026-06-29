import { isReservedName, Errors, type FieldMetaInput } from '@1api/shared';
import { getEngine } from '../core/engine.js';
import { ok } from '../utils/response.js';
import { requireToken, checkPermission } from '../hooks.js';
import type { RouteDeps } from './table.js';

/**
 * 对外 Schema /api/data/_schema/*（data 组，Token schema action）。
 * 路径相对 data 组前缀 /api/data：/_schema/tables、/_schema/tables/:table/fields。
 * _schema 下划线前缀不与合法表名（^[a-z][a-z0-9_]*$）冲突。
 */
export function registerDataSchemaRoutes(deps: RouteDeps): void {
  const data = deps.api.group('data').before(requireToken(deps.systemDb));
  const engine = () => getEngine();

  // —— 建表 ——（表名在 body.name，checkPermission 从 body 取）
  data
    .post('/_schema/tables')
    .title('新建模型（token）')
    .before(checkPermission('schema', { tableFromBody: 'name' }))
    .register(async (ctx, next) => {
      const body = (ctx.body ?? {}) as {
        name?: string;
        label?: string;
        fields?: Record<string, unknown>[];
        note?: string | null;
        autoTimestamps?: boolean;
      };
      if (typeof body.name !== 'string' || typeof body.label !== 'string' || !Array.isArray(body.fields)) {
        throw Errors.validationFail('name/label/fields 必填');
      }
      if (isReservedName(body.name)) throw Errors.reservedName(body.name);
      const opts: {
        name: string;
        label: string;
        fields: FieldMetaInput[];
        note?: string | null;
        autoTimestamps?: boolean;
      } = { name: body.name, label: body.label, fields: body.fields as unknown as FieldMetaInput[] };
      if (body.note !== undefined) opts.note = body.note;
      if (body.autoTimestamps !== undefined) opts.autoTimestamps = body.autoTimestamps;
      ctx.reply.status(201).json(ok(await engine().schema.createModel(opts)));
      return next();
    });

  // —— 加字段 ——
  data
    .post('/_schema/tables/:table/fields')
    .title('加字段（token）')
    .before(checkPermission('schema', { tableKey: 'table' }))
    .register(async (ctx, next) => {
      const table = String(ctx.params['table']);
      const { field } = (ctx.body ?? {}) as { field?: Record<string, unknown> };
      if (!field) throw Errors.validationFail('field 必填');
      ctx.reply.json(ok(await engine().schema.addField(table, field as unknown as FieldMetaInput)));
      return next();
    });
}
