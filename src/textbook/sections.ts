import { chapterSources } from './chapters.ts';

export type ChapterRef = { id: string; title: string; start: number; end: number };
export type SectionRef = { id: string; chapterId: string; title: string; start: number; end: number };

export const chapters: ChapterRef[] = chapterSources.map(({ chapter }, index) => ({
  id: `chapter-${index + 1}`, title: chapter.chapter,
  start: chapter.pageRange[0]!, end: chapter.pageRange[1]!,
}));

// Titles checked against the actual contents pages (PDF 5–7). File-page
// boundaries come from the reviewed full-book catalog, not a printed-page offset.
export const sections: SectionRef[] = [
  ['1.1', '正数和负数', 9, 13], ['1.2', '有理数及其大小比较', 14, 26],
  ['2.1', '有理数的加法与减法', 32, 44], ['2.2', '有理数的乘法与除法', 45, 57], ['2.3', '有理数的乘方', 58, 64],
  ['3.1', '列代数式表示数量关系', 76, 85], ['3.2', '代数式的值', 86, 89],
  ['4.1', '整式', 96, 101], ['4.2', '整式的加法与减法', 102, 111],
  ['5.1', '方程', 118, 126], ['5.2', '解一元一次方程', 127, 139], ['5.3', '实际问题与一元一次方程', 140, 149],
  ['6.1', '几何图形', 157, 168], ['6.2', '直线、射线、线段', 169, 176], ['6.3', '角', 177, 188],
].map(([id, title, start, end]) => ({
  id: String(id), chapterId: `chapter-${String(id).split('.')[0]}`, title: `${id} ${title}`,
  start: Number(start), end: Number(end),
}));

export function chapterAt(page: number): ChapterRef | undefined {
  return chapters.find(({ start, end }) => page >= start && page <= end);
}

export function sectionAt(page: number): SectionRef | undefined {
  return sections.find(({ start, end }) => page >= start && page <= end);
}
