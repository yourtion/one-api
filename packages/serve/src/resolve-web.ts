import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);

/**
 * 探测 @1api/web 的 dist 目录路径。
 * @1api/web 是 optionalDependencies，可能未安装——此时返回 undefined（纯 API 模式）。
 */
export function resolveWebDist(): string | undefined {
  try {
    const pkgPath = require.resolve('@1api/web/package.json');
    const dist = join(dirname(pkgPath), 'dist');
    return existsSync(join(dist, 'index.html')) ? dist : undefined;
  } catch {
    return undefined;
  }
}
