// @1api/shared 入口；后续任务在此追加导出。
export const ONE_API_VERSION = '0.1.1';
/** @deprecated 使用 ONE_API_VERSION；保留原导出以兼容消费者。 */
export const __SHARED_VERSION = ONE_API_VERSION;

export * from './constants.js';
export * from './errors.js';
export type * from './types.js';
export * from './schema/parsers.js';
export * from './schema/mapping.js';
