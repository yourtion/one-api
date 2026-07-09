#!/usr/bin/env node
import { createServer } from '@1api/server';
import { resolveWebDist } from './resolve-web.js';
import { parseArgs, mergeConfig } from './args.js';

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const config = mergeConfig(args);

  // adminRoot 三态：
  // - --no-web → null（明确禁用，buildApp 不兜底探测）
  // - web 已装 → dist 路径
  // - web 未装 → undefined（让 buildApp 兜底探测；仓库内能找到 web/dist）
  let adminRoot: string | null | undefined;
  if (args.noWeb) {
    adminRoot = null;
  } else {
    adminRoot = resolveWebDist();
    if (!adminRoot) {
      console.warn('⚠ @1api/web 未安装，以纯 API 模式启动。如需管理界面请安装 @1api/web 或去掉 --no-web。');
    }
  }

  // exactOptionalPropertyTypes：adminRoot?: string | null 不接受显式 undefined，
  // 故条件构造 options（仅当 adminRoot 非 undefined 时挂上该字段）。null 会被传递以触发禁用。
  const handle = createServer(adminRoot !== undefined ? { config, adminRoot } : { config });
  await handle.listen();

  const shutdown = () => {
    handle
      .close()
      .then(() => process.exit(0))
      .catch((err) => {
        console.error(`关闭异常: ${(err as Error).message}`);
        process.exit(1);
      });
  };
  process.on('SIGINT', () => shutdown());
  process.on('SIGTERM', () => shutdown());
}

main().catch((err) => {
  console.error(`✗ 启动失败: ${(err as Error).message}`);
  process.exit(1);
});
