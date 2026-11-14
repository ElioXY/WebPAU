// @ts-check
import { defineConfig } from 'astro/config';

// El sitio vive en un dominio propio, así que la base por defecto es la raíz.
// GitHub Pages lo publica bajo /<repo>, pero su workflow pasa SITE_BASE
// explícitamente; cualquier build sin variables —el de Cloudflare— acierta
// con `/`. Con el valor antiguo (`/WebPAU`) ese build dejaba la web sin CSS ni
// JavaScript, porque pedía los assets a una ruta que en el dominio no existe.
const base = process.env.SITE_BASE ?? '/';

// https://astro.build/config
export default defineConfig({
  site: process.env.SITE_URL ?? 'https://pau.elioxy.us.ci',
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
    build: {
      // Sin scripts inline: el sitio se sirve con `script-src 'self'` y el
      // navegador bloquea lo que venga escrito dentro del HTML. Con el límite
      // a 0, Astro emite todos los scripts como archivos y la página funciona.
      assetsInlineLimit: 0,
    },
  },
});
