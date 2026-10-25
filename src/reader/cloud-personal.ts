import { supabase } from './supabase.ts';
import { personalStorageKey, validPersonalData, type PersonalData } from './personal.ts';
import { bookId } from '../textbook/content.ts';

export type LegacyCopy = { source_id: string; snapshot_hash: string; raw: string | null; kind: 'initial' | 'conflict'; has_conflict: boolean; created_at: string };
export type PersonalSnapshot = { userId: string; revision: number; data: PersonalData; copies: LegacyCopy[]; notice?: string };
type StorageAccess = Pick<Storage, 'getItem' | 'setItem'>;
const sourceKey = `textbook-personal-source-v2:${bookId}`;
const updates = new EventTarget();
let channel: BroadcastChannel | undefined;

export function onPersonalSaved(listener: (event: { external: boolean }) => void): () => void {
  const local = () => listener({ external: false });
  const external = () => listener({ external: true });
  updates.addEventListener('saved', local);
  channel ??= new BroadcastChannel(`textbook-cloud:${bookId}`);
  channel.addEventListener('message', external);
  return () => { updates.removeEventListener('saved', local); channel?.removeEventListener('message', external); };
}

function saved() {
  updates.dispatchEvent(new Event('saved'));
  channel?.postMessage('saved');
}

function snapshot(value: unknown, userId: string): PersonalSnapshot {
  const row = value as { owner_id?: unknown; revision?: unknown; content?: unknown; copies?: unknown } | null;
  if (!row || row.owner_id !== userId || !Number.isSafeInteger(row.revision) || Number(row.revision) < 0 || !validPersonalData(row.content) || !Array.isArray(row.copies)) {
    throw new Error('无法读取个人内容。原有数据已保留，请重试。');
  }
  return { userId, revision: Number(row.revision), data: row.content, copies: row.copies as LegacyCopy[] };
}

async function request(name: string, userId: string, args: Record<string, unknown> = {}): Promise<PersonalSnapshot> {
  const { data, error } = await supabase.rpc(name, { p_book_id: bookId, p_owner_id: userId, ...args });
  if (error) {
    if (error.code === 'PT409' || error.code === '40001') throw new Error('个人内容已在另一标签页更改。草稿已保留，请复制草稿后刷新重试。', { cause: error });
    if (error.code === '42501' || error.code === 'PGRST301') throw new Error('登录已失效或账号已切换。草稿已保留，请重新登录后重试。', { cause: error });
    if (error.code === '23514') throw new Error('个人内容或教材位置无效。草稿已保留，请检查后重试。', { cause: error });
    throw new Error('个人内容未能保存或读取。原数据与草稿已保留，请检查网络后重试。', { cause: error });
  }
  return snapshot(data, userId);
}

export async function readPersonal(userId: string): Promise<PersonalSnapshot> {
  return request('reader_personal_snapshot', userId);
}

export async function migratePersonal(userId: string, storage: StorageAccess = localStorage): Promise<PersonalSnapshot> {
  let raw: string | null;
  let source: { id: string; ownerId: string };
  try {
    raw = storage.getItem(personalStorageKey);
    const stored = storage.getItem(sourceKey);
    source = stored ? JSON.parse(stored) : { id: crypto.randomUUID(), ownerId: userId };
    if (!source || typeof source.id !== 'string' || typeof source.ownerId !== 'string') throw new Error('invalid migration source');
    if (source.ownerId !== userId) {
      return { ...await readPersonal(userId), notice: '此浏览器原有的个人内容已归属另一账号；当前只显示本账号的内容。' };
    }
    // Claim this browser source before uploading it. Switching accounts must not
    // copy the first reader's legacy notes into a second account.
    if (!stored) storage.setItem(sourceKey, JSON.stringify(source));
    if (raw !== null && !validPersonalData(JSON.parse(raw))) throw new Error('invalid legacy content');
  } catch (cause) {
    throw new Error('无法读取或保全旧个人内容。原有数据未被替换，请检查浏览器存储后重试。', { cause });
  }
  const result = await request('reader_migrate_legacy', userId, { p_source_id: source.id, p_raw: raw });
  // localStorage and a server transaction cannot commit together. Always read
  // again after the transaction; storage events also cover writes while open.
  let latest: string | null;
  try { latest = storage.getItem(personalStorageKey); }
  catch (cause) { throw new Error('迁移后无法检查旧页面修改。原数据已保留，请重试。', { cause }); }
  if (latest !== raw) return migratePersonal(userId, storage);
  return result;
}

// ponytail: one revision per reader/book, matching the legacy conflict scope.
// Split revisions per record only if concurrent independent editing needs it.
export async function savePersonal(data: PersonalData, previous: PersonalSnapshot): Promise<PersonalSnapshot> {
  if (!validPersonalData(data)) throw new Error('个人内容或教材位置无效，请检查后重试。');
  const result = await request('reader_save_personal', previous.userId, { p_expected_revision: previous.revision, p_content: data });
  saved();
  return result;
}
