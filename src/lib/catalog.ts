import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { slugify } from './slug';

/** La PAU de Andalucía se organiza en fase de acceso (obligatoria) y fase de
 *  admisión (voluntaria). Una misma materia de modalidad puede examinarse en
 *  ambas, de ahí que `phases` sea una lista. */
export type Phase = 'acceso' | 'admision';

export interface Subject {
  code: string;
  name: string;
  short: string;
  phases: Phase[];
  aliases: string[];
}

export type DocType = 'enunciados' | 'soluciones' | 'criterios' | 'plantilla';

export const DOC_TYPES: { id: DocType; label: string; short: string; hint: string }[] = [
  {
    id: 'enunciados',
    label: 'Enunciados',
    short: 'Enunciado',
    hint: 'El examen que te dan en el aula',
  },
  {
    id: 'soluciones',
    label: 'Soluciones',
    short: 'Soluciones',
    hint: 'Las soluciones oficiales',
  },
  {
    id: 'criterios',
    label: 'Criterios de corrección',
    short: 'Criterios',
    hint: 'Cómo se puntúa cada pregunta',
  },
  {
    id: 'plantilla',
    label: 'Hoja de respuestas',
    short: 'Hoja',
    hint: 'La plantilla OMR en blanco',
  },
];

export type Session = 'ordinaria' | 'extraordinaria';

export const SESSIONS: { id: Session; label: string; long: string }[] = [
  { id: 'ordinaria', label: 'Ordinaria', long: 'Convocatoria ordinaria · junio' },
  { id: 'extraordinaria', label: 'Extraordinaria', long: 'Convocatoria extraordinaria · julio' },
];

export interface Exam {
  /** slug estable, p. ej. "mate-2025-ordinaria-enunciados" */
  id: string;
  subject: string;
  year: number;
  session: Session;
  type: DocType;
  /** número de páginas del PDF, opcional */
  pages?: number | null;
  /** ruta relativa al repo, p. ej. "exams/2025/ordinaria/MAT/mate-2025-ordinaria-enunciados.pdf" */
  file: string;
  /** original file name as uploaded */
  originalName?: string;
  sizeKB?: number | null;
  language?: 'es' | '';
  official?: boolean;
  notes?: string;
  addedAt: string;
  updatedAt?: string;
}

export interface CatalogFile {
  version: number;
  updatedAt: string | null;
  exams: Exam[];
}

/** Una convocatoria del curso: con fecha exacta o solo el mes, si aún no se ha
 *  publicado el calendario oficial. */
export interface ExamEvent {
  id: string;
  label: string;
  /** `YYYY-MM-DD`, o `null` si todavía no hay fecha. */
  start: string | null;
  end?: string | null;
  /** `YYYY-MM`, para las que solo se sabe el mes. */
  month?: string | null;
  provisional?: boolean;
}

export interface DatesFile {
  updatedAt: string;
  course: string;
  source?: string;
  events: ExamEvent[];
}

/**
 * Find the repository root by walking up until we see package.json + data/.
 * Robust for both the source file and Astro's bundled prerender chunks
 * (which live in dist/.prerender/chunks/).
 */
function findRepoRoot(start: string): string {
  let dir = start;
  for (let i = 0; i < 12; i++) {
    if (
      fs.existsSync(path.join(dir, 'package.json')) &&
      fs.existsSync(path.join(dir, 'data', 'exams.json'))
    ) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
}

export const REPO_ROOT = findRepoRoot(path.dirname(fileURLToPath(import.meta.url)));
export const DATA_FILE = path.join(REPO_ROOT, 'data', 'exams.json');
export const SUBJECTS_FILE = path.join(REPO_ROOT, 'data', 'subjects.json');
export const EXAMS_DIR = path.join(REPO_ROOT, 'public', 'exams');

export function loadSubjects(): Subject[] {
  const raw = JSON.parse(fs.readFileSync(SUBJECTS_FILE, 'utf8')) as { subjects: Subject[] };
  return raw.subjects;
}

/* El calendario es opcional: sin él la portada simplemente no enseña la cuenta
   atrás, en vez de romper el build. */
export const DATES_FILE = path.join(REPO_ROOT, 'data', 'dates.json');

export function loadDates(): DatesFile | null {
  try {
    return JSON.parse(fs.readFileSync(DATES_FILE, 'utf8')) as DatesFile;
  } catch {
    return null;
  }
}

export function loadCatalog(): CatalogFile {
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) as CatalogFile;
}

export function saveCatalog(catalog: CatalogFile): void {
  catalog.exams.sort(sortExams);
  catalog.updatedAt = new Date().toISOString();
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(catalog, null, 2) + '\n', 'utf8');
}

export function sortExams(a: Exam, b: Exam): number {
  return (
    b.year - a.year ||
    a.session.localeCompare(b.session) ||
    a.subject.localeCompare(b.subject, 'ca') ||
    a.type.localeCompare(b.type) ||
    a.id.localeCompare(b.id)
  );
}

export function subjectLabel(subjects: Subject[], code: string): string {
  return subjects.find((s) => s.code === code)?.name ?? code;
}

/**
 * URL pública de una asignatura: `/asignatura/fisica`. Se construye con el
 * nombre —legible y estable— y cae al código si la materia no tiene ficha.
 */
export function subjectSlug(code: string, subjects: Subject[]): string {
  const name = subjects.find((s) => s.code === code)?.name ?? code;
  return slugify(name) || slugify(code);
}

/**
 * Materias que enseña el sitio: las que tienen documentos. Un examen con una
 * asignatura sin ficha también entra, con su código como nombre, para que su
 * tarjeta no enlace a una página inexistente.
 */
export function publishedSubjects(catalog: CatalogFile, subjects: Subject[]): Subject[] {
  const codes = [...new Set(catalog.exams.map((e) => e.subject))];
  return codes.map(
    (code) =>
      subjects.find((s) => s.code === code) ?? {
        code,
        name: code,
        short: code,
        phases: [],
        aliases: [],
      }
  );
}

/**
 * Rutas de las asignaturas publicadas: código → slug. Las calcula un único
 * sitio para que las tarjetas de la portada y `getStaticPaths` no puedan
 * discrepar; si dos materias compartieran nombre, la segunda lleva su código.
 */
export function subjectRoutes(codes: string[], subjects: Subject[]): Map<string, string> {
  const routes = new Map<string, string>();
  const used = new Set<string>();
  for (const code of codes) {
    let slug = subjectSlug(code, subjects);
    if (used.has(slug)) slug = `${slug}-${slugify(code)}`;
    used.add(slug);
    routes.set(code, slug);
  }
  return routes;
}

/* El slug y el recuento de páginas viven en un módulo sin `node:` porque los
   usa también el panel del navegador; aquí solo se reexportan. */
export { slugify, estimatePdfPages } from './slug';

/** Human title used on cards and in the admin table. */
export function examTitle(
  exam: Exam,
  subjects: Subject[],
  typeLabel: string
): string {
  const subj = subjectLabel(subjects, exam.subject);
  const session = SESSIONS.find((s) => s.id === exam.session)?.label ?? exam.session;
  return `${subj} · ${exam.year} · ${session} · ${typeLabel}`;
}

export function relativeFromRepo(absolute: string): string {
  return path.relative(REPO_ROOT, absolute).split(path.sep).join('/');
}

export function absFromRepo(relative: string): string {
  const safe = path.normalize(relative).replace(/^([/\\])+/, '');
  const full = path.join(REPO_ROOT, safe);
  if (!full.startsWith(REPO_ROOT)) throw new Error('Path escapes the repository');
  return full;
}

/** Where a given exam's PDF lives on disk. */
export function examPath(exam: Exam): string {
  return absFromRepo(path.join('public', exam.file));
}

export function fileExists(exam: Exam): boolean {
  try {
    return fs.statSync(examPath(exam)).isFile();
  } catch {
    return false;
  }
}

export function formatBytes(kb: number | null | undefined): string {
  if (!kb && kb !== 0) return '';
  if (kb < 1024) return `${Math.round(kb)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

export function normalize(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}
