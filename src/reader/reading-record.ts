import book from '../textbook/book.json' with { type: 'json' };

export type ReadingPosition = { page: number; fraction: number };
export const readingStorageKey = `textbook-reading-v1:${book.documentSha256}`;
type StorageAccess = Pick<Storage, 'getItem' | 'setItem'>;

function validPosition(value: unknown): value is ReadingPosition {
  if (typeof value !== 'object' || value === null) return false;
  const { page, fraction } = value as Record<string, unknown>;
  return typeof page === 'number' && Number.isInteger(page) && page >= 1 && page <= book.pageCount &&
    // At the bottom, a tall viewport can put the last page more than one page below its top.
    typeof fraction === 'number' && Number.isFinite(fraction) && fraction <= 1;
}

export function loadReadingPosition(storage?: StorageAccess): ReadingPosition | null {
  try {
    const raw = (storage ?? localStorage).getItem(readingStorageKey);
    if (raw === null) return null;
    const record: unknown = JSON.parse(raw);
    if (!validPosition(record)) return null;
    const { version, documentSha256 } = record as ReadingPosition & Record<string, unknown>;
    if (version !== 1 || documentSha256 !== book.documentSha256) return null;
    return { page: record.page, fraction: record.fraction };
  } catch (cause) {
    if (cause instanceof SyntaxError) return null;
    throw new Error('无法读取上次阅读位置。仍可继续阅读，本次不会覆盖原记录。', { cause });
  }
}

export function saveReadingPosition(position: ReadingPosition, storage?: StorageAccess): void {
  if (!validPosition(position)) throw new Error('阅读位置无效。');
  try {
    (storage ?? localStorage).setItem(readingStorageKey, JSON.stringify({
      version: 1, documentSha256: book.documentSha256, page: position.page, fraction: position.fraction,
    }));
  } catch (cause) {
    throw new Error('无法保存阅读位置。仍可继续阅读，下次打开可能需要重新找页。', { cause });
  }
}
