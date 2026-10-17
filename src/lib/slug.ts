/* =========================================================================
   Utilidades compartidas entre el sitio (Node) y el panel del navegador.
   Sin `node:` a propósito: este módulo lo importa el cliente.

   La implementación vive en `exam-name.js`, sin tipos, porque también la usa
   el importador de PDFs (`scripts/import.mjs`), que corre con Node a secas.
   ========================================================================= */

export { slugify, estimatePdfPages } from './exam-name.js';
