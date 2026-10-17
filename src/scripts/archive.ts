/* =========================================================================
   Filtrado del archivo — sin framework, sin estado duplicado.
   El estado vive en la URL (?q=&y=&ss=&t=&s=&p=) para poder compartirlo.
   Sin JavaScript el servidor ya renderiza todo el listado completo.
   ========================================================================= */

type Row = [id: string, subjectIdx: number, year: number, sessionIdx: number, typeIdx: number];
interface Payload {
  exams: Row[];
  subjects: [string, string, string, string][]; // [code, fases, name, alias]
  types: [string, string, string][]; // [id, etiqueta corta, etiqueta larga]
  sessions: [string, string][]; // [id, etiqueta]
  base: string;
}

/* palabras clave para buscar sin conocer el vocabulario exacto */
const TYPE_KEYWORDS: Record<string, string> = {
  enunciados: 'enunciado examen',
  soluciones: 'soluciones resoluciones',
  criterios: 'criterios correccion',
  plantilla: 'plantilla hoja respuestas omr',
};

interface State {
  q: string;
  y: string;
  ss: string;
  t: string;
  s: string;
  p: string;
}

const fold = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

const payload: Payload = JSON.parse(
  document.getElementById('catalog-data')!.textContent!
);

/* los ids y las etiquetas de convocatoria salen del catálogo, no de una copia
   local: si el catálogo cambia, el filtro sigue casando con las filas */
const SESSION_IDS = payload.sessions.map((s) => s[0]);
const SESSION_LABEL = new Map(payload.sessions.map((s) => [s[0], s[1]]));

const codes = payload.subjects.map((s) => s[0]);
const phaseLists = payload.subjects.map((s) => s[1].split(',').filter(Boolean));
const names = payload.subjects.map((s) => s[2]);
/* los alias («mates», «filosofía», «historia del arte») son una columna del
   catálogo que antes se quedaba en el servidor: sin ellos, buscar la materia
   como la llama la gente no encontraba nada */
const aliasLists = payload.subjects.map((s) => s[3] ?? '');
const TYPES = payload.types.map((t) => t[0]);
const TYPE_LABEL = new Map(payload.types.map((t) => [t[0], t[1]]));

/* ------------------------------------------------------------------ elems */

const $ = <T extends Element>(sel: string): T | null => document.querySelector<T>(sel);
const $$ = <T extends Element>(sel: string): T[] => Array.from(document.querySelectorAll<T>(sel));

const form = $<HTMLFormElement>('#filters');
const inputQ = $<HTMLInputElement>('#q');
const selectY = $<HTMLSelectElement>('#y');
const selectPhase = $<HTMLSelectElement>('#phase');
const clearBtn = $<HTMLButtonElement>('#clearFilters');
const clearBtn2 = $<HTMLButtonElement>('#clearFilters2');
const countEl = $<HTMLElement>('#resultCount');
const emptyEl = $<HTMLElement>('#catalogEmpty');
const noMatchEl = $<HTMLElement>('#noMatches');
const noMatchText = $<HTMLElement>('#noMatchesText');

const rows = new Map<string, HTMLElement>();
for (const el of $$<HTMLElement>('.row[data-id]')) rows.set(el.dataset.id!, el);

const groups = $$<HTMLElement>('.year-group').map((el) => ({
  el,
  count: el.querySelector<HTMLElement>('[data-group-count]')!,
  rows: $$<HTMLElement>('.row[data-id]').filter((r) => r.closest('.year-group') === el),
}));

/* Solo los botones filtran: las tarjetas de asignatura son enlaces a su
   propia página. Su recuento, en cambio, sigue respondiendo a los filtros
   como antes, para que todas las cifras del mosaico hablen del mismo estado. */
const chips = $$<HTMLButtonElement>('button.chip');
const countedChips = [...chips, ...$$<HTMLAnchorElement>('a.chip')] as HTMLElement[];
const sessionBtns = $$<HTMLButtonElement>('#segSession button');
const typeBtns = $$<HTMLButtonElement>('#segType button');

/* ------------------------------------------------------- índex de cerca */

interface Exam {
  id: string;
  code: string;
  phases: string[];
  name: string;
  year: number;
  session: string;
  type: string;
  hay: string;
}

const exams: Exam[] = payload.exams.map(([id, subjectIdx, year, sessionIdx, typeIdx]) => {
  const code = codes[subjectIdx] ?? '';
  const name = names[subjectIdx] ?? code;
  const session = SESSION_IDS[sessionIdx] ?? '';
  const type = TYPES[typeIdx] ?? '';
  return {
    id,
    code,
    phases: phaseLists[subjectIdx] ?? [],
    name,
    year,
    session,
    type,
    hay: fold(
      `${code} ${name} ${aliasLists[subjectIdx] ?? ''} ${year} ${session} ${type} ${
        TYPE_LABEL.get(type) ?? ''
      } ${TYPE_KEYWORDS[type] ?? ''}`
    ),
  };
});

/* ------------------------------------------------------------------ estat */

const readState = (): State => {
  const p = new URLSearchParams(location.search);
  return {
    q: p.get('q') ?? '',
    y: p.get('y') ?? '',
    ss: p.get('ss') ?? '',
    t: p.get('t') ?? '',
    s: p.get('s') ?? '',
    p: p.get('p') ?? '',
  };
};

const state = readState();
let tokens: string[] = [];

/** `ignore` permet fer el recompte facetat: què hi hauria si es canviés
 *  solo esta dimensión (como hacen los filtros de casi todas las tiendas). */
const matches = (e: Exam, ignore?: 's' | 't' | 'y'): boolean => {
  if (ignore !== 'y' && state.y && String(e.year) !== state.y) return false;
  if (state.ss && e.session !== state.ss) return false;
  if (ignore !== 't' && state.t && e.type !== state.t) return false;
  if (ignore !== 's' && state.s && e.code !== state.s) return false;
  if (state.p && !e.phases.includes(state.p)) return false;
  for (const tok of tokens) if (!e.hay.includes(tok)) return false;
  return true;
};

/* ------------------------------------------------------------------ URL */

function syncUrl(push: boolean): void {
  const p = new URLSearchParams();
  for (const key of ['q', 'y', 'ss', 't', 's', 'p'] as const) {
    const value = state[key];
    if (value) p.set(key, value);
  }
  const qs = p.toString();
  history[push ? 'pushState' : 'replaceState'](
    null,
    '',
    `${location.pathname}${qs ? `?${qs}` : ''}${location.hash}`
  );
}

/* --------------------------------------------------------------- render */

function apply(): void {
  tokens = fold(state.q.trim()).split(/\s+/).filter(Boolean);

  let total = 0;
  const perCode = new Map<string, number>();
  const perType = new Map<string, number>();
  let perYearTotal = 0;

  for (const e of exams) {
    const ok = matches(e);
    total += ok ? 1 : 0;

    /* recompte facetat: ignora la pròpia dimensió per poder oferir alternatives */
    if (matches(e, 's')) perCode.set(e.code, (perCode.get(e.code) ?? 0) + 1);
    if (matches(e, 't')) perType.set(e.type, (perType.get(e.type) ?? 0) + 1);
    if (matches(e, 'y')) perYearTotal++;

    const row = rows.get(e.id);
    if (row) row.hidden = !ok;
  }

  for (const group of groups) {
    let shown = 0;
    for (const r of group.rows) if (!r.hidden) shown++;
    group.el.hidden = shown === 0;
    group.count.textContent = shown === 1 ? '1 documento' : `${shown} documentos`;
  }

  /* el chip «Todas» muestra el total ignorando el filtro de asignatura */
  const allChip = chips.find((c) => (c.dataset.s ?? '') === '');
  if (allChip) {
    const em = allChip.querySelector('em');
    if (em) em.textContent = String(perYearTotal);
    const unit = allChip.querySelector('.unit');
    if (unit) unit.textContent = perYearTotal === 1 ? 'doc.' : 'docs.';
  }

  for (const chip of countedChips) {
    const code = chip.dataset.s ?? '';
    /* el chip «Todas» también se marca o se desmarca: si no, sigue encendido
       cuando hay una asignatura elegida (y también al abrir un enlace ?s=) */
    if (chip instanceof HTMLButtonElement) {
      chip.setAttribute('aria-pressed', String(state.s === code));
    }
    if (code === '') continue;
    const n = perCode.get(code) ?? 0;
    chip.classList.toggle('is-dim', n === 0 && state.s !== code);
    const em = chip.querySelector('em');
    if (em) em.textContent = String(n);
    /* el recuento de las tarjetas es vivo: también el plural */
    const unit = chip.querySelector('.unit');
    if (unit) unit.textContent = n === 1 ? 'doc.' : 'docs.';
  }

  /* los segmentos de tipo también muestran qué habría */
  for (const btn of typeBtns) {
    const t = btn.dataset.t ?? '';
    btn.setAttribute('aria-pressed', String(state.t === t));
    if (!t) continue;
    const n = perType.get(t) ?? 0;
    btn.classList.toggle('is-dim', n === 0 && state.t !== t);
  }

  /* el contador late cuando cambia: la cifra acompaña al filtrado */
  if (countEl) {
    const next = String(total);
    if (countEl.textContent !== next) {
      countEl.textContent = next;
      /* el sustantivo acompaña a la cifra: «1 documento», no «1 documentos» */
      const word = document.getElementById('resultWord');
      if (word) word.textContent = total === 1 ? 'documento' : 'documentos';
      const line = countEl.parentElement;
      if (line) {
        line.classList.remove('is-bump');
        void line.offsetWidth; /* reinicia la animación */
        line.classList.add('is-bump');
      }
    }
  }

  const catalogEmpty = exams.length === 0;
  if (emptyEl) emptyEl.hidden = !catalogEmpty;
  if (noMatchEl) noMatchEl.hidden = catalogEmpty || total > 0;
  if (noMatchText) noMatchText.textContent = `No hay documentos para ${describe()}.`;

  clearBtn?.toggleAttribute('hidden', !hasFilters());
  clearBtn2?.toggleAttribute('hidden', !hasFilters());
}

const hasFilters = (): boolean =>
  Boolean(state.q || state.y || state.ss || state.t || state.s || state.p);

function describe(): string {
  const bits: string[] = [];
  if (state.q) bits.push(`«${state.q}»`);
  if (state.s) bits.push(names[codes.indexOf(state.s)] ?? state.s);
  if (state.y) bits.push(state.y);
  if (state.ss) {
    /* el catálogo ya trae la etiqueta larga: «Convocatoria ordinaria · junio» */
    bits.push(SESSION_LABEL.get(state.ss) ?? state.ss);
  }
  if (state.t) bits.push(TYPE_LABEL.get(state.t) ?? state.t);
  if (state.p) bits.push(state.p === 'acceso' ? 'fase de acceso' : 'fase de admisión');
  return bits.join(' · ') || 'esos filtros';
}

/* --------------------------------------------------------------- events */

function setState(patch: Partial<State>, push = false): void {
  Object.assign(state, patch);
  syncUrl(push);
  apply();
}

function paintControls(): void {
  if (inputQ) inputQ.value = state.q;
  if (selectY) selectY.value = state.y;
  if (selectPhase) selectPhase.value = state.p;
  for (const b of sessionBtns) b.setAttribute('aria-pressed', String((b.dataset.ss ?? '') === state.ss));
  for (const b of typeBtns) b.setAttribute('aria-pressed', String((b.dataset.t ?? '') === state.t));
}

function resetAll(): void {
  Object.assign(state, { q: '', y: '', ss: '', t: '', s: '', p: '' });
  paintControls();
  syncUrl(false);
  apply();
}

let timer: number | undefined;
inputQ?.addEventListener('input', () => {
  window.clearTimeout(timer);
  timer = window.setTimeout(() => setState({ q: inputQ.value }));
});

selectY?.addEventListener('change', () => setState({ y: selectY.value }));
selectPhase?.addEventListener('change', () => setState({ p: selectPhase.value }));

$('#segSession')?.addEventListener('click', (event) => {
  const btn = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
  if (!btn) return;
  setState({ ss: btn.dataset.ss ?? '' });
});

$('#segType')?.addEventListener('click', (event) => {
  const btn = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
  if (!btn) return;
  setState({ t: btn.dataset.t ?? '' });
});

for (const chip of chips) {
  chip.addEventListener('click', () => {
    const code = chip.dataset.s ?? '';
    setState({ s: state.s === code ? '' : code }, true);
  });
}

clearBtn?.addEventListener('click', resetAll);
clearBtn2?.addEventListener('click', resetAll);

/* el filtrado ya es en vivo: «Buscar» solo lleva al listado */
form?.addEventListener('submit', (event) => {
  event.preventDefault();
  document.getElementById('archivo')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

/* atajos: «/» enfoca la búsqueda, «Esc» la desenfoca */
document.addEventListener('keydown', (event) => {
  const target = event.target as HTMLElement | null;
  const typing =
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target?.isContentEditable;
  /* sin buscador en la página (archivo vacío) la tecla no se secuestra */
  if (event.key === '/' && !typing && inputQ) {
    event.preventDefault();
    inputQ.focus();
    inputQ.select();
  }
  if (event.key === 'Escape' && document.activeElement === inputQ) inputQ?.blur();
});

window.addEventListener('popstate', () => {
  Object.assign(state, readState());
  paintControls();
  apply();
});

/* ------------------------------------------------------------- arrencada */

paintControls();
apply();
