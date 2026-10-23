import Database from 'better-sqlite3';
import { Kysely, SqliteDialect } from 'kysely';
import { DataService } from './data-service.js';
import { DynamicSql } from './dynamic-sql.js';
import { MetadataStore } from './metadata.js';
import { SchemaService } from './schema-service.js';
import { SYSTEM_DB_MIGRATIONS, type SystemDB } from './system-db.js';
import { ensureDbDir } from './fs-utils.js';

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
}

/** 工厂：创建连接 + 系统库迁移 + 缓存预热 + 返回 DataEngine（带 destroy） */
export async function createEngine(
  opts: CreateEngineOptions,
): Promise<DataEngine & { destroy(): Promise<void> }> {
  ensureDbDir(opts.businessDbPath);
  ensureDbDir(opts.systemDbPath);
  const businessRaw = new Database(opts.businessDbPath);
  let systemRaw: Database.Database | undefined;
  try {
    businessRaw.pragma('journal_mode = WAL');
    systemRaw = new Database(opts.systemDbPath);

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

    let destroyPromise: Promise<void> | undefined;
    return Object.assign(engine, {
      destroy() {
        destroyPromise ??= (async () => {
          const failures: unknown[] = [];
          const results = await Promise.allSettled([
            Promise.resolve().then(() => businessDb.destroy()),
            Promise.resolve().then(() => systemDb.destroy()),
          ]);
          for (const result of results) if (result.status === 'rejected') failures.push(result.reason);
          // Kysely 未执行过查询时不会初始化 driver，destroy 也不会关闭传入的原生句柄。
          for (const raw of [businessRaw, systemRaw]) {
            try {
              if (raw?.open) raw.close();
            } catch (error) {
              failures.push(error);
            }
          }
          if (failures.length) throw failures[0];
        })();
        return destroyPromise;
      },
    });
  } catch (error) {
    // 工厂尚未返回句柄时，调用方无法清理；保留原始初始化异常。
    try {
      if (businessRaw.open) businessRaw.close();
    } catch {
      // 继续清理其它句柄。
    }
    try {
      if (systemRaw?.open) systemRaw.close();
    } catch {
      // 保留原始异常。
    }
    throw error;
  }
}
