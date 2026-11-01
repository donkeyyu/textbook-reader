import { useEffect, useRef, useState } from 'react';
import type { DesktopApi, Note, Position, Result, VaultState, VaultView } from '../../desktop/contracts';
import { SourceEditor } from './SourceEditor';
import './desktop.css';

declare global { interface Window { textbookDesktop?: DesktopApi } }

function value<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.error);
  return result.value;
}
type Draft = { note: Note; source: string; isNew: boolean; key: number };
export function DesktopApp() {
  const api = window.textbookDesktop!;
  const [vault, setVault] = useState<VaultView | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [guard, setGuard] = useState(false);
  const guardResolve = useRef<((choice: 'save' | 'discard' | 'cancel') => void) | null>(null);
  const guardDialog = useRef<HTMLDialogElement>(null);
  const localState = useRef<VaultState>({ positions: {} });
  const latest = useRef({ vault, draft, busy });
  latest.current = { vault, draft, busy };
  const stateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirty = !!draft && (draft.isNew || draft.source !== draft.note.source);
  const key = useRef(0);

  function edit(source: string) {
    api.setDirty(true);
    const previous = latest.current.draft;
    const next = previous ? { ...previous, source } : null;
    latest.current = { ...latest.current, draft: next };
    setDraft(next);
    setStatus('未保存');
  }
  async function remember() {
    const current = latest.current.vault;
    if (!current) return;
    value(await api.saveState(current.token, localState.current));
  }
  function position(next: Position) {
    const current = latest.current.draft;
    if (!current || current.isNew) return;
    localState.current.positions[current.note.path] = next;
    if (stateTimer.current) clearTimeout(stateTimer.current);
    stateTimer.current = setTimeout(() => { void remember().catch((cause: Error) => setError(cause.message)); }, 180);
  }
  async function openNote(current: VaultView, path: string) {
    const note = value(await api.read(current.token, path));
    localState.current.activePath = path;
    const next = { note, source: note.source, isNew: false, key: ++key.current };
    latest.current.draft = next;
    setDraft(next);
    api.setDirty(false);
    setStatus(note.readOnly ? '只读' : '已从磁盘读取');
    value(await api.saveState(current.token, localState.current));
  }
  async function showVault(current: VaultView) {
    if (stateTimer.current) clearTimeout(stateTimer.current);
    localState.current = current.state;
    latest.current = { ...latest.current, vault: current, draft: null };
    setVault(current); setDraft(null); setCreating(false); setStatus('');
    api.setDirty(false);
    setError(current.notice ?? '');
    if (current.state.activePath && current.notes.includes(current.state.activePath)) await openNote(current, current.state.activePath);
  }
  useEffect(() => {
    document.documentElement.dataset.uiStyle = 'island';
    let active = true;
    void api.restore().then(async (result) => {
      if (!active) return;
      const current = value(result);
      if (current) await showVault(current);
    }).catch((cause: Error) => { if (active) setError(cause.message); }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; if (stateTimer.current) clearTimeout(stateTimer.current); };
  }, []);
  useEffect(() => { api.setDirty(dirty || busy && !!draft); }, [dirty, busy, draft, api]);
  useEffect(() => {
    if (!dirty) return;
    const prevent = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', prevent);
    return () => window.removeEventListener('beforeunload', prevent);
  }, [dirty]);
  useEffect(() => { if (guard) guardDialog.current?.showModal(); }, [guard]);

  async function save() {
    const { vault: current, draft: item, busy } = latest.current;
    if (!current || !item || busy || item.note.readOnly) return false;
    latest.current.busy = true;
    setBusy(true); setError(''); setStatus('保存中…');
    try {
      const note = value(await api.save(current.token, item.note.path, item.source, item.isNew ? null : item.note.revision));
      // Native edits can arrive before React renders the busy state. Keep those edits.
      const newer = latest.current.draft;
      const source = newer && newer.source !== item.source ? newer.source : note.source;
      const next = { ...item, note, source, isNew: false };
      latest.current.draft = next;
      setDraft(next);
      localState.current.activePath = note.path;
      setVault((previous) => previous ? { ...previous, notes: [...new Set([...previous.notes, note.path])].sort() } : null);
      api.setDirty(source !== note.source);
      try { await remember(); }
      catch (cause) { setError(`正文已保存，但本机位置未保存：${(cause as Error).message}`); }
      setStatus(source === note.source ? '已保存' : '未保存');
      return source === note.source;
    } catch (cause) { setError((cause as Error).message); setStatus('保存失败 · 草稿已保留'); api.setDirty(true); return false; }
    finally { latest.current.busy = false; setBusy(false); }
  }
  async function protect() {
    const current = latest.current.draft;
    if (!current || !current.isNew && current.source === current.note.source) return true;
    setGuard(true);
    const choice = await new Promise<'save' | 'discard' | 'cancel'>((resolve) => { guardResolve.current = resolve; });
    setGuard(false);
    return choice === 'save' ? save() : choice === 'discard';
  }
  function answer(choice: 'save' | 'discard' | 'cancel') {
    guardDialog.current?.close(); guardResolve.current?.(choice); guardResolve.current = null;
  }
  async function run(action: () => Promise<void>) {
    if (latest.current.busy) return;
    latest.current.busy = true;
    setBusy(true); setError('');
    try { await action(); }
    catch (cause) { setError((cause as Error).message); }
    finally { latest.current.busy = false; setBusy(false); }
  }
  return <main className="vault-app">
    <header className="vault-toolbar"><strong>课本解读</strong><span className="vault-name">{vault?.name ?? '本地笔记'}</span>
      <button disabled={busy} onClick={() => { void (async () => {
        if (!await protect()) return;
        await run(async () => { await remember(); const current = value(await api.chooseVault()); if (current) await showVault(current); });
      })(); }}> {vault ? '切换笔记库' : '选择笔记库'}</button>
    </header>
    {error && <div className="vault-error" role="alert">{error}</div>}
    {!vault ? <section className="vault-welcome"><h1>把笔记留在自己的书桌</h1><p>选择本机文件夹，打开或新建 Markdown 笔记。</p><p>无需登录。每次保存都写入所选文件夹。</p></section> :
      <div className="vault-layout" style={{ gridTemplateColumns: `${localState.current.sidebarWidth ?? 240}px minmax(0, 1fr)` }}>
        <aside className="vault-sidebar" aria-label="笔记列表"><div className="vault-list-actions">
          <button disabled={busy} onClick={() => { setCreating(!creating); }}>新建笔记</button>
          <button disabled={busy} onClick={() => { void run(async () => { const notes = value(await api.list(vault.token)); setVault({ ...vault, notes }); }); }}>刷新</button>
        </div>
          {creating && <form className="vault-new" onSubmit={(event) => { event.preventDefault(); void (async () => {
            if (!newName.trim() || !await protect()) return;
            const name = newName.trim().endsWith('.md') ? newName.trim() : `${newName.trim()}.md`;
            const note: Note = { path: name, source: '', revision: '', readOnly: false, problems: [] };
            setDraft({ note, source: '', isNew: true, key: ++key.current }); api.setDirty(true);
            setCreating(false); setNewName(''); setStatus('未保存'); setError('');
          })(); }}><label>名称或库内路径<input autoFocus aria-label="新笔记名称" value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="如：七年级/相反数" /></label><button type="submit" disabled={busy || !newName.trim()}>创建草稿</button></form>}
          <nav>{vault.notes.map((path) => <button key={path} disabled={busy} aria-current={draft?.note.path === path ? 'page' : undefined} onClick={() => { void (async () => {
            if (draft?.note.path === path && !draft.isNew) return;
            if (!await protect()) return;
            await run(async () => { await remember(); await openNote(vault, path); });
          })(); }}>{path.slice(0, -3)}</button>)}</nav>
          {!vault.notes.length && <p>此库还没有笔记。</p>}
        </aside>
        <section className="vault-paper" aria-label="笔记编辑器">{draft ? <>
          <div className="vault-note-heading"><h1>{draft.note.path.slice(0, -3)}</h1><span role="status">{status}</span>
            <button disabled={busy || draft.note.readOnly} onClick={() => { void save(); }}>保存</button></div>
          {draft.note.problems.length > 0 && <div className="vault-problems" role="note">{draft.note.problems.map((problem) => <p key={problem}>{problem}</p>)}</div>}
          <SourceEditor key={draft.key} source={draft.source} readOnly={busy || draft.note.readOnly} position={localState.current.positions[draft.note.path]} onChange={edit} onPosition={position} onSave={() => { void save(); }} />
        </> : <div className="vault-empty"><h1>选一篇笔记，继续写</h1><p>手动创建的 .md 文件也会出现在左侧。</p></div>}</section>
      </div>}
    <dialog ref={guardDialog} className="vault-guard" onCancel={(event) => { event.preventDefault(); answer('cancel'); }}><h2>还有未保存的草稿</h2><p>保存后继续，或保留当前编辑现场。</p><div>
      <button onClick={() => answer('cancel')}>取消</button><button onClick={() => answer('discard')}>放弃草稿并继续</button><button onClick={() => answer('save')}>保存并继续</button>
    </div></dialog>
  </main>;
}
