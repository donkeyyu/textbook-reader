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

export function pageLabel(page: { page: number; printedPage: string | null }) {
  return page.printedPage === null ? `文件第 ${page.page} 页` : `课本第 ${page.printedPage} 页`;
}

export function resolvePageInput(input: string): { page: number; error?: never } | { error: string; page?: never } {
  const label = input.trim();
  if (!label) return { error: '请输入页码。' };
  const page = Number(label);
  if (!/^\d+$/.test(label) || !Number.isSafeInteger(page) || page < 1 || page > pageCount) {
    return { error: `请输入 1–${pageCount} 的整数页码。` };
  }
  return { page };
}

export function getPage(page: PageNumber) {
  if (!Number.isInteger(page) || page < 1 || page > pageCount) {
    throw new RangeError(`Page must be an integer from 1 to ${pageCount}.`);
  }
  return pages[page - 1]!;
}
