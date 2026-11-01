import { constants } from 'node:fs';
import { lstat, open, readFile, readdir, rm, link } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { stringify } from 'yaml';
import { parse } from './format.ts';
import { Vault, notePath } from './vault.ts';
import { atomicFile, persistentDirectory } from './textbooks.ts';
import { checkPackage, type InitialPackage } from './initial-package.ts';
import { initialRelations, relationBody } from './initial-relations.ts';

export type ImportPlan = { version: string; textbook: string; notes: { sourceId: string; id: string; path: string }[] };
export type InitialNoteIndex = { textbook: string; version: string; archive: 'unpublished'; notes: { sourceId: string; id: string; path: string | null; problem?: string }[] };
const relativeRoot = (pack: { textbook: string }) => `.textbook/textbooks/${pack.textbook}/initial-notes`;
async function readPersistent(root: string, relative: string) {
  const parent = await persistentDirectory(root, path.posix.dirname(relative), false);
  const full = path.join(parent, path.posix.basename(relative));
  const handle = await open(full, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > 20 * 1024 * 1024) throw new Error('初始笔记记录不是独立的普通文件。');
    const bytes = await handle.readFile();
    const disk = await lstat(full);
    if (disk.isSymbolicLink() || disk.dev !== stat.dev || disk.ino !== stat.ino) throw new Error('初始笔记记录已改变。');
    try { return JSON.parse(bytes.toString('utf8')) as unknown; }
    catch { throw new Error(`初始笔记导入记录无法读取：${relative}。已有笔记已保留，请核对后重试添加。`); }
  } finally { await handle.close(); }
}
function validatePlan(value: unknown, pack: InitialPackage): ImportPlan {
  const plan = value as ImportPlan;
  if (plan?.version !== pack.version || plan.textbook !== pack.textbook || !Array.isArray(plan.notes) || plan.notes.length !== pack.entries.length ||
      new Set(plan.notes.map((note) => note.id)).size !== plan.notes.length || new Set(plan.notes.map((note) => note.path.toLowerCase())).size !== plan.notes.length ||
      plan.notes.some((note, index) => note.sourceId !== pack.entries[index]?.sourceId || !/^[0-9a-f-]{36}$/.test(note.id))) throw new Error('初始笔记导入计划不匹配，原文件已保留。');
  plan.notes.forEach((note) => notePath(note.path));
  return plan;
}
async function readPlan(vault: Vault, pack: InitialPackage) {
  return validatePlan(await readPersistent(vault.root, `${relativeRoot(pack)}/plan.json`), pack);
}
export async function loadInitialPackage(appRoot: string) {
  return checkPackage(JSON.parse(await readFile(path.join(appRoot, 'resources/initial-notes/grade-7-volume-1.json'), 'utf8')));
}
export class InitialNotes {
  readonly pack: InitialPackage;
  // Fault injection after exclusive installation, before the per-source receipt.
  checkpoint?: (count: number) => Promise<void>;
  constructor(pack: InitialPackage) { this.pack = checkPackage(pack); }
  private async requiredPlan(vault: Vault) {
    try { return await readPlan(vault, this.pack); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error('本教材尚未导入初始笔记，请在书架重新添加教材。');
      throw error;
    }
  }
  async index(vault: Vault): Promise<InitialNoteIndex> {
    const plan = await this.requiredPlan(vault);
    const byId = await vault.identities();
    return { textbook: plan.textbook, version: plan.version, archive: 'unpublished', notes: plan.notes.map((note) => {
      const paths = byId.get(note.id) ?? [];
      return { sourceId: note.sourceId, id: note.id, path: paths.length === 1 ? paths[0]! : null, ...(paths.length === 1 ? {} : { problem: paths.length ? '本地 ID 重复，请先修复副本身份。' : '本地笔记缺失或身份已改变；未重新生成。' }) };
    }) };
  }
  async note(vault: Vault, sourceId: unknown) {
    const plan = await this.requiredPlan(vault);
    const entry = plan.notes.find((note) => note.sourceId === sourceId);
    if (!entry) throw new Error('没有对应本地笔记，请先明确添加教材。');
    const note = await vault.readById(entry.id);
    if (!note) throw new Error('本地笔记缺失或身份已改变；未重新生成。');
    return { path: note.path, id: entry.id };
  }
  async import(vault: Vault, assertCurrent = () => {}) {
    const pack = this.pack;
    const base = relativeRoot(pack);
    let plan: ImportPlan;
    try { plan = await readPlan(vault, pack); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      // A missing persistent plan must not duplicate notes whose source still identifies this import.
      for (const relative of await vault.list()) {
        const source = await vault.read(relative).catch(() => null);
        if (!source) continue;
        let ai;
        try { ai = parse(source.source).data._textbook?.ai_source; } catch { continue; }
        if (ai?.textbook === pack.textbook && ai.version === pack.version) throw new Error('已有此初始版本的本地笔记，但导入计划缺失。已停止创建副本，请保留文件并核对导入记录。');
      }
      // Choose all names once. The immutable plan survives failed imports and retries.
      const used = new Set<string>();
      const notes: ImportPlan['notes'] = [];
      for (const entry of pack.entries) {
        notePath(entry.path);
        const parent = path.posix.dirname(entry.path);
        const full = await persistentDirectory(vault.root, parent);
        const existing = new Set((await readdir(full)).map((name) => name.toLowerCase()));
        let selected = entry.path;
        for (let suffix = 2; existing.has(path.posix.basename(selected).toLowerCase()) || used.has(selected.toLowerCase()); suffix++) selected = `${entry.path.slice(0, -3)}（${suffix}）.md`;
        used.add(selected.toLowerCase()); notes.push({ sourceId: entry.sourceId, id: randomUUID(), path: selected });
      }
      plan = { version: pack.version, textbook: pack.textbook, notes };
      await atomicFile(vault.root, `${base}/plan.json`, Buffer.from(JSON.stringify(plan)), true, assertCurrent);
    }
    await atomicFile(vault.root, `${base}/source.json`, Buffer.from(JSON.stringify(pack)), true, assertCurrent);
    const byId = await vault.identities();
    const completed = new Set<string>();
    for (const note of plan.notes) {
      try {
        const saved = await readPersistent(vault.root, `${base}/receipts/${note.id}.json`) as { id: string; sourceId: string; version: string };
        if (saved.id !== note.id || saved.sourceId !== note.sourceId || saved.version !== pack.version) throw new Error('初始笔记收据不匹配，已停止导入。');
        completed.add(note.id);
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
    const relations = initialRelations(pack);
    const planned = new Map(plan.notes.map((note) => [note.sourceId, note]));
    async function targetPaths(sourceId: string) {
      const paths = new Map<string, string | null>();
      for (const targetId of new Set((relations.get(sourceId) ?? []).flatMap((relation) => relation.targets))) {
        const target = planned.get(targetId);
        if (!target) { paths.set(targetId, null); continue; }
        const current = byId.get(target.id) ?? [];
        if (current.length > 1) { paths.set(targetId, null); continue; }
        if (current.length === 1) {
          const saved = await vault.read(current[0]!).catch(() => null);
          // Retry a move between the identity scan and this read. Never use a replacement.
          const actual = saved?.id === target.id ? saved : await vault.readById(target.id).catch(() => null);
          paths.set(targetId, actual?.path ?? null);
        } else if (completed.has(target.id)) paths.set(targetId, null);
        else {
          try {
            const saved = await vault.read(target.path);
            paths.set(targetId, saved.id === target.id ? saved.path : null);
          } catch (error) {
            paths.set(targetId, (error as NodeJS.ErrnoException).code === 'ENOENT' ? target.path : null);
          }
        }
      }
      return paths;
    }
    let created = 0;
    for (let index = 0; index < plan.notes.length; index++) {
      assertCurrent();
      const note = plan.notes[index]!;
      const receipt = `${base}/receipts/${note.id}.json`;
      if (completed.has(note.id)) continue; // Student-owned body, including moves or deletion.
      const paths = byId.get(note.id) ?? [];
      if (paths.length > 1) throw new Error('导入笔记的 ID 重复，原件已保留，请先修复。');
      if (!paths.length) {
        const entry = pack.entries[index]!;
        const now = new Date().toISOString();
        const metadata = { schema_version: 1, id: note.id, create_time: now, update_time: now,
          ai_source: { textbook: pack.textbook, source_id: note.sourceId, version: pack.version, archive: 'unpublished' },
          anchors: entry.anchors, initial_type: entry.type };
        const source = `---\n${stringify({ _textbook: metadata }, { lineWidth: 0, defaultStringType: 'QUOTE_DOUBLE' })}---\n${entry.body}${relationBody(relations.get(note.sourceId) ?? [], await targetPaths(note.sourceId))}`;
        const full = await vault.resolve(note.path, true);
        const temporary = path.join(path.dirname(full), `.initial-${randomUUID()}.tmp`);
        const handle = await open(temporary, 'wx', 0o600);
        try {
          await handle.writeFile(source, 'utf8'); await handle.sync(); await handle.close();
          await vault.resolve(note.path, true); assertCurrent();
          // A concurrently claimed name fails. It is never replaced or silently renamed.
          await link(temporary, full); await rm(temporary);
          byId.set(note.id, [note.path]);
          created++; await this.checkpoint?.(created);
        } finally { await handle.close().catch(() => {}); await rm(temporary, { force: true }); }
      } else {
        // A process killed before its receipt can recover the installed note after edits/moves.
        const saved = await vault.read(paths[0]!);
        const meta = parse(saved.source).data._textbook;
        if (meta?.ai_source?.source_id !== note.sourceId || meta.ai_source.version !== pack.version || meta.ai_source.textbook !== pack.textbook) throw new Error('未完成导入的本地来源已改变，已保留原件。');
      }
      completed.add(note.id);
      await atomicFile(vault.root, receipt, Buffer.from(JSON.stringify({ id: note.id, sourceId: note.sourceId, version: pack.version })), true, assertCurrent);
    }
    assertCurrent(); await vault.scan();
    return { count: plan.notes.length, created, version: pack.version, archive: 'unpublished' as const };
  }
}
