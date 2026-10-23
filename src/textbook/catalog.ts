import book from './book.json' with { type: 'json' };

export type PageNumber = number;
export const bookTitle = book.title;
export const pageCount = book.pageCount;
export const pages = book.pages.map(({ page, width, height }) => ({
  page,
  width,
  height,
  image: `/textbooks/grade-7-volume-1/page-${page}.webp`,
  thumbnail: `/textbooks/grade-7-volume-1/thumb-${page}.webp`,
  alt: `${bookTitle}，第 ${page} 页，共 ${pageCount} 页`,
}));

export function getPage(page: PageNumber) {
  if (!Number.isInteger(page) || page < 1 || page > pageCount) {
    throw new RangeError(`Page must be an integer from 1 to ${pageCount}.`);
  }
  return pages[page - 1]!;
}
