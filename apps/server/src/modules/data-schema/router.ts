import type { Kysely } from 'kysely';
import { z } from 'erest';
import * as web from '@leizm/web';
import { isReservedName, type FieldMetaInput } from '@1api/shared';
import type { ServerSystemDB } from '../../db/types.js';
import { AppApplication, AppRouter, type Middleware } from '../../types/context.js';
import { createApi } from '../../api.js';
import { ok } from '../../utils/response.js';
import { getEngine } from '../../core/engine.js';
import { createRequireToken, createCheckPermission } from '../../middlewares/token-auth.js';
import { corsForData } from '../../middlewares/cors.js';

export interface RegisterDataSchemaOpts {
  systemDb: Kysely<ServerSystemDB>;
}

/** 对外 Schema /api/data/_schema/*（Token schema action：建表/加字段） */
export function registerDataSchemaRoutes(app: AppApplication, opts: RegisterDataSchemaOpts): void {
  const router = new AppRouter();
  const requireToken = createRequireToken(opts.systemDb);
  const api = createApi();
  const engine = () => getEngine();

  router.use('/', corsForData());
  router.use('/', web.component.bodyParser.json() as unknown as Middleware);
  router.use('/', web.component.bodyParser.urlencoded({ extended: true }) as unknown as Middleware);

  // —— 建表 ——（表名在 body.name，checkPermission 从 body.name 取）
  api.api
    .post('/data/_schema/tables')
    .group('data-schema')
    .title('新建模型（token）')
    .before(requireToken)
    .before(createCheckPermission('schema', { tableFromBody: 'name' }))
    .body(
      z.object({
        name: z.string(),
        label: z.string(),
        fields: z.array(z.record(z.string(), z.unknown())),
        note: z.string().nullable().optional(),
        autoTimestamps: z.boolean().optional(),
      }),
    )
    .register(
      (async (ctx) => {
        const input = ctx.paramsInput as {
          name: string;
          label: string;
          fields: Record<string, unknown>[];
          note?: string | null;
          autoTimestamps?: boolean;
        };
        if (isReservedName(input.name)) {
          const { Errors } = await import('@1api/shared');
          throw Errors.reservedName(input.name);
        }
        const opts2: {
          name: string;
          label: string;
          fields: FieldMetaInput[];
          note?: string | null;
          autoTimestamps?: boolean;
        } = { name: input.name, label: input.label, fields: input.fields as unknown as FieldMetaInput[] };
        if (input.note !== undefined) opts2.note = input.note;
        if (input.autoTimestamps !== undefined) opts2.autoTimestamps = input.autoTimestamps;
        ctx.response.status(201).json(ok(await engine().schema.createModel(opts2)));
      }) as Middleware,
    );

  // —— 加字段 ——
  api.api
    .post('/data/_schema/tables/:table/fields')
    .group('data-schema')
    .title('加字段（token）')
    .before(requireToken)
    .before(createCheckPermission('schema'))
    .body(z.object({ field: z.record(z.string(), z.unknown()) }))
    .register(
      (async (ctx) => {
        const table = String(ctx.request.params['table']);
        const { field } = ctx.paramsInput as { field: Record<string, unknown> };
        ctx.response.json(ok(await engine().schema.addField(table, field as unknown as FieldMetaInput)));
      }) as Middleware,
    );

  api.bindRouter(router, api.checkerLeiWeb);
  app.use('/api', router);
}
