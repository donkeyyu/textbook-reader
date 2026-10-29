import book from '../textbook/book.json' with { type: 'json' };
import { validBindings, type LinkBinding } from './links/document.ts';

export type PersonalSupplement = {
  id: string;
  title: string;
  markdown: string;
  page: number | null;
  region: { x: number; y: number; width: number; height: number } | null;
  chapterId?: string | null;
  sectionId?: string | null;
  bindings?: readonly LinkBinding[];
};
export type PersonalData = { supplements: PersonalSupplement[]; notes: Record<string, string>; noteBindings?: Record<string, readonly LinkBinding[]> };
export const personalStorageKey = `textbook-personal-v1:${book.documentSha256}`;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validSupplement(value: unknown): value is PersonalSupplement {
  if (!isRecord(value) || typeof value.id !== 'string' || !/^[\w-]+$/.test(value.id) ||
    typeof value.title !== 'string' || !value.title.trim() || typeof value.markdown !== 'string' || !value.markdown.trim()) return false;
  if (['chapterId', 'sectionId'].some((key) => key in value && value[key] !== null && (typeof value[key] !== 'string' || !value[key].trim()))) return false;
  if ('bindings' in value && !validBindings(value.markdown, value.bindings, book.documentSha256)) return false;
  if (value.page === null && value.region === null) return true;
  if (typeof value.page !== 'number' || !Number.isInteger(value.page) || value.page < 1 || value.page > book.pageCount || !isRecord(value.region)) return false;
  const { x, y, width, height } = value.region;
  return typeof x === 'number' && typeof y === 'number' && typeof width === 'number' && typeof height === 'number' &&
    [x, y, width, height].every(Number.isFinite) && x >= 0 && y >= 0 && width > 0 && height > 0 &&
    x + width <= 1.000001 && y + height <= 1.000001;
}

export function validPersonalData(value: unknown): value is PersonalData {
  if (!isRecord(value) || !Array.isArray(value.supplements) || !value.supplements.every(validSupplement) ||
    !isRecord(value.notes) || !Object.values(value.notes).every((note) => typeof note === 'string')) return false;
  if ('noteBindings' in value && (!isRecord(value.noteBindings) || !Object.entries(value.noteBindings).every(([id, bindings]) =>
    typeof (value.notes as Record<string, unknown>)[id] === 'string' && validBindings((value.notes as Record<string, string>)[id]!, bindings, book.documentSha256)))) return false;
  return new Set(value.supplements.map(({ id }) => id)).size === value.supplements.length;
}
