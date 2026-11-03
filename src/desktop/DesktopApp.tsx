import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { DesktopApi, Note, Position, Recovery, Result, VaultChange, VaultState, VaultView, SettingsView, SettingsPatch } from '../../desktop/contracts';
import { freshIdentity as freshCopy, rebaseSaved, saveProblem } from '../../desktop/format';
import { SourceEditor, headerEnd, type EditorScene } from './SourceEditor';
import { NoteProperties, NoteInformation } from './NoteProperties';
import { originalHrefs, originalTargets } from '../../desktop/original-links';
import { NoteMarkdown } from './note-markdown';
import { NoteLinks } from './NoteLinks';
import { NoteMoves, noteDirectory, noteName } from './NoteMoves';
import type { MovePlan } from '../../desktop/moves';
import { NoteSearch } from './NoteSearch';
import { NoteGraph } from './NoteGraph';
import { NoteTitle } from './NoteTitle';
import { NoteActionIcon } from './NoteActionIcon';
import { LocateIcon } from '../ui/LocateIcon';
import { noteReferences, pathLink, replaceReference, resolveLink, type LinkIndex, type NoteReference } from '../../desktop/links';
import { CustomCatalogManager } from './CustomCatalog';
import { NoteAnchors } from './NoteAnchors';
import { anchorKey, changeAnchors, readAnchors, resolveAnchor, type AnchorTarget, type Catalog } from '../../desktop/anchors';
import type { AnchorSession, AnchorBridge } from './anchor-session';
import { notePath } from '../../desktop/note-path';
import './anchors.css';
import './desktop.css';
import './links.css';
import './projection.css';

declare global { interface Window { textbookDesktop?: DesktopApi } }

function value<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.error);
  return result.value;
}
type Conflict = { disk: Note | null; error?: string };
type Draft = { note: Note; source: string; isNew: boolean; key: number; conflict?: Conflict; paused?: boolean; freshOnSave?: boolean; createdFrom?: { key: number; reference: NoteReference; source: string }; rebase?: { sent: string; saved: string } };
type Choice = 'save' | 'discard' | 'cancel';
function Difference({ source, other }: { source: string; other: string }) {
  const lines = source.split('\n'), compared = other.split('\n');
  let start = 0, end = 0;
  while (start < Math.min(lines.length, compared.length) && lines[start] === compared[start]) start++;
  while (end < Math.min(lines.length, compared.length) - start && lines[lines.length - end - 1] === compared[compared.length - end - 1]) end++;
  return <pre>{lines.map((line, index) => <span className={index >= start && index < lines.length - end ? 'vault-diff-changed' : undefined} key={index}>{line}{'\n'}</span>)}</pre>;
}
const NoteList = memo(function NoteList({ notes, active, busy, duplicates, onOpen }: { notes: string[]; active?: string; busy: boolean; duplicates: Record<string, string[]>; onOpen: (path: string) => void }) {
  return <nav>{notes.map((path) => <button key={path} disabled={busy} aria-current={active === path ? 'page' : undefined} onClick={() => onOpen(path)} title={path} aria-label={path.includes('/') ? `${noteName(path)} · ${noteDirectory(path)}` : noteName(path)}><span>{noteName(path)}</span>{path.includes('/') && <small className="vault-note-directory">{noteDirectory(path)}</small>}{duplicates[path] && <small> ID 冲突</small>}</button>)}</nav>;
});
export function DesktopApp({ openRequest, catalog = null, onRefreshCatalog, onAnchorSession, anchorBridge, onLocate, onOriginal, onSelect, chooseRequest, active = true, mode, graphControls, noteVisible, onCloseNote, onRevealNote, toolbarHost }: {
  mode: 'book' | 'graph'; graphControls?: ReactNode; noteVisible: boolean; onCloseNote?: () => void; onRevealNote?: (path?: string) => void; toolbarHost?: HTMLElement | null;
  chooseRequest?: number; active?: boolean;
  openRequest?: { path: string; serial: number; vaultToken: string; expectedId?: string }; catalog?: Catalog | null;
  onRefreshCatalog?: () => Promise<void>;
  onAnchorSession?: (session: AnchorSession) => void; anchorBridge?: AnchorBridge; onLocate?: (target: AnchorTarget) => void; onOriginal?: (targets: AnchorTarget[], href: string) => void; onSelect?: (index?: number) => void;
}) {
  const api = window.textbookDesktop!;
  const [preferences, setPreferences] = useState<SettingsView>({ revision: null, settings: { editor: { bodyMode: 'live', frontmatterMode: 'properties' }, propertyTypes: {} } });
  const [settingsError, setSettingsError] = useState('');
  const settingsRef = useRef<SettingsView | null>(null);
  const settingsQueue = useRef<Promise<void>>(Promise.resolve());
  const { bodyMode, frontmatterMode } = preferences.settings.editor;
  const [linkIndex, setLinkIndex] = useState<LinkIndex>({ entries: [], problems: [] });
  const [linkRequest, setLinkRequest] = useState<{ reference: NoteReference; source: string; key: number }>();
  const [returnCount, setReturnCount] = useState(0);
  const history = useRef<{ draft: Draft; editor: SettingsView['settings']['editor']; status: string }[]>([]);
  const scenes = useRef(new Map<number, EditorScene>());
  const indexRequest = useRef(0);
  const graphOpen = mode === 'graph';
  const [graphMounted, setGraphMounted] = useState(false);
  const searchHost = useRef<HTMLDivElement>(null);
  const libraryMenu = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (event: PointerEvent) => { if (event.target instanceof Node && libraryMenu.current && !libraryMenu.current.contains(event.target)) libraryMenu.current.open = false; };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, []);
  const [vault, setVault] = useState<VaultView | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  useEffect(() => {
    setListOpen(false);
    if (graphOpen) setGraphMounted(true);
  }, [mode, graphOpen]);
  const handledOpenRequest = useRef<typeof openRequest>(undefined);
  const listShown = useRef(false); listShown.current = listOpen;
  const listToggle = useRef<HTMLButtonElement>(null);
  const listHost = useRef<HTMLElement>(null);
  const noteHeading = useRef<HTMLHeadingElement>(null);
  const titleFlush = useRef<{ flush: () => Promise<boolean> }>(null);
  const titleDirty = useRef(false);
  const [titleEditing, setTitleEditing] = useState(false);
  const running = useRef<Promise<void> | null>(null);
  const flushForClose = useRef<() => Promise<boolean>>(async () => false);
  const metadataHost = useRef<HTMLDetailsElement>(null);
  const [metadataOpen, setMetadataOpen] = useState(false);
  function closeList(focus = false) {
    if (focus && listShown.current) requestAnimationFrame(() => noteHeading.current?.focus());
    setListOpen(false);
  }
  useEffect(() => { if (listOpen) (listHost.current?.querySelector<HTMLButtonElement>('nav [aria-current]') ?? listHost.current?.querySelector<HTMLButtonElement>('button'))?.focus({ preventScroll: true }); }, [listOpen]);
  useEffect(() => {
    const sidebar = listHost.current;
    if (!active || !listOpen || !sidebar) return;
    const observer = new ResizeObserver(() => {
      const item = sidebar.querySelector<HTMLElement>('nav [aria-current]');
      if (!item) return;
      const bounds = item.getBoundingClientRect(), list = sidebar.getBoundingClientRect();
      if (bounds.top < list.top || bounds.bottom > list.bottom) item.scrollIntoView({ block: 'nearest' });
    });
    observer.observe(sidebar);
    const list = sidebar.querySelector('nav');
    if (list) observer.observe(list);
    return () => observer.disconnect();
  }, [active, listOpen, draft?.note.path]);
  const [guard, setGuard] = useState<'leave' | 'disk' | null>(null);
  const [diff, setDiff] = useState(false);
  const [records, setRecords] = useState<Recovery[] | null>(null);
  const [duplicates, setDuplicates] = useState<Record<string, string[]>>({});
  const guardResolve = useRef<((choice: Choice) => void) | null>(null);
  const guardDialog = useRef<HTMLDialogElement>(null);
  const localState = useRef<VaultState>({ positions: {} });
  const latest = useRef({ vault, draft, busy, saving, editor: preferences.settings.editor });
  latest.current = { vault, draft, busy, saving, editor: preferences.settings.editor };
  const inFlight = useRef<Promise<boolean> | null>(null);
  const deferredChange = useRef<VaultChange | null>(null);
  const stateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const key = useRef(0);
  const parkedDirty = history.current.some(({ draft }) => draft.isNew || draft.source !== draft.note.source);
  const dirty = !!draft && (draft.isNew || draft.source !== draft.note.source);
  const problem = draft && !draft.note.readOnly ? saveProblem(draft.source) : '';
  const revealNote = useRef(onRevealNote); revealNote.current = onRevealNote;
  const previousAttention = useRef<unknown[]>([]);
  // Track error transitions, not source text or callback identity. A closed pane
  // reopens for a new problem, without interrupting every edit of invalid YAML.
  const attention = JSON.stringify([`${vault?.token ?? ''}:${draft?.key ?? ''}`, error, settingsError, !!problem, !!draft?.conflict, !!draft?.paused, draft?.note.problems.length ? JSON.stringify(draft.note.problems) : '']);
  useEffect(() => {
    const next: unknown[] = JSON.parse(attention), previous = previousAttention.current;
    previousAttention.current = next;
    if (next.some((issue, index) => index > 0 && !!issue && (next[0] !== previous[0] || issue !== previous[index]))) revealNote.current?.();
  }, [attention]);

  function update(next: Draft | null) {
    if (next && next.key !== latest.current.draft?.key) closeList(true);
    latest.current.draft = next; setDraft(next);
    api.setDirty(titleDirty.current || parkedDirty || latest.current.saving || !!next && (next.isNew || next.source !== next.note.source));
  }
  function edit(source: string) {
    const previous = latest.current.draft;
    if (!previous) return;
    update({ ...previous, source, paused: false });
    setStatus(previous.conflict ? '磁盘冲突 · 自动保存已暂停' : !previous.isNew && source === previous.note.source ? '已保存' : '未保存');
    setError('');
  }
  async function remember() {
    const current = latest.current.vault;
    if (!current) return;
    const result = await api.saveState(current.token, localState.current);
    // A debounced request can be queued behind the native picker. Its rejected
    // old token must not publish an error into the newly selected vault.
    if (latest.current.vault?.token === current.token) value(result);
  }
  function position(next: Position) {
    const current = latest.current.draft;
    if (!current || current.isNew) return;
    localState.current.positions[current.note.path] = next;
    if (stateTimer.current) clearTimeout(stateTimer.current);
    stateTimer.current = setTimeout(() => { void remember().catch((cause: Error) => setError(cause.message)); }, 180);
  }
  function loaded(note: Note) {
    setLinkRequest(undefined);
    update({ note, source: note.source, isNew: false, key: ++key.current });
    setDiff(false); setStatus(note.readOnly ? '只读' : '已从磁盘读取');
  }
  async function chooseVault() {
    if (!await protect()) return;
    await run(async () => { await remember(); const current = value(await api.chooseVault()); if (current) await showVault(current); });
  }
  async function openNote(current: VaultView, path: string, expectedId?: string) {
    const note = value(await api.read(current.token, path));
    if (expectedId && note.id !== expectedId) throw new Error('目标笔记身份已改变，请重新从教材打开。');
    localState.current.activePath = path;
    loaded(note);
    await remember();
  }
  async function readPreferences(current: VaultView) {
    settingsRef.current = null; setSettingsError('');
    const result = await api.readSettings(current.token);
    if (latest.current.vault?.token !== current.token) return;
    if (result.ok) { settingsRef.current = result.value; setPreferences(result.value); }
    else setSettingsError(result.error);
  }
  function configure(patch: SettingsPatch) {
    const current = latest.current.vault;
    if (!current) return;
    setPreferences((previous) => ({ ...previous, settings: { editor: { ...previous.settings.editor, ...patch.editor }, propertyTypes: { ...previous.settings.propertyTypes, ...patch.propertyTypes } } }));
    settingsQueue.current = settingsQueue.current.then(async () => {
      if (latest.current.vault?.token !== current.token) return;
      if (!settingsRef.current) { setSettingsError((previous) => previous || '配置未读取，当前选择尚未保存。请重新读取配置。'); return; }
      const result = await api.saveSettings(current.token, settingsRef.current.revision, patch);
      if (latest.current.vault?.token !== current.token) return;
      if (result.ok) { settingsRef.current = result.value; setPreferences((previous) => ({ ...previous, unsupportedPropertyTypes: result.value.unsupportedPropertyTypes })); setSettingsError(''); }
      else { settingsRef.current = null; setSettingsError(result.error); }
    });
  }
  async function refreshLinks(current: VaultView) {
    const request = ++indexRequest.current;
    const result = await api.links(current.token);
    if (latest.current.vault?.token !== current.token || request !== indexRequest.current) return;
    if (result.ok) setLinkIndex(result.value);
    else setLinkIndex((previous) => ({ ...previous, problems: [result.error] }));
  }
  async function showVault(current: VaultView) {
    closeList();
    if (stateTimer.current) clearTimeout(stateTimer.current);
    history.current = []; scenes.current.clear(); setReturnCount(0); setLinkRequest(undefined);
    ++indexRequest.current; setLinkIndex({ entries: [], problems: [] }); setGraphMounted(false);
    localState.current = current.state;
    latest.current.vault = current;
    setVault(current); setPreferences({ revision: null, settings: { editor: { bodyMode: 'live', frontmatterMode: 'properties' }, propertyTypes: {} } }); update(null); setCreating(false); setRecords(null); setDuplicates({}); setStatus('');
    setError(current.notice ?? '');
    await readPreferences(current);
    await refreshLinks(current);
    if (current.state.activePath && current.notes.includes(current.state.activePath)) await openNote(current, current.state.activePath);
    value(await api.list(current.token));
    const recoveries = value(await api.recoveries(current.token));
    if (recoveries.length) setRecords(recoveries);
  }
  async function changed(change: VaultChange) {
    const current = latest.current.vault;
    if (current?.token !== change.token) return;
    // Invalidate immediately, including notifications deferred behind a save.
    // A response captured before deletion must never restore that old node.
    ++indexRequest.current;
    if (change.error) { setError(`笔记库监听失败：${change.error}；草稿已保留，可刷新重试。`); return; }
    const paths = new Set(change.notes);
    setLinkIndex((previous) => {
      const entries = previous.entries.filter((entry) => paths.has(entry.path));
      return entries.length === previous.entries.length ? previous : { ...previous, entries };
    });
    setVault((previous) => previous?.token === change.token ? { ...previous, notes: change.notes } : previous);
    setDuplicates(change.duplicates);
    if (latest.current.saving || latest.current.busy) { deferredChange.current = change; return; }
    void refreshLinks(current);
    const item = latest.current.draft;
    if (!item || item.isNew) return;
    let disk: Note | null = null;
    let readError = '';
    const result = await api.read(current.token, item.note.path);
    if (result.ok) disk = result.value;
    else if (result.code !== 'ENOENT') readError = result.error;
    const live = latest.current.draft;
    if (!live || live.key !== item.key || latest.current.vault?.token !== current.token) return;
    if (disk?.revision === live.note.revision && !live.conflict) {
      update({ ...live, note: disk }); return;
    }
    if (live.source !== live.note.source || readError) {
      update({ ...live, conflict: { disk, error: readError || undefined }, paused: true });
      setStatus('磁盘冲突 · 自动保存已暂停');
    } else if (disk) loaded(disk);
    else {
      update(null); delete localState.current.activePath;
      setStatus('文件已从磁盘删除'); setError('当前笔记已被外部删除。');
    }
  }
  function flushChange() {
    const change = deferredChange.current; deferredChange.current = null;
    if (change) void changed(change).catch((cause: Error) => setError(cause.message));
  }
  useEffect(() => {
    document.documentElement.dataset.uiStyle = 'island';
    let active = true;
    const unsubscribe = api.onChange((change) => { void changed(change).catch((cause: Error) => setError(cause.message)); });
    void api.restore().then(async (result) => {
      if (!active) return;
      const current = value(result);
      if (current) await showVault(current);
    }).catch((cause: Error) => { if (active) setError(cause.message); }).finally(() => {
      if (active) { latest.current.busy = false; setBusy(false); flushChange(); }
    });
    return () => { active = false; unsubscribe(); if (stateTimer.current) clearTimeout(stateTimer.current); };
  }, []);
  useEffect(() => { if (chooseRequest) void chooseVault(); }, [chooseRequest]);
  useEffect(() => {
    if (!openRequest || busy || latest.current.busy || handledOpenRequest.current === openRequest) return;
    handledOpenRequest.current = openRequest;
    void (async () => {
      const current = latest.current.vault;
      if (!current || current.token !== openRequest.vaultToken) return;
      if (latest.current.draft?.note.path === openRequest.path && !latest.current.draft.isNew && (!openRequest.expectedId || latest.current.draft.note.id === openRequest.expectedId)) { closeList(true); revealNote.current?.(openRequest.path); return; }
      await navigate(openRequest.path, openRequest.expectedId);
      if (latest.current.draft?.note.path === openRequest.path) { revealNote.current?.(openRequest.path); }
    })();
  }, [openRequest, busy]);
  useEffect(() => { api.setDirty(titleEditing || dirty || parkedDirty || saving); }, [titleEditing, dirty, parkedDirty, saving, api]);
  useEffect(() => {
    if (!titleEditing && !dirty && !parkedDirty && !saving) return;
    const prevent = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', prevent);
    return () => window.removeEventListener('beforeunload', prevent);
  }, [titleEditing, dirty, parkedDirty, saving]);
  useEffect(() => { if (guard) guardDialog.current?.showModal(); }, [guard]);
  useEffect(() => {
    if (!dirty || busy || saving || guard || problem || draft?.conflict || draft?.paused || draft?.note.readOnly) return;
    const timer = setTimeout(() => { void save(); }, 650);
    return () => clearTimeout(timer);
  }, [draft, dirty, busy, saving, guard, problem]);

  async function save(): Promise<boolean> {
    if (inFlight.current) { await inFlight.current; return save(); }
    const { vault: current, draft: item, busy } = latest.current;
    if (!current || !item || busy || item.note.readOnly || item.conflict) return false;
    if (!item.isNew && item.source === item.note.source && item.note.id) return true;
    let source = item.rebase ? rebaseSaved(item.rebase.sent, item.source, item.rebase.saved) ?? item.source : item.source;
    const invalid = saveProblem(source);
    if (invalid) { setError(invalid); setStatus('保存失败 · 草稿已保留'); update({ ...item, paused: true }); return false; }
    if (item.freshOnSave) source = freshCopy(source);
    latest.current.saving = true; setSaving(true); api.setDirty(true);
    setError(''); setStatus('保存中…');
    const operation = (async () => {
      try {
        const note = value(await api.save(current.token, item.note.path, source, item.isNew ? null : item.note.revision));
        const live = latest.current.draft;
        if (!live || live.key !== item.key) return false;
        const rebase = { sent: item.source, saved: note.source };
        const merged = live.source === item.source ? note.source : rebaseSaved(item.source, live.source, note.source);
        update({ ...live, note, source: merged ?? live.source, isNew: false, paused: false, freshOnSave: false, createdFrom: undefined, rebase: merged === undefined ? rebase : undefined });
        if (item.isNew && item.createdFrom && note.path !== item.note.path) {
          const origin = history.current.find((entry) => entry.draft.key === item.createdFrom!.key);
          if (origin && origin.draft.source === item.createdFrom.source) {
            origin.draft = { ...origin.draft, source: replaceReference(origin.draft.source, item.createdFrom.reference, pathLink(note.path, item.createdFrom.reference.alias), item.createdFrom.source) };
            origin.status = '未保存';
          } else setError(`新笔记已保存到 ${note.path}；来源内容已改变，请重新选择来源链接。`);
        }
        localState.current.activePath = note.path;
        setVault((previous) => previous ? { ...previous, notes: [...new Set([...previous.notes, note.path])].sort() } : null);
        setStatus(merged === note.source ? '已保存' : '未保存');
        try { await remember(); } catch (cause) { setError(`正文已保存，但本机位置未保存：${(cause as Error).message}`); }
        return merged === note.source;
      } catch (cause) {
        const live = latest.current.draft;
        if (live?.key === item.key) update({ ...live, paused: true });
        setError((cause as Error).message); setStatus('保存失败 · 草稿已保留');
        // This also detects a missing/replaced target if the watcher was delayed.
        if (!item.isNew) {
          const list = await api.list(current.token);
          if (list.ok) deferredChange.current = { token: current.token, notes: list.value, changed: [item.note.path], duplicates: {} };
        }
        return false;
      } finally {
        inFlight.current = null; latest.current.saving = false; setSaving(false); flushChange();
      }
    })();
    inFlight.current = operation;
    return operation;
  }
  async function flushBody() {
    if (running.current) await running.current;
    if (inFlight.current) await inFlight.current;
    const item = latest.current.draft;
    if (!item || !item.isNew && item.source === item.note.source) return true;
    if (item.paused || item.conflict || item.note.readOnly) return false;
    return save();
  }
  async function flushNote() {
    if (running.current) await running.current;
    if (inFlight.current) await inFlight.current;
    if (titleFlush.current && !await titleFlush.current.flush()) { revealNote.current?.(); return false; }
    return flushBody();
  }
  async function closeNote() {
    if (await flushNote()) onCloseNote?.();
    else revealNote.current?.();
  }
  function titleChanged(value: boolean) {
    titleDirty.current = value; setTitleEditing(value);
    const item = latest.current.draft;
    api.setDirty(value || latest.current.saving || history.current.some(({ draft }) => draft.isNew || draft.source !== draft.note.source) || !!item && (item.isNew || item.source !== item.note.source));
  }
  flushForClose.current = async () => {
    if (!await flushNote()) return false;
    if (history.current.some(({ draft }) => draft.isNew || draft.source !== draft.note.source)) {
      setError('还有未保存的来源笔记，请返回来源处理后再关闭。'); revealNote.current?.(); return false;
    }
    await remember();
    const item = latest.current.draft;
    if (latest.current.busy || latest.current.saving || titleDirty.current || item && (item.isNew || item.source !== item.note.source)) return false;
    api.setDirty(false); return true;
  };
  useEffect(() => api.onBeforeClose(() => flushForClose.current()), [api]);
  const focusFlush = useRef(flushNote); focusFlush.current = flushNote;
  useEffect(() => {
    const blur = () => { void focusFlush.current(); };
    window.addEventListener('blur', blur);
    return () => window.removeEventListener('blur', blur);
  }, []);
  async function ask(kind: 'leave' | 'disk') {
    if (guardResolve.current) return 'cancel';
    setGuard(kind);
    const choice = await new Promise<Choice>((resolve) => { guardResolve.current = resolve; });
    setGuard(null); return choice;
  }
  async function protect() {
    if (titleFlush.current && !await titleFlush.current.flush()) return false;
    if (await flushBody()) return true;
    const current = latest.current.draft;
    if (!current || !current.isNew && current.source === current.note.source) return true;
    const choice = await ask('leave');
    return choice === 'save' ? save() : choice === 'discard';
  }
  function answer(choice: Choice) {
    guardDialog.current?.close(); guardResolve.current?.(choice); guardResolve.current = null;
  }
  async function run(action: () => Promise<void>) {
    if (latest.current.busy) return;
    // A save may have persisted content while its position bookkeeping is still
    // queued. Honor the requested navigation after it settles instead of dropping it.
    if (inFlight.current) await inFlight.current;
    if (latest.current.busy) return;
    latest.current.busy = true; setBusy(true); setError('');
    const operation = (async () => {
      try { await action(); }
      catch (cause) { setError((cause as Error).message); }
      finally { latest.current.busy = false; setBusy(false); flushChange(); }
    })();
    running.current = operation;
    await operation;
    if (running.current === operation) running.current = null;
  }
  async function saveAs() {
    const { vault: current, draft: item } = latest.current;
    if (!current || !item) return false;
    // Explicit save-as always creates a new identity, including a deleted source.
    const note = value(await api.save(current.token, item.note.path, freshCopy(item.source), null));
    const live = latest.current.draft;
    if (!live || live.key !== item.key) return false;
    loaded(note); localState.current.activePath = note.path; await remember();
    value(await api.list(current.token)); setStatus('已保存');
    return true;
  }
  async function adoptDisk() {
    const item = latest.current.draft;
    if (!item?.conflict) return;
    const choice = await ask('disk');
    if (choice === 'cancel') return;
    await run(async () => {
      const current = latest.current.vault!, live = latest.current.draft!;
      // Persist even invalid YAML before replacing the editor. Failure keeps the scene.
      value(await api.protectDraft(current.token, live.note.path, live.source));
      if (choice === 'save') {
        const originalPath = live.note.path;
        if (!await saveAs()) return;
        const disk = await api.read(current.token, originalPath);
        if (disk.ok) loaded(disk.value);
        else { update(null); setStatus('磁盘文件不可用；草稿已另存'); }
      } else {
        const disk = await api.read(current.token, live.note.path);
        if (disk.ok) loaded(disk.value);
        else if (!value(await api.list(current.token)).includes(live.note.path)) { update(null); delete localState.current.activePath; setStatus('磁盘文件已删除；草稿在恢复记录'); }
        else throw new Error(disk.error);
      }
      if (latest.current.draft) localState.current.activePath = latest.current.draft.note.path;
      await remember(); setDiff(false);
    });
  }
  async function copy(replaceIdentity: boolean) {
    const current = latest.current.vault!, item = latest.current.draft!;
    const note = value(await api.copy(current.token, item.note.path, item.source, item.note.revision, replaceIdentity));
    loaded(note); localState.current.activePath = note.path; await remember();
    value(await api.list(current.token)); setStatus('已保存');
  }
  async function recover(record: Recovery, source: string) {
    if (!await protect()) return;
    const name = `${record.path.slice(0, -3)}（恢复）.md`;
    update({ note: { path: name, source: '', revision: '', readOnly: false, problems: [] }, source, isNew: true, key: ++key.current, paused: true, freshOnSave: true });
    setStatus('恢复草稿 · 请核对后保存'); setRecords(null); setError('');
  }
  async function saveBeforeMove() {
    const live = latest.current.draft;
    return !live || !live.isNew && live.source === live.note.source && !!live.note.id ? true : save();
  }
  async function appliedMove(plan: MovePlan) {
    const current = latest.current.vault!, item = latest.current.draft;
    if (plan.moved) {
      if (localState.current.positions[plan.from]) { localState.current.positions[plan.to] = localState.current.positions[plan.from]!; delete localState.current.positions[plan.from]; }
      for (const entry of history.current) if (entry.draft.note.path === plan.from) entry.draft.note = { ...entry.draft.note, path: plan.to };
    }
    if (item && !item.isNew && item.source === item.note.source && !item.conflict) {
      const targetPath = item.note.path === plan.from && plan.moved ? plan.to : item.note.path;
      const result = await api.read(current.token, targetPath);
      if (result.ok) { update({ ...item, note: result.value, source: result.value.source }); localState.current.activePath = targetPath; }
    }
    await remember(); value(await api.list(current.token)); await refreshLinks(current);
  }
  async function navigate(path: string, expectedId?: string) {
    if (titleFlush.current && !await titleFlush.current.flush()) return;
    await flushBody();
    await run(async () => {
      if (inFlight.current) await inFlight.current;
      const current = latest.current.vault!, item = latest.current.draft;
      if (item?.note.path === path && !item.isNew && (!expectedId || item.note.id === expectedId)) return;
      // Read first: a missing target must leave the current editor intact.
      const target = value(await api.read(current.token, path));
      if (expectedId && target.id !== expectedId) throw new Error('目标笔记身份已改变，请重新从教材打开。');
      if (item) {
        if (item.isNew || item.source !== item.note.source) value(await api.protectDraft(current.token, item.note.path, item.source));
        history.current.push({ draft: item, editor: { bodyMode, frontmatterMode }, status });
      }
      setReturnCount(history.current.length); setLinkRequest(undefined);
      loaded(target); localState.current.activePath = target.path; await remember();
    });
  }
  async function openProjected(path: string) {
    await navigate(path);
    if (latest.current.draft?.note.path === path) { closeList(true); revealNote.current?.(path); }
  }
  async function returnToSource() {
    if (!await flushNote()) return;
    await run(async () => {
      if (inFlight.current) await inFlight.current;
      const current = latest.current.vault!, item = latest.current.draft;
      if (item && (item.isNew || item.source !== item.note.source)) value(await api.protectDraft(current.token, item.note.path, item.source));
      const previous = history.current.at(-1);
      if (!previous) return;
      let restored = previous.draft;
      if (!restored.isNew) {
        const disk = await api.read(current.token, restored.note.path);
        if (!disk.ok || disk.value.revision !== restored.note.revision) {
          if (restored.source !== restored.note.source || restored.conflict || !disk.ok) restored = { ...restored, conflict: { disk: disk.ok ? disk.value : null, error: disk.ok || disk.code === 'ENOENT' ? undefined : disk.error }, paused: true };
          else restored = { ...restored, note: disk.value, source: disk.value.source };
        } else restored = { ...restored, note: disk.value };
      }
      history.current.pop(); setReturnCount(history.current.length); setLinkRequest(undefined);
      update(restored); configure({ editor: previous.editor });
      setStatus(restored.conflict ? '磁盘冲突 · 自动保存已暂停' : previous.status);
      localState.current.activePath = restored.note.path; await remember();
    });
  }
  function openOriginal(href: string) {
    if (!originalHrefs(latest.current.draft?.source ?? '').includes(href)) { setError('原文链接已改变，请重新打开。'); return; }
    try {
      const targets = originalTargets(href, catalog, (warnings) => setError(warnings.join('；')));
      onOriginal?.(targets, href);
    }
    catch (error) { setError((error as Error).message); }
  }
  function openLink(clicked: NoteReference) {
    const reference = noteReferences(latest.current.draft?.source ?? '').find((item) => item.from === clicked.from && item.to === clicked.to && item.raw === clicked.raw && JSON.stringify(item.property) === JSON.stringify(clicked.property));
    if (!reference) { setError('内容已改变，请重新打开链接。'); return; }
    const result = resolveLink(reference.target, linkIndex.entries);
    if (result.kind === 'resolved') void navigate(result.candidates[0]!.path);
    else setLinkRequest({ reference, source: latest.current.draft!.source, key: Date.now() });
  }
  function createLinked(path: string, reference: NoteReference, replacement: string) {
    void run(async () => {
      const current = latest.current.vault!, item = latest.current.draft;
      if (!item) return;
      const inserted = noteReferences(item.source).find((candidate) => candidate.raw === replacement && candidate.from === reference.from && JSON.stringify(candidate.property) === JSON.stringify(reference.property));
      if (!inserted) throw new Error('来源链接已改变，请重新选择。');
      if (item.isNew || item.source !== item.note.source) value(await api.protectDraft(current.token, item.note.path, item.source));
      history.current.push({ draft: item, editor: { bodyMode, frontmatterMode }, status: item.source !== item.note.source || item.isNew ? '未保存' : status }); setReturnCount(history.current.length);
      update({ note: { path, source: '', revision: '', readOnly: false, problems: [] }, source: '', isNew: true, key: ++key.current, paused: true, createdFrom: { key: item.key, reference: inserted, source: item.source } });
      setStatus('新笔记草稿 · 保存后创建文件'); setLinkRequest(undefined);
    });
  }
  let anchorSignature: string | undefined;
  try { anchorSignature = anchorKey(readAnchors(draft?.source ?? '')); } catch { /* Invalid YAML stays in the editor. */ }
  const originalSignature = JSON.stringify(originalHrefs(draft?.source ?? ''));
  const anchorWritable = !!draft && !busy && !draft.note.readOnly && bodyMode !== 'preview' && !problem && !draft.conflict;
  useEffect(() => {
    if (onAnchorSession) onAnchorSession({ vaultToken: vault?.token ?? '', key: draft?.key, path: draft?.note.path, originals: JSON.parse(originalSignature), anchors: anchorSignature === undefined ? undefined : JSON.parse(anchorSignature).anchors, writable: anchorWritable, index: linkIndex });
  }, [vault?.token, draft?.key, draft?.note.path, anchorSignature, originalSignature, anchorWritable, linkIndex, onAnchorSession]);
  if (anchorBridge) anchorBridge.current = async (command) => {
    let succeeded = false;
    // Validate the candidate before parking any source or changing history.
    let candidate: { path: string; source: string } | undefined;
    try {
      if (command.create) {
        const name = command.create.name.trim();
        if (!name) throw new Error('请输入笔记名称。');
        const path = name.endsWith('.md') ? name : `${name}.md`;
        notePath(path);
        candidate = { path, source: changeAnchors('', undefined, { append: command.create.anchors }) };
      }
    } catch (cause) { setError((cause as Error).message); return false; }
    await run(async () => {
      const current = latest.current.vault, item = latest.current.draft;
      if (!current || command.session.vaultToken !== current.token || item?.key !== command.session.key) throw new Error('笔记或笔记库已改变，请重新框选。');
      if (candidate) {
        if (item && (item.isNew || item.source !== item.note.source)) value(await api.protectDraft(current.token, item.note.path, item.source));
        const live = latest.current.draft;
        if (latest.current.vault?.token !== current.token || live?.key !== item?.key || live?.source !== item?.source || live?.note.revision !== item?.note.revision) throw new Error('来源笔记已改变，草稿已保留；请重新确认。');
        if (item && !item.isNew) {
          const disk = value(await api.read(current.token, item.note.path));
          if (disk.revision !== item.note.revision) throw new Error('来源磁盘笔记已改变，草稿已保留；请先处理冲突。');
          if (latest.current.vault?.token !== current.token || latest.current.draft?.key !== item.key || latest.current.draft?.source !== item.source) throw new Error('来源笔记已改变，请重新确认。');
        }
        if (item) { history.current.push({ draft: item, editor: latest.current.editor, status: item.conflict ? '磁盘冲突 · 自动保存已暂停' : item.isNew || item.source !== item.note.source ? '未保存' : '已保存' }); setReturnCount(history.current.length); }
        update({ note: { path: candidate.path, source: '', revision: '', readOnly: false, problems: [] }, source: candidate.source, isNew: true, key: ++key.current });
        setStatus('未保存'); setError(''); succeeded = true; return;
      }
      if (!item || item.note.readOnly || latest.current.editor.bodyMode === 'preview' || saveProblem(item.source) || item.conflict) throw new Error('当前笔记不可修改，选择草稿已保留。');
      edit(changeAnchors(item.source, anchorKey(command.session.anchors), command.index === undefined ? { append: command.append } : { index: command.index, patch: { rects: command.rects } }));
      succeeded = true;
    });
    return succeeded;
  };
  const openListed = useCallback((path: string) => { void (async () => {
    const current = latest.current.vault;
    if (!current) return;
    if (latest.current.draft?.note.path === path && !latest.current.draft.isNew) { closeList(true); revealNote.current?.(path); return; }
    if (!await protect()) return;
    await run(async () => { await remember(); await openNote(current, path); revealNote.current?.(path); });
  })(); }, []);
  const noteContext = useMemo(() => {
    try {
      const anchors = readAnchors(draft?.source ?? '');
      return Array.isArray(anchors) ? anchors.map((anchor: unknown) => resolveAnchor(anchor, catalog)).find((anchor) => anchor.target) : undefined;
    } catch { return undefined; }
  }, [draft?.source, catalog]);
  const scene = draft ? scenes.current.get(draft.key) ?? {} : undefined;
  if (draft && scene) scenes.current.set(draft.key, scene);
  const retainedKeys = new Set([draft?.key, ...history.current.map((entry) => entry.draft.key)]);
  for (const key of scenes.current.keys()) if (!retainedKeys.has(key)) scenes.current.delete(key);
  const libraryControls = <>
    {vault && <button ref={listToggle} className="workspace-note-list icon-button" aria-label="笔记列表" title="笔记列表" aria-expanded={listOpen} aria-controls="vault-file-list" onClick={() => setListOpen(!listOpen)}><NoteActionIcon name="list" /><span>笔记</span></button>}
    {vault && <div ref={searchHost}><NoteSearch catalog={catalog} entries={linkIndex.entries} disabled={busy || saving} onOpen={openProjected} /></div>}
    {!vault ? <button disabled={busy || saving} onClick={() => { void chooseVault(); }}>选择笔记库</button> : <details ref={libraryMenu} className="vault-library-menu" onKeyDown={(event) => {
      if (event.key === 'Escape') { event.currentTarget.open = false; event.currentTarget.querySelector('summary')?.focus(); }
    }}><summary className="icon-button" aria-label="笔记库" title="笔记库"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M3 7V5a1 1 0 0 1 1-1h6l2 3h8a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg></summary><div><strong>{vault.name}</strong>
      <button disabled={busy || saving} onClick={(event) => { event.currentTarget.closest('details')!.open = false; void chooseVault(); }}>切换笔记库</button>
      <button disabled={busy || saving} onClick={(event) => { event.currentTarget.closest('details')!.open = false; revealNote.current?.(); void run(async () => setRecords(value(await api.recoveries(vault.token)))); }}>恢复记录</button>
    </div></details>}
  </>;
  return <main className="vault-app" data-workspace-mode={mode} data-integrated="true">
    {toolbarHost && createPortal(libraryControls, toolbarHost)}
    {error && error !== problem && !draft?.note.problems.includes(error) && <div className="vault-error" role="alert">{error}</div>}
    {records && <section className="vault-recoveries" aria-label="恢复记录"><div><h2>恢复记录</h2><button onClick={() => setRecords(null)}>收起恢复记录</button></div><p>这些是未完成写入、改名或采用磁盘版本前保留的内容。打开后核对，再另存为新笔记。</p>
      {!records.length && <p>没有待恢复的内容。</p>}{records.map((record) => <article key={record.id}><strong>{record.path}</strong><span>{record.created}</span>
        <button disabled={busy || saving} onClick={() => { void recover(record, record.candidate); }}>打开草稿</button>
        {record.original !== null && <button disabled={busy || saving} onClick={() => { void recover(record, record.original!); }}>打开写入前版本</button>}
        {record.observed !== undefined && record.observed !== record.original && <button disabled={busy || saving} onClick={() => { void recover(record, record.observed!); }}>打开外部版本</button>}
      </article>)}</section>}
    {!vault ? <section className="vault-welcome"><h1>把笔记留在自己的书桌</h1><p>选择本机文件夹，打开或新建 Markdown 笔记。</p><p>无需登录。每次保存都写入所选文件夹。</p></section> :
      <div className="vault-layout" data-list-open={listOpen} style={{ gridTemplateColumns: listOpen ? `${Math.min(localState.current.sidebarWidth ?? 220, 260)}px minmax(0, 1fr)` : 'minmax(0, 1fr)' }}>
        {toolbarHost && createPortal(<>        <aside ref={listHost} hidden={!listOpen} id="vault-file-list" className="vault-sidebar" aria-label="笔记列表" onKeyDown={(event) => { if (event.key === 'Escape' && listShown.current) { event.preventDefault(); closeList(); listToggle.current?.focus({ preventScroll: true }); } }}><div className="vault-list-actions"><strong>笔记</strong>
          <button aria-label="关闭笔记列表" title="关闭笔记列表" onClick={() => { closeList(); listToggle.current?.focus({ preventScroll: true }); }}><NoteActionIcon name="close" /></button>
          <button aria-label="新建笔记" title="新建笔记" disabled={busy || saving} onClick={() => setCreating(!creating)}><NoteActionIcon name="add" /></button>
          <button aria-label="刷新笔记列表" title="刷新笔记列表" disabled={busy || saving} onClick={() => { void run(async () => { value(await api.list(vault.token)); }); }}><NoteActionIcon name="refresh" /></button>
        </div>
          {creating && <form className="vault-new" onSubmit={(event) => { event.preventDefault(); void (async () => {
            if (!newName.trim() || !await protect()) return;
            const name = newName.trim().endsWith('.md') ? newName.trim() : `${newName.trim()}.md`;
            update({ note: { path: name, source: '', revision: '', readOnly: false, problems: [] }, source: '', isNew: true, key: ++key.current });
            setCreating(false); setNewName(''); setStatus('未保存'); setError(''); setDiff(false);
          })(); }}><label>名称或库内路径<input autoFocus aria-label="新笔记名称" value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="如：七年级/相反数" /></label><button type="submit" disabled={busy || saving || !newName.trim()}>创建草稿</button></form>}
          <NoteList notes={vault.notes} active={draft?.note.path} busy={busy || saving} duplicates={duplicates} onOpen={openListed} />
          {!vault.notes.length && <p>此库还没有笔记。</p>}
        </aside>
</>, toolbarHost.closest('.desktop-workspace')!)}
        <div className="vault-content">
        {(graphMounted || graphOpen) && <NoteGraph controls={graphControls} listOpen={listOpen} onCloseList={() => closeList()} catalog={catalog} index={linkIndex} selected={noteVisible && draft && !draft.isNew && linkIndex.entries.some((entry) => entry.path === draft.note.path) ? draft.note.path : null} visible={active && graphOpen} onSearch={() => searchHost.current?.querySelector<HTMLButtonElement>('button')?.click()} onSelect={(path) => {
          if (latest.current.busy || latest.current.saving) return false;
          if (path) void openProjected(path);
          else void closeNote();
          return true;
        }} />}
        <section className="vault-paper" hidden={!noteVisible} aria-label="笔记编辑器">
          {draft ? <>
          <header className="vault-note-heading" aria-label="笔记工具栏">
            <div className="vault-note-actions">
              <div className="vault-edit-actions" role="group" aria-label="编辑工具">
              <div className="vault-body-modes" role="group" aria-label="正文模式">
                {([['edit', '编辑正文'], ['preview', '只读预览'], ['live', '实时预览']] as const).map(([value, label]) => <button key={value} className="icon-button" title={label} aria-label={label} aria-pressed={bodyMode === value} disabled={busy || draft.note.readOnly} onClick={() => configure({ editor: { bodyMode: value } })}><NoteActionIcon name={value} /></button>)}
              </div>
              <button className="icon-button" aria-label="笔记属性" title="笔记属性" aria-expanded={metadataOpen} onClick={() => { if (metadataHost.current) { metadataHost.current.open = !metadataHost.current.open; if (metadataHost.current.open) metadataHost.current.querySelector('summary')?.focus(); } }}><NoteActionIcon name="properties" /></button>
              </div>
              <div className="vault-other-actions" role="group" aria-label="笔记工具">
              {returnCount > 0 && <button className="icon-button" aria-label="返回来源" title="返回来源" disabled={busy || saving} onClick={() => { void returnToSource(); }}><NoteActionIcon name="back" /></button>}
              {noteContext?.target && <button className="icon-button vault-locate" aria-label="定位原文" title="定位原文" onClick={() => onLocate?.(noteContext.target!)}><LocateIcon /></button>}
              <NoteMoves key={vault.token} api={api} token={vault.token} note={!draft.isNew ? draft.note : undefined} disabled={busy || saving || !!draft.conflict || bodyMode === 'preview'} refresh={linkIndex} before={async () => await flushNote() && await saveBeforeMove()} run={run} onApplied={appliedMove} />
              <details className="vault-file-info" onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); event.currentTarget.open = false; event.currentTarget.querySelector('summary')?.focus(); } }} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) event.currentTarget.open = false; }}><summary className="icon-button" aria-label="笔记信息" title="笔记信息"><NoteActionIcon name="info" /></summary><NoteInformation source={draft.source} path={draft.note.path} fileMtime={draft.note.fileMtime} /></details>
              {!draft.isNew && <button className="icon-button" aria-label="复制笔记" title="复制笔记" disabled={busy || saving || draft.note.readOnly || !!draft.conflict || bodyMode === 'preview'} onClick={() => { void (async () => { if (await flushNote()) await run(() => copy(false)); })(); }}><NoteActionIcon name="copy" /></button>}
              {onCloseNote && <button className="icon-button vault-close-note" aria-label="收起笔记" title="收起笔记" onClick={() => { void closeNote(); }}><NoteActionIcon name="close" /></button>}
              </div>
            </div>
          </header>
          {(problem || draft.note.problems.length > 0) && <div className="vault-problems" role="alert">{[...new Set([problem, ...draft.note.problems].filter(Boolean))].map((message) => {
            const location = message.match(/^YAML 第 \d+ 行，第 \d+ 列/);
            return location ? <details key={message}><summary>{location[0]}：文件头无效，保存已暂停。</summary><p>{message.slice(location[0].length).replace(/^：/, '')}</p></details> : <p key={message}>{message}</p>;
          })}</div>}
          {!!draft.note.duplicatePaths?.length && <div className="vault-problems"><p>ID 重复：{draft.note.duplicatePaths.join('、')}。不会按 ID 任意选取目标。</p><button hidden={bodyMode === 'preview' || draft.note.readOnly} disabled={busy || saving || draft.note.readOnly || !!draft.conflict} onClick={() => { void run(() => copy(true)); }}>将此副本设为新笔记</button></div>}
          {draft.conflict && <section className="vault-conflict" role="alert"><p>磁盘文件已改变，自动保存已暂停。草稿和磁盘版本均保留。{draft.conflict.error || (!draft.conflict.disk && '文件已删除或暂不可用。')}</p><div>
            <button onClick={() => setDiff(!diff)}>{diff ? '收起差异' : '查看差异'}</button>
            <button hidden={bodyMode === 'preview' || draft.note.readOnly} disabled={busy || saving || !!problem} onClick={() => { void run(async () => { await saveAs(); }); }}>另存草稿为新笔记</button>
            <button hidden={bodyMode === 'preview' || draft.note.readOnly} disabled={busy || saving} onClick={() => { void adoptDisk(); }}>采用磁盘版本</button>
          </div>{diff && <div className="vault-diff"><section><h2>编辑草稿</h2><Difference source={draft.source} other={draft.conflict.disk?.source ?? ''} /></section><section><h2>磁盘版本</h2><Difference source={draft.conflict.disk?.source ?? draft.conflict.error ?? '文件已删除或暂不可用。'} other={draft.source} /></section></div>}</section>}
          {!draft.conflict && draft.paused && <div className="vault-problems"><p>草稿已保留，可重试保存或另存。</p><button hidden={bodyMode === 'preview' || draft.note.readOnly} disabled={busy || saving || !!problem} onClick={() => { void run(async () => { await saveAs(); }); }}>另存草稿为新笔记</button></div>}
          {settingsError && <div className="vault-problems" role="alert">配置未保存：{settingsError}<button onClick={() => { void readPreferences(vault); }}>重新读取配置</button></div>}
          <div className="note-document" onBlurCapture={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setTimeout(() => { void focusFlush.current(); }, 0);
          }}>
            <div className="vault-note-title" title={draft.note.path}><NoteTitle key={`${vault.token}:${draft.key}`} headingRef={noteHeading} flushRef={titleFlush} onDirtyChange={titleChanged} note={draft.note} api={api} token={vault.token} disabled={busy || saving || !!draft.conflict || draft.note.readOnly || bodyMode === 'preview'} before={saveBeforeMove} run={run} onApplied={appliedMove} /></div>
<NoteAnchors catalogTools={<CustomCatalogManager key={vault.token} api={api} token={vault.token} catalog={catalog} disabled={busy || saving || !!draft.conflict || draft.note.readOnly || bodyMode === 'preview'} before={async () => {
              const live = latest.current.draft;
              return !live || !live.isNew && live.source === live.note.source ? true : save();
            }} run={run} onRefresh={onRefreshCatalog ?? (async () => {})} onApplied={async () => {
              const current = latest.current.vault!, item = latest.current.draft;
              if (item && !item.isNew && item.source === item.note.source && !item.conflict) {
                const disk = value(await api.read(current.token, item.note.path));
                update({ ...item, note: disk, source: disk.source });
              }
              value(await api.list(current.token)); await refreshLinks(current);
            }} />} source={draft.source} readOnly={!anchorWritable} catalog={catalog} onChange={edit} onLocate={onLocate ?? (() => {})} onSelect={onSelect ?? (() => {})} /><details ref={metadataHost} className="note-metadata" onToggle={(event) => setMetadataOpen(event.currentTarget.open)}><summary>笔记属性</summary><div className="note-modes">{bodyMode !== 'preview' && !draft.note.readOnly && <label>文件头<select disabled={busy} aria-label="文件头模式" value={frontmatterMode} onChange={(event) => configure({ editor: { frontmatterMode: event.target.value as typeof frontmatterMode } })}><option value="properties">属性预览</option><option value="source">源码</option></select></label>}</div><NoteProperties key={draft.key} showProperties={bodyMode === 'preview' || draft.note.readOnly || frontmatterMode === 'properties'} source={draft.source} readOnly={!anchorWritable} propertyTypes={preferences.settings.propertyTypes} unsupportedPropertyTypes={preferences.unsupportedPropertyTypes} onChange={edit} onTypeChange={(name, type) => configure({ propertyTypes: { [name]: type } })} /></details>
            <SourceEditor onOriginal={openOriginal} key={draft.key} scene={scene} entries={linkIndex.entries} onLink={openLink} source={draft.source} bodyMode={draft.note.readOnly ? 'preview' : bodyMode} frontmatterMode={metadataOpen ? frontmatterMode : 'properties'} readOnly={busy || draft.note.readOnly} position={localState.current.positions[draft.note.path]} onChange={edit} onPosition={position} onSave={() => { if (bodyMode !== 'preview') void save(); }} />
            {(bodyMode === 'preview' || draft.note.readOnly) && <div className="note-preview" aria-label="笔记只读预览"><NoteMarkdown onOriginal={openOriginal} onLink={openLink} offset={headerEnd(draft.source)} source={draft.source.slice(headerEnd(draft.source))} /></div>}
          </div>
          <div className="vault-note-footer"><span role="status" className="vault-save-status">{status === '已保存' ? '已保存到本地' : status}</span>
            {draft.paused && !draft.conflict && bodyMode !== 'preview' && !draft.note.readOnly && <button className="vault-save" disabled={busy || saving} onClick={() => { void save(); }}>重试保存</button>}
          </div>
          <NoteLinks catalog={catalog} key={draft.key} index={linkIndex} source={draft.source} path={draft.isNew ? '' : draft.note.path} readOnly={busy || draft.note.readOnly || bodyMode === 'preview'} request={linkRequest} onNavigate={(path) => { void navigate(path); }} onRepair={(reference, replacement, expectedSource) => {
            try { edit(replaceReference(latest.current.draft!.source, reference, replacement, expectedSource)); return true; } catch (cause) { setError((cause as Error).message); return false; }
          }} onCreate={createLinked} />
        </> : <div className="vault-empty"><NoteMoves key={vault.token} api={api} token={vault.token} disabled={busy || saving} refresh={linkIndex} before={async () => true} run={run} onApplied={appliedMove} />{returnCount > 0 && <button disabled={busy || saving} onClick={() => { void returnToSource(); }}>返回来源</button>}<h1>从课本打开笔记</h1><p>点击课本旁的笔记图标，或从笔记列表中选择。</p><button onClick={() => setListOpen(true)}>笔记列表</button></div>}</section>
        </div>
      </div>}
    <dialog ref={guardDialog} className="vault-guard" onCancel={(event) => { event.preventDefault(); answer('cancel'); }}><h2>{guard === 'disk' ? '采用磁盘版本前保留草稿' : '还有未保存的草稿'}</h2><p>{guard === 'disk' ? '草稿将先写入恢复记录。也可以先另存为新笔记。取消会保留当前编辑现场。' : '保存后继续，或保留当前编辑现场。'}</p><div>
      <button onClick={() => answer('cancel')}>取消</button><button onClick={() => answer('discard')}>{guard === 'disk' ? '保留恢复记录并采用磁盘' : '放弃草稿并继续'}</button><button disabled={guard === 'disk' && !!problem} onClick={() => answer('save')}>{guard === 'disk' ? '另存草稿并采用磁盘' : '保存并继续'}</button>
    </div></dialog>
  </main>;
}
