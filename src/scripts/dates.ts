/* =========================================================================
   Cuenta atrás de la próxima convocatoria.

   El build no sabe qué día es hoy cuando alguien abre la página, así que el
   texto se calcula aquí y se refresca cada hora (y al volver a la pestaña, por
   si el portátil ha estado cerrado unos días).
   ========================================================================= */

import type { ExamEvent } from '../lib/catalog';
import { countdown, humanDate, nextEvent } from '../lib/dates';

const dataEl = document.getElementById('dates-data');
const strip = document.getElementById('nextExam');
const labelEl = document.getElementById('nextExamLabel');
const daysEl = document.getElementById('nextExamDays');

if (dataEl?.textContent && strip && labelEl && daysEl) {
  const events = JSON.parse(dataEl.textContent) as ExamEvent[];

  const render = (): void => {
    const event = nextEvent(events);
    if (!event) {
      strip.hidden = true;
      return;
    }

    const { text } = countdown(event);
    labelEl.textContent = `${event.label} · ${humanDate(event)}${
      event.provisional ? ' (provisional)' : ''
    }`;
    daysEl.textContent = text;
    strip.hidden = false;
  };

  render();

  /* Una hora basta: lo que cambia es el día, no el minuto. */
  window.setInterval(render, 60 * 60 * 1000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) render();
  });
}
