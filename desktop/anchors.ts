import { YAMLMap, isMap, isSeq, isNode, isAlias } from 'yaml';
import { parse, saveProblem } from './format.ts';

export type Rect = [number, number, number, number];
type CatalogRange = { source?: undefined; start: number; end: number } | { source: 'custom'; start?: never; end?: never };
export type Catalog = { textbookId: string; title: string; pageCount: number; pages: { page: number; width: number; height: number; printedPage: string | null }[]; chapters: ({ id: string; title: string } & CatalogRange)[]; sections: ({ id: string; title: string; chapterId: string } & CatalogRange)[] };
export type AnchorTarget = { textbook: string; page: number; rects: Rect[] };
export const anchorKey = (anchors: unknown) => JSON.stringify({ anchors });
export function readAnchors(source: string): unknown {
  return parse(source).data._textbook?.anchors;
}
export function validRect(rect: unknown): rect is Rect {
  if (!Array.isArray(rect) || rect.length !== 4 || !rect.every((n) => typeof n === 'number' && Number.isFinite(n))) return false;
  const [x, y, w, h] = rect as Rect;
  return x >= 0 && y >= 0 && w > 0 && h > 0 && x + w <= 1 && y + h <= 1;
}
export function anchorObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
export function resolveAnchor(value: unknown, catalog: Catalog | null) {
  const item = anchorObject(value), problems: string[] = [];
  if (!item) return { problems: ['位置必须是对象，原值已保留。'], target: null, chapter: undefined, section: undefined, page: undefined };
  const bookValid = !!catalog && item.textbook === catalog.textbookId;
  if (!bookValid) problems.push(item.textbook ? '教材标识未匹配当前版本目录，后置字段不用于定位。' : '缺少教材，后置字段不用于定位。');
  const chapter = bookValid ? catalog.chapters.find((entry) => entry.id === item.chapter) : undefined;
  const section = chapter ? catalog!.sections.find((entry) => entry.id === item.section && entry.chapterId === chapter.id) : undefined;
  if (item.chapter !== undefined && !chapter) problems.push('章标识无效；章与节原值已保留。');
  if (item.section !== undefined && !section) problems.push('节标识无效或不属于所选章，原值已保留。');
  const page = bookValid && Number.isSafeInteger(item.pdf_page) && Number(item.pdf_page) > 0 ? catalog.pages.find((page) => page.page === item.pdf_page) : undefined;
  if (item.pdf_page !== undefined && !page) problems.push('文件页序无效，须为目录内从 1 开始的整数。');
  const conflict = page && ((chapter && chapter.source !== 'custom' && (page.page < chapter.start || page.page > chapter.end)) || (section && section.source !== 'custom' && (page.page < section.start || page.page > section.end)));
  if (conflict) problems.push('章节与页面范围冲突，已暂停此条跳转；请明确修改。');
  const rectsValid = item.rects === undefined || Array.isArray(item.rects) && item.rects.length > 0 && item.rects.every(validRect);
  if (!rectsValid) problems.push('区域须为非空的 [x, y, width, height] 列表，坐标不得越出 0–1；原值已保留。');
  if (item.rects !== undefined && !page) problems.push('区域缺少有效页面，不参与定位。');
  const target: AnchorTarget | null = page && !conflict && rectsValid ? { textbook: catalog!.textbookId, page: page.page, rects: item.rects as Rect[] ?? [] } : null;
  return { problems, target, chapter, section, page };
}
// Mutate the YAML tree, not a reconstructed frontmatter object. Source aliases
// that would become dangling are rejected by the final parse.
export function changeAnchors(source: string, expected: string | undefined, operation: { index?: number; patch?: Record<string, unknown>; remove?: boolean; append?: unknown[] }) {
  const problem = saveProblem(source); if (problem) throw new Error(problem);
  if (expected !== undefined && anchorKey(readAnchors(source)) !== expected) throw new Error('笔记位置已改变，已保留当前源码；请取消后重选。');
  const parsed = parse(source);
  let meta = parsed.meta;
  if (!meta) { meta = new YAMLMap(); parsed.doc.set('_textbook', meta); }
  let anchors: unknown = meta.get('anchors', true);
  if (anchors === undefined) { anchors = parsed.doc.createNode([]); meta.set('anchors', anchors); }
  if (!isSeq(anchors)) throw new Error('anchors 必须是列表，请在源码中明确修复。');
  if (operation.index !== undefined) {
    const index = operation.index;
    if (index < 0 || index >= anchors.items.length) throw new Error('位置条目已改变，请重新选择。');
    if (operation.remove) anchors.items.splice(index, 1);
    else {
      const node = anchors.items[index];
      if (!isMap(node)) throw new Error('位置不是可编辑对象，请在源码中修复。');
      for (const [name, value] of Object.entries(operation.patch ?? {})) {
        if (value === undefined) node.delete(name);
        else {
          const previous = node.get(name, true), next = parsed.doc.createNode(value);
          if (isNode(previous)) { next.comment = previous.comment; next.commentBefore = previous.commentBefore; next.spaceBefore = previous.spaceBefore; if (!isAlias(previous) && previous.anchor) next.anchor = previous.anchor; }
          node.set(name, next);
        }
      }
    }
  }
  for (const value of operation.append ?? []) anchors.items.push(parsed.doc.createNode(value));
  if (!anchors.items.length) meta.delete('anchors');
  const result = `${parsed.prefix}---${parsed.newline}${parsed.doc.toString({ lineWidth: 0 }).replace(/\n/g, parsed.newline)}---${parsed.newline}${parsed.body}`;
  parse(result); return result;
}
