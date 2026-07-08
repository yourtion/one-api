import { defineConfig } from 'vitepress';

export default defineConfig({
  lang: 'zh-CN',
  title: 'one-api',
  description: 'AI native 数据库',
  // 自定义域名 1api.js.org（根路径），base 用 /
  // 若临时回退到 yourtion.github.io/one-api/，改回 '/one-api/'
  base: '/',
  cleanUrls: true,
  // erest 自动生成的 api-reference/*.md 含「测试服务器 http://localhost:3000/api」示例文本，
  // VitePress 死链检查会误报。此处放行 localhost（非站内链接）。
  ignoreDeadLinks: [/^https?:\/\/localhost/, /^https?:\/\/127\.0\.0\.1/],
  themeConfig: {
    logo: '/logo.svg',
    nav: [
      { text: '指南', link: '/guide/introduction' },
      { text: '前端消费', link: '/clients/http-api' },
      { text: 'API 参考', link: '/api-reference/' },
      { text: '关于', link: '/about/contributing' },
    ],
    sidebar: {
      '/guide/': [
        {
          text: '开始',
          items: [
            { text: '介绍', link: '/guide/introduction' },
            { text: '快速上手', link: '/guide/quick-start' },
            { text: '核心概念', link: '/guide/concepts' },
            { text: '安装与部署', link: '/guide/install' },
            { text: '路线图', link: '/guide/roadmap' },
          ],
        },
      ],
      '/clients/': [
        {
          text: '前端消费',
          items: [
            { text: 'HTTP REST API', link: '/clients/http-api' },
            { text: '管理界面', link: '/clients/admin-ui' },
            { text: 'MCP 服务', link: '/clients/mcp' },
            { text: 'CLI', link: '/clients/cli' },
            { text: 'SDK', link: '/clients/sdk' },
          ],
        },
      ],
      '/api-reference/': [
        {
          text: 'API 参考',
          // 由 scripts/gen-api-docs.ts 自动生成（erest docs.markdown）。
          // 路由组路径为 erest 组级路径（/auth/* 等），生产挂在 /api 子 router → 实际 /api/auth/*。
          items: [
            { text: '概览', link: '/api-reference/index' },
            { text: '鉴权（auth）', link: '/api-reference/auth' },
            { text: '后台管理（admin）', link: '/api-reference/admin' },
            { text: '数据 CRUD（data）', link: '/api-reference/data' },
            { text: '错误码', link: '/api-reference/errors' },
          ],
        },
      ],
      '/about/': [
        {
          text: '关于',
          items: [
            { text: '贡献指南', link: '/about/contributing' },
            { text: '设计文档', link: '/about/design-docs' },
            { text: '更新日志', link: '/about/changelog' },
          ],
        },
      ],
    },
    socialLinks: [{ icon: 'github', link: 'https://github.com/yourtion/one-api' }],
    footer: {
      message: '基于 MIT 协议发布',
      copyright: 'Copyright © 2026 Yourtion',
    },
  },
});
