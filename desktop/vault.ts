import { constants, watch, type FSWatcher } from 'node:fs';
import { access, lstat, open, readdir, realpath, rename, rm, mkdir, readFile, link } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { freshIdentity, inspect, prepareSave } from './format.ts';
import { notePath } from './note-path.ts';
import { linkEntry, type LinkIndex, type LinkEntry } from './links.ts';
export { notePath } from './note-path.ts';
import type { Note, Recovery, VaultChange } from './contracts.ts';

export const digest = (source: string) => createHash('sha256').update(source).digest('hex');
const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
type IndexedNote = { stamp: string; note?: Note; links?: LinkEntry };

async function readCaptured(file: string, restoredTarget?: string) {
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    const target = restoredTarget ? await lstat(restoredTarget).catch(() => null) : null;
    const restoredLink = info.nlink === 2 && target?.isFile() && target.dev === info.dev && target.ino === info.ino;
    if (!info.isFile() || info.size > 10 * 1024 * 1024 || info.nlink !== 1 && !restoredLink) throw new Error('恢复原件不是可读取的库内普通文件。');
    const source = utf8.decode(await handle.readFile());
    const current = await lstat(file);
    if (current.dev !== info.dev || current.ino !== info.ino || current.isSymbolicLink()) throw new Error('恢复原件已被外部替换。');
    return source;
  } finally { await handle.close(); }
}

export class Vault {
  readonly token = randomUUID();
  readonly root: string;
  readonly recoveryDir: string;
  private index = new Map<string, IndexedNote>();
  private writes: Promise<unknown> = Promise.resolve();
  // Fault-injection seam, never exposed over IPC.
  writeCheckpoint?: (stage: 'prepared' | 'checked' | 'displaced' | 'installed') => Promise<void>;
  private constructor(root: string, recoveryDir: string) { this.root = root; this.recoveryDir = recoveryDir; }
  static async open(root: string, recoveryDir: string) {
    const canonical = await realpath(root);
    if (!(await lstat(canonical)).isDirectory()) throw new Error('笔记库目录不可用。');
    return new Vault(canonical, recoveryDir);
  }

  async resolve(relative: string, allowMissing = false) {
    notePath(relative);
    let full = this.root;
    const root = await lstat(full);
    if (root.isSymbolicLink() || !root.isDirectory() || await realpath(full) !== full) throw new Error('笔记库目录已被替换，请重新选择。');
    const parts = relative.split('/');
    for (let i = 0; i < parts.length; i++) {
      full = path.join(full, parts[i]!);
      try {
        const stat = await lstat(full);
        if (stat.isSymbolicLink() || (i < parts.length - 1 ? !stat.isDirectory() : !stat.isFile() || stat.nlink !== 1)) {
          throw new Error('不访问符号链接、目录联接、硬链接或非普通笔记文件。');
        }
      } catch (error) {
        if (allowMissing && i === parts.length - 1 && (error as NodeJS.ErrnoException).code === 'ENOENT') return full;
        throw error;
      }
    }
    if (await realpath(full) !== full) throw new Error('笔记路径已改变，请重新读取。');
    return full;
  }

  async list() {
    const notes: string[] = [];
    const walk = async (directory: string, prefix: string) => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
        const relative = `${prefix}${entry.name}`;
        if (entry.isDirectory()) {
          // Resolve each directory before descending; never follow a swapped link.
          const candidate = path.join(directory, entry.name);
          if ((await lstat(candidate)).isSymbolicLink() || await realpath(candidate) !== candidate) continue;
          await walk(candidate, `${relative}/`);
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
          try { await this.resolve(relative); notes.push(relative); } catch { /* Unsupported files stay untouched. */ }
        }
      }
    };
    if ((await lstat(this.root)).isSymbolicLink() || await realpath(this.root) !== this.root) throw new Error('笔记库目录已改变。');
    await walk(this.root, '');
    return notes.sort((a, b) => a.localeCompare(b, 'zh-CN'));
  }

  private async readFile(relative: string): Promise<Note> {
    const full = await this.resolve(relative);
    const handle = await open(full, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await handle.stat();
      if (stat.nlink !== 1 || !stat.isFile() || stat.size > 10 * 1024 * 1024) throw new Error('笔记应为不超过 10 MB 的普通 UTF-8 文件。');
      const source = utf8.decode(await handle.readFile());
      await this.resolve(relative);
      const disk = await lstat(full);
      if (disk.dev !== stat.dev || disk.ino !== stat.ino) throw new Error('笔记路径已改变，请重新读取。');
      return { path: relative, source, revision: digest(source), fileMtime: stat.mtimeMs, ...inspect(source) };
    } finally { await handle.close(); }
  }

  private duplicates() {
    const ids = new Map<string, string[]>();
    for (const [name, entry] of this.index) {
      if (entry.note?.id) ids.set(entry.note.id, [...(ids.get(entry.note.id) ?? []), name]);
    }
    return Object.fromEntries([...ids.values()].filter((names) => names.length > 1).flatMap((names) => names.map((name) => [name, names])));
  }

  async scan(): Promise<VaultChange> {
    const names = await this.list();
    const changed = new Set([...this.index.keys()].filter((name) => !names.includes(name)));
    const next = new Map<string, IndexedNote>();
    for (const name of names) {
      try {
        const info = await lstat(await this.resolve(name));
        const stamp = [info.dev, info.ino, info.size, info.mtimeMs, info.ctimeMs, info.mode].join(':');
        const previous = this.index.get(name);
        const entry: IndexedNote = previous?.stamp === stamp && previous.note ? previous : { stamp, note: await this.readFile(name).catch(() => undefined) };
        // Derived links depend only on this path and its persisted content. A
        // stamp-only change keeps them; changed/unreadable content drops them.
        // Deleted paths leave the map entirely; reopening a vault starts empty.
        if (entry !== previous && entry.note && entry.note.revision === previous?.note?.revision) entry.links = previous.links;
        next.set(name, entry);
        if (previous?.stamp !== stamp || previous?.note?.revision !== entry.note?.revision) changed.add(name);
      } catch { changed.add(name); }
    }
    const oldDuplicates = JSON.stringify(this.duplicates());
    this.index = next;
    const duplicates = this.duplicates();
    if (oldDuplicates !== JSON.stringify(duplicates)) for (const name of names) changed.add(name);
    return { token: this.token, notes: [...next.keys()], changed: [...changed], duplicates };
  }

  // Rebuildable, disk-only index. scan reuses unchanged file contents.
  async links(onChange?: (change: VaultChange) => void): Promise<LinkIndex> {
    const change = await this.scan();
    if (change.changed.length) onChange?.(change);
    const entries = [], problems = [];
    for (const [path, entry] of this.index) {
      if (entry.note) entries.push(entry.links ??= linkEntry(path, entry.note.source));
      else problems.push(`${path}：文件暂不可读取，未建立链接索引。`);
    }
    return { entries, problems };
  }

  async read(relative: string): Promise<Note> {
    const note = await this.readFile(relative);
    return { ...note, duplicatePaths: this.duplicates()[relative] };
  }

  watch(refresh: () => void) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const signal = () => { clearTimeout(timer); timer = setTimeout(refresh, 80); };
    let watcher: FSWatcher | undefined;
    try { watcher = watch(this.root, { recursive: true }, signal); watcher.on('error', signal); }
    catch { /* Polling also covers missed events and platforms without recursive watch. */ }
    // ponytail: scan names periodically; only changed file stamps trigger content reads.
    const poll = setInterval(refresh, 1200);
    return () => { clearTimeout(timer); clearInterval(poll); watcher?.close(); };
  }

  async protectDraft(relative: string, source: string) {
    notePath(relative);
    if (typeof source !== 'string' || Buffer.byteLength(source) > 10 * 1024 * 1024) throw new Error('草稿超过 10 MB。');
    const record: Recovery = { id: randomUUID(), path: relative, created: new Date().toISOString(), original: null, candidate: source };
    await atomicState(this.recoveryPath(record.id), { ...record, vault: this.root });
    return record.id;
  }

  private recoveryPath(id: string) {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('恢复记录无效。');
    return path.join(this.recoveryDir, digest(this.root), `${id}.json`);
  }

  async recoveries(): Promise<Recovery[]> {
    const directory = path.join(this.recoveryDir, digest(this.root));
    const records: Recovery[] = [];
    let names: string[];
    try { names = await readdir(directory); }
    catch (cause) { if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return []; throw cause; }
    for (const name of names.filter((name) => /^[a-f0-9-]{36}\.json$/.test(name))) {
      const record = await readJson(path.join(directory, name)) as Recovery & { vault: string };
      if (record?.vault !== this.root || `${record.id}.json` !== name || typeof record.candidate !== 'string' || !(record.original === null || typeof record.original === 'string')) continue;
      notePath(record.path);
      // A killed process may have captured a newer inode before updating the journal.
      // Read its hidden sibling without following links; enumeration never writes Markdown.
      const displaced = (record as Recovery & { displaced?: string }).displaced;
      let observed = record.observed;
      if (typeof displaced === 'string' && /^\.textbook-save-[a-f0-9-]{36}\.tmp\.previous$/.test(displaced)) {
        const parent = path.dirname(record.path);
        const name = `recovery-${randomUUID()}.md`;
        const probe = await this.resolve(parent === '.' ? name : `${parent}/${name}`, true).catch(() => null);
        if (probe) {
          observed = await readCaptured(path.join(path.dirname(probe), displaced), path.join(this.root, record.path)).catch(() => observed);
        }
      }
      records.push({ id: record.id, path: record.path, created: record.created, original: record.original, candidate: record.candidate, observed });
    }
    return records.sort((a, b) => b.created.localeCompare(a.created));
  }

  async availableName(relative: string) {
    notePath(relative);
    const existing = new Set((await this.list()).map((name) => name.toLocaleLowerCase('en-US')));
    let candidate = relative;
    for (let index = 2; existing.has(candidate.toLocaleLowerCase('en-US')); index++) candidate = `${relative.slice(0, -3)}（${index}）.md`;
    return candidate;
  }

  save(relative: string, source: string, revision: string | null) {
    const operation = this.writes.then(() => this.write(relative, source, revision));
    this.writes = operation.catch(() => undefined);
    return operation;
  }

  async copy(relative: string, source: string, revision: string, replaceIdentity: boolean) {
    const operation = this.writes.then(async () => {
      await this.scan();
      const original = await this.read(relative);
      if (original.readOnly) throw new Error('较新格式不可复制或修改身份。');
      if (original.revision !== revision) throw new Error('磁盘文件已改变，草稿已保留；请重新核对。');
      if (replaceIdentity && !original.duplicatePaths?.length) throw new Error('此文件已无重复 ID，请重新读取。');
      return this.write(relative, freshIdentity(source), replaceIdentity ? revision : null);
    });
    this.writes = operation.catch(() => undefined);
    return operation;
  }

  private async write(relative: string, source: string, revision: string | null) {
    if (typeof source !== 'string' || Buffer.byteLength(source, 'utf8') > 10 * 1024 * 1024) throw new Error('笔记内容超过 10 MB。');
    if (revision !== null && (typeof revision !== 'string' || !/^[a-f0-9]{64}$/.test(revision))) throw new Error('读取版本无效，请重新打开笔记。');
    const target = revision === null ? await this.availableName(relative) : relative;
    const full = await this.resolve(target, revision === null);
    const original = revision === null ? null : await this.read(target);
    if (original && original.revision !== revision) throw new Error('磁盘文件已改变，未覆盖。草稿仍在，请保留后重新打开。');
    const next = prepareSave(original?.source ?? null, source);
    if (original && ((await lstat(full)).mode & 0o222) === 0) throw new Error('文件为只读，未保存；可恢复权限后重试或另存草稿。');
    if (original) await access(full, constants.W_OK);
    const id = inspect(next).id;
    for (const other of await this.list()) {
      if (other === target) continue;
      let otherId;
      try { otherId = inspect((await this.read(other)).source).id; }
      catch { continue; } // Unreadable, oversized or invalid UTF-8 files have no usable identity.
      if (otherId === id) throw new Error('笔记 ID 重复，未保存；请明确修复副本身份。');
    }
    const temporary = path.join(path.dirname(full), `.textbook-save-${randomUUID()}.tmp`);
    const displaced = `${temporary}.previous`;
    const record: Recovery & { vault: string; displaced: string } = {
      id: randomUUID(), vault: this.root, path: target, created: new Date().toISOString(), original: original?.source ?? null, candidate: next,
      displaced: path.basename(displaced),
    };
    const recovery = this.recoveryPath(record.id);
    let moved = false;
    let completed = false;
    let handle;
    try {
      handle = await open(temporary, 'wx', 0o600);
      await handle.writeFile(next, 'utf8');
      if (original) await handle.chmod((await lstat(full)).mode & 0o777);
      await handle.sync();
      await handle.close(); handle = undefined;
      await atomicState(recovery, record);
      await this.writeCheckpoint?.('prepared');
      if (original) {
        if ((await this.read(target)).revision !== revision) throw new Error('磁盘文件已改变，未覆盖。草稿和磁盘版本均保留。');
        await this.resolve(target);
        await this.writeCheckpoint?.('checked');
        // Capture the displaced inode, then install exclusively. An external replacement
        // after the check is retained, and a new target created in the gap is never overwritten.
        await rename(full, displaced); moved = true;
        await this.writeCheckpoint?.('displaced');
        const previous = await readCaptured(displaced);
        record.observed = previous;
        await atomicState(recovery, record);
        if (digest(previous) !== revision) throw new Error('磁盘文件已改变，未覆盖；实际磁盘版本已保留在恢复记录。');
        await this.resolve(target, true);
        await link(temporary, full);
      } else {
        // Exclusive creation also protects a name claimed after the initial scan.
        await link(temporary, full);
      }
      await rm(temporary);
      await this.writeCheckpoint?.('installed');
      const saved = await this.read(target);
      if (saved.revision !== digest(next)) throw new Error('保存后磁盘文件再次改变；草稿与写入前版本已保留，请核对。');
      if (moved) {
        record.observed = await readCaptured(displaced);
        await atomicState(recovery, record);
        if (record.observed !== original!.source) throw new Error('外部程序仍在写入旧文件；双方版本保留在恢复记录，请核对。');
      }
      await this.scan();
      await rm(recovery);
      completed = true;
      return { ...saved, duplicatePaths: this.duplicates()[target] };
    } finally {
      await handle?.close();
      if (moved) {
        // Restore only if nobody has claimed the path. On failure the journal and
        // hidden sibling remain recoverable; never replace a concurrent writer.
        const previous = await readCaptured(displaced).catch(() => undefined);
        const restored = previous !== undefined && await link(displaced, full).then(() => true, () => false);
        let protectedObserved = false;
        if (previous !== undefined) {
          try {
            await lstat(recovery);
            record.observed = previous; await atomicState(recovery, record);
            protectedObserved = true;
          } catch { /* Keep the hidden preimage if recovery storage also failed. */ }
        }
        if (completed || restored || protectedObserved) await rm(displaced, { force: true });
      }
      await rm(temporary, { force: true });
    }
  }
}

export async function atomicState(file: string, value: unknown) {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    const handle = await open(temporary, 'wx', 0o600);
    try { await handle.writeFile(JSON.stringify(value), 'utf8'); await handle.sync(); }
    finally { await handle.close(); }
    await rename(temporary, file);
  } finally { await rm(temporary, { force: true }); }
}

export async function readJson(file: string): Promise<unknown> {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw new Error('本机状态无法读取；笔记文件未改动。'); }
}
