import book from './book.json' with { type: 'json' };

export type PageNumber = number;
export const bookTitle = book.title;
export const pageCount = book.pageCount;
export const pages = book.pages.map(({ page, width, height, printedPage }) => ({
  page,
  width,
  height,
  printedPage,
  image: `/textbooks/grade-7-volume-1/page-${page}.webp`,
  thumbnail: `/textbooks/grade-7-volume-1/thumb-${page}.webp`,
  alt: `${bookTitle}，文件页序 ${page}/${pageCount}，${printedPage === null ? '无印刷页码' : `课本第 ${printedPage} 页`}`,
}));

export type PageInputMode = 'printed' | 'file';

export function pageLabel(page: { page: number; printedPage: string | null }) {
  return page.printedPage === null ? `文件第 ${page.page} 页` : `课本第 ${page.printedPage} 页`;
}

export function resolvePageInput(input: string, mode: PageInputMode, entries: readonly { page: number; printedPage: string | null }[] = pages): { page: number; error?: never } | { error: string; page?: never } {
  const label = input.trim();
  if (!label) return { error: mode === 'printed' ? '请输入课本页码；封面等页面请切换文件页序。' : '请输入文件页序。' };
  if (mode === 'printed') {
    const matches = entries.filter((page) => page.printedPage === label);
    if (matches.length === 1) return { page: matches[0]!.page };
    if (matches.length > 1) return { error: '此课本页码对应多个页面，请切换文件页序。' };
    return { error: /^[\p{L}\p{N}]+$/u.test(label) ? '未找到此课本页码，请核对纸书或切换文件页序。' : '请输入纸书上印出的页码标签；也可切换文件页序。' };
  }
  const page = Number(label);
  if (!/^\d+$/.test(label) || !Number.isSafeInteger(page) || page < 1 || page > entries.length) {
    return { error: `请输入 1–${entries.length} 的整数文件页序。` };
  }
  return { page };
}

export function getPage(page: PageNumber) {
  if (!Number.isInteger(page) || page < 1 || page > pageCount) {
    throw new RangeError(`Page must be an integer from 1 to ${pageCount}.`);
  }
  return pages[page - 1]!;
}
