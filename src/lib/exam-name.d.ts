export type ParsedSession = 'ordinaria' | 'extraordinaria';
export type ParsedType = 'enunciados' | 'soluciones' | 'criterios' | 'plantilla';

export interface ParsedName {
  subject: string | null;
  /** Todas las asignaturas que empataron; más de una significa que hay que elegir. */
  candidates: string[];
  year: number | null;
  session: ParsedSession | null;
  type: ParsedType | null;
  /** Campos reconocidos, por nombre. */
  fields: string[];
  /** `true` si se reconocieron los cuatro campos. */
  complete: boolean;
}

export interface NameableSubject {
  code: string;
  name: string;
  short?: string;
  aliases?: string[];
}

export function fold(input: string): string;
export function slugify(input: string): string;
export function parseExamName(fileName: string, subjects?: NameableSubject[]): ParsedName;
export function estimatePdfPages(bytes: Uint8Array): number | null;

export const SESSIONS: ParsedSession[];
export const TYPES: ParsedType[];
