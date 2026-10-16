/* =========================================================================
   WebPAU — Panel de administración (cliente)

   No hay servidor detrás: el panel lee el catálogo del repositorio con la API
   de GitHub, sube los PDFs y publica todo en un único commit. GitHub Pages
   reconstruye la web sola, así que se puede subir desde cualquier dispositivo.
   ========================================================================= */

import {
  GithubError,
  bytesToBase64,
  commitFiles,
  getRepoInfo,
  readJsonFile,
  readTreePaths,
  textToBase64,
  type FileChange,
} from '../lib/github';
import { estimatePdfPages, slugify } from '../lib/slug';

/* ---------------------------------------------------------------- tipos */

type Phase = 'acceso' | 'admision';

interface Subject {
  code: string;
  name: string;
  short: string;
  phases: Phase[];
  aliases: string[];
}

interface Exam {
  id: string;
  subject: string;
  year: number;
  session: string;
  type: string;
  pages?: number | null;
  file: string;
  originalName?: string;
  sizeKB?: number | null;
  language?: 'es' | '';
  official?: boolean;
  notes?: string;
  addedAt: string;
  updatedAt?: string;
}

interface Catalog {
  version: number;
  updatedAt: string | null;
  exams: Exam[];
}

interface Config {
  owner: string;
  repo: string;
  base: string;
  maxMb: number;
  types: [string, string, string, string][];
  sessions: [string, string, string][];
}

interface PendingFile {
  file: File;
  error?: string;
}

/* ------------------------------------------------------------ config DOM */

const config = JSON.parse($('#admin-config').textContent ?? '{}') as Config;
const TYPES = config.types.map(([id, short, label, hint]) => ({ id, short, label, hint }));
const SESSIONS = config.sessions.map(([id, label, long]) => ({ id, label, long }));

/** Rutas dentro del repositorio, no dentro de `dist/`. */
const CATALOG_PATH = 'data/exams.json';
const SUBJECTS_PATH = 'data/subjects.json';
const pdfRepoPath = (exam: Exam) => `public/${exam.file}`;
const pdfPublicUrl = (exam: Exam) =>
  new URL(`${config.base}/${exam.file}`.replace(/\/{2,}/g, '/'), window.location.origin).href;

const TOKEN_KEY = 'webpau.admin.token';

/* ------------------------------------------------------------- utilidades */

function $<T extends Element = HTMLElement>(sel: string, root: ParentNode = document): T {
  return root.querySelector<T>(sel)!;
}
function $$<T extends Element = HTMLElement>(sel: string, root: ParentNode = document): T[] {
  return Array.from(root.querySelectorAll<T>(sel));
}

const escapeHtml = (value: string): string =>
  String(value).replace(
    /[&<>"']/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!
  );

const fmtBytes = (kb?: number | null): string => {
  if (!kb && kb !== 0) return '—';
  return kb < 1024 ? `${kb} KB` : `${(kb / 1024).toFixed(1)} MB`;
};

const fmtDate = (iso?: string): string => {
  if (!iso) return '—';
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? '—'
    : new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: '2-digit', year: '2-digit' }).format(date);
};

const ICON_EDIT = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11.5 2.5 13.5 4.5 5.5 12.5 2.5 13.5 3.5 10.5Z"/></svg>`;
const ICON_DEL = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5 5 13.5h6l.5-9M6.8 7v4M9.2 7v4"/></svg>`;
const ICON_OPEN = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3h4v4M13 3 7.5 8.5M11 9.5V12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h2.5"/></svg>`;

/* ----------------------------------------------------------------- estado */

let token = localStorage.getItem(TOKEN_KEY) ?? '';
const ref = { owner: config.owner, repo: config.repo };
let branch = '';
let subjects: Subject[] = [];
let catalog: Catalog = { version: 1, updatedAt: null, exams: [] };
/** Rutas de archivo que existen de verdad en la rama. */
let filesOnDisk = new Set<string>();
let pending: PendingFile[] = [];
let editingId: string | null = null;
let busy = false;

const subjectByCode = (code: string) => subjects.find((s) => s.code === code);
const typeById = (id: string) => TYPES.find((t) => t.id === id);
const sessionById = (id: string) => SESSIONS.find((s) => s.id === id);

const subjectName = (code: string) => subjectByCode(code)?.name ?? code;
const typeLabel = (id: string) => typeById(id)?.label ?? id;
const typeShort = (id: string) => typeById(id)?.short ?? id;
const sessionLabel = (id: string) => sessionById(id)?.label ?? id;

const missingFiles = () =>
  new Set(catalog.exams.filter((exam) => !filesOnDisk.has(pdfRepoPath(exam))).map((e) => e.id));

/* ---------------------------------------------------------- barra y avisos */

function setStatus(state: 'idle' | 'busy' | 'stale' | 'warn', text: string): void {
  const box = $('#barState', document);
  box.dataset.state = state;
  $('#barStateText').textContent = text;
}

function toast(
  message: string,
  kind: 'info' | 'ok' | 'error' = 'info',
  ttl = 4200,
  link?: { href: string; text: string }
): void {
  const el = document.createElement('div');
  el.className = 'toast';
  el.dataset.kind = kind;
  el.append(document.createTextNode(message));
  if (link) {
    el.append(document.createTextNode(' '));
    const anchor = document.createElement('a');
    anchor.href = link.href;
    anchor.target = '_blank';
    anchor.rel = 'noreferrer';
    anchor.textContent = link.text;
    el.append(anchor);
  }
  $('#toasts').append(el);
  setTimeout(() => {
    el.classList.add('is-out');
    setTimeout(() => el.remove(), 220);
  }, ttl);
}

function reportError(error: unknown): void {
  if (error instanceof GithubError) {
    if (error.status === 401 || error.status === 403) {
      // Sin permisos no hay nada que hacer dentro del panel.
      exit('El token no sirve para publicar aquí. Vuelve a entrar con uno válido.');
    }
    toast(error.detail ? `${error.message}\n${error.detail}` : error.message, 'error', 9000);
    return;
  }
  toast(error instanceof Error ? error.message : 'Ha ocurrido un error inesperado.', 'error', 9000);
}

/* -------------------------------------------------------------- progreso */

let lastLogLine = '';

function progressStart(label: string): void {
  const box = $('#progress');
  box.hidden = false;
  box.dataset.state = 'busy';
  $('#progressLog').innerHTML = '';
  lastLogLine = '';
  progressUpdate(label, 0);
}

function progressUpdate(label: string, ratio: number): void {
  const pct = Math.round(Math.min(1, Math.max(0, ratio)) * 100);
  $('#progressLabel').textContent = label;
  $('#progressPct').textContent = `${pct} %`;
  $('#progressFill').style.width = `${pct}%`;

  if (label !== lastLogLine) {
    lastLogLine = label;
    const line = document.createElement('li');
    line.textContent = label;
    $('#progressLog').append(line);
    $('#progressLog').scrollTop = $('#progressLog').scrollHeight;
  }
}

function progressEnd(state: 'ok' | 'error'): void {
  const box = $('#progress');
  box.dataset.state = state;
  $('#progressFill').style.width = '100%';
  $('#progressLabel').textContent = state === 'ok' ? 'Publicado' : 'No se pudo publicar';
  $('#progressPct').textContent = '';
  if (state === 'ok') setTimeout(() => (box.hidden = true), 4000);
}

/* ---------------------------------------------------------------- acceso */

function exit(message?: string): void {
  token = '';
  localStorage.removeItem(TOKEN_KEY);
  catalog = { version: 1, updatedAt: null, exams: [] };
  subjects = [];
  filesOnDisk = new Set();
  $('#app').hidden = true;
  $('#gate').hidden = false;
  const error = $('#gateError');
  error.hidden = !message;
  error.textContent = message ?? '';
  $('#tokenInput').focus();
}

async function connect(): Promise<void> {
  setStatus('busy', 'Leyendo el repositorio…');
  $('#app').hidden = false;
  $('#gate').hidden = true;
  await refresh();
}

async function refresh(): Promise<void> {
  try {
    if (!branch) {
      const info = await getRepoInfo(token, ref);
      branch = info.defaultBranch;
    }

    const [subjectsFile, catalogFile, tree] = await Promise.all([
      readJsonFile<{ subjects: Subject[] }>(token, ref, branch, SUBJECTS_PATH),
      readJsonFile<Catalog>(token, ref, branch, CATALOG_PATH),
      readTreePaths(token, ref, branch),
    ]);

    subjects = subjectsFile?.data.subjects ?? [];
    catalog = catalogFile?.data ?? { version: 1, updatedAt: null, exams: [] };
    filesOnDisk = tree.paths;

    if (subjects.length === 0) {
      toast(`No he podido leer ${SUBJECTS_PATH}: el desplegable de asignaturas queda vacío.`, 'error', 9000);
    }

    paintSubjects();
    paintSessions();
    paintTypes();
    paintFilters();
    paintFiles();
    renderTable();
    prefill();

    const missing = missingFiles().size;
    setStatus(
      missing > 0 ? 'warn' : 'idle',
      `${ref.owner}/${ref.repo} · ${branch} · ${catalog.exams.length} doc.${
        missing > 0 ? ` · ${missing} sin PDF` : ''
      }`
    );
  } catch (error) {
    if (error instanceof GithubError && (error.status === 401 || error.status === 403)) {
      exit(error.message);
      return;
    }
    setStatus('stale', 'Sin conexión con GitHub');
    reportError(error);
  }
}

$('#gateForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = $('#gateSubmit');
  const candidate = $<HTMLInputElement>('#tokenInput').value.trim();
  const error = $('#gateError');

  if (!candidate) {
    error.textContent = 'Pega un token para entrar.';
    error.hidden = false;
    return;
  }

  button.classList.add('is-busy');
  token = candidate;
  try {
    // Comprobamos el token y el repositorio antes de dar por buena la sesión.
    const info = await getRepoInfo(token, ref);
    branch = info.defaultBranch;
    localStorage.setItem(TOKEN_KEY, token);
    error.hidden = true;
    await connect();
  } catch (err) {
    token = '';
    localStorage.removeItem(TOKEN_KEY);
    error.textContent =
      err instanceof GithubError
        ? err.message
        : 'No se pudo comprobar el token. Inténtalo de nuevo.';
    error.hidden = false;
  } finally {
    button.classList.remove('is-busy');
  }
});

$('#btnLogout').addEventListener('click', () => exit());
$('#btnSync').addEventListener('click', async (event) => {
  const button = event.currentTarget as HTMLButtonElement;
  button.classList.add('is-busy');
  await refresh();
  button.classList.remove('is-busy');
});

/* ------------------------------------------------------- formulario: campos */

function paintSubjects(): void {
  const select = $<HTMLSelectElement>('#subject');
  const previous = select.value;
  select.innerHTML = '';

  /* Una materia de modalidad puede contar en las dos fases. Se lista una sola
     vez —repetirla en ambos grupos confundía— y el aviso lo dice. */
  for (const [phase, label] of [
    ['acceso', 'Fase de acceso'],
    ['admision', 'Fase de admisión'],
  ] as const) {
    const group = document.createElement('optgroup');
    group.label = label;
    const inGroup = (s: Subject) =>
      phase === 'acceso' ? s.phases.includes('acceso') : !s.phases.includes('acceso');

    for (const subject of subjects.filter(inGroup)) {
      const option = document.createElement('option');
      option.value = subject.code;
      const both = subject.phases.length > 1 ? ' · ambas fases' : '';
      option.textContent = `${subject.name} (${subject.code})${both}`;
      group.append(option);
    }
    if (group.children.length) select.append(group);
  }

  if (previous && subjectByCode(previous)) select.value = previous;
}

function paintSessions(): void {
  const box = $('#sessionSeg');
  const previous = box.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.dataset.v;
  box.innerHTML = '';

  for (const session of SESSIONS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.v = session.id;
    button.textContent = session.label;
    button.title = session.long;
    button.setAttribute('aria-pressed', String(session.id === (previous ?? SESSIONS[0]?.id)));
    box.append(button);
  }
}

function paintTypes(): void {
  const box = $('#typeGroup');
  const previous = box.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.dataset.v;
  box.innerHTML = '';

  for (const type of TYPES) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'type-btn';
    button.dataset.v = type.id;
    button.title = `${type.label} · ${type.hint}`;
    button.setAttribute('aria-pressed', String(type.id === (previous ?? 'enunciados')));
    button.innerHTML = `<i></i><span>${escapeHtml(type.short)}</span>`;
    box.append(button);
  }
}

$('#sessionSeg').addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest('button');
  if (!button) return;
  $$('#sessionSeg button').forEach((b) => b.setAttribute('aria-pressed', String(b === button)));
});

$('#typeGroup').addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest('.type-btn');
  if (!button) return;
  $$('.type-btn', $('#typeGroup')).forEach((b) =>
    b.setAttribute('aria-pressed', String(b === button))
  );
});

const sessionValue = () =>
  $('#sessionSeg').querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.dataset.v ?? '';
const typeValue = () =>
  $('#typeGroup').querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.dataset.v ?? '';

/* --------------------------------------------------------------- archivos */

const drop = $('#drop');
const fileInput = $<HTMLInputElement>('#files');

drop.addEventListener('click', (event) => {
  if (event.target === fileInput) return;
  fileInput.click();
});
drop.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    fileInput.click();
  }
});

for (const type of ['dragenter', 'dragover'] as const) {
  drop.addEventListener(type, (event) => {
    event.preventDefault();
    drop.classList.add('is-over');
  });
}
for (const type of ['dragleave', 'drop'] as const) {
  drop.addEventListener(type, (event) => {
    event.preventDefault();
    drop.classList.remove('is-over');
  });
}
drop.addEventListener('drop', (event) => addFiles((event as DragEvent).dataTransfer?.files ?? null));
fileInput.addEventListener('change', () => {
  addFiles(fileInput.files);
  fileInput.value = '';
});

function addFiles(list: FileList | File[] | null): void {
  if (!list) return;
  for (const file of Array.from(list)) {
    if (pending.some((p) => p.file.name === file.name && p.file.size === file.size)) continue;

    let error: string | undefined;
    if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) {
      error = 'no es un PDF';
    } else if (file.size > config.maxMb * 1024 * 1024) {
      error = `pasa de ${config.maxMb} MB`;
    }
    pending.push({ file, error });
  }
  paintFiles();
}

function paintFiles(): void {
  const list = $('#fileList');
  const good = pending.filter((p) => !p.error);
  const has = pending.length > 0;

  drop.classList.toggle('is-compact', has);
  $('#dropIdle').hidden = false;
  list.hidden = !has;
  list.innerHTML = '';

  for (const [index, entry] of pending.entries()) {
    const item = document.createElement('li');
    item.classList.toggle('is-bad', Boolean(entry.error));

    const name = document.createElement('b');
    name.textContent = entry.file.name;
    const size = document.createElement('span');
    size.textContent = entry.error ?? fmtBytes(Math.round(entry.file.size / 1024));

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = '×';
    remove.title = 'Quitar de la lista';
    remove.setAttribute('aria-label', `Quitar ${entry.file.name}`);
    remove.addEventListener('click', () => {
      pending.splice(index, 1);
      paintFiles();
    });

    item.append(name, size, remove);
    list.append(item);
  }

  $('#dropFoot').hidden = !has;
  if (has) {
    const total = good.reduce((sum, p) => sum + p.file.size, 0);
    $('#dropTotal').textContent = `${good.length} de ${pending.length} listos · ${fmtBytes(
      Math.round(total / 1024)
    )}`;
  }

  $('#uploadCount').textContent = good.length ? `(${good.length})` : '';
  $<HTMLButtonElement>('#btnUpload').disabled = busy || good.length === 0;
}

$('#btnClearFiles').addEventListener('click', () => {
  pending = [];
  paintFiles();
});

/* --------------------------------------------------------------- publicar */

function sortedExams(exams: Exam[]): Exam[] {
  return [...exams].sort(
    (a, b) =>
      b.year - a.year ||
      a.session.localeCompare(b.session) ||
      a.subject.localeCompare(b.subject) ||
      a.type.localeCompare(b.type) ||
      a.id.localeCompare(b.id)
  );
}

function serialize(next: Catalog): string {
  return `${JSON.stringify({ ...next, exams: sortedExams(next.exams) }, null, 2)}\n`;
}

function buildId(subject: string, year: number, session: string, type: string, taken: Set<string>): string {
  const base = `${slugify(subject)}-${year}-${session}-${type}`;
  if (!taken.has(base)) return base;
  for (let i = 2; i < 500; i++) {
    if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
  }
  return `${base}-${Date.now()}`;
}

/** Un commit con todo dentro: PDFs y catálogo viajan juntos o no viaja nada. */
async function publish(changes: FileChange[], message: string, label: string): Promise<void> {
  busy = true;
  $<HTMLButtonElement>('#btnUpload').disabled = true;
  setTableBusy(true);
  progressStart(label);
  try {
    const result = await commitFiles({
      token,
      ref,
      branch,
      message,
      files: changes,
      onProgress: progressUpdate,
    });
    progressEnd('ok');
    await refresh();
    toast('Publicado. GitHub Pages tarda alrededor de un minuto en reconstruir la web.', 'ok', 8000, {
      href: result.url,
      text: 'Ver el commit',
    });
  } catch (error) {
    progressEnd('error');
    reportError(error);
  } finally {
    busy = false;
    setTableBusy(false);
    paintFiles();
  }
}

/**
 * Mientras hay un commit en marcha, el catálogo en memoria se queda atrás: si
 * se editara o borrara ahora, el commit siguiente escribiría un catálogo viejo
 * y resucitaría registros ya publicados. Por eso la tabla se bloquea.
 */
function setTableBusy(value: boolean): void {
  $('.pane-list').dataset.busy = String(value);
}

$('#uploadForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (busy) return;

  const error = $('#uploadError');
  error.hidden = true;

  const subject = $<HTMLSelectElement>('#subject').value;
  const year = Number.parseInt($<HTMLInputElement>('#year').value, 10);
  const session = sessionValue();
  const type = typeValue();
  const language = $<HTMLSelectElement>('#language').value;
  const official = $<HTMLInputElement>('#official').checked;
  const notes = $<HTMLTextAreaElement>('#notes').value.trim();
  const files = pending.filter((p) => !p.error).map((p) => p.file);

  const fail = (message: string) => {
    error.textContent = message;
    error.hidden = false;
    error.scrollIntoView({ block: 'nearest' });
  };

  if (!subject || !subjectByCode(subject)) return fail('Elige una asignatura.');
  if (!Number.isFinite(year) || year < 1980 || year > 2100) return fail('Escribe un año válido.');
  if (!session) return fail('Elige la convocatoria.');
  if (!type) return fail('Elige el tipo de documento.');
  if (files.length === 0) return fail('Añade al menos un PDF.');

  const taken = new Set(catalog.exams.map((e) => e.id));
  const now = new Date().toISOString();
  const changes: FileChange[] = [];
  const created: Exam[] = [];

  try {
    for (const file of files) {
      const id = buildId(subject, year, session, type, taken);
      taken.add(id);
      const relative = `exams/${year}/${session}/${subject}/${id}.pdf`;
      const bytes = new Uint8Array(await file.arrayBuffer());

      changes.push({ path: `public/${relative}`, base64: bytesToBase64(bytes) });

      created.push({
        id,
        subject,
        year,
        session,
        type,
        pages: estimatePdfPages(bytes),
        file: relative,
        originalName: file.name,
        sizeKB: Math.round(file.size / 1024),
        language: language === 'es' ? 'es' : '',
        official,
        notes,
        addedAt: now,
        updatedAt: now,
      });
    }

    changes.push({
      path: CATALOG_PATH,
      base64: textToBase64(
        serialize({ ...catalog, exams: [...catalog.exams, ...created], updatedAt: now })
      ),
    });

    const count = created.length;
    const message = `archivo: añade ${count} ${count === 1 ? 'documento' : 'documentos'} · ${subjectName(
      subject
    )} ${year} · ${sessionLabel(session)} · ${typeLabel(type)}`;

    pending = [];
    paintFiles();
    $<HTMLTextAreaElement>('#notes').value = '';
    await publish(changes, message, 'Preparando la subida…');
  } catch (err) {
    reportError(err);
  }
});

/* ------------------------------------------------------------------ tabla */

const searchInput = $<HTMLInputElement>('#search');
const onlyMissing = $<HTMLInputElement>('#onlyMissing');
const filterSession = $<HTMLSelectElement>('#filterSession');
const filterType = $<HTMLSelectElement>('#filterType');

searchInput.addEventListener('input', renderTable);
onlyMissing.addEventListener('change', renderTable);
filterSession.addEventListener('change', renderTable);
filterType.addEventListener('change', renderTable);

function paintFilters(): void {
  const keepSession = filterSession.value;
  filterSession.innerHTML = '<option value="">Todas las convocatorias</option>';
  for (const session of SESSIONS) {
    const option = document.createElement('option');
    option.value = session.id;
    option.textContent = session.label;
    filterSession.append(option);
  }
  filterSession.value = SESSIONS.some((s) => s.id === keepSession) ? keepSession : '';

  const keepType = filterType.value;
  filterType.innerHTML = '<option value="">Todos los tipos</option>';
  for (const type of TYPES) {
    const option = document.createElement('option');
    option.value = type.id;
    option.textContent = type.label;
    filterType.append(option);
  }
  filterType.value = TYPES.some((t) => t.id === keepType) ? keepType : '';
}

function visibleExams(): Exam[] {
  const query = searchInput.value.trim().toLowerCase();
  const missing = missingFiles();

  return catalog.exams.filter((exam) => {
    if (filterSession.value && exam.session !== filterSession.value) return false;
    if (filterType.value && exam.type !== filterType.value) return false;
    if (onlyMissing.checked && !missing.has(exam.id)) return false;
    if (!query) return true;
    const haystack = [
      subjectName(exam.subject),
      exam.subject,
      exam.year,
      sessionLabel(exam.session),
      typeLabel(exam.type),
      exam.notes ?? '',
      exam.originalName ?? '',
    ]
      .join(' ')
      .toLowerCase();
    return haystack.includes(query);
  });
}

function renderTable(): void {
  const tbody = $('#tbody');
  const exams = visibleExams();
  const missing = missingFiles();

  $('#totalPill').textContent = String(catalog.exams.length);
  $('#tableEmpty').hidden = catalog.exams.length > 0;
  $('#tableFiltered').hidden = catalog.exams.length === 0 || exams.length > 0;
  tbody.innerHTML = '';

  for (const exam of exams) {
    if (exam.id === editingId) {
      tbody.append(buildEditRow(exam));
      continue;
    }

    const row = document.createElement('tr');
    row.dataset.id = exam.id;
    const isMissing = missing.has(exam.id);

    row.innerHTML = `
      <td class="c-code" data-label="Cód.">${escapeHtml(exam.subject)}</td>
      <td class="c-name" data-label="Asignatura">
        ${escapeHtml(subjectName(exam.subject))}
        ${isMissing ? '<span class="badge-missing">falta el PDF</span>' : ''}
        ${exam.notes ? `<div class="row-notes" title="${escapeHtml(exam.notes)}">${escapeHtml(exam.notes)}</div>` : ''}
      </td>
      <td class="c-year" data-label="Año">${exam.year}</td>
      <td class="c-ses" data-label="Convocatoria">${escapeHtml(sessionLabel(exam.session))}</td>
      <td data-label="Tipo"><span class="type-tag" data-t="${escapeHtml(exam.type)}"><i></i>${escapeHtml(
        typeShort(exam.type)
      )}</span></td>
      <td class="c-meta" data-label="Archivo">${fmtBytes(exam.sizeKB)} · ${fmtDate(exam.addedAt)}</td>
      <td class="c-act">
        <div class="row-actions">
          <a class="icon-btn" data-act="open" href="${pdfPublicUrl(exam)}" target="_blank" rel="noreferrer" title="Abrir el PDF">${ICON_OPEN}</a>
          <button class="icon-btn" data-act="edit" type="button" title="Editar">${ICON_EDIT}</button>
          <button class="icon-btn danger" data-act="delete" type="button" title="Eliminar">${ICON_DEL}</button>
        </div>
      </td>`;
    tbody.append(row);
  }
}

function buildEditRow(exam: Exam): HTMLTableRowElement {
  const row = document.createElement('tr');
  row.className = 'edit-row';
  row.dataset.id = exam.id;

  const cell = document.createElement('td');
  cell.colSpan = 7;

  const subjectOptions = subjects
    .map(
      (s) =>
        `<option value="${s.code}"${s.code === exam.subject ? ' selected' : ''}>${escapeHtml(
          s.name
        )}</option>`
    )
    .join('');
  const typeOptions = TYPES.map(
    (t) => `<option value="${t.id}"${t.id === exam.type ? ' selected' : ''}>${escapeHtml(t.label)}</option>`
  ).join('');
  const sessionOptions = SESSIONS.map(
    (s) => `<option value="${s.id}"${s.id === exam.session ? ' selected' : ''}>${escapeHtml(s.label)}</option>`
  ).join('');

  cell.innerHTML = `
    <div class="edit" data-id="${escapeHtml(exam.id)}">
      <div class="field">
        <span class="label">Asignatura</span>
        <select class="input" data-k="subject">${subjectOptions}</select>
      </div>
      <div class="field">
        <span class="label">Año</span>
        <input class="input" type="number" min="1980" max="2100" data-k="year" value="${exam.year}" />
      </div>
      <div class="field">
        <span class="label">Convocatoria</span>
        <select class="input" data-k="session">${sessionOptions}</select>
      </div>
      <div class="field">
        <span class="label">Tipo</span>
        <select class="input" data-k="type">${typeOptions}</select>
      </div>
      <div class="field">
        <span class="label">Idioma</span>
        <select class="input" data-k="language">
          <option value="es"${exam.language === 'es' ? ' selected' : ''}>Castellano</option>
          <option value=""${!exam.language ? ' selected' : ''}>Indiferente</option>
        </select>
      </div>
      <div class="field">
        <span class="label">Oficial</span>
        <select class="input" data-k="official">
          <option value="true"${exam.official !== false ? ' selected' : ''}>Sí</option>
          <option value="false"${exam.official === false ? ' selected' : ''}>No</option>
        </select>
      </div>
      <div class="field">
        <span class="label">Páginas</span>
        <input class="input" type="number" min="1" max="9999" data-k="pages" value="${exam.pages ?? ''}" />
      </div>
      <div class="field half">
        <span class="label">Notas</span>
        <input class="input" data-k="notes" value="${escapeHtml(exam.notes ?? '')}" />
      </div>
      <div class="edit-actions">
        <span class="edit-note">${escapeHtml(exam.file)}</span>
        <a class="btn btn-sm" href="${pdfPublicUrl(exam)}" target="_blank" rel="noreferrer">Abrir</a>
        <button class="btn btn-sm" data-act="cancel" type="button">Cancelar</button>
        <button class="btn btn-sm btn-primary" data-act="save" type="button">Guardar</button>
      </div>
    </div>`;

  cell.querySelector('[data-act="cancel"]')!.addEventListener('click', () => {
    editingId = null;
    renderTable();
  });

  cell.querySelector('[data-act="save"]')!.addEventListener('click', async (event) => {
    const button = event.currentTarget as HTMLButtonElement;
    const box = cell.querySelector('.edit')!;
    const values = new Map<string, string>();
    for (const input of $$<HTMLInputElement | HTMLSelectElement>('[data-k]', box)) {
      values.set(input.dataset.k!, input.value);
    }

    const year = Number.parseInt(values.get('year') ?? '', 10);
    if (!Number.isFinite(year) || year < 1980 || year > 2100) {
      toast('El año no es válido.', 'error');
      return;
    }
    const pages = Number.parseInt(values.get('pages') ?? '', 10);

    const updated: Exam = {
      ...exam,
      subject: values.get('subject') ?? exam.subject,
      year,
      session: values.get('session') ?? exam.session,
      type: values.get('type') ?? exam.type,
      language: values.get('language') === 'es' ? 'es' : '',
      official: values.get('official') === 'true',
      pages: Number.isFinite(pages) && pages > 0 ? pages : null,
      notes: (values.get('notes') ?? '').trim(),
      updatedAt: new Date().toISOString(),
    };

    const next: Catalog = {
      ...catalog,
      exams: catalog.exams.map((e) => (e.id === exam.id ? updated : e)),
      updatedAt: new Date().toISOString(),
    };

    button.classList.add('is-busy');
    editingId = null;
    renderTable();
    await publish(
      [{ path: CATALOG_PATH, base64: textToBase64(serialize(next)) }],
      `archivo: edita ${subjectName(updated.subject)} ${updated.year} · ${sessionLabel(
        updated.session
      )} · ${typeLabel(updated.type)}`,
      'Guardando los cambios…'
    );
  });

  row.append(cell);
  return row;
}

$('#tbody').addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
  if (!button) return;
  const row = button.closest('tr');
  const id = row?.dataset.id;
  if (!id) return;
  if (busy) return;

  if (button.dataset.act === 'edit') {
    editingId = editingId === id ? null : id;
    renderTable();
    if (editingId) $<HTMLInputElement>('.edit input')?.focus();
    return;
  }

  if (button.dataset.act !== 'delete') return;

  const exam = catalog.exams.find((e) => e.id === id);
  if (!exam) return;

  confirmDialog(
    'Eliminar documento',
    `Se borrará «${subjectName(exam.subject)} · ${exam.year} · ${sessionLabel(
      exam.session
    )} · ${typeLabel(exam.type)}» y su PDF del repositorio. No se puede deshacer.`,
    async () => {
      const now = new Date().toISOString();
      const changes: FileChange[] = [
        { path: pdfRepoPath(exam), base64: null },
        {
          path: CATALOG_PATH,
          base64: textToBase64(
            serialize({ ...catalog, exams: catalog.exams.filter((e) => e.id !== exam.id), updatedAt: now })
          ),
        },
      ];
      await publish(
        changes,
        `archivo: elimina ${subjectName(exam.subject)} ${exam.year} · ${sessionLabel(
          exam.session
        )} · ${typeLabel(exam.type)}`,
        'Eliminando…'
      );
    }
  );
});

/* --------------------------------------------------------------- diálogo */

const dialog = $<HTMLDialogElement>('#confirmDlg');
let pendingAction: (() => void | Promise<void>) | null = null;

function confirmDialog(title: string, text: string, action: () => void | Promise<void>): void {
  $('#confirmTitle').textContent = title;
  $('#confirmText').textContent = text;
  pendingAction = action;
  dialog.showModal();
}

$('#confirmNo').addEventListener('click', () => {
  dialog.close();
  pendingAction = null;
});

$('#confirmYes').addEventListener('click', () => {
  dialog.close();
  const action = pendingAction;
  pendingAction = null;
  void action?.();
});

/* ------------------------------------------------------------- arranque */

/** Año por defecto: el actual, acotado a lo que ya hay en el archivo. */
function prefill(): void {
  const input = $<HTMLInputElement>('#year');
  if (input.value) return;
  const years = catalog.exams.map((e) => e.year);
  const current = new Date().getFullYear();
  input.value = String(years.length ? Math.max(...years) : current);
  input.min = String(Math.min(1980, ...years, current - 1));
  input.max = String(current + 1);
}

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && editingId) {
    editingId = null;
    renderTable();
  }
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
    event.preventDefault();
    $<HTMLFormElement>('#uploadForm').requestSubmit();
  }
});

if (token) {
  connect();
} else {
  exit();
}
