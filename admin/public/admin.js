/* =========================================================================
   WebPAU · Panel de administración — cliente
   ========================================================================= */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const TOKEN_KEY = 'webpau.admin.token';
let token = localStorage.getItem(TOKEN_KEY) ?? '';
let state = null; // { catalog, subjects, types, sessions, missingFiles, git }
let pending = []; // File[]
let editingId = null;

/* ------------------------------------------------------------------ api */

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: { 'x-admin-token': token, ...(options.headers ?? {}) },
  });
  const isJson = res.headers.get('content-type')?.includes('application/json');
  const body = isJson ? await res.json() : null;
  if (!res.ok) {
    const error = new Error(body?.error ?? `Error ${res.status}`);
    error.status = res.status;
    throw error;
  }
  return body;
}

/* ---------------------------------------------------------------- toast */

function toast(message, kind = 'info', ttl = 4200) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.dataset.kind = kind;
  el.textContent = message;
  $('#toasts').append(el);
  setTimeout(() => {
    el.classList.add('is-out');
    setTimeout(() => el.remove(), 220);
  }, ttl);
}

/* --------------------------------------------------------------- iconos */

const ICON_EDIT = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11.5 2.5 13.5 4.5 5.5 12.5 2.5 13.5 3.5 10.5Z"/></svg>`;
const ICON_DEL = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5 5 13.5h6l.5-9M6.8 7v4M9.2 7v4"/></svg>`;
const ICON_OPEN = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3h4v4M13 3 7.5 8.5M11 9.5V12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h2.5"/></svg>`;

const fmtBytes = (kb) => {
  if (!kb && kb !== 0) return '—';
  return kb < 1024 ? `${kb} KB` : `${(kb / 1024).toFixed(1)} MB`;
};
const fmtDate = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '—'
    : new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: '2-digit', year: '2-digit' }).format(d);
};

/* ------------------------------------------------------------------ gate */

function showGate(message) {
  $('#gate').hidden = false;
  $('#app').hidden = true;
  if (message) {
    const err = $('#gateError');
    err.textContent = message;
    err.hidden = false;
  }
}

async function enter() {
  $('#gate').hidden = true;
  $('#app').hidden = false;
  await refresh();
  prefill();
}

$('#gateForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  token = $('#tokenInput').value.trim();
  try {
    await api('/api/session');
    await enter();
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    $('#gateError').textContent = 'Token incorrecto. Copia el que aparece en la terminal.';
    $('#gateError').hidden = false;
  }
});

/* ----------------------------------------------------------------- datos */

async function refresh() {
  try {
    state = await api('/api/state');
  } catch (error) {
    if (error.status === 401) {
      localStorage.removeItem(TOKEN_KEY);
      showGate('La sesión ha caducado. Vuelve a pegar el token.');
      return;
    }
    toast(error.message, 'error');
    return;
  }
  paintSubjects();
  paintTypes();
  paintGit();
  renderTable();
}

const subjectByCode = (code) => state.subjects.find((s) => s.code === code);
const typeById = (id) => state.types.find((t) => t.id === id);

function paintSubjects() {
  const sel = $('#subject');
  const previous = sel.value;
  sel.innerHTML = '';
  for (const [phase, label] of [
    ['acceso', 'Fase de acceso'],
    ['admision', 'Fase de admisión'],
  ]) {
    const group = document.createElement('optgroup');
    group.label = label;
    for (const s of state.subjects.filter((x) => x.phases.includes(phase))) {
      const opt = document.createElement('option');
      opt.value = s.code;
      opt.textContent = `${s.name} (${s.code})`;
      group.append(opt);
    }
    sel.append(group);
  }
  if (previous && subjectByCode(previous)) sel.value = previous;
}

function paintTypes() {
  const box = $('#typeGroup');
  box.innerHTML = '';
  for (const t of state.types) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'type-btn';
    btn.dataset.v = t.id;
    btn.title = `${t.label} · ${t.hint}`;
    btn.setAttribute('aria-pressed', String(t.id === 'enunciados'));
    btn.innerHTML = `<i></i><span>${t.short}</span>`;
    btn.addEventListener('click', () => {
      $$('.type-btn', box).forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
    });
    box.append(btn);
  }
}

function paintGit() {
  const git = state.git ?? {};
  const box = $('#gitInfo');
  box.dataset.dirty = String(git.dirtyLines > 0);
  const bits = [git.branch ?? '—'];
  if (git.remote) bits.push(git.remote.replace(/^https?:\/\/(www\.)?github\.com\//, ''));
  if (git.unborn) bits.push('sin commits');
  if (git.ahead) bits.push(`↑${git.ahead}`);
  if (git.behind) bits.push(`↓${git.behind}`);
  if (git.dirtyLines) bits.push(`${git.dirtyLines} sin confirmar`);
  box.innerHTML = `<span class="dot"></span><span>${bits.join(' · ')}</span>`;

  const badge = $('#pushBadge');
  const n = git.dirtyLines ?? 0;
  badge.hidden = n === 0;
  badge.textContent = String(n);
}

const sessionValue = () => $('#sessionSeg [aria-pressed="true"]').dataset.v;
const typeValue = () => $('.type-btn[aria-pressed="true"]').dataset.v;

/* ---------------------------------------------------------------- subida */

const drop = $('#drop');
const fileInput = $('#files');

$('#sessionSeg').addEventListener('click', (event) => {
  const btn = event.target.closest('button');
  if (!btn) return;
  $$('#sessionSeg button').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
});

drop.addEventListener('click', (e) => {
  if (e.target.closest('.drop-list')) return;
  fileInput.click();
});
drop.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    fileInput.click();
  }
});

for (const type of ['dragenter', 'dragover']) {
  drop.addEventListener(type, (e) => {
    e.preventDefault();
    drop.classList.add('is-over');
  });
}
for (const type of ['dragleave', 'drop']) {
  drop.addEventListener(type, (e) => {
    e.preventDefault();
    drop.classList.remove('is-over');
  });
}
drop.addEventListener('drop', (e) => addFiles(e.dataTransfer.files));
fileInput.addEventListener('change', () => {
  addFiles(fileInput.files);
  fileInput.value = '';
});

function addFiles(list) {
  const incoming = Array.from(list);
  const rejected = incoming.filter((f) => f.type !== 'application/pdf' && !/\.pdf$/i.test(f.name));
  const accepted = incoming.filter((f) => !rejected.includes(f));
  for (const f of accepted) {
    if (!pending.some((p) => p.name === f.name && p.size === f.size)) pending.push(f);
  }
  if (rejected.length) toast(`Se ignoraron ${rejected.length} archivo(s) que no son PDF.`, 'error');
  paintFiles();
}

function paintFiles() {
  const list = $('#fileList');
  const has = pending.length > 0;
  drop.classList.toggle('has-files', has);
  $('#dropIdle').hidden = has;
  list.hidden = !has;
  list.innerHTML = '';
  for (const [i, file] of pending.entries()) {
    const li = document.createElement('li');
    li.innerHTML = `<b>${file.name}</b><span>${fmtBytes(Math.round(file.size / 1024))}</span>`;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = '×';
    btn.title = 'Quitar de la lista';
    btn.addEventListener('click', () => {
      pending.splice(i, 1);
      paintFiles();
    });
    li.append(btn);
    list.append(li);
  }
  $('#uploadCount').textContent = has ? `(${pending.length})` : '';
  $('#btnUpload').disabled = !has;
}

$('#uploadForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const error = $('#uploadError');
  error.hidden = true;
  const btn = $('#btnUpload');
  btn.classList.add('is-busy');
  btn.disabled = true;

  const body = new FormData();
  for (const file of pending) body.append('files', file);
  body.append('subject', $('#subject').value);
  body.append('year', $('#year').value);
  body.append('session', sessionValue());
  body.append('type', typeValue());
  body.append('language', $('#language').value);
  body.append('official', $('#official').checked ? 'true' : 'false');
  body.append('notes', $('#notes').value);

  try {
    const res = await api('/api/exams', { method: 'POST', body });
    pending = [];
    paintFiles();
    $('#notes').value = '';
    state.catalog = res.catalog;
    await refresh();
    toast(`Subidos ${res.created.length} documento(s). Pulsa «Subir a GitHub» para publicar.`, 'ok', 6000);
  } catch (err) {
    error.textContent = err.message;
    error.hidden = false;
    if (err.status === 401) handleUnauthorized();
  } finally {
    btn.classList.remove('is-busy');
    btn.disabled = pending.length === 0;
  }
});

function handleUnauthorized() {
  localStorage.removeItem(TOKEN_KEY);
  showGate('La sesión ha caducado. Vuelve a pegar el token.');
}

/* ---------------------------------------------------------------- tabla */

const searchInput = $('#search');
const onlyMissing = $('#onlyMissing');

searchInput.addEventListener('input', renderTable);
onlyMissing.addEventListener('change', renderTable);

function visibleExams() {
  const q = searchInput.value.trim().toLowerCase();
  const missing = new Set(state.missingFiles ?? []);
  return state.catalog.exams.filter((exam) => {
    if (onlyMissing.checked && !missing.has(exam.id)) return false;
    if (!q) return true;
    const subject = subjectByCode(exam.subject)?.name ?? exam.subject;
    const type = typeById(exam.type)?.label ?? exam.type;
    return `${subject} ${exam.year} ${exam.session} ${type} ${exam.notes ?? ''} ${exam.originalName ?? ''}`
      .toLowerCase()
      .includes(q);
  });
}

function renderTable() {
  const tbody = $('#tbody');
  const exams = visibleExams();
  $('#totalPill').textContent = String(state.catalog.exams.length);
  $('#tableEmpty').hidden = exams.length > 0;
  tbody.innerHTML = '';
  const missing = new Set(state.missingFiles ?? []);

  for (const exam of exams) {
    if (exam.id === editingId) {
      tbody.append(buildEditRow(exam));
      continue;
    }
    const tr = document.createElement('tr');
    tr.dataset.id = exam.id;
    const subject = subjectByCode(exam.subject);
    const type = typeById(exam.type);
    tr.innerHTML = `
      <td class="c-code">${exam.subject}</td>
      <td>${subject?.name ?? exam.subject}${
        missing.has(exam.id) ? '<span class="badge-missing">falta el PDF</span>' : ''
      }${exam.notes ? `<div class="c-meta">${escapeHtml(exam.notes)}</div>` : ''}</td>
      <td class="c-year">${exam.year}</td>
      <td class="c-ses">${exam.session === 'ordinaria' ? 'ord.' : 'extr.'}</td>
      <td><span class="type-tag" data-t="${exam.type}"><i></i>${type?.short ?? exam.type}</span></td>
      <td class="c-meta">${fmtBytes(exam.sizeKB)} · ${fmtDate(exam.addedAt)}</td>
      <td class="c-act">
        <div class="row-actions">
          <button class="icon-btn" data-act="edit" title="Editar">${ICON_EDIT}</button>
          <button class="icon-btn" data-act="delete" title="Eliminar">${ICON_DEL}</button>
        </div>
      </td>`;
    tbody.append(tr);
  }
}

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function buildEditRow(exam) {
  const tr = document.createElement('tr');
  tr.className = 'edit-row';
  tr.dataset.id = exam.id;
  const td = document.createElement('td');
  td.colSpan = 7;

  const subjects = state.subjects
    .map((s) => `<option value="${s.code}"${s.code === exam.subject ? ' selected' : ''}>${s.name}</option>`)
    .join('');
  const types = state.types
    .map((t) => `<option value="${t.id}"${t.id === exam.type ? ' selected' : ''}>${t.label}</option>`)
    .join('');

  td.innerHTML = `
    <div class="edit" data-id="${exam.id}">
      <div class="field">
        <span class="label">Asignatura</span>
        <select class="input" data-k="subject">${subjects}</select>
      </div>
      <div class="field">
        <span class="label">Año</span>
        <input class="input" type="number" min="1980" max="2100" data-k="year" value="${exam.year}" />
      </div>
      <div class="field">
        <span class="label">Convocatoria</span>
        <select class="input" data-k="session">
          <option value="ordinaria"${exam.session === 'ordinaria' ? ' selected' : ''}>Ordinaria</option>
          <option value="extraordinaria"${exam.session === 'extraordinaria' ? ' selected' : ''}>Extraordinaria</option>
        </select>
      </div>
      <div class="field">
        <span class="label">Tipo</span>
        <select class="input" data-k="type">${types}</select>
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
      <div class="field half">
        <span class="label">Notas</span>
        <input class="input" data-k="notes" value="${escapeHtml(exam.notes ?? '')}" />
      </div>
      <div class="field">
        <span class="label">Fichero</span>
        <a class="btn btn-sm" href="/${exam.file}" target="_blank" rel="noreferrer">
          ${ICON_OPEN} Abrir
        </a>
      </div>
      <div class="edit-actions">
        <span class="edit-note">${exam.file}</span>
        <button class="btn btn-sm" data-act="cancel">Cancelar</button>
        <button class="btn btn-sm btn-primary" data-act="save">Guardar</button>
      </div>
    </div>`;

  td.querySelector('[data-act="cancel"]').addEventListener('click', () => {
    editingId = null;
    renderTable();
  });

  td.querySelector('[data-act="save"]').addEventListener('click', async (event) => {
    const btn = event.currentTarget;
    const box = td.querySelector('.edit');
    const patch = {};
    for (const input of $$('[data-k]', box)) patch[input.dataset.k] = input.value;
    patch.year = Number(patch.year);
    patch.official = patch.official === 'true';
    btn.classList.add('is-busy');
    try {
      const res = await api(`/api/exams/${encodeURIComponent(exam.id)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      });
      state.catalog = res.catalog;
      editingId = null;
      await refresh();
      toast('Cambios guardados.', 'ok');
    } catch (err) {
      toast(err.message, 'error');
      btn.classList.remove('is-busy');
      if (err.status === 401) handleUnauthorized();
    }
  });

  tr.append(td);
  return tr;
}

$('#tbody').addEventListener('click', (event) => {
  const btn = event.target.closest('[data-act]');
  if (!btn) return;
  const tr = btn.closest('tr');
  const id = tr?.dataset.id;
  if (!id) return;

  if (btn.dataset.act === 'edit') {
    editingId = editingId === id ? null : id;
    renderTable();
    if (editingId) $('.edit input')?.focus();
    return;
  }

  if (btn.dataset.act === 'delete') {
    const item = state.catalog.exams.find((e) => e.id === id);
    if (!item) return;
    confirmDialog(
      'Eliminar documento',
      `Se borrará «${subjectByCode(item.subject)?.name ?? item.subject} · ${item.year} · ${
        item.session === 'ordinaria' ? 'ordinaria' : 'extraordinaria'
      }» y su PDF del disco. Esto no se puede deshacer.`,
      async () => {
        try {
          const res = await api(`/api/exams/${encodeURIComponent(id)}`, { method: 'DELETE' });
          state.catalog = res.catalog;
          await refresh();
          toast('Documento eliminado.', 'ok');
        } catch (err) {
          toast(err.message, 'error');
          if (err.status === 401) handleUnauthorized();
        }
      }
    );
  }
});

/* --------------------------------------------------------------- diálogo */

const dlg = $('#confirmDlg');
let pendingAction = null;

function confirmDialog(title, text, action) {
  $('#confirmTitle').textContent = title;
  $('#confirmText').textContent = text;
  pendingAction = action;
  dlg.showModal();
}

$('#confirmNo').addEventListener('click', () => {
  dlg.close();
  pendingAction = null;
});

$('#confirmYes').addEventListener('click', () => {
  dlg.close();
  pendingAction?.();
  pendingAction = null;
});

/* ------------------------------------------------------------------- git */

$('#btnPush').addEventListener('click', async (event) => {
  const btn = event.currentTarget;
  btn.classList.add('is-busy');
  btn.disabled = true;
  try {
    const res = await api('/api/git/push', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: '' }),
    });
    toast(res.message, res.pushed ? 'ok' : 'info', 6000);
    await refresh();
  } catch (err) {
    toast(err.message + (err.detail ? `\n${err.detail}` : ''), 'error', 8000);
    if (err.status === 401) handleUnauthorized();
  } finally {
    btn.classList.remove('is-busy');
    btn.disabled = false;
  }
});

$('#btnPull').addEventListener('click', async (event) => {
  const btn = event.currentTarget;
  btn.classList.add('is-busy');
  btn.disabled = true;
  try {
    const res = await api('/api/git/pull', { method: 'POST' });
    toast(res.message ?? 'Repositorio actualizado.', 'ok');
    await refresh();
  } catch (err) {
    toast((err.detail ?? err.message), 'error', 8000);
  } finally {
    btn.classList.remove('is-busy');
    btn.disabled = false;
  }
});

/* --------------------------------------------------------------- arranque */

async function boot() {
  paintFiles();
  if (!token) {
    showGate();
    return;
  }
  $('#gate').hidden = true;
  $('#app').hidden = false;
  await refresh();
  prefill();
}

/** Año por defecto: la convocatoria que viene o la última que haya. */
function prefill() {
  const now = new Date();
  const current = now.getFullYear();
  const years = [...new Set(state?.catalog.exams.map((e) => e.year) ?? [])].sort((a, b) => b - a);
  const input = $('#year');
  input.value = String(current);
  input.max = String(current + 1);
  input.min = String(Math.min(1980, ...years, current));
}

boot();

/* atajos de teclado */
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && editingId) {
    editingId = null;
    renderTable();
  }
  const mod = event.ctrlKey || event.metaKey;
  if (mod && event.key === 'Enter') {
    event.preventDefault();
    $('#uploadForm').requestSubmit();
  }
});
