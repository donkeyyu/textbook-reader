import book from '../textbook/book.json' with { type: 'json' };

export type PersonalSupplement = {
  id: string;
  title: string;
  markdown: string;
  page: number;
  region: { x: number; y: number; width: number; height: number };
  chapterId?: string | null;
  sectionId?: string | null;
};
export type PersonalData = { supplements: PersonalSupplement[]; notes: Record<string, string> };
export const personalStorageKey = `textbook-personal-v1:${book.documentSha256}`;
type StorageAccess = Pick<Storage, 'getItem' | 'setItem'>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validSupplement(value: unknown): value is PersonalSupplement {
  if (!isRecord(value) || typeof value.id !== 'string' || !/^[\w-]+$/.test(value.id) ||
    typeof value.title !== 'string' || !value.title.trim() || typeof value.markdown !== 'string' || !value.markdown.trim() ||
    typeof value.page !== 'number' || !Number.isInteger(value.page) || value.page < 1 || value.page > book.pageCount || !isRecord(value.region)) return false;
  if (['chapterId', 'sectionId'].some((key) => key in value && value[key] !== null && typeof value[key] !== 'string')) return false;
  const { x, y, width, height } = value.region;
  return typeof x === 'number' && typeof y === 'number' && typeof width === 'number' && typeof height === 'number' &&
    [x, y, width, height].every(Number.isFinite) && x >= 0 && y >= 0 && width > 0 && height > 0 &&
    x + width <= 1.000001 && y + height <= 1.000001;
}

export function validPersonalData(value: unknown): value is PersonalData {
  if (!isRecord(value) || !Array.isArray(value.supplements) || !value.supplements.every(validSupplement) ||
    !isRecord(value.notes) || !Object.values(value.notes).every((note) => typeof note === 'string')) return false;
  return new Set(value.supplements.map(({ id }) => id)).size === value.supplements.length;
}

export function loadPersonal(storage?: StorageAccess): PersonalData {
  try {
    const raw = (storage ?? localStorage).getItem(personalStorageKey);
    if (raw === null) return { supplements: [], notes: {} };
    const data: unknown = JSON.parse(raw);
    if (!validPersonalData(data)) throw new Error('invalid data');
    return data;
  } catch (cause) {
    throw new Error('无法读取个人内容。原有数据已保留，请检查浏览器存储后重试。', { cause });
  }
}

export function savePersonal(data: PersonalData, previous: PersonalData, storage?: StorageAccess): void {
  if (!validPersonalData(data)) throw new Error('个人内容或教材位置无效，请检查后重试。');
  const target = storage ?? localStorage;
  if (JSON.stringify(loadPersonal(target)) !== JSON.stringify(previous)) {
    throw new Error('个人内容已在另一标签页更改。草稿已保留，请先复制草稿，再刷新后重试。');
  }
  try {
    target.setItem(personalStorageKey, JSON.stringify(data));
  } catch (cause) {
    throw new Error('保存失败。请保留编辑内容，并检查浏览器存储空间或权限后重试。', { cause });
  }
}
