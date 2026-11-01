import { constants } from 'node:fs';
import { lstat, realpath, mkdir, open, rename, link, rm, access, readdir } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { digest } from './vault.ts';
import type { SettingsView, VaultSettings, PropertyType } from './contracts.ts';

const propertyTypes = new Set<PropertyType>(['text', 'number', 'boolean', 'list', 'date', 'object']);
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const missing = (cause: unknown) => (cause as NodeJS.ErrnoException).code === 'ENOENT';
const conflict = '笔记库设置已被外部修改，请重新读取后重试；磁盘设置未覆盖。';
const utf8 = new TextDecoder('utf-8', { fatal: true });

function preferences(raw: Record<string, unknown>): VaultSettings {
  const editor = raw.editor ?? {};
  if (!object(editor) || raw.propertyTypes !== undefined && !object(raw.propertyTypes)) throw new Error('笔记库设置格式无效，原文件已保留。');
  const { bodyMode = 'live', frontmatterMode = 'properties' } = editor;
  if (!['edit', 'preview', 'live'].includes(bodyMode as string) || !['source', 'properties'].includes(frontmatterMode as string)) throw new Error('笔记库编辑模式设置无效，原文件已保留。');
  return { editor: { bodyMode: bodyMode as VaultSettings['editor']['bodyMode'], frontmatterMode: frontmatterMode as VaultSettings['editor']['frontmatterMode'] },
    propertyTypes: Object.fromEntries(Object.entries(raw.propertyTypes ?? {}).filter(([, value]) => propertyTypes.has(value as PropertyType))) as Record<string, PropertyType> };
}

function apply(raw: Record<string, unknown>, patch: unknown) {
  if (!object(patch) || Object.keys(patch).some((key) => !['editor', 'propertyTypes'].includes(key))) throw new Error('设置修改只能包含编辑模式和属性类型。');
  preferences(raw);
  const result = { ...raw };
  if (patch.editor !== undefined) {
    if (!object(patch.editor) || Object.keys(patch.editor).some((key) => !['bodyMode', 'frontmatterMode'].includes(key))) throw new Error('编辑模式设置参数无效。');
    result.editor = { ...(object(raw.editor) ? raw.editor : {}), ...patch.editor };
  }
  if (patch.propertyTypes !== undefined) {
    if (!object(patch.propertyTypes) || Object.entries(patch.propertyTypes).some(([name, type]) => !name.trim() || name.length > 200 || name === '_textbook' || !propertyTypes.has(type as PropertyType))) throw new Error('属性类型设置无效；不能保存笔记属性值。');
    result.propertyTypes = { ...(object(raw.propertyTypes) ? raw.propertyTypes : {}), ...patch.propertyTypes };
  }
  preferences(result);
  return result;
}

export class VaultSettingsStore {
  private writes: Promise<unknown> = Promise.resolve();
  // Fault-injection seam, never exposed over IPC.
  writeCheckpoint?: (stage: 'prepared' | 'checked' | 'displaced' | 'installed') => Promise<void>;
  readonly root: string;
  constructor(root: string) { this.root = root; }
  private get directory() { return path.join(this.root, '.textbook'); }
  private get file() { return path.join(this.directory, 'settings.json'); }

  private async directoryPath(create = false) {
    const root = await lstat(this.root);
    if (!root.isDirectory() || root.isSymbolicLink() || await realpath(this.root) !== this.root) throw new Error('笔记库目录已被替换，请重新选择。');
    let info = await lstat(this.directory).catch((cause) => { if (!missing(cause)) throw cause; return null; });
    if (!info && create) { await mkdir(this.directory, { mode: 0o700 }).catch((cause) => { if ((cause as NodeJS.ErrnoException).code !== 'EEXIST') throw cause; }); info = await lstat(this.directory); }
    if (info && (!info.isDirectory() || info.isSymbolicLink() || await realpath(this.directory) !== this.directory)) throw new Error('设置目录不可为链接或非库内目录。');
    return !!info;
  }

  private async source(file = this.file): Promise<string | null> {
    if (!await this.directoryPath()) return null;
    const info = await lstat(file).catch((cause) => { if (!missing(cause)) throw cause; return null; });
    if (!info) {
      if (file === this.file && (await readdir(this.directory)).some((name) => /^\.settings-[a-f0-9-]+\.tmp\.previous$/.test(name))) throw new Error('设置文件缺失；先前设置保留在 .textbook/.settings-*.tmp.previous，请核对恢复后重试。');
      return null;
    }
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > 1024 * 1024 || await realpath(file) !== file) throw new Error('设置应为不超过 1 MB 的库内普通文件，不访问链接。');
    const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const opened = await handle.stat();
      if (opened.dev !== info.dev || opened.ino !== info.ino || opened.nlink !== 1 || opened.size > 1024 * 1024) throw new Error(conflict);
      const source = utf8.decode(await handle.readFile());
      await this.directoryPath();
      const current = await lstat(file);
      if (current.dev !== opened.dev || current.ino !== opened.ino || current.isSymbolicLink()) throw new Error(conflict);
      return source;
    } finally { await handle.close(); }
  }

  private decode(source: string | null) {
    let raw: unknown;
    try { raw = source === null ? {} : JSON.parse(source); } catch { throw new Error('笔记库设置不是有效 JSON，原文件已保留。'); }
    if (!object(raw)) throw new Error('笔记库设置必须为对象，原文件已保留。');
    return raw;
  }
  private view(source: string | null): SettingsView {
    const raw = this.decode(source), settings = preferences(raw);
    const unsupportedPropertyTypes = Object.entries(raw.propertyTypes ?? {}).filter(([, type]) => !propertyTypes.has(type as PropertyType)).map(([name]) => name);
    return { revision: source === null ? null : digest(source), settings,
      ...(unsupportedPropertyTypes.length ? { unsupportedPropertyTypes } : {}) };
  }
  async read(): Promise<SettingsView> { return this.view(await this.source()); }
  save(revision: unknown, patch: unknown): Promise<SettingsView> {
    const operation = this.writes.then(() => this.write(revision, patch));
    this.writes = operation.catch(() => undefined);
    return operation;
  }
  private async write(revision: unknown, patch: unknown): Promise<SettingsView> {
    if (revision !== null && (typeof revision !== 'string' || !/^[a-f0-9]{64}$/.test(revision))) throw new Error('设置版本无效，请重新读取。');
    const original = await this.source();
    if ((original === null ? null : digest(original)) !== revision) throw new Error(conflict);
    const next = `${JSON.stringify(apply(this.decode(original), patch), null, 2)}\n`;
    if (Buffer.byteLength(next) > 1024 * 1024) throw new Error('设置超过 1 MB。');
    await this.directoryPath(true);
    const mode = original === null ? 0o600 : (await lstat(this.file)).mode & 0o777;
    if (original !== null) {
      if (!(mode & 0o222)) throw new Error('笔记库设置为只读，未保存。');
      await access(this.file, constants.W_OK);
    }
    const temporary = path.join(this.directory, `.settings-${randomUUID()}.tmp`);
    const displaced = `${temporary}.previous`;
    let moved = false, completed = false;
    try {
      const handle = await open(temporary, 'wx', mode);
      try { await handle.writeFile(next, 'utf8'); await handle.sync(); } finally { await handle.close(); }
      await this.writeCheckpoint?.('prepared');
      const observed = await this.source();
      if ((observed === null ? null : digest(observed)) !== revision) throw new Error(conflict);
      await this.writeCheckpoint?.('checked');
      if (original !== null) {
        await rename(this.file, displaced); moved = true;
        await this.writeCheckpoint?.('displaced');
        if (await this.source(displaced) !== original) throw new Error(conflict);
      }
      await this.directoryPath();
      // Exclusive installation cannot replace a file claimed after the revision check.
      await link(temporary, this.file);
      await rm(temporary);
      await this.writeCheckpoint?.('installed');
      if (await this.source() !== next || moved && await this.source(displaced) !== original) throw new Error(conflict);
      completed = true;
      return this.view(next);
    } finally {
      if (moved) {
        await this.directoryPath();
        // The captured path can itself be replaced while a write is paused.
        // Only a validated, independent ordinary file may be restored.
        const captured = !completed ? await this.source(displaced).catch(() => null) : null;
        const restored = captured !== null && await link(displaced, this.file).then(() => true, () => false);
        // If another writer claimed the path, keep its file and the captured settings.
        if (completed || restored) await rm(displaced, { force: true });
      }
      await rm(temporary, { force: true });
    }
  }
}
