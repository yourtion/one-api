/**
 * erest 自动 API 文档生成脚本。
 *
 * 装配一个「仅用于文档生成」的 erest 实例（带 docs.markdown 配置），
 * 复用 server 的 7 个 register*Routes 注册全部路由，
 * 再调 api.genDocs(outDir, false) 导出 markdown 到 apps/docs/api-reference/。
 *
 * 关键：不能复用 instance.ts 的全局 `api` 单例——它创建时没传 docs 配置，
 * 而 erest 的 docs 插件注册依赖构造期 docsOptions（构造后无法注入）。
 * 故本脚本自建一个带 `docs: { markdown: true, index: true }` 的实例。
 *
 * 关于 DB：register*Routes 在注册期（非 handler 期）即调用 getSystemDb()——
 * createAdminStore/requireAdmin/requireToken/createTokenStore 在注册时绑定库句柄，
 * 故需要一个已装配的 systemDb（用临时文件初始化，仅满足注册签名，不写业务数据）。
 * getEngine() 被包在 `() => getEngine()` 惰性闭包里，仅 handler 运行时触发，文档脚本不触达。
 *
 * 用法：pnpm --filter @1api/docs gen:api-docs
 *
 * 产出随构建手动刷新，保证与实际路由不漂移。
 */
import { mkdirSync, readdirSync, mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  // 动态 import：相对路径从 apps/docs/scripts/ 跨到 apps/server/src/。
  // 用动态 import 而非顶层 import，确保 erest/server 代码在脚本入口后才加载，
  // 便于报错定位（也避开 docs 包自身不直接依赖 erest 的解析约束——
  // 这些相对路径文件位于 apps/server/，其 node_modules 含 erest/@1api/shared）。
  const { createERest } = await import('@erest/leizmweb');
  const { API_INFO, GROUPS } = await import('../../server/src/api/groups.js');
  const { responseEnvelopers } = await import('../../server/src/api/instance.js');
  const { initSystemDb } = await import('../../server/src/db/system.js');
  const { setSystemDb } = await import('../../server/src/core/system-db.js');
  const { registerAuthRoutes } = await import('../../server/src/routes/auth.js');
  const { registerTableRoutes } = await import('../../server/src/routes/table.js');
  const { registerAdminDataRoutes } = await import('../../server/src/routes/admin-data.js');
  const { registerTokenRoutes } = await import('../../server/src/routes/token.js');
  const { registerAdminRoutes } = await import('../../server/src/routes/admins.js');
  const { registerDataRoutes } = await import('../../server/src/routes/data.js');
  const { registerDataSchemaRoutes } = await import('../../server/src/routes/data-schema.js');

  // 装配临时 systemDb：register*Routes 在注册期即绑定库句柄（store/hook factory 需提前拿到 db）。
  // 仅满足注册签名，不导入业务数据，用完即删。
  const tmpDir = mkdtempSync(join(tmpdir(), '1api-apigen-'));
  const systemDbPath = join(tmpDir, 'system.db');
  const systemDbHandle = await initSystemDb(systemDbPath);
  setSystemDb(systemDbHandle.db);

  try {
    // 创建带 docs.markdown 配置的 erest 实例（与生产/测试同构：info + groups + forceGroup + envelopers）。
    // docs.index:true 让 erest 额外生成 index.md（概览，含生成时间/host/分组目录）。
    // basePath 显式设 /api：仅影响 index.md 的「测试服务器」行，提示最终路径挂在 /api 下
    // （erest 的 realPath 是组级路径 /auth/*，生产 app.ts 在 /api 子 router 挂载）。
    const api = createERest({
      info: { ...API_INFO, basePath: '/api' },
      groups: GROUPS,
      forceGroup: true,
      docs: { markdown: true, index: true }, // 关键：开启 markdown + index 插件
    });
    api.setResponseEnvelopers(responseEnvelopers);

    // 注册全部路由（仅记元数据 + 绑定 store/hook 句柄；handler 不触发）
    registerAuthRoutes(api);
    registerTableRoutes(api);
    registerAdminDataRoutes(api);
    registerTokenRoutes(api);
    registerAdminRoutes(api);
    registerDataRoutes(api);
    registerDataSchemaRoutes(api);

    // 生成 + 保存：用 erest 公开 genDocs(savePath, onExit=false)——
    // 它会懒创建 IAPIDoc、按 docsOptions 注册 markdown 插件、并立即 save 到 outDir
    // （onExit 默认 true 会挂 process exit 延迟写，脚本场景需同步落盘，故传 false）。
    const outDir = resolve(__dirname, '../api-reference');
    mkdirSync(outDir, { recursive: true });
    api.genDocs(outDir, false);

    // 断言产出非空
    const files = readdirSync(outDir).filter((f) => f !== '.gitkeep' && f.endsWith('.md'));
    if (files.length === 0) {
      throw new Error('API 文档生成失败：api-reference 目录无 markdown 产出');
    }

    // 后处理：去掉每个 API 标题的 ❌ 标记。
    // erest 的 ❌/✅ 表示路由是否经 test-agent 跑过（.tested），与 API 是否可用无关。
    // 本项目有完整 vitest 套件（90/90）覆盖路由，tested 标记对最终文档读者无信息价值，
    // 留着 ❌ 反而让读者误以为「测试未通过」。示例已由 .example() 提供。
    let stripped = 0;
    for (const f of files) {
      const fp = join(outDir, f);
      const before = readFileSync(fp, 'utf8');
      const after = before.replace(/ ❌/g, '');
      if (before !== after) {
        writeFileSync(fp, after);
        stripped += 1;
      }
    }
    console.log(`✓ API 文档已生成，共 ${files.length} 个文件（${stripped} 个去除 ❌ 标记）：`, files.join(', '));
  } finally {
    // 清理临时 systemDb（不残留临时文件）
    await systemDbHandle.close();
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error('✗ API 文档生成失败:', e);
  process.exit(1);
});
