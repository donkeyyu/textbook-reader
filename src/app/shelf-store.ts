export const shelfStorageKey = 'textbook-shelf-v1';
type ShelfStorage = Pick<Storage, 'getItem' | 'setItem'>;

export function loadShelf(storage?: ShelfStorage): string[] {
  let raw: string | null;
  try { raw = (storage ?? localStorage).getItem(shelfStorageKey); }
  catch (cause) { throw new Error('无法读取本地书架。仍可从教材库直接阅读，本次不会覆盖原书架。', { cause }); }
  if (raw === null) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null || !('version' in value) || value.version !== 1 ||
      !('bookIds' in value) || !Array.isArray(value.bookIds) ||
      !value.bookIds.every((id): id is string => typeof id === 'string' && id.length > 0)) throw new Error('invalid shelf');
    return [...new Set(value.bookIds)];
  } catch (cause) {
    throw new Error('本地书架记录无法识别。仍可从教材库直接阅读，原记录已保留。', { cause });
  }
}

export function saveShelf(bookIds: readonly string[], storage?: ShelfStorage): void {
  try {
    (storage ?? localStorage).setItem(shelfStorageKey, JSON.stringify({ version: 1, bookIds: [...new Set(bookIds)] }));
  } catch (cause) {
    throw new Error('无法保存本地书架，可能是存储空间不足或浏览器禁止保存。请重试，或从教材库直接阅读。', { cause });
  }
}

export function removeShelfBook(id: string, storage?: ShelfStorage): string[] {
  const members = loadShelf(storage).filter((member) => member !== id);
  saveShelf(members, storage);
  return members;
}
