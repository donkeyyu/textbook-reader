import { constants } from 'node:fs';
import { link, lstat, mkdir, open, readFile, realpath, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
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
async function directory(root: string, relative = '', create = true) {
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
async function atomicFile(root: string, relative: string, bytes: Buffer, keepExisting = false, assertCurrent = () => {}) {
  const parent = await directory(root, path.posix.dirname(relative));
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
    await directory(root, path.posix.dirname(relative));
    // Recheck before rename. Existing personal catalogs are never replaced.
    assertCurrent();
    if (keepExisting) {
      await link(temporary, full);
    } else await rename(temporary, full);
  } finally { await handle.close().catch(() => {}); await rm(temporary, { force: true }); }
}

export class TextbookStore {
  root: string;
  private status: TextbookStatus = { textbookId, phase: 'checking', completed: 0, total: 405, error: '', sourceConfigured: false };
  private manifest!: Manifest;
  private tools!: ResourceTools;
  private pending: Promise<void> | null = null;
  private installed = false;
  private appRoot: string;
  private source: string | null;
  private allowLocalHttp: boolean;
  constructor(appRoot: string, dataRoot: string, source: string | null, allowLocalHttp = false) {
    this.appRoot = appRoot; this.source = source; this.allowLocalHttp = allowLocalHttp;
    this.root = path.join(dataRoot, 'textbook-resources', textbookId);
  }
  async initialize() {
    // Keep the resource contract shared with ticket 14 without compiling its CLI into the renderer.
    const moduleUrl = new URL('../scripts/offline-resources.mjs', import.meta.url).href;
    this.tools = await import(moduleUrl) as ResourceTools;
    this.manifest = this.tools.parseManifest(await readFile(path.join(this.appRoot, 'resources/offline/grade-7-volume-1/manifest.json')), manifestHash);
    this.status.sourceConfigured = !!this.source;
    const dataRoot = path.dirname(path.dirname(this.root));
    await mkdir(dataRoot, { recursive: true });
    const canonical = await realpath(dataRoot);
    this.root = path.join(canonical, 'textbook-resources', textbookId);
    await directory(canonical, `textbook-resources/${textbookId}`);
    try {
      const installerFile = path.join(this.appRoot, 'resources/offline/installer.json');
      await this.tools.verifyInstaller(path.join(this.appRoot, 'dist'), await readFile(installerFile), (await readFile(`${installerFile}.sha256`, 'utf8')).trim());
      this.installed = true;
      await this.verify();
    } catch (error) {
      this.status.phase = 'unavailable'; this.status.error = this.installed ? '教材尚未完整下载，或本地资源已损坏。请添加或重试下载。' : `安装资源校验失败：${(error as Error).message}`;
    }
  }
  snapshot(): TextbookStatus { return { ...this.status }; }
  private async verify() {
    await directory(path.dirname(path.dirname(this.root)), `textbook-resources/${textbookId}`);
    await this.tools.verifyDirectory(this.root, this.manifest.download);
    await atomicFile(this.root, 'complete.json', Buffer.from(JSON.stringify({ schemaVersion: 1, textbookId, manifestSha256: manifestHash })));
    this.status = { ...this.status, phase: 'ready', completed: this.manifest.download.length, error: '' };
  }
  async download() {
    if (this.pending) return this.pending;
    this.pending = this.performDownload().finally(() => { this.pending = null; });
    return this.pending;
  }
  private async performDownload() {
    if (!this.installed) throw new Error(this.status.error);
    this.status = { ...this.status, phase: 'downloading', completed: 0, error: '' };
    try {
      for (const entry of this.manifest.download) {
        let valid = false;
        try { this.tools.verifyBytes(entry, await this.tools.readResource(this.root, entry.path)); valid = true; }
        catch (error) { if (!['MISSING_RESOURCE', 'SIZE_MISMATCH', 'HASH_MISMATCH'].includes((error as { code: string }).code)) throw error; }
        if (!valid) {
          if (!this.source) throw new Error('尚未配置获准的教材下载源。请联系发行方提供下载配置后重试。');
          const bytes = await this.tools.fetchResource(this.source, entry, { allowLocalHttp: this.allowLocalHttp });
          await atomicFile(this.root, entry.path, bytes);
        }
        this.status.completed++;
      }
      await this.verify();
    } catch (error) {
      const cause = error as Error & { code?: string; path?: string };
      this.status = { ...this.status, phase: 'error', error: `教材下载未完成：${cause.message}${cause.code ? `（${cause.code}${cause.path ? `: ${cause.path}` : ''}）` : ''}` };
      throw new Error(this.status.error);
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
    try {
      await directory(path.dirname(path.dirname(this.root)), `textbook-resources/${textbookId}`);
      return this.tools.verifyBytes(entry, await this.tools.readResource(this.root, relative));
    } catch (error) {
      this.status = { ...this.status, phase: 'error', error: '本地教材资源缺失或损坏，请重试下载。' };
      throw error;
    }
  }
  async catalog(vaultRoot?: string) {
    let bytes = await this.read(catalogPath);
    if (vaultRoot) {
      const relative = `.textbook/textbooks/${textbookId}/catalog.json`;
      await directory(vaultRoot, path.posix.dirname(relative), false);
      const file = await open(path.join(vaultRoot, relative), constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const stat = await file.stat();
        if (!stat.isFile() || stat.nlink !== 1) throw new Error('教材目录不是独立的普通文件。');
        bytes = await file.readFile();
        this.tools.verifyBytes(this.manifest.download.find((entry) => entry.path === catalogPath)!, bytes);
        await directory(vaultRoot, path.posix.dirname(relative), false);
      } finally { await file.close(); }
    }
    return JSON.parse(bytes.toString('utf8')) as unknown;
  }
}
