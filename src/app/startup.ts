export type StartupDestination = { page: 'shelf' } | { page: 'reader'; bookId: string };
export const startupStorageKey = 'textbook-startup-v1';
type StartupStorage = Pick<Storage, 'getItem' | 'setItem'>;

export function loadStartupDestination(storage?: StartupStorage): StartupDestination | null {
  let raw: string | null;
  try { raw = (storage ?? localStorage).getItem(startupStorageKey); }
  catch (cause) { throw new Error('无法读取上次停留页面。已进入书架，本次不会覆盖原记录。', { cause }); }
  if (raw === null) return null;
  try {
    const value = JSON.parse(raw);
    if (value?.version === 1) {
      if (value.page === 'shelf') return { page: 'shelf' };
      if (value.page === 'reader' && typeof value.bookId === 'string' && value.bookId) return { page: 'reader', bookId: value.bookId };
    }
  } catch { /* Keep the original record, just as for an unsupported format. */ }
  throw new Error('上次停留页面记录无法识别。已进入书架，原记录已保留。');
}

export function saveStartupDestination(destination: StartupDestination, storage?: StartupStorage): void {
  try { (storage ?? localStorage).setItem(startupStorageKey, JSON.stringify({ version: 1, ...destination })); }
  catch (cause) { throw new Error('无法保存当前停留页面。仍可继续阅读，下次打开可能无法回到此处。', { cause }); }
}

export function resolveStartupDestination(destination: StartupDestination | null, members: readonly string[], availableIds: readonly string[]) {
  if (!destination || destination.page === 'shelf') return { bookId: null, notice: '' };
  if (!availableIds.includes(destination.bookId)) return { bookId: null, notice: '上次阅读的教材版本暂不可用，已返回书架。' };
  if (!members.includes(destination.bookId)) return { bookId: null, notice: '上次阅读的教材已不在书架，已返回书架。可重新添加后继续阅读。' };
  return { bookId: destination.bookId, notice: '' };
}
