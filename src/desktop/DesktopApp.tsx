import { useEffect, useRef, useState } from 'react';
import type { DesktopApi, Note, Position, Recovery, Result, VaultChange, VaultState, VaultView, SettingsView, SettingsPatch } from '../../desktop/contracts';
import { freshIdentity as freshCopy, rebaseSaved, saveProblem } from '../../desktop/format';
import { SourceEditor, headerEnd } from './SourceEditor';
import { NoteProperties } from './NoteProperties';
import { NoteMarkdown } from './note-markdown';
import './desktop.css';

declare global { interface Window { textbookDesktop?: DesktopApi } }

function value<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.error);
  return result.value;
}
type Conflict = { disk: Note | null; error?: string };
type Draft = { note: Note; source: string; isNew: boolean; key: number; conflict?: Conflict; paused?: boolean; freshOnSave?: boolean; rebase?: { sent: string; saved: string } };
type Choice = 'save' | 'discard' | 'cancel';
function Difference({ source, other }: { source: string; other: string }) {
  const lines = source.split('\n'), compared = other.split('\n');
  let start = 0, end = 0;
  while (start < Math.min(lines.length, compared.length) && lines[start] === compared[start]) start++;
  while (end < Math.min(lines.length, compared.length) - start && lines[lines.length - end - 1] === compared[compared.length - end - 1]) end++;
  return <pre>{lines.map((line, index) => <span className={index >= start && index < lines.length - end ? 'vault-diff-changed' : undefined} key={index}>{line}{'\n'}</span>)}</pre>;
}
export function DesktopApp() {
  const api = window.textbookDesktop!;
  const [preferences, setPreferences] = useState<SettingsView>({ revision: null, settings: { editor: { bodyMode: 'live', frontmatterMode: 'properties' }, propertyTypes: {} } });
  const [settingsError, setSettingsError] = useState('');
  const settingsRef = useRef<SettingsView | null>(null);
  const settingsQueue = useRef<Promise<void>>(Promise.resolve());
  const { bodyMode, frontmatterMode } = preferences.settings.editor;
  const [vault, setVault] = useState<VaultView | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [guard, setGuard] = useState<'leave' | 'disk' | null>(null);
  const [diff, setDiff] = useState(false);
  const [records, setRecords] = useState<Recovery[] | null>(null);
  const [duplicates, setDuplicates] = useState<Record<string, string[]>>({});
  const guardResolve = useRef<((choice: Choice) => void) | null>(null);
  const guardDialog = useRef<HTMLDialogElement>(null);
  const localState = useRef<VaultState>({ positions: {} });
  const latest = useRef({ vault, draft, busy, saving });
  latest.current = { vault, draft, busy, saving };
  const inFlight = useRef<Promise<boolean> | null>(null);
  const deferredChange = useRef<VaultChange | null>(null);
  const stateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const key = useRef(0);
  const dirty = !!draft && (draft.isNew || draft.source !== draft.note.source);
  const problem = draft && !draft.note.readOnly ? saveProblem(draft.source) : '';

  function update(next: Draft | null) {
    latest.current.draft = next; setDraft(next);
    api.setDirty(latest.current.saving || !!next && (next.isNew || next.source !== next.note.source));
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
    update({ note, source: note.source, isNew: false, key: ++key.current });
    setDiff(false); setStatus(note.readOnly ? '只读' : '已从磁盘读取');
  }
  async function openNote(current: VaultView, path: string) {
    const note = value(await api.read(current.token, path));
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
  async function showVault(current: VaultView) {
    if (stateTimer.current) clearTimeout(stateTimer.current);
    localState.current = current.state;
    latest.current.vault = current;
    setVault(current); setPreferences({ revision: null, settings: { editor: { bodyMode: 'live', frontmatterMode: 'properties' }, propertyTypes: {} } }); update(null); setCreating(false); setRecords(null); setDuplicates({}); setStatus('');
    setError(current.notice ?? '');
    await readPreferences(current);
    if (current.state.activePath && current.notes.includes(current.state.activePath)) await openNote(current, current.state.activePath);
    value(await api.list(current.token));
    const recoveries = value(await api.recoveries(current.token));
    if (recoveries.length) setRecords(recoveries);
  }
  async function changed(change: VaultChange) {
    const current = latest.current.vault;
    if (current?.token !== change.token) return;
    if (change.error) { setError(`笔记库监听失败：${change.error}；草稿已保留，可刷新重试。`); return; }
    setVault((previous) => previous?.token === change.token ? { ...previous, notes: change.notes } : previous);
    setDuplicates(change.duplicates);
    if (latest.current.saving || latest.current.busy) { deferredChange.current = change; return; }
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
  useEffect(() => { api.setDirty(dirty || saving); }, [dirty, saving, api]);
  useEffect(() => {
    if (!dirty && !saving) return;
    const prevent = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', prevent);
    return () => window.removeEventListener('beforeunload', prevent);
  }, [dirty, saving]);
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
        update({ ...live, note, source: merged ?? live.source, isNew: false, freshOnSave: false, rebase: merged === undefined ? rebase : undefined });
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
  async function ask(kind: 'leave' | 'disk') {
    if (guardResolve.current) return 'cancel';
    setGuard(kind);
    const choice = await new Promise<Choice>((resolve) => { guardResolve.current = resolve; });
    setGuard(null); return choice;
  }
  async function protect() {
    if (inFlight.current) await inFlight.current;
    const current = latest.current.draft;
    if (!current || !current.isNew && current.source === current.note.source) return true;
    const choice = await ask('leave');
    return choice === 'save' ? save() : choice === 'discard';
  }
  function answer(choice: Choice) {
    guardDialog.current?.close(); guardResolve.current?.(choice); guardResolve.current = null;
  }
  async function run(action: () => Promise<void>) {
    if (latest.current.busy || latest.current.saving) return;
    latest.current.busy = true; setBusy(true); setError('');
    try { await action(); }
    catch (cause) { setError((cause as Error).message); }
    finally { latest.current.busy = false; setBusy(false); flushChange(); }
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
  return <main className="vault-app">
    <header className="vault-toolbar"><strong>课本解读</strong><span className="vault-name">{vault?.name ?? '本地笔记'}</span>
      {vault && <button disabled={busy || saving} onClick={() => { void run(async () => setRecords(value(await api.recoveries(vault.token)))); }}>恢复记录</button>}
      <button disabled={busy || saving} onClick={() => { void (async () => {
        if (!await protect()) return;
        await run(async () => { await remember(); const current = value(await api.chooseVault()); if (current) await showVault(current); });
      })(); }}>{vault ? '切换笔记库' : '选择笔记库'}</button>
    </header>
    {error && <div className="vault-error" role="alert">{error}</div>}
    {records && <section className="vault-recoveries" aria-label="恢复记录"><div><h2>恢复记录</h2><button onClick={() => setRecords(null)}>收起恢复记录</button></div><p>这些是未完成写入或采用磁盘版本前保留的内容。打开后核对，再另存为新笔记。</p>
      {!records.length && <p>没有待恢复的内容。</p>}{records.map((record) => <article key={record.id}><strong>{record.path}</strong><span>{record.created}</span>
        <button disabled={busy || saving} onClick={() => { void recover(record, record.candidate); }}>打开草稿</button>
        {record.original !== null && <button disabled={busy || saving} onClick={() => { void recover(record, record.original!); }}>打开写入前版本</button>}
        {record.observed !== undefined && record.observed !== record.original && <button disabled={busy || saving} onClick={() => { void recover(record, record.observed!); }}>打开外部版本</button>}
      </article>)}</section>}
    {!vault ? <section className="vault-welcome"><h1>把笔记留在自己的书桌</h1><p>选择本机文件夹，打开或新建 Markdown 笔记。</p><p>无需登录。每次保存都写入所选文件夹。</p></section> :
      <div className="vault-layout" style={{ gridTemplateColumns: `${localState.current.sidebarWidth ?? 240}px minmax(0, 1fr)` }}>
        <aside className="vault-sidebar" aria-label="笔记列表"><div className="vault-list-actions">
          <button disabled={busy || saving} onClick={() => setCreating(!creating)}>新建笔记</button>
          <button disabled={busy || saving} onClick={() => { void run(async () => { value(await api.list(vault.token)); }); }}>刷新</button>
        </div>
          {creating && <form className="vault-new" onSubmit={(event) => { event.preventDefault(); void (async () => {
            if (!newName.trim() || !await protect()) return;
            const name = newName.trim().endsWith('.md') ? newName.trim() : `${newName.trim()}.md`;
            update({ note: { path: name, source: '', revision: '', readOnly: false, problems: [] }, source: '', isNew: true, key: ++key.current });
            setCreating(false); setNewName(''); setStatus('未保存'); setError(''); setDiff(false);
          })(); }}><label>名称或库内路径<input autoFocus aria-label="新笔记名称" value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="如：七年级/相反数" /></label><button type="submit" disabled={busy || saving || !newName.trim()}>创建草稿</button></form>}
          <nav>{vault.notes.map((path) => <button key={path} disabled={busy || saving} aria-current={draft?.note.path === path ? 'page' : undefined} onClick={() => { void (async () => {
            if (latest.current.draft?.note.path === path && !latest.current.draft.isNew) return;
            if (!await protect()) return;
            await run(async () => { await remember(); await openNote(vault, path); });
          })(); }}>{path.slice(0, -3)}{duplicates[path] && <small> ID 冲突</small>}</button>)}</nav>
          {!vault.notes.length && <p>此库还没有笔记。</p>}
        </aside>
        <section className="vault-paper" aria-label="笔记编辑器">{draft ? <>
          <div className="vault-note-heading"><h1>{draft.note.path.slice(0, -3)}</h1><span role="status">{status}</span>
            <button hidden={bodyMode === 'preview' || draft.note.readOnly} disabled={busy || saving || draft.note.readOnly || !!draft.conflict} onClick={() => { void save(); }}>保存</button>
            {!draft.isNew && bodyMode !== 'preview' && !draft.note.readOnly && <button disabled={busy || saving || draft.note.readOnly || !!draft.conflict} onClick={() => { void run(() => copy(false)); }}>复制笔记</button>}
          </div>
          {draft.note.fileMtime && <details className="vault-file-info"><summary>文件信息</summary><p>文件修改时间：{new Date(draft.note.fileMtime).toLocaleString()}（独立于 YAML 中的笔记更新时间）</p></details>}
          {(problem || draft.note.problems.length > 0) && <div className="vault-problems" role="note">{[...new Set([problem, ...draft.note.problems].filter(Boolean))].map((message) => <p key={message}>{message}</p>)}</div>}
          {!!draft.note.duplicatePaths?.length && <div className="vault-problems"><p>ID 重复：{draft.note.duplicatePaths.join('、')}。不会按 ID 任意选取目标。</p><button hidden={bodyMode === 'preview' || draft.note.readOnly} disabled={busy || saving || draft.note.readOnly || !!draft.conflict} onClick={() => { void run(() => copy(true)); }}>将此副本设为新笔记</button></div>}
          {draft.conflict && <section className="vault-conflict" role="alert"><p>磁盘文件已改变，自动保存已暂停。草稿和磁盘版本均保留。{draft.conflict.error || (!draft.conflict.disk && '文件已删除或暂不可用。')}</p><div>
            <button onClick={() => setDiff(!diff)}>{diff ? '收起差异' : '查看差异'}</button>
            <button hidden={bodyMode === 'preview' || draft.note.readOnly} disabled={busy || saving || !!problem} onClick={() => { void run(async () => { await saveAs(); }); }}>另存草稿为新笔记</button>
            <button hidden={bodyMode === 'preview' || draft.note.readOnly} disabled={busy || saving} onClick={() => { void adoptDisk(); }}>采用磁盘版本</button>
          </div>{diff && <div className="vault-diff"><section><h2>编辑草稿</h2><Difference source={draft.source} other={draft.conflict.disk?.source ?? ''} /></section><section><h2>磁盘版本</h2><Difference source={draft.conflict.disk?.source ?? draft.conflict.error ?? '文件已删除或暂不可用。'} other={draft.source} /></section></div>}</section>}
          {!draft.conflict && draft.paused && <div className="vault-problems"><p>草稿已保留，可重试保存或另存。</p><button hidden={bodyMode === 'preview' || draft.note.readOnly} disabled={busy || saving || !!problem} onClick={() => { void run(async () => { await saveAs(); }); }}>另存草稿为新笔记</button></div>}
          <div className="note-modes"><label>正文<select aria-label="正文模式" value={bodyMode} onChange={(event) => configure({ editor: { bodyMode: event.target.value as typeof bodyMode } })}><option value="edit">编辑</option><option value="preview">预览</option><option value="live">实时预览</option></select></label>
            {bodyMode !== 'preview' && !draft.note.readOnly && <label>文件头<select aria-label="文件头模式" value={frontmatterMode} onChange={(event) => configure({ editor: { frontmatterMode: event.target.value as typeof frontmatterMode } })}><option value="properties">属性预览</option><option value="source">源码</option></select></label>}
          </div>
          {settingsError && <div className="vault-problems" role="alert">配置未保存：{settingsError}<button onClick={() => { void readPreferences(vault); }}>重新读取配置</button></div>}
          <div className="note-document">
            <div><NoteProperties key={draft.key} showProperties={bodyMode === 'preview' || draft.note.readOnly || frontmatterMode === 'properties'} source={draft.source} readOnly={busy || draft.note.readOnly || bodyMode === 'preview'} propertyTypes={preferences.settings.propertyTypes} unsupportedPropertyTypes={preferences.unsupportedPropertyTypes} onChange={edit} onTypeChange={(name, type) => configure({ propertyTypes: { [name]: type } })} /></div>
            <SourceEditor key={draft.key} source={draft.source} bodyMode={draft.note.readOnly ? 'preview' : bodyMode} frontmatterMode={frontmatterMode} readOnly={busy || draft.note.readOnly} position={localState.current.positions[draft.note.path]} onChange={edit} onPosition={position} onSave={() => { if (bodyMode !== 'preview') void save(); }} />
            {(bodyMode === 'preview' || draft.note.readOnly) && <div className="note-preview" aria-label="笔记只读预览"><NoteMarkdown source={draft.source.slice(headerEnd(draft.source))} /></div>}
          </div>
        </> : <div className="vault-empty"><h1>选一篇笔记，继续写</h1><p>手动创建的 .md 文件也会出现在左侧。</p></div>}</section>
      </div>}
    <dialog ref={guardDialog} className="vault-guard" onCancel={(event) => { event.preventDefault(); answer('cancel'); }}><h2>{guard === 'disk' ? '采用磁盘版本前保留草稿' : '还有未保存的草稿'}</h2><p>{guard === 'disk' ? '草稿将先写入恢复记录。也可以先另存为新笔记。取消会保留当前编辑现场。' : '保存后继续，或保留当前编辑现场。'}</p><div>
      <button onClick={() => answer('cancel')}>取消</button><button onClick={() => answer('discard')}>{guard === 'disk' ? '保留恢复记录并采用磁盘' : '放弃草稿并继续'}</button><button disabled={guard === 'disk' && !!problem} onClick={() => answer('save')}>{guard === 'disk' ? '另存草稿并采用磁盘' : '保存并继续'}</button>
    </div></dialog>
  </main>;
}
