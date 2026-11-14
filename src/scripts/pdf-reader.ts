/* =========================================================================
   Visor del enunciado.

   El sitio sirve todas las respuestas —también los PDF— con
   `Content-Security-Policy: … frame-ancestors 'none'`, así que un <iframe>
   con el documento se queda en blanco. pdf.js dibuja las páginas en canvas
   dentro de la propia sala: el cronómetro y el examen comparten pantalla.
   ========================================================================= */

import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

GlobalWorkerOptions.workerSrc = workerUrl;

const host = document.getElementById('pdfView') as HTMLElement | null;

if (host) {
  const src = host.dataset.src;
  if (src) void show(host, src);
}

async function show(host: HTMLElement, src: string): Promise<void> {
  const loading = host.querySelector<HTMLElement>('.reader-loading');
  const totalEl = document.querySelector<HTMLElement>('[data-page-total]');
  const zoomControls = document.querySelector<HTMLElement>('[data-zoom-controls]');
  const zoomLevel = document.querySelector<HTMLElement>('[data-zoom-level]');

  /* el zoom parte del ancho de la columna y sube en pasos */
  const steps = [1, 1.25, 1.5, 2];
  let step = 0;
  let token = 0;

  try {
    const doc = await getDocument({ url: src }).promise;

    loading?.remove();
    if (totalEl) {
      totalEl.textContent = `${doc.numPages} ${doc.numPages === 1 ? 'página' : 'páginas'}`;
    }
    if (zoomControls) zoomControls.hidden = false;

    const pages = document.createElement('div');
    pages.className = 'reader-canvases';
    host.append(pages);

    const column = (): number => Math.max(240, host.clientWidth - 32);

    const draw = async (): Promise<void> => {
      const run = (token += 1);
      pages.replaceChildren();
      if (zoomLevel) zoomLevel.textContent = `${Math.round(steps[step] * 100)}%`;

      for (let number = 1; number <= doc.numPages; number += 1) {
        if (run !== token) return;
        const page = await doc.getPage(number);
        if (run !== token) return;

        const natural = page.getViewport({ scale: 1 });
        const width = column() * steps[step];
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        const viewport = page.getViewport({ scale: (width / natural.width) * ratio });

        const canvas = document.createElement('canvas');
        canvas.width = Math.round(viewport.width);
        canvas.height = Math.round(viewport.height);
        canvas.style.width = `${Math.round(width)}px`;
        canvas.style.aspectRatio = `${natural.width} / ${natural.height}`;
        canvas.setAttribute('role', 'img');
        canvas.setAttribute('aria-label', `Página ${number} de ${doc.numPages}`);
        pages.append(canvas);

        const context = canvas.getContext('2d');
        if (!context) continue;
        try {
          await page.render({ canvasContext: context, viewport }).promise;
        } catch {
          /* una página que falla no debe llevarse por delante las demás */
        }
      }
    };

    for (const button of document.querySelectorAll<HTMLButtonElement>('[data-zoom]')) {
      button.addEventListener('click', () => {
        const next = Math.min(
          steps.length - 1,
          Math.max(0, step + Number(button.dataset.zoom ?? 0))
        );
        if (next === step) return;
        step = next;
        void draw();
      });
    }

    let timer = 0;
    window.addEventListener('resize', () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void draw(), 250);
    });

    await draw();
  } catch (error) {
    console.warn('[pdf] no se pudo mostrar el enunciado:', error);
    if (loading) {
      loading.textContent =
        'No se pudo mostrar el enunciado aquí; ábrelo en otra pestaña con el enlace de abajo.';
    }
  }
}
