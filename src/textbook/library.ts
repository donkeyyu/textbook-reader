import book from './book.json' with { type: 'json' };

// Register only textbooks that the reader can open with their published resources.
export const textbooks = [{
  id: book.documentSha256,
  title: book.title,
  edition: '人教版 · 2024 年审定',
  cover: '/textbooks/grade-7-volume-1/page-1.webp',
  pages: book.pages,
}] as const;

export function getTextbook(id: string) {
  return textbooks.find((textbook) => textbook.id === id);
}
