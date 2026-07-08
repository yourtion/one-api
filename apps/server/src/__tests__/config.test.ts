import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../config/index.js';

const KEYS = ['ONE_API_DATA_DIR', 'ONE_API_SYSTEM_DB', 'ONE_API_BUSINESS_DB', 'PORT', 'ONE_API_DEFAULT_ADMIN_NAME', 'ONE_API_DEFAULT_ADMIN_PASSWORD'] as const;

describe('loadConfig', () => {
  afterEach(() => { for (const k of KEYS) delete process.env[k]; });

  it('ONE_API_DATA_DIR 覆盖默认数据目录', () => {
    process.env['ONE_API_DATA_DIR'] = '/tmp/1api-test';
    const cfg = loadConfig();
    expect(cfg.systemDbPath).toBe('/tmp/1api-test/system.db');
    expect(cfg.businessDbPath).toBe('/tmp/1api-test/business.db');
  });

  it('显式 ONE_API_SYSTEM_DB 覆盖 dataDir 派生路径', () => {
    process.env['ONE_API_DATA_DIR'] = '/tmp/1api-test';
    process.env['ONE_API_SYSTEM_DB'] = '/custom/sys.db';
    const cfg = loadConfig();
    expect(cfg.systemDbPath).toBe('/custom/sys.db');
    expect(cfg.businessDbPath).toBe('/tmp/1api-test/business.db');
  });
});
