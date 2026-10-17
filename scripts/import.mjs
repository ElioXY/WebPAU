#!/usr/bin/env node
/* =========================================================================
   Importador de PDFs en bloque.

   Lee una carpeta (o un archivo), deduce asignatura, año, convocatoria y tipo
   del nombre, copia cada PDF a public/exams/… y añade las filas al catálogo.
   Nunca sobrescribe: si ya hay un documento con esa combinación, lo dice y
   sigue con el resto.

     npm run import ./descargas
     npm run import ./descargas -- --dry-run
     npm run import ./descargas -- --move --subject FIS

   --dry-run  enseña lo que haría sin tocar nada
   --move     mueve los PDFs en vez de copiarlos
   --root     raíz del proyecto (para pruebas)
   --subject  fuerza la asignatura, --year, --session y --type hacen lo mismo
   ========================================================================= */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { estimatePdfPages, parseExamName, slugify } from '../src/lib/exam-name.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(HERE, '..');

const SESSION_IDS = ['ordinaria', 'extraordinaria'];
const TYPE_IDS = ['enunciados', 'soluciones', 'criterios', 'plantilla'];
const TYPE_LABEL = {
  enunciados: 'enunciado',
  soluciones: 'soluciones',
  criterios: 'criterios',
  plantilla: 'hoja',
};

function usage(message) {
  if (message) console.error(`\n  ${message}\n`);
  console.error(`Uso: npm run import <carpeta-o-pdf> [opciones]

  --dry-run            enseña lo que haría, sin escribir nada
  --move               mueve los archivos en lugar de copiarlos
  --root <dir>         raíz del proyecto (por defecto, la de este script)
  --subject <código>   fuerza la asignatura
  --year <aaaa>        fuerza el año
  --session <id>       fuerza la convocatoria (ordinaria | extraordinaria)
  --type <id>          fuerza el tipo (enunciados | soluciones | criterios | plantilla)
`);
  process.exit(1);
}

function parseArgs(argv) {
  const options = {
    input: null,
    dryRun: false,
    move: false,
    root: DEFAULT_ROOT,
    subject: null,
    year: null,
    session: null,
    type: null,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      if (options.input) usage(`Sobra «${arg}»: solo se lee una carpeta a la vez.`);
      options.input = arg;
      continue;
    }

    const [flag, inline] = arg.slice(2).split('=');
    const value = () => {
      if (inline !== undefined) return inline;
      const next = argv[++i];
      if (next === undefined) usage(`Falta el valor de --${flag}`);
      return next;
    };

    if (flag === 'dry-run') options.dryRun = true;
    else if (flag === 'move') options.move = true;
    else if (flag === 'root') options.root = path.resolve(value());
    else if (flag === 'subject') options.subject = value().trim().toUpperCase();
    else if (flag === 'year') options.year = Number(value());
    else if (flag === 'session') options.session = value().trim().toLowerCase();
    else if (flag === 'type') options.type = value().trim().toLowerCase();
    else if (flag === 'help' || flag === 'h') usage();
    else usage(`Opción desconocida: --${flag}`);
  }

  if (!options.input) usage('Falta la carpeta con los PDFs.');
  return options;
}

const options = parseArgs(process.argv.slice(2));

const SUBJECTS_FILE = path.join(options.root, 'data', 'subjects.json');
const DATA_FILE = path.join(options.root, 'data', 'exams.json');
const EXAMS_DIR = path.join(options.root, 'public', 'exams');

if (!fs.existsSync(SUBJECTS_FILE)) usage(`No encuentro ${SUBJECTS_FILE}`);
if (!fs.existsSync(DATA_FILE)) usage(`No encuentro ${DATA_FILE}`);

const subjects = JSON.parse(fs.readFileSync(SUBJECTS_FILE, 'utf8')).subjects;
const catalog = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
const subjectByCode = new Map(subjects.map((s) => [s.code, s]));

/* ------------------------------------------------------------- recorrido */

function collect(input, found = []) {
  const stat = fs.statSync(input);
  if (stat.isFile()) {
    if (/\.pdf$/i.test(input)) found.push(input);
    return found;
  }
  for (const entry of fs.readdirSync(input, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name)
  )) {
    if (entry.name.startsWith('.')) continue;
    collect(path.join(input, entry.name), found);
  }
  return found;
}

if (!fs.existsSync(options.input)) usage(`No existe «${options.input}».`);
const files = collect(path.resolve(options.input));
if (files.length === 0) usage(`No hay ningún PDF en «${options.input}».`);

/* ---------------------------------------------------------------- helpers */

const sortExams = (a, b) =>
  b.year - a.year ||
  a.session.localeCompare(b.session) ||
  a.subject.localeCompare(b.subject) ||
  a.type.localeCompare(b.type) ||
  a.id.localeCompare(b.id);

const keyOf = (exam) => `${exam.subject}|${exam.year}|${exam.session}|${exam.type}`;

const takenIds = new Set(catalog.exams.map((e) => e.id));
const takenKeys = new Map(catalog.exams.map((e) => [keyOf(e), e]));

function buildId(subject, year, session, type) {
  const base = `${slugify(subject)}-${year}-${session}-${type}`;
  if (!takenIds.has(base)) {
    takenIds.add(base);
    return base;
  }
  for (let i = 2; i < 500; i++) {
    const candidate = `${base}-${i}`;
    if (!takenIds.has(candidate)) {
      takenIds.add(candidate);
      return candidate;
    }
  }
  const fallback = `${base}-${Date.now()}`;
  takenIds.add(fallback);
  return fallback;
}

const pad = (text, width) => String(text).padEnd(width);

/* --------------------------------------------------------------- lectura */

const accepted = [];
const skipped = [];

for (const file of files) {
  const originalName = path.basename(file);
  const parsed = parseExamName(originalName, subjects);

  const subject = options.subject ?? parsed.subject;
  const year = options.year ?? parsed.year;
  const session = options.session ?? parsed.session;
  const type = options.type ?? parsed.type;

  const reasons = [];
  if (!subject) reasons.push('sin asignatura');
  else if (!subjectByCode.has(subject)) reasons.push(`asignatura desconocida «${subject}»`);
  if (!year || year < 1980 || year > 2100) reasons.push('sin año');
  if (!session || !SESSION_IDS.includes(session)) reasons.push('sin convocatoria');
  if (!type || !TYPE_IDS.includes(type)) reasons.push('sin tipo de documento');

  if (reasons.length) {
    skipped.push({ originalName, reason: reasons.join(', ') });
    continue;
  }

  const key = `${subject}|${year}|${session}|${type}`;
  if (takenKeys.has(key)) {
    const existing = takenKeys.get(key);
    skipped.push({
      originalName,
      reason: `ya está en el archivo (${existing.id})`,
    });
    continue;
  }

  const id = buildId(subject, year, session, type);
  const relative = `exams/${year}/${session}/${subject}/${id}.pdf`;
  const destination = path.join(options.root, 'public', relative);
  const bytes = fs.readFileSync(file);
  const sizeKB = Math.round(bytes.byteLength / 1024);

  const exam = {
    id,
    subject,
    year,
    session,
    type,
    pages: estimatePdfPages(bytes),
    file: relative,
    originalName,
    sizeKB,
    language: 'es',
    official: true,
    addedAt: new Date().toISOString(),
  };

  accepted.push({ file, exam, destination });
  takenKeys.set(key, exam);
}

/* ----------------------------------------------------------------- informe */

const label = (exam) => {
  const subjectName = subjectByCode.get(exam.subject)?.name ?? exam.subject;
  return `${exam.year} · ${exam.session} · ${subjectName} · ${TYPE_LABEL[exam.type] ?? exam.type}`;
};

if (accepted.length) {
  console.log('');
  for (const { exam } of accepted) {
    console.log(`  ✓ ${pad(label(exam), 58)} ${exam.originalName}`);
    console.log(`    → public/${exam.file}`);
  }
}

if (skipped.length) {
  console.log('');
  for (const item of skipped) {
    console.log(`  · ${pad(item.originalName, 58)} ${item.reason}`);
  }
}

const plural = accepted.length === 1 ? 'documento' : 'documentos';
const state = options.dryRun
  ? accepted.length === 1
    ? 'listo (dry-run: no se ha escrito nada)'
    : 'listos (dry-run: no se ha escrito nada)'
  : accepted.length === 1
    ? 'importado'
    : 'importados';

console.log(`\n  ${accepted.length} ${plural} ${state}${skipped.length ? ` · ${skipped.length} omitidos` : ''}\n`);

if (options.dryRun || accepted.length === 0) process.exit(0);

/* --------------------------------------------------------------- escritura */

for (const { file, exam, destination } of accepted) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  if (options.move) fs.renameSync(file, destination);
  else fs.copyFileSync(file, destination);
  if (!fs.existsSync(destination)) {
    console.error(`  ✗ No se pudo escribir ${destination}`);
    process.exit(1);
  }
  exam.updatedAt = exam.addedAt;
}

catalog.exams = [...catalog.exams, ...accepted.map((a) => a.exam)].sort(sortExams);
catalog.updatedAt = new Date().toISOString();
fs.writeFileSync(DATA_FILE, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');

console.log(`  Catálogo actualizado: ${catalog.exams.length} documentos en total.\n`);
