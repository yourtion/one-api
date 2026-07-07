import { defineConfig } from 'vitepress';

export default defineConfig({
  lang: 'zh-CN',
  title: 'one-api',
  description: 'AI native 数据库',
  base: '/',
  cleanUrls: true,
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
          // Task 11 生成后按实际产出补全 items
          items: [],
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
