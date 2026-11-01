import { randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { prepareSave, saveProblem } from './format.ts';
import { linkEntry, pathLink, replaceReference, resolveLink, type LinkEntry, type NoteReference } from './links.ts';
import { notePath } from './note-path.ts';
import { atomicState, digest, readJson, type Vault } from './vault.ts';
import type { Note, Recovery, VaultChange } from './contracts.ts';

type Identity = { path: string; id?: string; revision: string };
type Notice = { id: string; from: string; to: string; targetId: string; revision: string; history: Identity[]; problem?: string };
type Edit = { path: string; original: string; candidate: string; references: NoteReference[]; done: boolean; error?: string };
type Operation = { version: 1; id: string; created: string; from: string; to: string; targetId: string; original: string; moved: boolean; external: boolean; started: boolean; edits: Edit[]; warnings: string[]; error?: string };
export type MovePlan = Omit<Operation, 'version' | 'original' | 'edits'> & { edits: { path: string; count: number; done: boolean; error?: string; links: string[] }[] };
export type MoveStatus = { operations: MovePlan[]; notices: { id: string; from: string; to: string; problem?: string }[] };

const uuid = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value);
const view = ({ version: _version, original: _original, edits, ...operation }: Operation): MovePlan => ({ ...operation, edits: edits.map(({ path, references, done, error }) => ({ path, count: references.length, done, error, links: references.map((reference) => `${reference.property ? `属性 ${reference.property.join(' / ')}` : '正文'}：${reference.raw}`) })) });
const entriesFor = (identities: Identity[]) => identities.map((item) => linkEntry(item.path, ''));
const samePath = (a: string, b: string) => a.normalize('NFC') === b.normalize('NFC');

// Body ranges are absolute. Property ranges are relative to one scalar value.
// Keep these groups separate so YAML serialization cannot invalidate body ranges.
export function rewriteReferences(source: string, references: NoteReference[], target: string, expectedSource = source) {
  if (source !== expectedSource) throw new Error('内容已改变，请重新预览。');
  const body = references.filter((item) => !item.property).sort((a, b) => b.from - a.from);
  const properties = new Map<string, NoteReference[]>();
  for (const item of references.filter((item) => item.property)) {
    const key = JSON.stringify(item.property);
    properties.set(key, [...(properties.get(key) ?? []), item]);
  }
  for (const reference of [...body, ...[...properties.values()].flatMap((items) => items.sort((a, b) => b.from - a.from))]) {
    source = replaceReference(source, reference, pathLink(target, reference.alias));
  }
  return source;
}

export class NoteMoves {
  private history: Identity[] = [];
  private notices: Notice[] = [];
  private operations = new Map<string, Operation>();
  private moving?: Operation;
  private directory: string;
  private vault: Vault;
  // Test seam, never exposed over IPC. A thrown checkpoint simulates a stopped process.
  checkpoint?: (stage: 'journaled' | 'moved' | 'written', operation: string) => Promise<void>;
  private constructor(vault: Vault) { this.vault = vault; this.directory = path.join(vault.recoveryDir, digest(vault.root), 'moves'); }

  static async open(vault: Vault) {
    const manager = new NoteMoves(vault);
    const names = await readdir(manager.directory).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return []; throw error; });
    for (const name of names.filter((name) => /^[a-f0-9-]{36}\.json$/.test(name))) {
      const operation = await readJson(path.join(manager.directory, name)) as Operation;
      if (operation?.version !== 1 || !uuid(operation.id) || name !== `${operation.id}.json` || typeof operation.original !== 'string' || !Array.isArray(operation.edits)) throw new Error('改名操作记录损坏；原文件未改动。');
      notePath(operation.from); notePath(operation.to);
      for (const edit of operation.edits) { notePath(edit.path); if (typeof edit.original !== 'string' || typeof edit.candidate !== 'string' || !Array.isArray(edit.references)) throw new Error('引用修复记录损坏。'); }
      manager.operations.set(operation.id, operation);
    }
    vault.onScan = (change, notes) => manager.observe(change, notes);
    return manager;
  }

  private persist(operation: Operation) { return atomicState(path.join(this.directory, `${operation.id}.json`), operation); }
  private observe(change: VaultChange, scanned: ReadonlyMap<string, Note | undefined>) {
    if (!change.changed.length && this.history.length) return;
    const old = this.history;
    const names = new Set(change.notes), changed = new Set(change.changed);
    const next = new Map(old.filter((item) => names.has(item.path)).map((item) => [item.path, item]));
    // Reuse the scan's captured notes. Observation has no disk writes, second
    // content reads, parsing or recursive scan calls on the successful save path.
    for (const name of change.notes) if (changed.has(name) || !next.has(name)) {
      const note = scanned.get(name);
      next.set(name, { path: name, id: note?.id, revision: note?.revision ?? '' });
    }
    const byPath = new Map([...next.values()].map((item) => [item.path.normalize('NFC'), item]));
    const occupiedProblem = '原路径已被其他文件占用，存在身份冲突；请手动核对引用。';
    for (const notice of this.notices) {
      const occupant = byPath.get(notice.from.normalize('NFC'));
      const matches = [...next.values()].filter((item) => item.id === notice.targetId);
      if (occupant) notice.problem = occupant.id !== notice.targetId ? occupiedProblem : '原路径已重新出现，不能确认外部移动。';
      else if (notice.history.filter((item) => item.id === notice.targetId).length !== 1 || matches.length > 1) notice.problem = 'ID 冲突，不能确认外部移动目标。';
      else if (!matches.length) notice.problem = '外移原件暂不可确认，未自动修复引用。';
      else if (matches[0]!.revision !== notice.revision) notice.problem = '路径与内容同时改变，不能确认同一原件。';
      else { notice.to = matches[0]!.path; notice.problem = undefined; }
    }
    for (const previous of old) {
      if (!previous.id) continue;
      const occupant = byPath.get(previous.path.normalize('NFC'));
      if (occupant?.id === previous.id) continue;
      if (this.moving?.from === previous.path && this.moving.targetId === previous.id) continue;
      const matches = [...next.values()].filter((item) => item.id === previous.id);
      if (!matches.length || this.notices.some((notice) => notice.from === previous.path && notice.targetId === previous.id)) continue;
      const candidate = matches[0]!;
      const duplicate = old.filter((item) => item.id === previous.id).length !== 1 || matches.length !== 1;
      // An explicit duplicate-ID repair leaves the old ID on its other copy.
      // An occupied path only proves a move conflict with unique old/new identity evidence.
      if (occupant && (duplicate || samePath(candidate.path, previous.path))) continue;
      this.notices.push({ id: randomUUID(), from: previous.path, to: candidate.path, targetId: previous.id, revision: previous.revision, history: old,
        problem: occupant ? occupiedProblem : duplicate ? 'ID 冲突，不能确认外部移动目标。' : candidate.revision !== previous.revision ? '路径与内容同时改变，不能确认同一原件。' : undefined });
    }
    this.history = [...next.values()];
  }

  async status(): Promise<MoveStatus> {
    await this.vault.scan();
    return { operations: [...this.operations.values()].filter((operation) => operation.started).map(view), notices: this.notices.map(({ history: _history, targetId: _id, revision: _revision, ...notice }) => notice) };
  }

  recoveries(): Recovery[] {
    return [...this.operations.values()].filter((operation) => operation.started).flatMap((operation) => [
      ...(!operation.moved || operation.error ? [{ id: operation.id, path: operation.from, created: operation.created, original: null, candidate: operation.original }] : []),
      ...operation.edits.filter((edit) => !edit.done).map((edit) => ({ id: `${operation.id}:${edit.path}`, path: edit.path, created: operation.created, original: edit.original, candidate: edit.candidate })),
    ]);
  }

  private async uniqueTarget(note: Note) {
    if (!note.id || note.readOnly || saveProblem(note.source)) throw new Error('请先保存笔记，建立有效 ID 后再改名。');
    if (this.history.filter((item) => item.id === note.id).length !== 1) throw new Error('笔记 ID 冲突，未认领目标。请先明确副本身份。');
  }

  private async create(from: string, to: string, target: Note, entries: LinkEntry[], external: boolean, historical?: Identity[]) {
    await this.uniqueTarget(target);
    const operation: Operation = { version: 1, id: randomUUID(), created: new Date().toISOString(), from, to, targetId: target.id!, original: target.source, moved: external, external, started: false, edits: [], warnings: [] };
    for (const entry of entries) {
      const references = entry.references.filter((reference) => {
        const resolved = resolveLink(reference.target, entries);
        return resolved.kind === 'resolved' && resolved.candidates[0]!.path === from;
      });
      if (!references.length) continue;
      const actualPath = external && entry.path === from ? to : entry.path;
      const note = actualPath === target.path ? target : await this.vault.read(actualPath).catch(() => null);
      if (!note) { operation.warnings.push(`${actualPath}：无法读取，未改写。`); continue; }
      if (this.history.find((item) => item.path === actualPath)?.revision !== note.revision) throw new Error(`${actualPath}：预览期间内容已改变，请重新预览。`);
      if (historical && historical.find((item) => item.path === entry.path)?.revision !== note.revision) {
        operation.warnings.push(`${actualPath}：历史快照后内容已改变，请手动核对引用。`); continue;
      }
      const problem = note.readOnly ? '较新格式只读，不能改写引用。' : saveProblem(note.source);
      if (problem || note.duplicatePaths?.length) { operation.warnings.push(`${actualPath}：${references.length} 处确定引用，${problem || 'ID 冲突'}；未改写，需手动处理。`); continue; }
      const rewritten = rewriteReferences(note.source, references, to);
      operation.edits.push({ path: entry.path === from ? to : actualPath, original: note.source, candidate: prepareSave(note.source, rewritten), references, done: false });
    }
    this.operations.set(operation.id, operation);
    return view(operation);
  }

  async plan(from: string, to: string, revision: string) {
    notePath(from); notePath(to);
    if (samePath(from, to)) throw new Error('新路径与原路径相同。');
    const index = await this.vault.links();
    if (index.entries.some((item) => item.path.normalize('NFC').toLowerCase() === to.normalize('NFC').toLowerCase())) throw new Error('目标已存在或大小写/NFC 冲突，未覆盖。');
    await this.vault.resolve(to, true);
    const target = await this.vault.read(from);
    if (target.revision !== revision) throw new Error('原笔记已外改，请重新读取再预览。');
    const plan = await this.create(from, to, target, index.entries, false);
    const operation = this.operations.get(plan.id)!;
    operation.warnings.push(...index.problems);
    return view(operation);
  }

  async planRepair(id: string) {
    await this.vault.scan();
    const notice = this.notices.find((item) => item.id === id);
    if (!notice || notice.problem) throw new Error(notice?.problem || '修复提示已失效，请刷新。');
    if (this.history.some((item) => samePath(item.path, notice.from))) throw new Error('原路径已重新出现，不能确认外部移动。');
    const target = await this.vault.read(notice.to);
    if (target.id !== notice.targetId || target.revision !== notice.revision) throw new Error('外部移动目标已改变，未认领。');
    const index = await this.vault.links();
    const historicalEntries = entriesFor(notice.history).map((entry) => ({ ...entry, references: index.entries.find((current) => current.path === (entry.path === notice.from ? notice.to : entry.path))?.references ?? [] }));
    return this.create(notice.from, notice.to, target, historicalEntries, true, notice.history);
  }

  async apply(id: string) {
    if (!uuid(id)) throw new Error('操作 ID 无效。');
    const operation = this.operations.get(id);
    if (!operation) throw new Error('操作记录不存在，请重新预览。');
    const starting = !operation.started;
    await this.persist({ ...operation, started: true, error: undefined });
    operation.started = true; operation.error = undefined;
    // The durable operation now owns this repair. Retire only its current hint;
    // future external moves may create fresh notices for the same old path/ID.
    if (starting && operation.external) this.notices = this.notices.filter((notice) => notice.from !== operation.from || notice.targetId !== operation.targetId || notice.to !== operation.to);
    await this.checkpoint?.('journaled', id);
    if (!operation.moved) {
      try {
        await this.vault.scan();
        if (this.history.some((item) => item.id === operation.targetId && item.path !== operation.from && item.path !== operation.to)) throw new Error('笔记 ID 冲突，移动已暂停。');
        const target = await this.vault.read(operation.to).catch(() => null);
        const sourceExists = (await this.vault.list()).includes(operation.from);
        if (target && !sourceExists && target.id === operation.targetId && target.revision === digest(operation.original)) await this.uniqueTarget(target);
        else {
          // A captured file is absent from the visible index during crash recovery.
          const source = await this.vault.read(operation.from).catch(() => null);
          if (source) { await this.uniqueTarget(source); if (source.id !== operation.targetId) throw new Error('原笔记身份已改变。'); }
          this.moving = operation;
          try { await this.vault.moveFile(operation.from, operation.to, digest(operation.original), operation.id); }
          finally {
            // Consume only this transfer's own observation before clearing its
            // scope. Completed/reloaded journals never suppress external moves.
            try { await this.vault.scan(); } finally { this.moving = undefined; }
          }
        }
        operation.moved = true;
        await this.persist(operation);
        await this.checkpoint?.('moved', id);
      } catch (cause) { operation.error = (cause as Error).message; await this.persist(operation); return view(operation); }
    }
    // Retry never adopts a different ID, a duplicate, or an externally changed target.
    await this.vault.scan();
    try {
      if (operation.external && this.history.some((item) => samePath(item.path, operation.from))) throw new Error('原路径已重新出现，外部引用修复暂停。');
      const target = await this.vault.read(operation.to);
      await this.uniqueTarget(target);
      const selfEdit = operation.edits.find((edit) => edit.path === operation.to);
      if (target.id !== operation.targetId || target.revision !== digest(operation.original) && target.revision !== (selfEdit && digest(selfEdit.candidate))) throw new Error('移动目标已外改，引用改写暂停；请核对原件。');
    } catch (cause) { operation.error = (cause as Error).message; await this.persist(operation); return view(operation); }
    for (const edit of operation.edits) {
      if (edit.done) continue;
      edit.error = undefined;
      try {
        const note = await this.vault.read(edit.path).catch((cause: NodeJS.ErrnoException) => { if (cause.code === 'ENOENT') return null; throw cause; });
        if (!note) {
          const restored = await this.vault.resumePrepared(edit.path, edit.original, edit.candidate);
          if (!restored) throw new Error('文件已删除且无可确认的中断原件；未自动重建，可从恢复记录核对。');
          edit.done = true;
        } else if (note.revision === digest(edit.candidate)) edit.done = true;
        else {
          if (note.revision !== digest(edit.original)) throw new Error('文件已外改，未覆盖；请恢复预览时版本后重试，或手动修复。');
          // Freeze the actual attempt time before writing. A recovered installed
          // candidate matches above and never gets a second timestamp.
          edit.candidate = prepareSave(edit.original, edit.candidate);
          await this.persist(operation);
          await this.vault.savePrepared(edit.path, edit.candidate, note.revision);
          await this.checkpoint?.('written', id);
          edit.done = true;
        }
      } catch (cause) { edit.error = (cause as Error).message; }
      await this.persist(operation);
    }
    return view(operation);
  }
}
