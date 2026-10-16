import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import express from 'express';
import multer from 'multer';
import {
  DOC_TYPES,
  EXAMS_DIR,
  REPO_ROOT,
  SESSIONS,
  absFromRepo,
  estimatePdfPages,
  fileExists,
  loadCatalog,
  loadSubjects,
  saveCatalog,
  slugify,
  type Exam,
} from '../src/lib/catalog.ts';

const PORT = Number(process.env.ADMIN_PORT ?? 4321);
const HOST = process.env.ADMIN_HOST ?? '127.0.0.1';
const MAX_MB = Number(process.env.ADMIN_MAX_MB ?? 80);

const TOKEN_FILE = path.join(REPO_ROOT, 'admin', '.token');
const TOKEN = (() => {
  const fromEnv = process.env.ADMIN_TOKEN;
  if (fromEnv) return fromEnv;
  try {
    const existing = fs.readFileSync(TOKEN_FILE, 'utf8').trim();
    if (existing.length >= 16) return existing;
  } catch {
    /* generate below */
  }
  const fresh = crypto.randomBytes(24).toString('base64url');
  fs.writeFileSync(TOKEN_FILE, fresh, { encoding: 'utf8', mode: 0o600 });
  return fresh;
})();

const DOC_TYPE_IDS = new Set(DOC_TYPES.map((t) => t.id));
const SESSION_IDS = new Set(SESSIONS.map((s) => s.id));

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

/* ------------------------------------------------------------------ auth */

function guard(req: express.Request, res: express.Response, next: express.NextFunction) {
  const header = req.get('x-admin-token') ?? '';
  const query = typeof req.query.token === 'string' ? req.query.token : '';
  const supplied = header || query;
  const ok =
    supplied.length === TOKEN.length &&
    crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(TOKEN));
  if (!ok) {
    res.status(401).json({ error: 'Token incorrecto. Copia el que aparece en la terminal del servidor.' });
    return;
  }
  next();
}

/* --------------------------------------------------------------- helpers */

function readString(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function parseYear(value: unknown): number | null {
  const year = Number.parseInt(readString(value), 10);
  if (!Number.isFinite(year) || year < 1980 || year > 2100) return null;
  return year;
}

function parsePages(value: unknown): number | null {
  const raw = readString(value);
  if (!raw) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function buildId(subjectCode: string, year: number, session: string, type: string, taken: Set<string>): string {
  const base = `${slugify(subjectCode)}-${year}-${session}-${type}`;
  if (!taken.has(base)) return base;
  for (let i = 2; i < 500; i++) {
    const candidate = `${base}-${i}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base}-${Date.now()}`;
}

function normalizeOriginalName(name: string, ext: string): string {
  const base = path.basename(name || 'examen').replace(/\.[^.]+$/, '');
  return `${slugify(base)}${ext}`;
}

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = 'HttpError';
  }
}

function git(args: string[]): { code: number; stdout: string; stderr: string } {
  const res = spawnSync('git', args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });
  return {
    code: res.status ?? 1,
    stdout: (res.stdout ?? '').trim(),
    stderr: (res.stderr ?? '').trim(),
  };
}

function gitState() {
  let branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
  if (branch.code !== 0) {
    // repositorio aún sin commits: la rama existe pero HEAD no está resuelto
    const symbolic = git(['symbolic-ref', '--short', 'HEAD']);
    branch = { code: symbolic.code === 0 ? 0 : 1, stdout: symbolic.stdout, stderr: symbolic.stderr };
  }
  const remote = git(['remote', 'get-url', 'origin']);
  const status = git(['status', '--porcelain']);
  const last = git(['log', '-1', '--pretty=%h %s']);
  const ahead = git(['rev-list', '--count', '@{upstream}..HEAD']);
  const behind = git(['rev-list', '--count', 'HEAD..@{upstream}']);
  return {
    branch: branch.code === 0 && branch.stdout ? branch.stdout : null,
    remote: remote.code === 0 ? remote.stdout.replace(/\.git$/, '') : null,
    dirtyLines: status.code === 0 && status.stdout ? status.stdout.split('\n').length : 0,
    lastCommit: last.code === 0 && last.stdout ? last.stdout : null,
    unborn: last.code !== 0,
    ahead: ahead.code === 0 ? Number(ahead.stdout) : null,
    behind: behind.code === 0 ? Number(behind.stdout) : null,
  };
}

/* ---------------------------------------------------------------- upload */

const storage = multer.diskStorage({
  destination(_req, _file, cb) {
    fs.mkdirSync(EXAMS_DIR, { recursive: true });
    cb(null, EXAMS_DIR);
  },
  filename(_req, file, cb) {
    const ext = path.extname(file.originalname || '.pdf').toLowerCase() || '.pdf';
    const unique = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    cb(null, `${unique}--${normalizeOriginalName(file.originalname, ext)}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_MB * 1024 * 1024, files: 8 },
  fileFilter(_req, file, cb) {
    const isPdf =
      file.mimetype === 'application/pdf' ||
      path.extname(file.originalname || '').toLowerCase() === '.pdf';
    if (!isPdf) {
      cb(new HttpError(415, `“${file.originalname}” no es un PDF.`));
      return;
    }
    cb(null, true);
  },
});

/* ------------------------------------------------------------------ API */

app.get('/api/session', (_req, res) => {
  res.json({ ok: true, requiresToken: true });
});

app.post('/api/login', (req, res) => {
  const supplied = readString(req.body?.token);
  const ok =
    supplied.length === TOKEN.length &&
    crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(TOKEN));
  if (!ok) {
    res.status(401).json({ error: 'Token incorrecto.' });
    return;
  }
  res.json({ ok: true, token: TOKEN });
});

app.get('/api/state', guard, (_req, res) => {
  const catalog = loadCatalog();
  const subjects = loadSubjects();
  res.json({
    catalog,
    subjects,
    types: DOC_TYPES,
    sessions: SESSIONS,
    missingFiles: catalog.exams.filter((e) => !fileExists(e)).map((e) => e.id),
    git: gitState(),
    token: TOKEN,
  });
});

app.post('/api/exams', guard, upload.array('files', 8), (req, res) => {
  const subjects = loadSubjects();
  const subject = readString(req.body.subject);
  const year = parseYear(req.body.year);
  const session = readString(req.body.session);
  const type = readString(req.body.type);

  if (!subjects.some((s) => s.code === subject)) throw new HttpError(400, 'Asignatura desconocida.');
  if (!year) throw new HttpError(400, 'Año no válido.');
  if (!SESSION_IDS.has(session)) throw new HttpError(400, 'Convocatoria no válida.');
  if (!DOC_TYPE_IDS.has(type)) throw new HttpError(400, 'Tipo de documento no válido.');

  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  const rejected = files.filter((f) => path.extname(f.originalname).toLowerCase() !== '.pdf');
  if (rejected.length) throw new HttpError(415, 'Solo se aceptan archivos PDF.');
  if (files.length === 0) throw new HttpError(400, 'Selecciona al menos un PDF.');

  const catalog = loadCatalog();
  const taken = new Set(catalog.exams.map((e) => e.id));
  const now = new Date().toISOString();
  const created: Exam[] = [];

  for (const file of files) {
    const id = buildId(subject, year, session, type, taken);
    taken.add(id);
    const relative = `exams/${year}/${session}/${subject}/${id}.pdf`;
    const targetAbs = absFromRepo(path.join('public', relative));
    fs.mkdirSync(path.dirname(targetAbs), { recursive: true });
    fs.renameSync(file.path, targetAbs);

    const buffer = fs.readFileSync(targetAbs);
    const language = readString(req.body.language);
    const exam: Exam = {
      id,
      subject,
      year,
      session: session as Exam['session'],
      type: type as Exam['type'],
      pages: parsePages(req.body.pages) ?? estimatePdfPages(buffer),
      file: relative,
      originalName: file.originalname,
      sizeKB: Math.round(buffer.byteLength / 1024),
      language: (['ca', 'es', ''] as const).includes(language as 'ca') ? (language as Exam['language']) : '',
      official: readString(req.body.official) === 'true',
      notes: readString(req.body.notes),
      addedAt: now,
      updatedAt: now,
    };
    catalog.exams.push(exam);
    created.push(exam);
  }

  saveCatalog(catalog);
  res.status(201).json({ created, catalog });
});

app.patch('/api/exams/:id', guard, (req, res) => {
  const catalog = loadCatalog();
  const exam = catalog.exams.find((e) => e.id === req.params.id);
  if (!exam) throw new HttpError(404, 'No existe ese examen.');

  const subjects = loadSubjects();
  if (req.body.subject !== undefined) {
    const subject = readString(req.body.subject);
    if (!subjects.some((s) => s.code === subject)) throw new HttpError(400, 'Asignatura desconocida.');
    exam.subject = subject;
  }
  if (req.body.year !== undefined) {
    const year = parseYear(req.body.year);
    if (!year) throw new HttpError(400, 'Año no válido.');
    exam.year = year;
  }
  if (req.body.session !== undefined) {
    const session = readString(req.body.session);
    if (!SESSION_IDS.has(session)) throw new HttpError(400, 'Convocatoria no válida.');
    exam.session = session as Exam['session'];
  }
  if (req.body.type !== undefined) {
    const type = readString(req.body.type);
    if (!DOC_TYPE_IDS.has(type)) throw new HttpError(400, 'Tipo de documento no válido.');
    exam.type = type as Exam['type'];
  }
  if (req.body.language !== undefined) {
    const language = readString(req.body.language);
    exam.language = (['ca', 'es', ''] as const).includes(language as 'ca')
      ? (language as Exam['language'])
      : '';
  }
  if (req.body.official !== undefined) {
    exam.official = req.body.official === true || readString(req.body.official) === 'true';
  }
  if (req.body.notes !== undefined) {
    exam.notes = readString(req.body.notes);
  }
  if (req.body.pages !== undefined) {
    exam.pages = parsePages(req.body.pages);
  }
  exam.updatedAt = new Date().toISOString();

  saveCatalog(catalog);
  res.json({ exam, catalog });
});

app.delete('/api/exams/:id', guard, (req, res) => {
  const catalog = loadCatalog();
  const index = catalog.exams.findIndex((e) => e.id === req.params.id);
  if (index === -1) throw new HttpError(404, 'No existe ese examen.');
  const [removed] = catalog.exams.splice(index, 1);

  try {
    fs.unlinkSync(absFromRepo(path.join('public', removed.file)));
  } catch {
    /* file already gone */
  }
  saveCatalog(catalog);
  res.json({ removed, catalog });
});

/* ------------------------------------------------------------------- git */

app.post('/api/git/push', guard, (req, res) => {
  const message = readString(req.body?.message) || `docs: actualiza el archivo de exámenes (${new Date().toISOString().slice(0, 16).replace('T', ' ')})`;
  const add = git(['add', '--', 'data', 'public/exams']);
  if (add.code !== 0) {
    res.status(500).json({ error: 'git add falló', detail: add.stderr });
    return;
  }
  const status = git(['status', '--porcelain']);
  if (!status.stdout) {
    res.json({ pushed: false, message: 'No había nada nuevo que subir.' });
    return;
  }
  const staged = git(['diff', '--cached', '--name-only']);
  const files = staged.stdout ? staged.stdout.split('\n').length : 0;
  const commit = git(['commit', '-m', message]);
  if (commit.code !== 0) {
    res.status(500).json({ error: 'git commit falló', detail: commit.stderr || commit.stdout });
    return;
  }
  const push = git(['push']);
  if (push.code !== 0) {
    res.json({
      pushed: false,
      message: 'Guardado en local, pero el push falló.',
      detail: push.stderr || push.stdout,
      git: gitState(),
    });
    return;
  }
  res.json({ pushed: true, message: `Subidos ${files} archivo(s) a GitHub.`, git: gitState() });
});

app.post('/api/git/pull', guard, (_req, res) => {
  const pull = git(['pull', '--rebase']);
  if (pull.code !== 0) {
    res.status(500).json({ error: 'git pull falló', detail: pull.stderr || pull.stdout });
    return;
  }
  res.json({ message: pull.stdout || 'Ya estaba todo actualizado.', git: gitState() });
});

/* -------------------------------------------------------------- front-end */

app.get('/favicon.svg', (_req, res) => {
  res.sendFile(path.join(REPO_ROOT, 'public', 'favicon.svg'));
});

app.use(express.static(path.join(REPO_ROOT, 'admin', 'public'), { extensions: ['html'] }));

/** Uploaded-but-not-committed files land in the exams root; sweep them on failure. */
function sweepOrphans() {
  try {
    const catalog = loadCatalog();
    const keep = new Set(catalog.exams.map((e) => path.basename(e.file)));
    for (const name of fs.readdirSync(EXAMS_DIR)) {
      const isTemp = /^\d{10,}-[0-9a-f]{8}--/.test(name);
      if (isTemp || !keep.has(name)) {
        fs.rmSync(path.join(EXAMS_DIR, name), { force: true, recursive: true });
      }
    }
  } catch {
    /* nothing to sweep */
  }
}

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  sweepOrphans();
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  if (err instanceof multer.MulterError) {
    const message =
      err.code === 'LIMIT_FILE_SIZE' ? `Cada PDF puede pesar hasta ${MAX_MB} MB.`
      : err.code === 'LIMIT_FILE_COUNT' ? 'Demasiados archivos a la vez.'
      : err.message;
    res.status(400).json({ error: message });
    return;
  }
  console.error(err);
  res.status(500).json({ error: 'Error inesperado en el servidor.' });
});

app.listen(PORT, HOST, () => {
  const line = '─'.repeat(58);
  console.log(`\n${line}`);
  console.log('  WebPAU · Panel de administración');
  console.log(line);
  console.log(`  Panel:   http://${HOST}:${PORT}`);
  console.log(`  Token:   ${TOKEN}`);
  console.log(`  Token guardado en admin/.token (no se sube a GitHub)`);
  console.log(`  Rama:    ${gitState().branch ?? '?'} → ${gitState().remote ?? 'sin remoto'}`);
  console.log(`${line}\n`);
});
