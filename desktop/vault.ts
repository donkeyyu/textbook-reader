import { constants } from 'node:fs';
import { lstat, open, readdir, realpath, rename, rm, mkdir, readFile, link } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { inspect, prepareSave } from './format.ts';
import type { Note } from './contracts.ts';

export const digest = (source: string) => createHash('sha256').update(source).digest('hex');
const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

export function notePath(input: unknown): asserts input is string {
  if (typeof input !== 'string' || input.length > 1000 || !input.endsWith('.md') ||
    input.split('/').some((part) => !part || part.startsWith('.') || [...part].some((character) => character.charCodeAt(0) < 32) || /[\\:<>"|?*]/.test(part) || /[. ]$/.test(part) || /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(part))) {
    throw new Error('请使用笔记库内的 Markdown 路径；不支持隐藏文件、特殊路径或系统保留名。');
  }
}

export class Vault {
  readonly token = randomUUID();
  readonly root: string;
  readonly recoveryDir: string;
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

  async read(relative: string): Promise<Note> {
    const full = await this.resolve(relative);
    const handle = await open(full, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await handle.stat();
      if (stat.nlink !== 1 || !stat.isFile() || stat.size > 10 * 1024 * 1024) throw new Error('笔记应为不超过 10 MB 的普通 UTF-8 文件。');
      const source = utf8.decode(await handle.readFile());
      await this.resolve(relative);
      const disk = await lstat(full);
      if (disk.dev !== stat.dev || disk.ino !== stat.ino) throw new Error('笔记路径已改变，请重新读取。');
      return { path: relative, source, revision: digest(source), ...inspect(source) };
    } finally { await handle.close(); }
  }

  async availableName(relative: string) {
    notePath(relative);
    const existing = new Set((await this.list()).map((name) => name.toLocaleLowerCase('en-US')));
    let candidate = relative;
    for (let index = 2; existing.has(candidate.toLocaleLowerCase('en-US')); index++) candidate = `${relative.slice(0, -3)}（${index}）.md`;
    return candidate;
  }

  async save(relative: string, source: string, revision: string | null) {
    if (typeof source !== 'string' || Buffer.byteLength(source, 'utf8') > 10 * 1024 * 1024) throw new Error('笔记内容超过 10 MB。');
    if (revision !== null && (typeof revision !== 'string' || !/^[a-f0-9]{64}$/.test(revision))) throw new Error('读取版本无效，请重新打开笔记。');
    const target = revision === null ? await this.availableName(relative) : relative;
    const full = await this.resolve(target, revision === null);
    const original = revision === null ? null : await this.read(target);
    if (original && original.revision !== revision) throw new Error('磁盘文件已改变，未覆盖。草稿仍在，请保留后重新打开。');
    const next = prepareSave(original?.source ?? null, source);
    const id = inspect(next).id;
    for (const other of await this.list()) {
      if (other === target) continue;
      let otherId;
      try { otherId = inspect((await this.read(other)).source).id; }
      catch { continue; } // Unreadable, oversized or invalid UTF-8 files have no usable identity.
      if (otherId === id) throw new Error('笔记 ID 重复，未保存；请明确修复副本身份。');
    }
    const temporary = path.join(path.dirname(full), `.textbook-save-${randomUUID()}.tmp`);
    let handle;
    try {
      handle = await open(temporary, 'wx', 0o600);
      await handle.writeFile(next, 'utf8');
      if (original) await handle.chmod((await lstat(full)).mode & 0o777);
      await handle.sync();
      await handle.close(); handle = undefined;
      if (original) {
        // Keep a recoverable preimage and candidate outside the vault. The final check is
        // not an atomic compare-and-swap against a concurrent external editor (R15).
        await mkdir(this.recoveryDir, { recursive: true, mode: 0o700 });
        const backup = path.join(this.recoveryDir, `${digest(`${this.root}/${target}`)}.json`);
        await atomicState(backup, { vault: this.root, path: target, original: original.source, candidate: next });
        if ((await this.read(target)).revision !== revision) throw new Error('磁盘文件已改变，未覆盖。草稿和磁盘版本均保留。');
        await this.resolve(target);
        await rename(temporary, full);
      } else {
        // Exclusive creation also protects a name claimed after the initial scan.
        await link(temporary, full);
      }
      return { path: target, source: next, revision: digest(next), ...inspect(next) } satisfies Note;
    } finally {
      await handle?.close();
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
