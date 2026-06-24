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
}

/** 工厂：创建连接 + 系统库迁移 + 缓存预热 + 返回 DataEngine（带 destroy） */
export async function createEngine(
  opts: CreateEngineOptions,
): Promise<DataEngine & { destroy(): Promise<void> }> {
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
