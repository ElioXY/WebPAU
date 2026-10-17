/* =========================================================================
   Agrupación de documentos por examen (asignatura + año + convocatoria).

   El archivo guarda un documento por fila; para practicar hace falta verlos
   juntos: el enunciado que se hace y las soluciones y criterios que lo
   corrigen. Solo cuenta como examen practicable el que tiene enunciado.
   ========================================================================= */

import { loadCatalog, type DocType, type Exam } from './catalog';

export interface PracticeSet {
  /** `FIS|2026|ordinaria` */
  key: string;
  /** `fis-2026-ordinaria`, el trozo de URL. */
  slug: string;
  subject: string;
  year: number;
  session: string;
  docs: Partial<Record<DocType, Exam>>;
}

export const setSlug = (subject: string, year: number, session: string): string =>
  `${subject.toLowerCase()}-${year}-${session}`;

export function practiceSets(): PracticeSet[] {
  const groups = new Map<string, PracticeSet>();

  for (const exam of loadCatalog().exams) {
    const key = `${exam.subject}|${exam.year}|${exam.session}`;
    const set =
      groups.get(key) ??
      ({
        key,
        slug: setSlug(exam.subject, exam.year, exam.session),
        subject: exam.subject,
        year: exam.year,
        session: exam.session,
        docs: {},
      } as PracticeSet);
    set.docs[exam.type] = exam;
    groups.set(key, set);
  }

  return [...groups.values()]
    .filter((set) => Boolean(set.docs.enunciados))
    .sort(
      (a, b) =>
        b.year - a.year ||
        a.subject.localeCompare(b.subject, 'ca') ||
        a.session.localeCompare(b.session)
    );
}
