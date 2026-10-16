/* =========================================================================
   Filtratge del fitxer — sense framework, sense estat duplicat.
   L'estat viu a l'URL (?q=&y=&ss=&t=&s=&p=) perquè es pugui compartir.
   Sense JavaScript el servidor ja renderitza tot el llistat complet.
   ========================================================================= */

type Row = [id: string, subjectIdx: number, year: number, sessionIdx: number, typeIdx: number];
interface Payload {
  exams: Row[];
  subjects: [string, string, string][]; // [code, phase, name]
  types: [string, string, string][]; // [id, etiqueta corta, etiqueta larga]
  base: string;
}

const SESSIONS = ['juny', 'setembre'];

/* paraules clau per buscar sense conèixer el vocabulari exacte */
const TYPE_KEYWORDS: Record<string, string> = {
  enunciats: 'enunciat examen',
  resolucions: 'solucions soluciones',
  criteris: 'criteris correccio',
  plantilla: 'plantilla full omr',
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

const codes = payload.subjects.map((s) => s[0]);
const phases = payload.subjects.map((s) => s[1]);
const names = payload.subjects.map((s) => s[2]);
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
const markedEl = $<HTMLElement>('#markedCount');
const heroGrid = $<HTMLElement>('#heroGrid');
const emptyEl = $<HTMLElement>('#catalogEmpty');
const noMatchEl = $<HTMLElement>('#noMatches');
const noMatchText = $<HTMLElement>('#noMatchesText');

const rows = new Map<string, HTMLElement>();
const cells = new Map<string, HTMLElement>();
for (const el of $$<HTMLElement>('.row[data-id]')) rows.set(el.dataset.id!, el);
for (const el of $$<HTMLElement>('.cell-btn[data-id]')) cells.set(el.dataset.id!, el);

const bands = $$<HTMLElement>('.band').map((el) => ({
  el,
  count: el.querySelector<HTMLElement>('[data-band-count]'),
  cells: Array.from(el.querySelectorAll<HTMLElement>('.cell-btn[data-id]')),
}));

const groups = $$<HTMLElement>('.year-group').map((el) => ({
  el,
  count: el.querySelector<HTMLElement>('[data-group-count]')!,
  rows: $$<HTMLElement>('.row[data-id]').filter((r) => r.closest('.year-group') === el),
}));

const chips = $$<HTMLButtonElement>('.chip');
const sessionBtns = $$<HTMLButtonElement>('#segSession button');
const typeBtns = $$<HTMLButtonElement>('#segType button');

/* ------------------------------------------------------- índex de cerca */

interface Exam {
  id: string;
  code: string;
  phase: string;
  name: string;
  year: number;
  session: string;
  type: string;
  hay: string;
}

const exams: Exam[] = payload.exams.map(([id, subjectIdx, year, sessionIdx, typeIdx]) => {
  const code = codes[subjectIdx] ?? '';
  const name = names[subjectIdx] ?? code;
  const session = SESSIONS[sessionIdx] ?? '';
  const type = TYPES[typeIdx] ?? '';
  return {
    id,
    code,
    phase: phases[subjectIdx] ?? '',
    name,
    year,
    session,
    type,
    hay: fold(
      `${code} ${name} ${year} ${session} ${type} ${TYPE_LABEL.get(type) ?? ''} ${
        TYPE_KEYWORDS[type] ?? ''
      }`
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
 *  només aquesta dimensió (com fan els filtres de la majoria de botigs). */
const matches = (e: Exam, ignore?: 's' | 't' | 'y'): boolean => {
  if (ignore !== 'y' && state.y && String(e.year) !== state.y) return false;
  if (state.ss && e.session !== state.ss) return false;
  if (ignore !== 't' && state.t && e.type !== state.t) return false;
  if (ignore !== 's' && state.s && e.code !== state.s) return false;
  if (state.p && e.phase !== state.p) return false;
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
    const cell = cells.get(e.id);
    if (cell) cell.hidden = !ok;
  }

  for (const band of bands) {
    let shown = 0;
    for (const cell of band.cells) if (!cell.hidden) shown++;
    band.el.hidden = shown === 0;
    if (band.count) band.count.textContent = String(shown);
  }

  for (const group of groups) {
    let shown = 0;
    for (const r of group.rows) if (!r.hidden) shown++;
    group.el.hidden = shown === 0;
    group.count.textContent = shown === 1 ? '1 documento' : `${shown} documentos`;
  }

  /* el xip «Todas» mostra el total ignorant el filtre d'assignatura */
  const allChip = chips.find((c) => (c.dataset.s ?? '') === '');
  if (allChip) {
    const em = allChip.querySelector('em');
    if (em) em.textContent = String(perYearTotal);
  }

  for (const chip of chips) {
    const code = chip.dataset.s ?? '';
    if (code === '') continue;
    const n = perCode.get(code) ?? 0;
    chip.setAttribute('aria-pressed', String(state.s === code));
    chip.classList.toggle('is-dim', n === 0 && state.s !== code);
    const em = chip.querySelector('em');
    if (em) em.textContent = String(n);
  }

  /* els segments de tipus també mostren què hi hauria */
  for (const btn of typeBtns) {
    const t = btn.dataset.t ?? '';
    btn.setAttribute('aria-pressed', String(state.t === t));
    if (!t) continue;
    const n = perType.get(t) ?? 0;
    btn.classList.toggle('is-dim', n === 0 && state.t !== t);
  }

  if (countEl) countEl.textContent = String(total);
  if (markedEl) markedEl.textContent = String(total);
  if (heroGrid) heroGrid.hidden = total === 0;

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
  if (state.ss) bits.push(state.ss === 'juny' ? 'convocatoria de juny' : 'convocatoria de setembre');
  if (state.t) bits.push(TYPE_LABEL.get(state.t) ?? state.t);
  if (state.p) bits.push(state.p === 'general' ? 'fase general' : 'fase específica');
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
form?.addEventListener('submit', (event) => event.preventDefault());

/* clic a un quadrat del hero → fila corresponent del llistat */

for (const [id, cell] of cells) {
  cell.addEventListener('click', () => {
    const row = rows.get(id);
    if (!row) return;
    if (row.hidden) resetAll();
    requestAnimationFrame(() => {
      row.scrollIntoView({ behavior: 'smooth', block: 'center' });
      row.classList.remove('is-target');
      void row.offsetWidth;
      row.classList.add('is-target');
    });
  });
}

window.addEventListener('popstate', () => {
  Object.assign(state, readState());
  paintControls();
  apply();
});

/* ------------------------------------------------------------- arrencada */

paintControls();
apply();
