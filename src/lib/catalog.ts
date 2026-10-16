import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export type Phase = 'general' | 'especifica';

export interface Subject {
  code: string;
  name: string;
  short: string;
  phase: Phase;
  aliases: string[];
}

export type DocType = 'enunciats' | 'resolucions' | 'criteris' | 'plantilla';

export const DOC_TYPES: { id: DocType; label: string; short: string; hint: string }[] = [
  {
    id: 'enunciats',
    label: 'Enunciados',
    short: 'Enunciado',
    hint: 'El examen que te dan en el aula',
  },
  {
    id: 'resolucions',
    label: 'Resoluciones',
    short: 'Soluciones',
    hint: 'Las soluciones oficiales',
  },
  {
    id: 'criteris',
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

export type Session = 'juny' | 'setembre';

export const SESSIONS: { id: Session; label: string; long: string }[] = [
  { id: 'juny', label: 'Junio', long: 'Convocatoria de junio' },
  { id: 'setembre', label: 'Septiembre', long: 'Convocatoria de septiembre' },
];

export interface Exam {
  /** stable slug, e.g. "mat-2024-juny-enunciats" */
  id: string;
  subject: string;
  year: number;
  session: Session;
  type: DocType;
  /** page count in the PDF, optional */
  pages?: number | null;
  /** repo-relative path, e.g. "exams/2024/juny/MAT/mat-2024-juny-enunciats.pdf" */
  file: string;
  /** original file name as uploaded */
  originalName?: string;
  sizeKB?: number | null;
  language?: 'ca' | 'es' | '';
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

/** Turn an arbitrary string into a URL-safe slug. */
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

/** Human title used on cards and in the admin table. */
export function examTitle(
  exam: Exam,
  subjects: Subject[],
  typeLabel: string
): string {
  const subj = subjectLabel(subjects, exam.subject);
  const session = exam.session === 'juny' ? 'junio' : 'septiembre';
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

/** Rough page count by counting /Type /Page objects. Best effort, no dependency. */
export function estimatePdfPages(buffer: Buffer): number | null {
  const text = buffer.toString('latin1');
  const matches = text.match(/\/Type\s*\/Page[^s]/g);
  if (!matches) return null;
  const count = text.match(/\/Count\s+(\d+)/);
  return count ? Number(count[1]) : matches.length;
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
