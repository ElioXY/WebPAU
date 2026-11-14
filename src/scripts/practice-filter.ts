/* =========================================================================
   Buscador del índice de práctica.

   Filtra en el navegador: cada examen practicable lleva su texto en
   `data-q` (asignatura, año, convocatoria y documentos) y el año en
   `data-year`. Al escribir se ocultan las filas que no casan y los grupos de
   asignatura que se quedan sin ninguna, así que la lista se acorta sola.
   ========================================================================= */

const input = document.getElementById('q') as HTMLInputElement | null;
const year = document.getElementById('py') as HTMLSelectElement | null;

if (input && year) {
  const sets = Array.from(document.querySelectorAll<HTMLElement>('[data-set]'));
  const groups = Array.from(document.querySelectorAll<HTMLElement>('[data-subject]'));
  const count = document.getElementById('practiceCount');
  const clear = document.getElementById('practiceClear');
  const empty = document.getElementById('practiceEmpty');
  const total = sets.length;

  /* sin tildes y en minúsculas: «fisica» encuentra «Física» */
  const norm = (value: string): string =>
    value
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');

  const apply = (): void => {
    const query = norm(input.value.trim());
    const chosenYear = year.value;
    let shown = 0;

    for (const set of sets) {
      const matchesText = !query || norm(set.dataset.q ?? '').includes(query);
      const matchesYear = !chosenYear || set.dataset.year === chosenYear;
      const visible = matchesText && matchesYear;
      set.hidden = !visible;
      if (visible) shown += 1;
    }

    for (const group of groups) {
      const visible = Array.from(group.querySelectorAll<HTMLElement>('[data-set]')).filter(
        (set) => !set.hidden
      ).length;
      group.hidden = visible === 0;
      const badge = group.querySelector<HTMLElement>('[data-group-count]');
      if (badge) badge.textContent = `${visible} ${visible === 1 ? 'examen' : 'exámenes'}`;
    }

    if (count) {
      count.textContent =
        shown === total
          ? `${total} ${total === 1 ? 'examen' : 'exámenes'}`
          : `${shown} de ${total} exámenes`;
    }

    if (clear) clear.hidden = query.length === 0 && chosenYear.length === 0;
    if (empty) empty.hidden = shown !== 0;
  };

  input.addEventListener('input', apply);
  year.addEventListener('change', apply);

  clear?.addEventListener('click', () => {
    input.value = '';
    year.value = '';
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
