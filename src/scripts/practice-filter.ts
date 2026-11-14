/* =========================================================================
   Filtros del índice de práctica.

   Dos ejes que se combinan: la asignatura (los botones de arriba) y el texto
   o el año (el buscador). Sin filtros, cada asignatura enseña solo sus tres
   convocatorias más recientes para que el índice no sea un muro de PDFs; al
   elegir asignatura o buscar, se abre todo lo que casa.
   ========================================================================= */

const input = document.getElementById('q') as HTMLInputElement | null;
const year = document.getElementById('py') as HTMLSelectElement | null;

if (input && year) {
  const sets = Array.from(document.querySelectorAll<HTMLElement>('[data-set]'));
  const groups = Array.from(document.querySelectorAll<HTMLElement>('[data-group]'));
  const chips = Array.from(
    document.querySelectorAll<HTMLButtonElement>('[data-subject-filter]')
  );
  const more = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-show-all]'));
  const count = document.getElementById('practiceCount');
  const clear = document.getElementById('practiceClear');
  const empty = document.getElementById('practiceEmpty');
  const total = sets.length;

  /** asignatura elegida; cadena vacía = todas */
  let subject = '';

  /* sin tildes y en minúsculas: «fisica» encuentra «Física» */
  const norm = (value: string): string =>
    value
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');

  const apply = (): void => {
    const query = norm(input.value.trim());
    const chosenYear = year.value;
    const filtering = Boolean(query || chosenYear || subject);
    let shown = 0;

    for (const group of groups) {
      const code = group.dataset.group ?? '';
      const bySubject = subject === '' || code === subject;
      let visibleInGroup = 0;

      for (const [index, set] of Array.from(
        group.querySelectorAll<HTMLElement>('[data-set]')
      ).entries()) {
        const matchesText = !query || norm(set.dataset.q ?? '').includes(query);
        const matchesYear = !chosenYear || set.dataset.year === chosenYear;
        const matches = bySubject && matchesText && matchesYear;
        /* sin filtros solo se enseña la punta del índice, pero el contador
           sigue hablando de exámenes, no de filas plegadas */
        const capped = !filtering && index >= 3;

        set.hidden = !matches || capped;
        if (matches) {
          visibleInGroup += 1;
          shown += 1;
        }
      }

      group.hidden = visibleInGroup === 0;
      group.toggleAttribute('data-expanded', filtering);
    }

    for (const button of more) {
      const holder = button.closest<HTMLElement>('.practice-more');
      if (holder) holder.hidden = filtering;
    }

    for (const chip of chips) {
      chip.setAttribute('aria-pressed', String((chip.dataset.subjectFilter ?? '') === subject));
    }

    if (count) {
      count.textContent =
        shown === total ? `${total} exámenes` : `${shown} de ${total} exámenes`;
    }

    if (clear) clear.hidden = !filtering;
    if (empty) empty.hidden = shown !== 0;
  };

  const reveal = (): void => {
    document.getElementById('examenes')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const choose = (code: string): void => {
    subject = code;
    apply();
    reveal();
  };

  for (const chip of chips) {
    chip.addEventListener('click', () => choose(chip.dataset.subjectFilter ?? ''));
  }

  for (const button of more) {
    button.addEventListener('click', () => {
      input.value = '';
      year.value = '';
      choose(button.dataset.showAll ?? '');
    });
  }

  input.addEventListener('input', apply);
  year.addEventListener('change', apply);

  clear?.addEventListener('click', () => {
    input.value = '';
    year.value = '';
    subject = '';
    apply();
    input.focus();
  });

  /* la barra lleva al buscador, como en el archivo */
  document.addEventListener('keydown', (event) => {
    if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
    const active = document.activeElement;
    if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) return;
    event.preventDefault();
    input.focus();
  });

  apply();
}
