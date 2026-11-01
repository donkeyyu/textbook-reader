import { constants } from 'node:fs';
import { access, link, lstat, open, readdir, rename, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { anchorObject, changeAnchors, readAnchors, type Catalog } from './anchors.ts';
import { prepareSave, saveProblem } from './format.ts';
import { persistentDirectory } from './textbooks.ts';
import { atomicState, digest, readJson, type Vault } from './vault.ts';
import { notePath } from './note-path.ts';

export type CustomEntry = { id: string; title: string; chapterId?: string; [key: string]: unknown };
export type CustomData = { schemaVersion: number; textbookId: string; chapters: CustomEntry[]; sections: CustomEntry[]; [key: string]: unknown };
export type CustomView = { revision: string | null; data: CustomData; readOnly: boolean; problem?: string };
export type CustomEdit = { kind: 'chapter' | 'section'; id?: string; title: string; chapterId?: string };
type Edit = { path: string; original: string; candidate: string; count: number; done: boolean; error?: string };
type Deletion = { version: 1; id: string; textbookId: string; kind: 'chapter' | 'section'; entryId: string; title: string; children: string[]; replacement: string | null; revision: string | null; created: string; started: boolean; removed: boolean; edits: Edit[]; problems: string[]; error?: string; finalSource?: string };
export type CustomDeletion = Omit<Deletion, 'version' | 'revision' | 'finalSource' | 'edits'> & { edits: Omit<Edit, 'original' | 'candidate'>[] };
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const missing = (cause: unknown) => (cause as NodeJS.ErrnoException).code === 'ENOENT';
const uuid = (value: string) => /^[a-f0-9-]{36}$/.test(value);
const nameKey = (value: string) => value.trim().normalize('NFC');
const view = ({ version: _version, revision: _revision, finalSource: _finalSource, edits, ...operation }: Deletion): CustomDeletion => ({ ...operation, edits: edits.map(({ original: _original, candidate: _candidate, ...edit }) => edit) });
const empty = (id: string): CustomData => ({ schemaVersion: 1, textbookId: id, chapters: [], sections: [] });

// Custom entries describe classification only; no inferred page ranges.
export function withCustom(catalog: Catalog, custom: CustomView): Catalog {
  if (custom.readOnly) return catalog;
  return { ...catalog, chapters: [...catalog.chapters, ...custom.data.chapters.map(({ id, title }) => ({ id, title, source: 'custom' as const }))], sections: [...catalog.sections, ...custom.data.sections.map(({ id, title, chapterId }) => ({ id, title, chapterId: chapterId!, source: 'custom' as const }))] };
}

export class CustomCatalog {
  private operations = new Map<string, Deletion>();
  readonly vault: Vault;
  readonly textbookId: string;
  private get relative() { return `.textbook/textbooks/${this.textbookId}`; }
  private get directory() { return path.join(this.vault.root, this.relative); }
  private get file() { return path.join(this.directory, 'custom.json'); }
  private get journals() { return path.join(this.vault.recoveryDir, digest(this.vault.root), 'custom-catalog', this.textbookId); }
  // Fault seams are local tests only, never exposed over IPC.
  checkpoint?: (stage: 'journaled' | 'written') => Promise<void>;
  writeCheckpoint?: (stage: 'prepared' | 'checked' | 'displaced' | 'installed') => Promise<void>;
  private constructor(vault: Vault, textbookId: string) { this.vault = vault; this.textbookId = textbookId; }
  static async open(vault: Vault, textbookId: string) {
    if (!/^[a-f0-9]{64}$/.test(textbookId)) throw new Error('教材版本标识无效。');
    const manager = new CustomCatalog(vault, textbookId);
    const names = await readdir(manager.journals).catch((cause) => { if (missing(cause)) return []; throw cause; });
    for (const name of names.filter((name) => /^[a-f0-9-]{36}\.json$/.test(name))) {
      const operation = await readJson(path.join(manager.journals, name)) as Deletion;
      if (!operation || operation.version !== 1 || !uuid(operation.id) || name !== `${operation.id}.json` || operation.textbookId !== textbookId || !['chapter', 'section'].includes(operation.kind) || !Array.isArray(operation.children) || !Array.isArray(operation.edits) || !Array.isArray(operation.problems)) throw new Error('自定义目录删除记录损坏；原资料未改动。');
      for (const edit of operation.edits) { notePath(edit.path); if (typeof edit.original !== 'string' || typeof edit.candidate !== 'string') throw new Error('目录引用恢复记录损坏。'); }
      manager.operations.set(operation.id, operation);
    }
    return manager;
  }
  private async source(file = this.file, expected?: { dev: number; ino: number }): Promise<string | null> { return (await this.snapshot(file, expected))?.text ?? null; }
  private async snapshot(file = this.file, expected?: { dev: number; ino: number }): Promise<{ text: string; dev: number; ino: number } | null> {
    try { await persistentDirectory(this.vault.root, this.relative, false); } catch (cause) { if (missing(cause)) return null; throw cause; }
    const info = await lstat(file).catch((cause) => { if (missing(cause)) return null; throw cause; });
    if (!info) {
      if (file === this.file && (await readdir(this.directory)).some((name) => /^\.custom-.*\.previous$/.test(name))) throw new Error('custom.json 缺失；先前资料保留在同目录 .custom-*.previous，请核对恢复。');
      return null;
    }
    if (expected && (info.dev !== expected.dev || info.ino !== expected.ino)) throw new Error('捕获的目录原件已被替换，未认领替换物。');
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > 1024 * 1024) throw new Error('自定义目录应为不超过 1 MB 的独立普通 UTF-8 文件。');
    const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const opened = await handle.stat();
      if (opened.ino !== info.ino || opened.dev !== info.dev || opened.nlink !== 1 || !opened.isFile() || opened.size > 1024 * 1024) throw new Error('自定义目录已外改，请重新读取。');
      const source = new TextDecoder('utf-8', { fatal: true }).decode(await handle.readFile());
      await persistentDirectory(this.vault.root, this.relative, false);
      const current = await lstat(file);
      if (current.ino !== opened.ino || current.dev !== opened.dev || current.isSymbolicLink()) throw new Error('自定义目录已外改，请重新读取。');
      return { text: source, dev: opened.dev, ino: opened.ino };
    } finally { await handle.close(); }
  }
  private decode(source: string | null, catalog: Catalog): CustomData {
    const data: unknown = source === null ? empty(this.textbookId) : JSON.parse(source);
    if (!object(data) || data.schemaVersion !== 1 || data.textbookId !== this.textbookId || !Array.isArray(data.chapters) || !Array.isArray(data.sections)) throw new Error('自定义目录格式无效或使用较新版本；原文件已保留。');
    const ids = new Set([...catalog.chapters, ...catalog.sections].map((entry) => entry.id));
    const names = new Set<string>();
    for (const [kind, entries] of [['chapter', data.chapters], ['section', data.sections]] as const) for (const entry of entries) {
      if (!object(entry) || typeof entry.id !== 'string' || !/^custom-[a-f0-9-]{36}$/.test(entry.id) || ids.has(entry.id) || typeof entry.title !== 'string' || !nameKey(entry.title) || entry.title.length > 200 || kind === 'section' && typeof entry.chapterId !== 'string') throw new Error('自定义目录条目标识、名称或父级无效；原文件已保留。');
      ids.add(entry.id);
      const key = JSON.stringify([kind, kind === 'section' ? entry.chapterId : '', nameKey(entry.title)]);
      if (names.has(key)) throw new Error('自定义目录同父级有重名；原文件已保留，请在源码核对。');
      names.add(key);
    }
    // Missing index parents remain repairable after catalog updates.
    return data as CustomData;
  }
  async read(catalog: Catalog): Promise<CustomView> {
    let source: string | null = null;
    try { source = await this.source(); return { revision: source === null ? null : digest(source), data: this.decode(source, catalog), readOnly: false }; }
    catch (cause) { return { revision: source === null ? null : digest(source), data: empty(this.textbookId), readOnly: true, problem: (cause as Error).message }; }
  }
  private async write(revision: string | null, data: CustomData, catalog: Catalog) {
    const original = await this.source();
    if ((original === null ? null : digest(original)) !== revision) throw new Error('自定义目录已外改，未覆盖；请重新读取。');
    this.decode(original, catalog);
    const next = `${JSON.stringify(data, null, 2)}\n`; this.decode(next, catalog);
    if (Buffer.byteLength(next) > 1024 * 1024) throw new Error('自定义目录超过 1 MB。');
    await persistentDirectory(this.vault.root, this.relative);
    const mode = original === null ? 0o600 : (await lstat(this.file)).mode & 0o777;
    if (original !== null) { if (!(mode & 0o222)) throw new Error('自定义目录只读。'); await access(this.file, constants.W_OK); }
    const temporary = path.join(this.directory, `.custom-${randomUUID()}.tmp`), displaced = `${temporary}.previous`;
    let moved = false, completed = false;
    let captured: { dev: number; ino: number } | undefined;
    try {
      const handle = await open(temporary, 'wx', mode);
      try { await handle.writeFile(next); await handle.sync(); } finally { await handle.close(); }
      await this.writeCheckpoint?.('prepared');
      const observed = await this.snapshot();
      if ((observed?.text ?? null) !== original) throw new Error('自定义目录已外改，未覆盖。');
      captured = observed ?? undefined;
      await this.writeCheckpoint?.('checked');
      if (original !== null) {
        await rename(this.file, displaced); moved = true;
        await this.writeCheckpoint?.('displaced');
        if (await this.source(displaced, captured) !== original) throw new Error('自定义目录已外改；原件保留。');
      }
      await persistentDirectory(this.vault.root, this.relative, false);
      await link(temporary, this.file); await rm(temporary);
      await this.writeCheckpoint?.('installed');
      if (await this.source() !== next || moved && await this.source(displaced, captured) !== original) throw new Error('自定义目录写入期间外改；双方原件保留。');
      completed = true;
      return { revision: digest(next), data, readOnly: false } as CustomView;
    } finally {
      if (moved) {
        await persistentDirectory(this.vault.root, this.relative, false);
        const capturedText = completed ? null : await this.source(displaced, captured).catch(() => null);
        const restored = capturedText !== null && await link(displaced, this.file).then(() => true, () => false);
        if (completed || restored) await rm(displaced, { force: true });
      }
      await rm(temporary, { force: true });
    }
  }
  async save(catalog: Catalog, revision: string | null, edit: CustomEdit) {
    const current = await this.read(catalog);
    if (current.readOnly) throw new Error(current.problem);
    if (revision !== current.revision) throw new Error('自定义目录已外改，请重新读取。');
    if (!edit || !['chapter', 'section'].includes(edit.kind) || typeof edit.title !== 'string' || !nameKey(edit.title) || edit.title.length > 200) throw new Error('请输入不超过 200 字的目录名称。');
    const entries = edit.kind === 'chapter' ? current.data.chapters : current.data.sections;
    const entry = edit.id ? entries.find((entry) => entry.id === edit.id) : undefined;
    if (edit.id && !entry) throw new Error('自定义条目已失效，请重新读取。');
    const parent = edit.kind === 'section' ? entry?.chapterId ?? edit.chapterId : undefined;
    if (edit.kind === 'section' && !withCustom(catalog, current).chapters.some((chapter) => chapter.id === parent)) throw new Error('请先选择有效父章。');
    const choices = edit.kind === 'chapter' ? withCustom(catalog, current).chapters : withCustom(catalog, current).sections;
    const duplicate = choices.find((item) => item.id !== entry?.id && ('chapterId' in item ? item.chapterId : undefined) === parent && nameKey(item.title) === nameKey(edit.title));
    if (duplicate) return { view: current, entry: duplicate, reused: true };
    if (entry) entry.title = nameKey(edit.title);
    else entries.push({ id: `custom-${randomUUID()}`, title: nameKey(edit.title), ...(parent ? { chapterId: parent } : {}) });
    return { view: await this.write(revision, current.data, catalog), entry: entry ?? entries.at(-1)!, reused: false };
  }
  private persist(operation: Deletion) { return atomicState(path.join(this.journals, `${operation.id}.json`), operation); }
  status() { return [...this.operations.values()].filter((operation) => operation.started && !operation.removed).map(view); }
  private matches(anchor: unknown, operation: Deletion) {
    const item = anchorObject(anchor);
    return !!item && item.textbook === this.textbookId && (operation.kind === 'section' ? item.section === operation.entryId : item.chapter === operation.entryId || operation.children.includes(String(item.section)));
  }
  private patch(operation: Deletion, catalog: Catalog) {
    if (operation.kind === 'chapter') return { chapter: operation.replacement ?? undefined, section: undefined };
    const replacement = catalog.sections.find((entry) => entry.id === operation.replacement);
    return { section: operation.replacement ?? undefined, ...(replacement ? { chapter: replacement.chapterId } : {}) };
  }
  async plan(catalog: Catalog, revision: string | null, kind: 'chapter' | 'section', entryId: string, replacement: string | null) {
    const current = await this.read(catalog);
    if (current.readOnly || revision !== current.revision) throw new Error(current.problem || '自定义目录已外改，请重新读取。');
    const entry = (kind === 'chapter' ? current.data.chapters : kind === 'section' ? current.data.sections : []).find((item) => item.id === entryId);
    if (!entry) throw new Error('只能删除当前教材的自定义条目。');
    const merged = withCustom(catalog, current), choices = kind === 'chapter' ? merged.chapters : merged.sections;
    if (replacement !== null && (!choices.some((item) => item.id === replacement) || replacement === entryId)) throw new Error('替代条目无效。');
    const operation: Deletion = { version: 1, id: randomUUID(), textbookId: this.textbookId, kind, entryId, title: entry.title, children: kind === 'chapter' ? current.data.sections.filter((item) => item.chapterId === entryId).map((item) => item.id) : [], replacement, revision, created: new Date().toISOString(), started: false, removed: false, edits: [], problems: [] };
    await this.vault.scan();
    for (const name of await this.vault.list()) {
      try {
        const note = await this.vault.read(name), anchors = readAnchors(note.source);
        if (anchors !== undefined && !Array.isArray(anchors)) throw new Error('anchors 不是列表，引用数量无法确认。');
        const indices = Array.isArray(anchors) ? anchors.flatMap((anchor, index) => this.matches(anchor, operation) ? [index] : []) : [];
        if (!indices.length) continue;
        let candidate = note.source;
        const problem = note.readOnly ? '较新格式只读' : note.duplicatePaths?.length ? 'ID 冲突' : saveProblem(candidate);
        if (!problem) for (const index of indices) candidate = changeAnchors(candidate, undefined, { index, patch: this.patch(operation, merged) });
        operation.edits.push({ path: name, original: note.source, candidate, count: indices.length, done: false, ...(problem ? { error: problem } : {}) });
      } catch (cause) { operation.problems.push(`${name}：${(cause as Error).message}`); }
    }
    this.operations.set(operation.id, operation);
    return view(operation);
  }
  async apply(catalog: Catalog, id: string) {
    const operation = this.operations.get(id);
    if (!operation || !uuid(id)) throw new Error('删除预览已失效，请重新预览。');
    if (operation.removed) return view(operation);
    operation.started = true; operation.error = undefined;
    await this.persist(operation); await this.checkpoint?.('journaled');
    const current = await this.read(catalog);
    if (!current.readOnly && operation.finalSource && current.revision === digest(operation.finalSource)) { operation.removed = true; await this.persist(operation); return view(operation); }
    if (current.readOnly || current.revision !== operation.revision) {
      operation.error = current.problem || '自定义目录已外改；停止删除，请重新预览。'; await this.persist(operation); return view(operation);
    }
    const merged = withCustom(catalog, current);
    const replacements = operation.kind === 'chapter' ? merged.chapters : merged.sections;
    const replacement = replacements.find((entry) => entry.id === operation.replacement);
    if (operation.replacement !== null && (!replacement || 'chapterId' in replacement && !merged.chapters.some((entry) => entry.id === replacement.chapterId))) {
      operation.error = '替代目录或父章已失效，未继续改写；请重新预览。'; await this.persist(operation); return view(operation);
    }
    await this.vault.scan();
    for (const edit of operation.edits) {
      if (edit.done) continue;
      edit.error = undefined;
      try {
        const note = await this.vault.read(edit.path).catch((cause) => { if (missing(cause)) return null; throw cause; });
        if (!note) {
          if (!await this.vault.resumePrepared(edit.path, edit.original, edit.candidate)) throw new Error('文件已删除，无可确认的中断原件；未重建。');
        } else if (note.source !== edit.candidate) {
          if (note.source !== edit.original) throw new Error('文件已外改，未覆盖；请核对后重新预览。');
          if (note.readOnly || note.duplicatePaths?.length || saveProblem(note.source)) throw new Error('笔记只读、格式无效或 ID 冲突，未改写。');
          edit.candidate = prepareSave(edit.original, edit.candidate);
          await this.persist(operation);
          await this.vault.savePrepared(edit.path, edit.candidate, note.revision);
          await this.checkpoint?.('written');
        } else if (edit.candidate === edit.original) throw new Error('该笔记不可改写，请先修复格式。');
        edit.done = true;
      } catch (cause) { edit.error = (cause as Error).message; }
      await this.persist(operation);
    }
    // Rescan every file: new references and unknown/invalid files prevent removing
    // the shared entry even if all originally planned writes succeeded.
    operation.problems = [];
    for (const name of await this.vault.list()) {
      try {
        const anchors = readAnchors((await this.vault.read(name)).source);
        if (anchors !== undefined && !Array.isArray(anchors)) throw new Error('anchors 不是列表，引用数量无法确认。');
        if (Array.isArray(anchors) && anchors.some((anchor) => this.matches(anchor, operation))) operation.problems.push(`${name}：仍有引用，目录条目已保留。`);
      } catch (cause) { operation.problems.push(`${name}：${(cause as Error).message}`); }
    }
    if (operation.edits.some((edit) => !edit.done) || operation.problems.length) operation.error = '部分引用未处理，尚未删除目录条目；可修复后重试或重新预览。';
    else {
      const data = current.data;
      if (operation.kind === 'chapter') { data.chapters = data.chapters.filter((item) => item.id !== operation.entryId); data.sections = data.sections.filter((item) => item.chapterId !== operation.entryId); }
      else data.sections = data.sections.filter((item) => item.id !== operation.entryId);
      try { operation.finalSource = `${JSON.stringify(data, null, 2)}\n`; await this.persist(operation); await this.write(operation.revision, data, catalog); operation.removed = true; }
      catch (cause) { operation.error = (cause as Error).message; }
    }
    await this.persist(operation); return view(operation);
  }
}
