/* =========================================================================
   Visor de los documentos del examen.

   El sitio sirve todas las respuestas —también los PDF— con
   `Content-Security-Policy: … frame-ancestors 'none'`, así que un <iframe>
   con el documento se queda en blanco. pdf.js dibuja las páginas en canvas
   dentro de la propia sala: el cronómetro y el examen comparten pantalla.

   Al terminar el cronómetro (`practice:state`), el mismo panel pasa a las
   soluciones y los criterios, con pestañas para volver al enunciado.
   ========================================================================= */

import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

GlobalWorkerOptions.workerSrc = workerUrl;

interface ReaderDoc {
  id: string;
  label: string;
  file: string;
  /** «2 p. · 1,2 MB», bajo el visor */
  meta: string;
}

interface PracticeData {
  docs?: ReaderDoc[];
}

type PdfDoc = Awaited<ReturnType<typeof getDocument>['promise']>;

const host = document.getElementById('pdfView');
const dataEl = document.getElementById('practice-data');

const docs: ReaderDoc[] = (() => {
  if (!dataEl?.textContent) return [];
  try {
    return (JSON.parse(dataEl.textContent) as PracticeData).docs ?? [];
  } catch {
    return [];
  }
})();

if (host && docs.length > 0) void start(host, docs);

async function start(host: HTMLElement, docs: ReaderDoc[]): Promise<void> {
  const loading = host.querySelector<HTMLElement>('.reader-loading');
  const titleEl = document.querySelector<HTMLElement>('[data-reader-title]');
  const tabBar = document.querySelector<HTMLElement>('[data-reader-tabs]');
  const tabs = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-doc]'));
  const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('[data-reader-open]'));
  const metaEl = document.querySelector<HTMLElement>('[data-reader-meta]');
  const totalEl = document.querySelector<HTMLElement>('[data-page-total]');
  const zoomControls = document.querySelector<HTMLElement>('[data-zoom-controls]');
  const zoomLevel = document.querySelector<HTMLElement>('[data-zoom-level]');

  const pages = document.createElement('div');
  pages.className = 'reader-canvases';
  pages.hidden = true;
  host.append(pages);

  const steps = [1, 1.25, 1.5, 2];
  let step = 0;
  let current = 0;
  let pdf: PdfDoc | null = null;
  let run = 0;

  const column = (): number => Math.max(240, host.clientWidth - 32);

  const draw = async (): Promise<void> => {
    if (!pdf) return;
    const me = run;
    pages.replaceChildren();
    pages.hidden = false;
    if (zoomLevel) zoomLevel.textContent = `${Math.round(steps[step] * 100)}%`;

    for (let number = 1; number <= pdf.numPages; number += 1) {
      if (me !== run) return;

      let page;
      try {
        page = await pdf.getPage(number);
      } catch {
        continue;
      }
      if (me !== run) return;

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
      canvas.setAttribute('aria-label', `Página ${number} de ${pdf.numPages}`);
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

  const open = async (index: number): Promise<void> => {
    const doc = docs[index];
    if (!doc) return;

    current = index;
    step = 0;
    const me = (run += 1);

    if (titleEl) titleEl.textContent = doc.label;
    for (const tab of tabs) {
      tab.setAttribute('aria-pressed', String(Number(tab.dataset.doc) === index));
    }
    for (const link of links) link.href = doc.file;
    if (metaEl) metaEl.textContent = doc.meta;
    if (zoomLevel) zoomLevel.textContent = '100%';
    host.scrollTop = 0;
    pages.replaceChildren();
    pages.hidden = true;

    if (loading) {
      loading.hidden = false;
      loading.textContent = 'Cargando…';
    }

    try {
      const next = await getDocument({ url: doc.file }).promise;
      if (me !== run) {
        void next.destroy();
        return;
      }
      const previous = pdf;
      pdf = next;
      if (previous) void previous.destroy();

      if (loading) loading.hidden = true;
      if (totalEl) {
        totalEl.textContent = `${next.numPages} ${next.numPages === 1 ? 'página' : 'páginas'}`;
      }
      if (zoomControls) zoomControls.hidden = false;
      await draw();
    } catch (error) {
      if (me !== run) return;
      console.warn('[pdf] no se pudo mostrar el documento:', error);
      if (loading) {
        loading.hidden = false;
        loading.textContent =
          'No se pudo mostrar este documento aquí; ábrelo en otra pestaña con el enlace de abajo.';
      }
    }
  };

  /* las pestañas solo tienen sentido cuando ya se puede corregir */
  const sync = (done: boolean): void => {
    const switchable = done && docs.length > 1;
    if (tabBar) tabBar.hidden = !switchable;
    if (switchable && current === 0) {
      void open(1);
      return;
    }
    if (!done && current !== 0) void open(0);
  };

  for (const tab of tabs) {
    tab.addEventListener('click', () => {
      const index = Number(tab.dataset.doc);
      if (Number.isFinite(index) && index !== current) void open(index);
    });
  }

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

  window.addEventListener('practice:state', (event) => {
    const detail = (event as CustomEvent<{ done?: boolean }>).detail;
    sync(detail?.done === true);
  });

  /* el cronómetro deja su estado en el HTML antes de que este módulo arranque */
  const done = document.documentElement.dataset.practiceDone === 'true';
  if (tabBar) tabBar.hidden = !(done && docs.length > 1);
  await open(done && docs.length > 1 ? 1 : 0);
}
