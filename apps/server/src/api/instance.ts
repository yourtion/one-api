import ERest from 'erest';
import { API_INFO, GROUPS } from './groups.js';
import { applyEnvelopeFormat } from './format.js';

/**
 * 全局唯一 ERest 单例（forceGroup 模式）。
 *
 * 所有路由注册到此实例（api.group('xxx').<method>()），由 app.ts 一次性 bind 到 @leizm/web。
 * 与 erest 3.x 最佳实践一致：单实例 + forceGroup 分组 + 组级 before/middleware 钩子。
 */
export const api = new ERest<unknown>({
  info: API_INFO,
  groups: GROUPS,
  forceGroup: true,
});

// 告知 erest 测试脚手架如何拆解统一信封 {success, data|error}（仅影响 success()/error() 语义）
applyEnvelopeFormat(api);

