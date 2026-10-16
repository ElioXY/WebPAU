// @ts-check
import { defineConfig } from 'astro/config';

// GitHub Pages project site lives at https://<user>.github.io/<repo>
// Override with SITE_BASE=/ for a root domain or a custom domain deploy.
const base = process.env.SITE_BASE ?? '/WebPAU';

// https://astro.build/config
export default defineConfig({
  site: process.env.SITE_URL ?? 'https://elioxy.github.io',
  base,
  trailingSlash: 'ignore',
  build: {
    format: 'file',
  },
  devToolbar: {
    enabled: false,
  },
  vite: {
    css: {
      devSourcemap: true,
    },
  },
});
