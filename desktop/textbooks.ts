import { constants } from 'node:fs';
import { link, lstat, mkdir, open, readFile, readdir, realpath, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { Catalog } from './anchors.ts';
import type { TextbookStatus } from './textbook-contracts.ts';

export const textbookId = '6f2a471b07f44a4985756affed9c3c58da7232d205317b1f643b1a865e4e7249';
export const manifestHash = 'c7b99570b8bc136574b9421c59a01a65f86a9298cc07b075530e68eed1f47b13';
const catalogPath = 'textbooks/grade-7-volume-1/catalog.json';
type Entry = { path: string; bytes: number; sha256: string };
type Manifest = { download: Entry[] };
type ResourceTools = {
  parseManifest: (bytes: Buffer, hash: string) => Manifest;
  verifyBytes: (entry: Entry, bytes: Buffer) => Buffer;
  readResource: (directory: string, relative: string) => Promise<Buffer>;
  verifyDirectory: (directory: string, entries: Entry[]) => Promise<void>;
  fetchResource: (source: string, entry: Entry, options: { allowLocalHttp: boolean }) => Promise<Buffer>;
  verifyInstaller: (directory: string, bytes: Buffer, hash: string) => Promise<unknown>;
};

// Each write checks the persistent boundary; resource repair never enters note folders.
export async function persistentDirectory(root: string, relative = '', create = true) {
  if (await realpath(root) !== root || !(await lstat(root)).isDirectory()) throw new Error('持久资料目录已改变。');
  let full = root;
  for (const part of relative.split('/').filter(Boolean)) {
    full = path.join(full, part);
    if (create) await mkdir(full).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'EEXIST') throw error; });
    const stat = await lstat(full);
    if (stat.isSymbolicLink() || !stat.isDirectory() || await realpath(full) !== full) throw new Error('不访问教材目录中的符号链接或目录联接。');
  }
  return full;
}
export async function atomicFile(root: string, relative: string, bytes: Buffer, keepExisting = false, assertCurrent = () => {}) {
  const parent = await persistentDirectory(root, path.posix.dirname(relative));
  const full = path.join(root, relative);
  try {
    const stat = await lstat(full);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new Error('教材文件不是独立的普通文件。');
    if (keepExisting) {
      if (!(await readFile(full)).equals(bytes)) throw new Error('教材目录已有不同内容，已保留。请核对后重试添加。');
      assertCurrent(); return;
    }
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const temporary = path.join(parent, `.download-${randomUUID()}`);
  const handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
  try {
    await handle.writeFile(bytes); await handle.sync(); await handle.close();
    await persistentDirectory(root, path.posix.dirname(relative));
    // Recheck before rename. Existing personal catalogs are never replaced.
    assertCurrent();
    if (keepExisting) {
      await link(temporary, full);
    } else await rename(temporary, full);
  } finally { await handle.close().catch(() => {}); await rm(temporary, { force: true }); }
}

// Only metadata is cached. Every served resource still verifies its pinned hash.
async function resourceStamp(root: string, entries?: Entry[]) {
  await persistentDirectory(root, '', false);
  const stamps: string[] = [];
  async function visit(relative: string) {
    const full = path.join(root, relative);
    const info = await lstat(full, { bigint: true });
    if (info.isSymbolicLink()) throw new Error('不访问资源中的符号链接。');
    if (info.isDirectory()) {
      stamps.push(`${relative}:${info.dev}:${info.ino}:${info.mode}`);
      const names = (await readdir(full)).sort();
      await Promise.all(names.map((name) => visit(relative ? `${relative}/${name}` : name)));
    } else {
      if (!info.isFile()) throw new Error('资源不是普通文件。');
      stamps.push(`${relative}:${info.dev}:${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}:${info.mode}:${info.nlink}`);
    }
  }
  if (entries) {
    const directories = [...new Set(entries.map((entry) => path.posix.dirname(entry.path)))];
    await Promise.all(directories.map((directory) => persistentDirectory(root, directory, false)));
    await Promise.all(entries.map((entry) => visit(entry.path)));
  } else await visit('');
  return createHash('sha256').update(stamps.sort().join('\n')).digest('hex');
}

export class TextbookStore {
  root: string;
  private status: TextbookStatus = { textbookId, phase: 'checking', completed: 0, total: 405, error: '', sourceConfigured: false };
  private manifest!: Manifest;
  private tools!: ResourceTools;
  private pending: Promise<void> | null = null;
  private pendingRoot: string | null = null;
  private selection = 0;
  private installed = false;
  private appRoot: string;
  private dataRoot: string;
  private defaultRoot: string;
  private source: string | null;
  private allowLocalHttp: boolean;
  constructor(appRoot: string, dataRoot: string, source: string | null, allowLocalHttp = false) {
    this.appRoot = appRoot; this.source = source; this.allowLocalHttp = allowLocalHttp;
    this.dataRoot = dataRoot;
    this.defaultRoot = this.root = path.join(dataRoot, 'textbook-resources', textbookId);
  }
  async initialize() {
    // Keep the resource contract shared with ticket 14 without compiling its CLI into the renderer.
    const moduleUrl = new URL('../scripts/offline-resources.mjs', import.meta.url).href;
    this.tools = await import(moduleUrl) as ResourceTools;
    this.manifest = this.tools.parseManifest(await readFile(path.join(this.appRoot, 'resources/offline/grade-7-volume-1/manifest.json')), manifestHash);
    this.status.sourceConfigured = !!this.source;
    const dataRoot = this.dataRoot;
    await mkdir(dataRoot, { recursive: true });
    const canonical = await realpath(dataRoot);
    this.dataRoot = canonical;
    this.defaultRoot = this.root = path.join(canonical, 'textbook-resources', textbookId);
    await persistentDirectory(canonical, `textbook-resources/${textbookId}`);
    try {
      const installerFile = path.join(this.appRoot, 'resources/offline/installer.json');
      const installer = await readFile(installerFile);
      const installerHash = (await readFile(`${installerFile}.sha256`, 'utf8')).trim();
      if (createHash('sha256').update(installer).digest('hex') !== installerHash) throw new Error('安装清单摘要不匹配。');
      const distribution = await realpath(path.join(this.appRoot, 'dist'));
      await this.verifyCached(distribution, installerHash, () => this.tools.verifyInstaller(distribution, installer, installerHash));
      this.installed = true;
      await this.verify();
    } catch (error) {
      this.status.phase = 'unavailable'; this.status.error = this.installed ? '教材尚未完整下载，或本地资源已损坏。请添加或重试下载。' : `安装资源校验失败：${(error as Error).message}`;
    }
  }
  snapshot(): TextbookStatus { return { ...this.status }; }
  private async verifyCached(directory: string, version: string, verify: () => Promise<unknown>, entries?: Entry[]) {
    const key = createHash('sha256').update(`${directory}:${version}`).digest('hex');
    const file = `textbook-verification/${key}.json`;
    const stamp = await resourceStamp(directory, entries);
    let previous: { version?: unknown; stamp?: unknown } | null = null;
    try { previous = JSON.parse(await readFile(path.join(this.dataRoot, file), 'utf8')); } catch { /* A missing or broken receipt requires full verification. */ }
    if (previous?.version === version && previous.stamp === stamp) return;
    await verify();
    if (await resourceStamp(directory, entries) !== stamp) throw new Error('资源在校验期间改变，请重试。');
    // Failure to save a disposable receipt must not prevent offline reading.
    await atomicFile(this.dataRoot, file, Buffer.from(JSON.stringify({ version, stamp }))).catch(() => {});
  }
  private async verify(root = this.root) {
    await this.verifyCached(root, manifestHash, () => this.tools.verifyDirectory(root, this.manifest.download), this.manifest.download);
    if (root === this.root) this.status = { ...this.status, phase: 'ready', completed: this.manifest.download.length, error: '' };
  }
  async useVaultResources(vaultRoot: string) {
    const selection = ++this.selection;
    const relative = `.textbook/textbooks/${textbookId}/resources`;
    const directory = path.join(vaultRoot, relative);
    this.root = this.defaultRoot;
    this.status = { ...this.status, phase: 'checking', completed: 0, error: '' };
    try {
      if (!this.installed) throw new Error('安装资源尚未通过校验。');
      const present = await lstat(directory).then(() => true, (error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return false;
        throw error;
      });
      if (selection !== this.selection) return;
      if (present) {
        await persistentDirectory(vaultRoot, relative, false);
        if (selection !== this.selection) return;
        this.root = directory;
        this.tools.parseManifest(await this.tools.readResource(directory, 'manifest.json'), manifestHash);
      }
      if (selection !== this.selection) return;
      await this.verify();
    } catch (error) {
      if (selection !== this.selection) return;
      this.status = { ...this.status, phase: 'unavailable', error: `本地教材资源无法使用：${(error as Error).message}` };
    }
  }
  async download(): Promise<void> {
    const root = this.root;
    if (this.pending) {
      if (this.pendingRoot === root) return this.pending;
      await this.pending.catch(() => {});
      if (root !== this.root) throw new Error('笔记库已切换，请在当前库重试。');
      return this.download();
    }
    this.pendingRoot = root;
    this.pending = this.performDownload().finally(() => { this.pending = null; this.pendingRoot = null; });
    return this.pending;
  }
  private async performDownload() {
    if (!this.installed) throw new Error(this.status.error);
    const root = this.root;
    this.status = { ...this.status, phase: 'downloading', completed: 0, error: '' };
    try {
      for (const entry of this.manifest.download) {
        let valid = false;
        try { this.tools.verifyBytes(entry, await this.tools.readResource(root, entry.path)); valid = true; }
        catch (error) { if (!['MISSING_RESOURCE', 'SIZE_MISMATCH', 'HASH_MISMATCH'].includes((error as { code: string }).code)) throw error; }
        if (!valid) {
          if (!this.source) throw new Error('尚未配置获准的教材下载源。请联系发行方提供下载配置后重试。');
          const bytes = await this.tools.fetchResource(this.source, entry, { allowLocalHttp: this.allowLocalHttp });
          await atomicFile(root, entry.path, bytes);
        }
        if (root === this.root) this.status.completed++;
      }
      await this.verify(root);
      if (root !== this.defaultRoot) await atomicFile(root, 'manifest.json', await readFile(path.join(this.appRoot, 'resources/offline/grade-7-volume-1/manifest.json')));
      await atomicFile(root, 'complete.json', Buffer.from(JSON.stringify({ schemaVersion: 1, textbookId, manifestSha256: manifestHash })));
    } catch (error) {
      const cause = error as Error & { code?: string; path?: string };
      const message = `教材下载未完成：${cause.message}${cause.code ? `（${cause.code}${cause.path ? `: ${cause.path}` : ''}）` : ''}`;
      if (root === this.root) this.status = { ...this.status, phase: 'error', error: message };
      throw new Error(message);
    }
  }
  async addToVault(vaultRoot: string, id: unknown, assertCurrent = () => {}) {
    if (id !== textbookId) throw new Error('教材版本不可用。');
    assertCurrent();
    await this.download();
    assertCurrent();
    const bytes = await this.read(catalogPath);
    assertCurrent();
    await atomicFile(vaultRoot, `.textbook/textbooks/${textbookId}/catalog.json`, bytes, true, assertCurrent);
    assertCurrent();
    return { textbookId, catalogPath: `.textbook/textbooks/${textbookId}/catalog.json`, manifestSha256: manifestHash };
  }
  async read(relative: string) {
    if (this.status.phase !== 'ready') throw new Error('教材尚未完整校验，请重试下载。');
    const entry = this.manifest.download.find((item) => item.path === relative);
    if (!entry) throw new Error('教材资源路径无效。');
    const root = this.root;
    try {
      await persistentDirectory(root, '', false);
      return this.tools.verifyBytes(entry, await this.tools.readResource(root, relative));
    } catch (error) {
      if (root === this.root) this.status = { ...this.status, phase: 'error', error: '本地教材资源缺失或损坏，请重试下载。' };
      throw error;
    }
  }
  async catalog(vaultRoot?: string) {
    let bytes = await this.read(catalogPath);
    if (vaultRoot) {
      const relative = `.textbook/textbooks/${textbookId}/catalog.json`;
      await persistentDirectory(vaultRoot, path.posix.dirname(relative), false);
      const file = await open(path.join(vaultRoot, relative), constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const stat = await file.stat();
        if (!stat.isFile() || stat.nlink !== 1 || stat.size > 1024 * 1024) throw new Error('教材目录不是不超过 1 MB 的独立普通文件。');
        bytes = await file.readFile();
        const current = await lstat(path.join(vaultRoot, relative));
        if (current.dev !== stat.dev || current.ino !== stat.ino || current.isSymbolicLink()) throw new Error('教材目录已外改，请重新读取。');
        await persistentDirectory(vaultRoot, path.posix.dirname(relative), false);
      } finally { await file.close(); }
    }
    return validateCatalog(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
  }
}

// Persistent catalogs may be updated independently of the downloaded page cache.
// Trust explicit stable IDs, never derive replacements from order or labels.
export function validateCatalog(value: unknown): Catalog {
  const data = value as Catalog & { schemaVersion: number };
  if (!data || data.schemaVersion !== 1 || data.textbookId !== textbookId || typeof data.title !== 'string' || !Number.isSafeInteger(data.pageCount) || data.pageCount < 1 || !Array.isArray(data.pages) || !Array.isArray(data.chapters) || !Array.isArray(data.sections)) throw new Error('教材目录格式无效或使用较新版本，原文件已保留。');
  const ids = new Set<string>(), pages = new Set<number>();
  for (const page of data.pages) {
    if (!page || !Number.isSafeInteger(page.page) || page.page < 1 || page.page > data.pageCount || pages.has(page.page) || !Number.isFinite(page.width) || page.width <= 0 || !Number.isFinite(page.height) || page.height <= 0 || !(page.printedPage === null || typeof page.printedPage === 'string')) throw new Error('教材目录页面无效。');
    pages.add(page.page);
  }
  if (pages.size !== data.pageCount) throw new Error('教材目录页面不完整。');
  for (const entry of [...data.chapters, ...data.sections]) {
    if (!entry || typeof entry.id !== 'string' || !entry.id || ids.has(entry.id) || typeof entry.title !== 'string' || !entry.title.trim() || entry.source !== undefined || !Number.isSafeInteger(entry.start) || !Number.isSafeInteger(entry.end) || entry.start < 1 || entry.end < entry.start || entry.end > data.pageCount) throw new Error('教材目录条目标识或页界无效。');
    ids.add(entry.id);
  }
  for (const entry of data.sections) if (!data.chapters.some((chapter) => chapter.id === entry.chapterId)) throw new Error('教材目录节的父章无效。');
  return data;
}
