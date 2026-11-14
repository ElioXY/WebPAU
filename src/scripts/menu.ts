/* =========================================================================
   Menú de secciones en móvil.

   El botón `[data-menu-toggle]` abre y cierra el `[data-menu]` poniendo
   `data-menu="open"` en la cabecera; el CSS hace el resto. Se cierra al elegir
   una sección, al pulsar fuera, con Escape y al volver al ancho de escritorio.
   ========================================================================= */

const header = document.querySelector<HTMLElement>('.site-head');
const toggle = header?.querySelector<HTMLButtonElement>('[data-menu-toggle]');
const nav = header?.querySelector<HTMLElement>('[data-menu-panel]');

if (header && toggle && nav) {
  const wide = window.matchMedia('(min-width: 901px)');

  const setOpen = (open: boolean): void => {
    header.dataset.menu = open ? 'open' : 'closed';
    toggle.setAttribute('aria-expanded', String(open));
  };

  setOpen(false);

  toggle.addEventListener('click', () => {
    setOpen(toggle.getAttribute('aria-expanded') !== 'true');
  });

  /* elegir una sección cierra el desplegable antes de navegar */
  nav.addEventListener('click', (event) => {
    if ((event.target as Element | null)?.closest('a')) setOpen(false);
  });

  document.addEventListener('click', (event) => {
    const target = event.target as Node | null;
    if (target && !header.contains(target)) setOpen(false);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || toggle.getAttribute('aria-expanded') !== 'true') return;
    setOpen(false);
    toggle.focus();
  });

  wide.addEventListener('change', (event) => {
    if (event.matches) setOpen(false);
  });
}
