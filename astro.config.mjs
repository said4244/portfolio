import { defineConfig } from 'astro/config';

// Static output = no server, no database, minimal attack surface.
export default defineConfig({
  site: 'https://saidalhazina.com',
  trailingSlash: 'ignore',
  markdown: {
    shikiConfig: { theme: 'github-dark', wrap: false },
  },
});
