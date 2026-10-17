import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// Static output = no server, no database, minimal attack surface.
export default defineConfig({
  site: 'https://portfolio.offsecsaid.com',
  trailingSlash: 'ignore',
  integrations: [sitemap({ filter: (page) => !page.includes('/admin') })],
  markdown: {
    shikiConfig: { theme: 'github-dark', wrap: false },
  },
});
