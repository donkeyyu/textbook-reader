import { createHash } from 'node:crypto';

export type InitialAnchor = { textbook: string; chapter?: string; section?: string; pdf_page: number; rects: number[][] };
export type InitialEntry = { sourceId: string; title: string; type: string; path: string; body: string; anchors: InitialAnchor[] };
export type InitialPackage = {
  schemaVersion: 1; textbook: string; version: string;
  archive: { table: 'reader_initial_versions'; state: 'unpublished' };
  source: unknown; entries: InitialEntry[];
};
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  return JSON.stringify(value);
}
export const packageVersion = (source: unknown) => createHash('sha256').update(canonical(source)).digest('hex');
export function checkPackage(value: unknown): InitialPackage {
  const pack = value as InitialPackage;
  if (pack?.schemaVersion !== 1 || !/^[a-f0-9]{64}$/.test(pack.textbook) || pack.version !== packageVersion({ source: pack.source, entries: pack.entries }) ||
      pack.archive?.state !== 'unpublished' || pack.archive.table !== 'reader_initial_versions' || !Array.isArray(pack.entries) || !pack.entries.length ||
      new Set(pack.entries.map((entry) => entry.sourceId)).size !== pack.entries.length || pack.entries.some((entry) =>
        !entry || typeof entry.sourceId !== 'string' || !entry.sourceId || typeof entry.title !== 'string' || typeof entry.body !== 'string' || !Array.isArray(entry.anchors))) throw new Error('初始笔记包版本或内容校验失败。');
  return pack;
}
export function callout(type: string, title: string, parts: string[], fold = '') {
  return parts.length ? `> [!${type}]${fold} ${title}\n${parts.join('\n\n').split('\n').map((line) => `> ${line}`).join('\n')}\n\n` : '';
}
export function initialBody(note: { paragraphs: string[]; questionGuide?: { continuous?: boolean; knowledgePoints?: string[]; method: string[]; cautions?: string[] } }) {
  const guide = note.questionGuide;
  const paragraphs = [...note.paragraphs];
  if (guide?.continuous) paragraphs.push(...(guide.knowledgePoints ?? []), ...guide.method, ...(guide.cautions ?? []));
  let body = callout('explanation', '理解', paragraphs);
  if (guide && !guide.continuous) body += callout('explanation', '相关知识', guide.knowledgePoints ?? []) + callout('hint', '思路与方法', guide.method, '-') + callout('warning', '注意事项', guide.cautions ?? []);
  return body;
}
