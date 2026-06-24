import { createEngine, type DataEngine } from '@1api/engine';

let engineInstance: (DataEngine & { destroy(): Promise<void> }) | null = null;

/** 装配并缓存全局 DataEngine 单例。传入业务库/系统库路径。 */
export async function initEngine(opts: {
  businessDbPath: string;
  systemDbPath: string;
}): Promise<DataEngine & { destroy(): Promise<void> }> {
  if (engineInstance) return engineInstance;
  engineInstance = await createEngine(opts);
  return engineInstance;
}

/** 取已装配的 engine（未装配抛错） */
export function getEngine(): DataEngine & { destroy(): Promise<void> } {
  if (!engineInstance) throw new Error('engine 未装配：请先调 initEngine()');
  return engineInstance;
}

/** 测试辅助：重置单例（避免用例间串扰） */
export function _resetEngine(): void {
  engineInstance = null;
}
