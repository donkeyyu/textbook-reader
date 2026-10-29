import book from './book.json' with { type: 'json' };
import { chapterSources } from './chapters.ts';
import { chapters, sections } from './sections.ts';
import { getLocation, type Supplement, type TextbookLocation } from './supplements.ts';
import type { PersonalData, PersonalSupplement } from '../reader/personal.ts';

export const bookId = book.documentSha256;
export type NodeType = 'concept' | 'method' | 'question' | 'review' | 'personal';
export type NodeRef = { bookId: string; source: 'default' | 'personal'; id: string };
export type NodeLocation = { page: number; region: TextbookLocation['region']; locationId: string | null };
type NodeFields = {
  bookId: string; id: string;
  key: string; title: string; type: NodeType; summary: string;
  chapterId: string | null; sectionId: string | null; location: NodeLocation | null;
};
export type ContentNode = NodeFields & (
  { source: 'default'; type: Exclude<NodeType, 'personal'>; location: NodeLocation; supplement: Supplement } |
  { source: 'personal'; type: 'personal'; personal: PersonalSupplement }
);
export type PublishedContent = {
  documentSha256: string; pageCount: number; chapters: typeof chapters; sections: typeof sections;
  supplements: Supplement[];
};

export function nodeKey(ref: NodeRef): string {
  return JSON.stringify([ref.bookId, ref.source, ref.id]);
}

export function publishedContent(): PublishedContent {
  return { documentSha256: bookId, pageCount: book.pageCount, chapters, sections,
    supplements: chapterSources.flatMap(({ chapter }) => chapter.supplements) };
}

export function supplementKind(note: Supplement): Exclude<NodeType, 'personal'> {
  if (note.questionGuide) return 'question';
  if (/定义概念|陈述性质/.test(note.learningRole)) return 'concept';
  if (/示范方法|推导或证明/.test(note.learningRole)) return 'method';
  return 'review';
}

export function contentNodes(content: PublishedContent, personal: PersonalData): ContentNode[] {
  const chapterAt = (page: number | null) => page === null ? undefined : content.chapters.find(({ start, end }) => page >= start && page <= end);
  const sectionAt = (page: number | null) => page === null ? undefined : content.sections.find(({ start, end }) => page >= start && page <= end);
  const defaults = content.supplements.map((supplement): ContentNode => {
    const location = getLocation(supplement.locationId);
    const ref = { bookId, source: 'default' as const, id: supplement.id };
    return { ...ref, key: nodeKey(ref), title: supplement.title, type: supplementKind(supplement),
      summary: supplement.preview, chapterId: chapterAt(location.page)?.id ?? null,
      sectionId: sectionAt(location.page)?.id ?? null,
      location: { page: location.page, region: location.region, locationId: location.id }, supplement };
  });
  return [...defaults, ...personal.supplements.map((item): ContentNode => {
    const ref = { bookId, source: 'personal' as const, id: item.id };
    return { ...ref, key: nodeKey(ref), title: item.title, type: 'personal', summary: item.markdown.slice(0, 160),
      chapterId: item.chapterId === undefined ? chapterAt(item.page)?.id ?? null : item.chapterId,
      sectionId: item.sectionId === undefined ? sectionAt(item.page)?.id ?? null : item.sectionId,
      location: item.page === null || item.region === null ? null : { page: item.page, region: item.region, locationId: null }, personal: item };
  })];
}

export function parsePublishedContent(value: unknown): PublishedContent {
  const data = value as PublishedContent | null;
  const strings = (items: unknown): items is string[] => Array.isArray(items) && items.every((item) => typeof item === 'string');
  if (!data || data.documentSha256 !== bookId || data.pageCount !== book.pageCount ||
    !Array.isArray(data.chapters) || !Array.isArray(data.sections) || !Array.isArray(data.supplements)) throw new Error('教材内容与当前教材不匹配。');
  if (data.chapters.some((item) => !item || typeof item.id !== 'string' || typeof item.title !== 'string' || !Number.isInteger(item.start) || !Number.isInteger(item.end)) ||
    data.sections.some((item) => !item || typeof item.id !== 'string' || typeof item.chapterId !== 'string' || typeof item.title !== 'string' || !Number.isInteger(item.start) || !Number.isInteger(item.end))) throw new Error('教材章节信息无效。');
  const ids = new Set<string>();
  for (const item of data.supplements) {
    if (!item || typeof item.id !== 'string' || !item.id || ids.has(item.id) || typeof item.locationId !== 'string' ||
      !['title', 'preview', 'learningRole', 'learningGap', 'learningAction'].every((key) => typeof item[key as keyof Supplement] === 'string') ||
      !strings(item.paragraphs) || !Array.isArray(item.related) || item.related.some((link) => !link || typeof link.locationId !== 'string' || typeof link.label !== 'string' || typeof link.purpose !== 'string') ||
      (item.questionGuide && (!strings(item.questionGuide.method) || (item.questionGuide.knowledgePoints !== undefined && !strings(item.questionGuide.knowledgePoints)) || (item.questionGuide.cautions !== undefined && !strings(item.questionGuide.cautions))))) throw new Error('教材补充内容无效。');
    ids.add(item.id);
    getLocation(item.locationId);
    item.related.forEach((link) => getLocation(link.locationId));
  }
  return data;
}

export function supplementQueries(content: PublishedContent) {
  const byId = new Map(content.supplements.map((item) => [item.id, item]));
  return {
    getSupplement: (id: string) => byId.get(id),
    supplementsForPage: (page: number) => content.supplements.filter((item) => getLocation(item.locationId).page === page),
  };
}
