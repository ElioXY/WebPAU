/* =========================================================================
   Utilidades compartidas entre el sitio (Node) y el panel del navegador.
   Sin `node:` a propósito: este módulo lo importa el cliente.
   ========================================================================= */

/** Convierte un texto arbitrario en un slug apto para una URL o un id. */
export function slugify(input: string): string {
  const map: Record<string, string> = {
    à: 'a', á: 'a', â: 'a', ä: 'a',
    è: 'e', é: 'e', ê: 'e', ë: 'e',
    ì: 'i', í: 'i', î: 'i', ï: 'i',
    ò: 'o', ó: 'o', ô: 'o', ö: 'o',
    ù: 'u', ú: 'u', û: 'u', ü: 'u',
    ç: 'c', ñ: 'n', '·': '-', '/': '-',
  };
  return input
    .toLowerCase()
    .replace(/[àáâäèéêëìíîïòóôöùúûüçñ·/]/g, (ch) => map[ch] ?? ch)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/** Por encima de este tamaño no compensa escanear el PDF en el navegador. */
const MAX_SCAN_BYTES = 24 * 1024 * 1024;

/**
 * Cuenta páginas de un PDF a ojo, buscando los objetos `/Type /Page` y la
 * entrada `/Count` del índice. Es una estimación: sirve para mostrar «4 p.»
 * en la ficha, no para validar el archivo.
 */
export function estimatePdfPages(bytes: Uint8Array): number | null {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_SCAN_BYTES) return null;

  // Los marcadores que buscamos son ASCII, así que basta con leer los bytes
  // como latin1. Se trocea para no reventar la pila con `fromCharCode`.
  const CHUNK = 0x8000;
  let text = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    text += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }

  const matches = text.match(/\/Type\s*\/Page[^s]/g);
  if (!matches) return null;
  const count = text.match(/\/Count\s+(\d+)/);
  return count ? Number(count[1]) : matches.length;
}
