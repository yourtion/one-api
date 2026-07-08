/**
 * erest 自动 API 文档生成脚本（测试驱动版）。
 *
 * 复用 server 测试夹具 setupTest 装配完整路由 + 启动真实 server，
 * 用 erest test-agent 跑代表性请求序列（.success().takeExample()），
 * 让文档通过真实测试变绿（✅）+ 用真实响应填充 example（而非手写静态示例）。
 * 最后 genDocs 导出 markdown 到 apps/docs/api-reference/。
 *
 * 用法：pnpm docs:gen-api （或 pnpm --filter @1api/docs gen:api-docs）
 *
 * 设计原则（erest 设计初衷：测试即文档）：
 * - 不自己 createERest + register*Routes：直接复用 setupTest 装配的真实实例（含真实 leizm/web
 *   server + session 中间件 + cookie jar + engine），与生产/测试完全同构。
 * - 每个路由至少跑一次 .success().takeExample()（正常路径优先），让 ✅ 翻转 + example 落真实响应。
 *   个别只能走错误路径的路由用 .error().takeExample()（error() 也会存 example + 翻转 tested）。
 * - test-agent 路径用完整 group 前缀（/auth/* /admin/* /data/*）：路由注册带 group prefix，
 *   erest 的 findApi 用完整路径匹配。
 * - 鉴权：admin 通道（/auth/* /admin/*）走 session cookie（admin session 登录后 cookie jar 自动维护）；
 *   data 通道（/data/*）走 Bearer token（setup.insertToken 拿明文，请求时 Authorization 头带上）。
 * - 数据准备：admin 先建一张 users 表（createModel），供 data CRUD / admin-data / data-schema 用。
 *
 * 会话隔离：每个独立流程用独立 session（admin 持续会话 / auth 演示会话 / data 会话），
 * 互不干扰——session destroy/clearCookie 只影响调用方自身的 cookie jar。
 */
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  // 动态 import：相对路径从 apps/docs/scripts/ 跨到 apps/server/src/。
  // 用动态 import 而非顶层 import，确保 erest/server 代码在脚本入口后才加载，
  // 便于报错定位（也避开 docs 包自身不直接依赖 erest 的解析约束——
  // 这些相对路径文件位于 apps/server/，其 node_modules 含 erest/@1api/shared）。
  const { setupTest, seedBusinessTable } = await import('../../server/src/__tests__/helpers.js');
  const setup = await setupTest();

  try {
    // —— 启用 markdown index 概览 + 标注 basePath（仅影响 index.md「测试服务器」行）——
    // setupTest 装配的实例默认 markdown:true + wiki:'./' + index:false。
    // docsOptions/info 是普通对象（getDocsView 返回同一引用），运行期可改。
    setup.api.docsOptions.index = true;
    setup.api.info.basePath = '/api';

    // ============================================================
    // auth 组（session 鉴权）—— 用独立会话演示完整鉴权生命周期
    // login → me → password → logout。logout 会销毁此会话，故用独立 session，
    // 不影响后续 admin 持续会话。
    // ============================================================
    const authSession = setup.api.test.session();
    await authSession.post('/auth/login').input({ name: 'admin', password: '123456' }).takeExample('登录成功').success();
    await authSession.get('/auth/me').takeExample('当前管理员').success();
    // 改密后立即改回原密码（避免污染共享 systemDb，admin 持续会话后续仍用原密码）
    await authSession
      .put('/auth/password')
      .input({ oldPassword: '123456', newPassword: 'newpass123' })
      .takeExample('修改密码')
      .success();
    await authSession.put('/auth/password').input({ oldPassword: 'newpass123', newPassword: '123456' }).success();
    await authSession.post('/auth/logout').takeExample('登出').success();

    // ============================================================
    // admin 持续会话（session 鉴权，login 后 cookie jar 跨请求自动维护）
    // 覆盖全部 admin/* 路由：tables / tables/:id/data / tokens / admins
    // ============================================================
    const admin = setup.api.test.session();
    await admin.post('/auth/login').input({ name: 'admin', password: '123456' }).success();

    // —— admin/tables 表管理 ——（先建 users 表，供后续 data / admin-data / schema 用）
    const usersTable = (await admin
      .post('/admin/tables')
      .input({
        name: 'users',
        label: '用户',
        fields: [
          { name: 'id', jsonType: 'integer', isPrimary: true, isAutoIncrement: true },
          { name: 'name', jsonType: 'string' },
          { name: 'age', jsonType: 'integer' },
        ],
      })
      .takeExample('新建模型')
      .success()) as { id: number; name: string };

    await admin.get('/admin/tables').takeExample('表列表').success();
    await admin.get(`/admin/tables/${usersTable.id}`).takeExample('表详情').success();
    await admin
      .put(`/admin/tables/${usersTable.id}`)
      .input({ label: '用户表', note: '用户信息表', isPublished: true })
      .takeExample('更新元数据')
      .success();
    await admin.post(`/admin/tables/${usersTable.id}/refresh`).takeExample('刷新表结构').success();

    // 导入已有表（先在业务库原生建物理表，再 import）
    await seedBusinessTable(setup.businessDbPath, 'CREATE TABLE posts (id INTEGER PRIMARY KEY, title TEXT)');
    const imported = (await admin.post('/admin/tables/import').input({ name: 'posts' }).takeExample('导入已有表').success()) as {
      id: number;
    };
    await admin.delete(`/admin/tables/${imported.id}`).input({ confirm: true }).takeExample('取消注册（导入表）').success();

    // —— admin/tokens（Token 管理）——
    const createdToken = (await admin
      .post('/admin/tokens')
      .input({ name: '前端读写', permissions: { tables: ['*'], actions: ['read', 'write'] } })
      .takeExample('创建 Token')
      .success()) as { id: number };
    await admin.get('/admin/tokens').takeExample('Token 列表').success();
    await admin
      .put(`/admin/tokens/${createdToken.id}`)
      .input({ name: '前端读写（已停用）', isActive: false })
      .takeExample('更新 Token')
      .success();

    // —— admin/admins（管理员管理）——
    const createdAdmin = (await admin
      .post('/admin/admins')
      .input({ name: 'ops', nickname: '运维', password: 'init123' })
      .takeExample('新建管理员')
      .success()) as { id: number };
    await admin.get('/admin/admins').takeExample('管理员列表').success();
    await admin
      .put(`/admin/admins/${createdAdmin.id}`)
      .input({ nickname: '运维同学' })
      .takeExample('更新管理员')
      .success();

    // —— admin/tables/:id/data（管理员数据浏览，internal 通道）——
    const dataRow = (await admin
      .post(`/admin/tables/${usersTable.id}/data`)
      .input({ name: 'alice', age: 30 })
      .takeExample('新增记录')
      .success()) as { id: number };
    await admin
      .get(`/admin/tables/${usersTable.id}/data`)
      .query({ page: 1, size: 20 })
      .takeExample('数据列表')
      .success();
    await admin.get(`/admin/tables/${usersTable.id}/data/${dataRow.id}`).takeExample('单条记录').success();
    await admin
      .put(`/admin/tables/${usersTable.id}/data/${dataRow.id}`)
      .input({ age: 31 })
      .takeExample('修改记录')
      .success();
    // CSV 导出（绕过 envelope，非 JSON 响应）— 用 raw() 拿原始响应（success/error 会尝试解析 JSON 信封）
    await admin.get(`/admin/tables/${usersTable.id}/export`).takeExample('导出 CSV').raw();
    await admin.delete(`/admin/tables/${usersTable.id}/data/${dataRow.id}`).takeExample('删除记录').success();

    // ============================================================
    // data 组（Bearer token 鉴权）
    // ============================================================
    const dataToken = await setup.insertToken({ tables: ['*'], actions: ['read', 'write', 'schema'] });
    const dataAuth = { Authorization: `Bearer ${dataToken}` };
    const dataSession = setup.api.test.session();

    // —— data CRUD ——
    const row = (await dataSession
      .post('/data/users/records')
      .headers(dataAuth)
      .input({ name: 'bob', age: 25 })
      .takeExample('创建记录')
      .success()) as { id: number };
    await dataSession.get('/data/users').headers(dataAuth).takeExample('列表查询').success();
    await dataSession.get('/data/users/schema').headers(dataAuth).takeExample('表结构').success();
    await dataSession.get(`/data/users/records/${row.id}`).headers(dataAuth).takeExample('查询单条').success();
    await dataSession
      .put(`/data/users/records/${row.id}`)
      .headers(dataAuth)
      .input({ age: 26 })
      .takeExample('更新记录')
      .success();
    await dataSession
      .post('/data/users/incr')
      .headers(dataAuth)
      .input({ pk: row.id, field: 'age', count: 1 })
      .takeExample('自增')
      .success();
    await dataSession.delete(`/data/users/records/${row.id}`).headers(dataAuth).takeExample('删除记录').success();

    // —— data-schema（Token schema action，上面 token 已含 schema）——
    await dataSession
      .post('/data/_schema/tables')
      .headers(dataAuth)
      .input({
        name: 'products',
        label: '商品',
        fields: [
          { name: 'id', jsonType: 'integer', isPrimary: true, isAutoIncrement: true },
          { name: 'name', jsonType: 'string' },
        ],
      })
      .takeExample('通过 Token 新建模型')
      .success();
    await dataSession
      .post('/data/_schema/tables/products/fields')
      .headers(dataAuth)
      .input({ field: { name: 'price', jsonType: 'number' } })
      .takeExample('通过 Token 加字段')
      .success();

    // ============================================================
    // admin 收尾：删除 token / 管理员 / 表（覆盖删除路由 + 不残留垃圾）
    // admin 持续会话未登出，cookie 仍有效。
    // ============================================================
    await admin.delete(`/admin/tokens/${createdToken.id}`).takeExample('删除 Token').success();
    await admin.delete(`/admin/admins/${createdAdmin.id}`).takeExample('删除管理员').success();
    await admin.delete(`/admin/tables/${usersTable.id}`).input({ confirm: true }).takeExample('取消注册表').success();

    // ============================================================
    // 生成文档
    // ============================================================
    const outDir = resolve(__dirname, '../api-reference');
    mkdirSync(outDir, { recursive: true });
    // genDocs(savePath, onExit=false)：false = 同步落盘（不挂 process exit）
    setup.api.genDocs(outDir, false);
    // setupTest 的 initTest 已注册一个 saveOnExit(${cwd}/docs/)（onExit 默认 true），
    // 进程退出时会再次触发 save → 写到不存在的 ${cwd}/docs/ 报 ENOENT 噪音（已被 erest
    // 插件 try/catch 吞掉，不影响退出码，但污染输出）。清空已注册的 markdown 插件使退出时
    // 的 save 变 no-op。IAPIDoc 实例挂在 apiInfo.docs（erest 内部 api 对象的 .docs）。
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (setup.api as any).api?.docs?.removePlugin?.('markdown');

    const files = readdirSync(outDir).filter((f) => f !== '.gitkeep' && f.endsWith('.md'));
    if (files.length === 0) throw new Error('API 文档生成失败：api-reference 目录无 markdown 产出');

    // 统计 ✅ 覆盖率（标题行格式「## <title> ✅|❌」）
    let totalApis = 0;
    let testedApis = 0;
    for (const f of files) {
      const md = readFileSync(`${outDir}/${f}`, 'utf8');
      totalApis += (md.match(/^## .+ [✅❌]/gm) || []).length;
      testedApis += (md.match(/^## .+ ✅/gm) || []).length;
    }
    console.log(`✓ API 文档已生成（${testedApis}/${totalApis} 路由通过测试变绿 ✅）：`, files.join(', '));
  } finally {
    await setup.cleanup();
  }
}

main().catch((e) => {
  console.error('✗ API 文档生成失败:', e);
  process.exit(1);
});
