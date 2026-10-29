import book from '../../textbook/book.json' with { type: 'json' };

export type ReadingPosition = { page: number; fraction: number };
type ReadingBook = { documentSha256: string; pageCount: number };
export const readingStorageKey = `textbook-reading-v1:${book.documentSha256}`;
type StorageAccess = Pick<Storage, 'getItem' | 'setItem'>;

function validPosition(value: unknown, textbook: ReadingBook): value is ReadingPosition {
  if (typeof value !== 'object' || value === null) return false;
  const { page, fraction } = value as Record<string, unknown>;
  return typeof page === 'number' && Number.isInteger(page) && page >= 1 && page <= textbook.pageCount &&
    // At the bottom, a tall viewport can put the last page more than one page below its top.
    typeof fraction === 'number' && Number.isFinite(fraction) && fraction <= 1;
}

export function loadReadingPosition(storage?: StorageAccess, textbook: ReadingBook = book): ReadingPosition | null {
  let raw: string | null;
  try {
    raw = (storage ?? localStorage).getItem(`textbook-reading-v1:${textbook.documentSha256}`);
  } catch (cause) {
    throw new Error('无法读取上次阅读位置。仍可继续阅读，本次不会覆盖原记录。', { cause });
  }
  if (raw === null) return null;
  try {
    const record: unknown = JSON.parse(raw);
    if (!validPosition(record, textbook)) throw new Error('invalid position');
    const { version, documentSha256 } = record as ReadingPosition & Record<string, unknown>;
    if (version !== 1 || documentSha256 !== textbook.documentSha256) throw new Error('mismatched version');
    return { page: record.page, fraction: record.fraction };
  } catch (cause) {
    throw new Error('上次阅读位置无法识别，将从封面开始。仍可继续阅读，本次不会覆盖原记录。', { cause });
  }
}

export function saveReadingPosition(position: ReadingPosition, storage?: StorageAccess, textbook: ReadingBook = book): void {
  if (!validPosition(position, textbook)) throw new Error('阅读位置无效。');
  try {
    (storage ?? localStorage).setItem(`textbook-reading-v1:${textbook.documentSha256}`, JSON.stringify({
      version: 1, documentSha256: textbook.documentSha256, page: position.page, fraction: position.fraction,
    }));
  } catch (cause) {
    throw new Error('无法保存阅读位置。仍可继续阅读，下次打开可能需要重新找页。', { cause });
  }
}
