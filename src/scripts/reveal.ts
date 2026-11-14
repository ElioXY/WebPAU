/* =========================================================================
   Movimiento al hacer scroll.

   Los bloques marcados con `data-reveal` entran con opacidad y un desplaza-
   miento corto la primera vez que se ven. La clase `reveal-ready` la pone
   este mismo script: si no llega a cargar, el CSS no esconde nada y la
   página se lee igual. Con «reducir movimiento» no se anima nada.
   ========================================================================= */

const root = document.documentElement;
const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');

const revealAll = (elements: HTMLElement[]): void => {
  for (const el of elements) el.classList.add('is-in');
};

const elements = Array.from(document.querySelectorAll<HTMLElement>('[data-reveal]'));

if (elements.length > 0) {
  if (reduce.matches || !('IntersectionObserver' in window)) {
    revealAll(elements);
  } else {
    root.classList.add('reveal-ready');

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          (entry.target as HTMLElement).classList.add('is-in');
          observer.unobserve(entry.target);
        }
      },
      { rootMargin: '0px 0px -6% 0px', threshold: 0.04 }
    );

    for (const el of elements) observer.observe(el);

    /* si el usuario pide menos movimiento a mitad de la visita, se enseña todo */
    reduce.addEventListener('change', (event) => {
      if (!event.matches) return;
      observer.disconnect();
      revealAll(elements);
    });
  }
}
