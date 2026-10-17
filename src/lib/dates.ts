/* =========================================================================
   Calendario de convocatorias: leer una fecha y saber cuánto falta.

   Sin `node:` a propósito: lo usan el componente que se renderiza en el build
   y el script que actualiza la cuenta atrás en el navegador.
   ========================================================================= */

import type { ExamEvent } from './catalog';

const dayFmt = new Intl.DateTimeFormat('es-ES', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

const monthFmt = new Intl.DateTimeFormat('es-ES', { month: 'long', year: 'numeric' });

/** Un `YYYY-MM-DD` en hora local, no en UTC: son fechas de calendario. */
export const parseDay = (day: string): Date => new Date(`${day}T00:00:00`);

/** Último día del mes `YYYY-MM`. */
export function endOfMonth(month: string): Date {
  const [year, value] = month.split('-').map(Number);
  return new Date(year, value, 0);
}

/** El último día en que la convocatoria sigue viva. */
export function endOfEvent(event: ExamEvent): Date | null {
  if (event.end) return parseDay(event.end);
  if (event.start) return parseDay(event.start);
  if (event.month) return endOfMonth(event.month);
  return null;
}

/** «1–3 de junio de 2027», «julio de 2027» o «fecha por confirmar». */
export function humanDate(event: ExamEvent): string {
  if (event.start) {
    const start = parseDay(event.start);
    if (!event.end || event.end === event.start) return dayFmt.format(start);
    const end = parseDay(event.end);
    if (start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear()) {
      return `${start.getDate()}–${end.getDate()} de ${monthFmt.format(start)}`;
    }
    return `${dayFmt.format(start)} – ${dayFmt.format(end)}`;
  }
  if (event.month) return monthFmt.format(endOfMonth(event.month));
  return 'fecha por confirmar';
}

export interface Countdown {
  /** Días que faltan para el primer día; negativo si ya empezó. */
  days: number | null;
  text: string;
}

/** Cuánto queda: «faltan 227 días», «hoy empieza», «en marcha»… */
export function countdown(event: ExamEvent, now: Date = new Date()): Countdown {
  if (!event.start) return { days: null, text: 'fecha por confirmar' };

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const start = parseDay(event.start);
  const end = endOfEvent(event) ?? start;
  const days = Math.round((start.getTime() - today.getTime()) / 86_400_000);

  if (today > end) return { days, text: 'terminada' };
  if (days > 1) return { days, text: `faltan ${days} días` };
  if (days === 1) return { days, text: 'faltan 1 día' };
  if (days === 0) return { days, text: 'hoy empieza' };
  return { days, text: 'en marcha' };
}

/** La siguiente convocatoria que no ha terminado, si queda alguna. */
export function nextEvent(events: ExamEvent[], now: Date = new Date()): ExamEvent | null {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return (
    events.find((event) => {
      const end = endOfEvent(event);
      return end !== null && end >= today;
    }) ?? null
  );
}
