/* =========================================================================
   Un único sitio para dos cosas que usan el sitio y la terminal:
   el slug de los ids y la lectura de metadatos del nombre del archivo.

   Sin `node:` y sin TypeScript a propósito: este módulo lo importa el panel
   (navegador), la web (Node durante el build) y el importador de PDFs
   (`scripts/import.mjs`), que corre con Node a secas.
   ========================================================================= */

const ACCENTS = {
  à: 'a', á: 'a', â: 'a', ä: 'a',
  è: 'e', é: 'e', ê: 'e', ë: 'e',
  ì: 'i', í: 'i', î: 'i', ï: 'i',
  ò: 'o', ó: 'o', ô: 'o', ö: 'o',
  ù: 'u', ú: 'u', û: 'u', ü: 'u',
  ç: 'c', ñ: 'n', '·': '-', '/': '-',
};

/** Minúsculas y sin acentos:la base para comparar nombres. */
export function fold(input) {
  return String(input)
    .toLowerCase()
    .replace(/[àáâäèéêëìíîïòóôöùúûüçñ·/]/g, (ch) => ACCENTS[ch] ?? ch);
}

/** Convierte un texto arbitrario en un slug apto para una URL o un id. */
export function slugify(input) {
  return fold(input)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export const SESSIONS = ['ordinaria', 'extraordinaria'];
export const TYPES = ['enunciados', 'soluciones', 'criterios', 'plantilla'];

/** Por encima de este tamaño no compensa escanear el PDF. */
const MAX_SCAN_BYTES = 24 * 1024 * 1024;

/**
 * Cuenta páginas de un PDF a ojo, buscando los objetos `/Type /Page` y la
 * entrada `/Count` del índice. Es una estimación: sirve para mostrar «4 p.»
 * en la ficha, no para validar el archivo.
 */
export function estimatePdfPages(bytes) {
  if (!bytes || bytes.byteLength === 0 || bytes.byteLength > MAX_SCAN_BYTES) return null;

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

/**
 * Léelo como lo leería quien lo sube: primero el tipo —que es la palabra más
 * característica—, luego la convocatoria, el año y la asignatura. Devuelve lo
 * que haya encontrado y deja el resto a null para que el panel lo pida.
 */
export function parseExamName(fileName, subjects = []) {
  const base = fold(String(fileName).replace(/\.[a-z0-9]+$/i, ''))
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  const padded = ` ${base} `;

  let type = null;
  if (/\bcriterios?\b|\brubrica|\bcorreccion|\bbaremo/.test(base)) type = 'criterios';
  else if (/\bplantilla|\bhoja|\bomr\b|\brespuestas?\b/.test(base)) type = 'plantilla';
  else if (/\bsolucion|\bsoluciones|\bresuelt/.test(base)) type = 'soluciones';
  else if (/\benunciado|\bexamen|\bprueba/.test(base)) type = 'enunciados';

  let session = null;
  if (/\bextraordinari|\bextraord|\bjulio|\bjul\b/.test(base)) session = 'extraordinaria';
  else if (/\bordinari|\bjunio|\bjun\b/.test(base)) session = 'ordinaria';

  const yearMatch = base.match(/\b(19\d{2}|20\d{2})\b/);
  const year = yearMatch ? Number(yearMatch[1]) : null;

  /* Asignatura: el código exacto manda; si no, el alias más específico. Los
     empates (p. ej. «lengua extranjera») se devuelven como ambiguos en vez de
     elegir una materia al azar. */
  let subject = null;
  const scores = new Map();
  const bump = (code, score) => {
    if (!code) return;
    if (!scores.has(code) || scores.get(code) < score) scores.set(code, score);
  };

  for (const s of subjects) {
    if (!s || !s.code) continue;
    if (new RegExp(`\\b${slugify(s.code).replace(/-/g, '\\W')}\\b`).test(base)) bump(s.code, 1000);
    for (const alias of [s.name, s.short, ...(s.aliases ?? [])]) {
      const phrase = slugify(alias).replace(/-/g, ' ');
      if (!phrase) continue;
      if (padded.includes(` ${phrase} `)) bump(s.code, phrase.length);
      /* las abreviaturas llevan punto («Fís.»), que el slug convierte en guion */
      const short = slugify(alias ?? '');
      if (short && padded.includes(` ${short} `)) bump(s.code, short.length);
    }
  }

  let best = 0;
  for (const score of scores.values()) best = Math.max(best, score);
  const top = [...scores.entries()].filter(([, score]) => score === best).map(([code]) => code);
  if (top.length === 1) subject = top[0];

  const fields = [];
  if (subject) fields.push('subject');
  if (year) fields.push('year');
  if (session) fields.push('session');
  if (type) fields.push('type');

  return {
    subject,
    candidates: top,
    year,
    session,
    type,
    fields,
    complete: fields.length === 4,
  };
}
