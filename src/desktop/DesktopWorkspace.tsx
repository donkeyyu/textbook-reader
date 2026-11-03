import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { originalTargets } from '../../desktop/original-links';
import { DesktopApp } from './DesktopApp';
import { DesktopTextbooks } from './DesktopTextbooks';
import { anchorKey, resolveAnchor, type AnchorTarget, type Catalog, type Rect } from '../../desktop/anchors';
import type { LinkEntry } from '../../desktop/links';
import type { LocalReaderTools, LocalReadingPosition } from '../reader/Reader';
import type { AnchorSession, AnchorBridge, LocateRequest } from './anchor-session';
import { AnchorRegions, type SelectionPage } from './AnchorRegions';
import { Candidate } from './NoteLinks';
import { noteName } from './NoteMoves';
import { bookTitle, getPage } from '../textbook/catalog';
import { groupMarkers } from '../reader/book/marker-groups';
import './textbooks.css';
import './anchors.css';
import './workspace.css';

type Mode = 'book' | 'graph';
type Selection = { session: AnchorSession; items: SelectionPage[]; index?: number; drawing?: number; selected: string; name: string; error: string };
const emptySession: AnchorSession = { vaultToken: '', anchors: undefined, writable: false, index: { entries: [], problems: [] } };
// Both editor and reader stay mounted across full-screen and split views.
export function DesktopWorkspace() {
  const [mode, setMode] = useState<Mode>('book');
  const [noteOpen, setNoteOpen] = useState(false);
  const [bookOpen, setBookOpen] = useState(false);
  const [windowWidth, setWindowWidth] = useState(innerWidth);
  const [toolbarHost, setToolbarHost] = useState<HTMLDivElement | null>(null);
  const [shelfRequest, setShelfRequest] = useState(0);
  const narrow = windowWidth <= 1000;
  const bottom = mode === 'book' && windowWidth <= 1100;
  const bookVisible = mode === 'book' || bookOpen;
  const notesVisible = mode === 'book' ? noteOpen : !narrow || !bookOpen;
  const split = bookVisible && notesVisible;
  const noteActive = noteOpen;
  const minimumShare = bottom ? 25 : Math.min(50, Math.ceil(320 / Math.max(1, windowWidth - 10) * 100));
  const sizeKey = bottom ? 'bottom' : mode;
  const [chooseRequest, setChooseRequest] = useState(0);
  const [openRequest, setOpenRequest] = useState<{ path: string; serial: number; vaultToken: string; expectedId?: string }>();
  const [locate, setLocate] = useState<LocateRequest>();
  const [original, setOriginal] = useState<{ targets: AnchorTarget[]; href: string; key?: number; index: number; previous: { mode: Mode; noteOpen: boolean; bookOpen: boolean; locate?: LocateRequest; position?: LocalReadingPosition | null; sourceScroll: { element: HTMLElement; top: number; left: number }[] } }>();
  const capture = useRef<(() => LocalReadingPosition | null) | null>(null);
  const [restore, setRestore] = useState<LocalReaderTools['request']>();
  const [session, setSession] = useState<AnchorSession>(emptySession);
  const bridge: AnchorBridge = useRef(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const catalogRequest = useRef(0);
  const catalogRefreshing = useRef({ token: '', count: 0 });
  const [selection, setSelection] = useState<Selection>();
  const [candidates, setCandidates] = useState<LinkEntry[]>();
  const dialog = useRef<HTMLDialogElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const shares = useRef({ book: Math.max(66, (1 - 500 / Math.max(1, innerWidth - 10)) * 100), graph: 60, bottom: 55 });
  const preferredPage = useRef<number | undefined>(undefined);
  const pendingNote = useRef<{ path: string; vaultToken: string; page?: number } | undefined>(undefined);
  const locateSerial = useRef(0);
  const token = useRef(''); token.current = session.vaultToken;
  useEffect(() => {
    const changed = () => setWindowWidth(innerWidth);
    window.addEventListener('resize', changed); return () => window.removeEventListener('resize', changed);
  }, []);
  useLayoutEffect(() => { resize(shares.current[sizeKey]); }, [split, minimumShare, sizeKey]);
  useEffect(() => {
    catalogRequest.current++;
    pendingNote.current = undefined; preferredPage.current = undefined;
    setCatalog(null); setNoteOpen(false); setBookOpen(false); setRestore(undefined); setOriginal(undefined); setSelection(undefined); setLocate(undefined); setCandidates(undefined); dialog.current?.close();
    if (!session.vaultToken) return;
    let active = true, polling = false;
    const read = async () => {
      if (polling || catalogRefreshing.current.token === session.vaultToken && catalogRefreshing.current.count) return;
      polling = true; const serial = ++catalogRequest.current;
      try {
        const result = await window.textbookResources!.catalog(session.vaultToken);
        if (active && serial === catalogRequest.current) setCatalog((previous) => result.ok ? JSON.stringify(previous) === JSON.stringify(result.value) ? previous : result.value as Catalog : null);
      } finally { polling = false; }
    };
    void read(); const timer = setInterval(() => { void read(); }, 1200);
    return () => { active = false; clearInterval(timer); };
  }, [session.vaultToken]);
  const refreshCatalog = useCallback(async () => {
    const vaultToken = token.current;
    if (!vaultToken) return;
    const serial = ++catalogRequest.current;
    if (catalogRefreshing.current.token !== vaultToken) catalogRefreshing.current = { token: vaultToken, count: 0 };
    catalogRefreshing.current.count++;
    try {
      const result = await window.textbookResources!.catalog(vaultToken);
      if (token.current !== vaultToken || serial !== catalogRequest.current) return;
      if (!result.ok) { setCatalog(null); throw new Error(result.error); }
      setCatalog(result.value as Catalog);
    } finally { if (catalogRefreshing.current.token === vaultToken) catalogRefreshing.current.count--; }
  }, []);
  const onCatalog = useCallback((_next: Catalog, vaultToken: string) => {
    if (token.current === vaultToken) void refreshCatalog().catch(() => { if (token.current === vaultToken) setCatalog(null); });
  }, [refreshCatalog]);
  const located = useCallback((target: AnchorTarget) => {
    setOriginal(undefined); setRestore(undefined);
    setLocate({ ...target, serial: ++locateSerial.current, vaultToken: token.current });
    setBookOpen(true);
  }, []);
  function locateOriginal(targets: AnchorTarget[], href: string) {
    setOriginal({ targets, href, key: session.key, index: 0, previous: original?.previous ?? { mode, noteOpen, bookOpen, locate, position: capture.current?.(), sourceScroll: [...body.current?.querySelectorAll<HTMLElement>('.workspace-notes .vault-paper, .workspace-notes .note-preview, .workspace-notes .cm-scroller') ?? []].map((element) => ({ element, top: element.scrollTop, left: element.scrollLeft })) } });
    setRestore(undefined);
    setLocate({ ...targets[0]!, serial: ++locateSerial.current, vaultToken: token.current, origin: 'relation' });
    setBookOpen(true);
  }
  function returnOriginal() {
    if (!original) return;
    setMode(original.previous.mode); setNoteOpen(original.previous.noteOpen); setBookOpen(original.previous.bookOpen);
    setLocate(original.previous.locate);
    setRestore(original.previous.position ? { ...original.previous.position, rects: [], serial: ++locateSerial.current } : undefined);
    setOriginal(undefined);
    requestAnimationFrame(() => {
      for (const saved of original.previous.sourceScroll) if (saved.element.isConnected) saved.element.scrollTo(saved.left, saved.top);
      [...body.current?.querySelectorAll<HTMLElement>('[data-original-link]') ?? []].find((element) => element.dataset.originalLink === original.href)?.focus({ preventScroll: true });
    });
  }
  function open(path: string, vaultToken = session.vaultToken, expectedId?: string) {
    pendingNote.current = { path, vaultToken, page: preferredPage.current };
    preferredPage.current = undefined;
    setOpenRequest((previous) => ({ path, vaultToken, expectedId, serial: (previous?.serial ?? 0) + 1 })); setNoteOpen(true);
  }
  const byPage = useMemo(() => {
    const map = new Map<number, { entry: LinkEntry; target: AnchorTarget }[]>();
    for (const entry of session.index.entries) for (const anchor of entry.anchors) {
      const { target } = resolveAnchor(anchor, catalog);
      if (target) map.set(target.page, [...map.get(target.page) ?? [], { entry, target }]);
    }
    return map;
  }, [session.index, catalog]);
  const noteTargets = useMemo(() => (Array.isArray(session.anchors) ? session.anchors : [])
    .flatMap((anchor) => { const target = resolveAnchor(anchor, catalog).target; return target ? [target] : []; }), [session.anchors, catalog]);
  function choose(entries: LinkEntry[], page?: number) {
    preferredPage.current = page;
    const unique = [...new Map(entries.map((entry) => [entry.path, entry])).values()];
    if (unique.length === 1) open(unique[0]!.path, session.vaultToken, unique[0]!.id);
    else { setCandidates(unique); dialog.current?.showModal(); }
  }
  function begin(index?: number) {
    if (!catalog) return;
    const anchor = index === undefined || !Array.isArray(session.anchors) ? null : session.anchors[index];
    const { target } = resolveAnchor(anchor, catalog);
    if (index !== undefined && !target) return;
    const position = capture.current?.();
    const page = target?.page ?? position?.page ?? catalog.pages[0]?.page;
    if (page === undefined) return;
    setSelection({ session, index, items: target ? [{ textbook: target.textbook, pdf_page: target.page, rects: target.rects.map((rect) => [...rect]) }] : [], drawing: page, selected: target?.rects.length ? '0:0' : '', name: '教材笔记', error: '' });
    setBookOpen(true);
    if (target) located(target);
    else if (!position) located({ textbook: catalog.textbookId, page, rects: [] });
  }
  async function apply(create: boolean) {
    if (!selection || !bridge.current) return;
    const items = selection.items.filter((item) => item.rects.length);
    if (!items.length && selection.index === undefined) { setSelection({ ...selection, error: '请先框选至少一个区域。' }); return; }
    const ok = await bridge.current({ session: selection.session, ...(create ? { create: { name: selection.name, anchors: items } } : selection.index === undefined ? { append: items } : { index: selection.index, rects: items[0]?.rects }) });
    if (ok) { setSelection(undefined); setNoteOpen(true); }
    else setSelection((previous) => previous ? { ...previous, error: '笔记状态或位置已改变，未覆盖当前内容。请取消后重新选择；选择草稿仍在。' } : previous);
  }
  const tools: LocalReaderTools = {
    capture,
    request: restore ?? (locate?.vaultToken === session.vaultToken ? locate : undefined),
    page: (page, width) => <>
      {(() => {
        const entries = byPage.get(page) ?? [];
        const dimensions = getPage(page);
        const height = width * dimensions.height / dimensions.width;
        return groupMarkers(entries.map(({ target }, index) => ({ id: String(index), x: width, y: (target.rects[0]?.[1] ?? .03) * height })), 40).map((group) => {
          const items = [...new Map(group.map(({ id }) => { const { entry } = entries[Number(id)]!; return [entry.path, entry] as const; })).values()];
          const title = items.length === 1 ? noteName(items[0]!.path) : `${items.length} 篇笔记：${items.map((entry) => noteName(entry.path)).join('；')}`;
          return <button key={group[0]!.id} className="desktop-anchor-mark" aria-label={`打开笔记：${title}`} title={title}
            aria-pressed={noteActive && items.some((entry) => entry.path === session.path)}
            style={{ top: `${group[0]!.y / height * 100}%` }} onClick={() => choose(items, page)}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M7 4h12v17H5V4h2m2-2h6v4H9zM8 10h8M8 14h8M8 18h5" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /></svg>{items.length > 1 && <span>{items.length}</span>}
          </button>;
        });
      })()}
      {noteActive && (locate?.origin === 'relation' ? [locate] : noteTargets).filter((target) => target.page === page).flatMap((target) => target.rects).map(([x, y, width, height], index) => <div key={index} className="desktop-anchor-boundary" aria-label={`已定位区域 ${index + 1}`} style={{ left: `${x * 100}%`, top: `${y * 100}%`, width: `${width * 100}%`, height: `${height * 100}%` }} />)}
      {selection && <AnchorRegions page={page} items={selection.items} drawing={selection.drawing === page} selected={selection.selected} onSelect={(selected) => setSelection((previous) => previous ? { ...previous, selected } : previous)} onAdd={(rect) => setSelection((previous) => {
        if (!previous || !catalog) return previous;
        const items = previous.items.map((item) => ({ ...item, rects: [...item.rects] }));
        let index = items.findIndex((item) => item.pdf_page === page);
        if (index < 0) { index = items.length; items.push({ textbook: catalog.textbookId, pdf_page: page, rects: [] }); }
        items[index]!.rects.push(rect);
        return { ...previous, items, drawing: undefined, selected: `${index}:${items[index]!.rects.length - 1}` };
      })} onChange={(i, j, rect: Rect) => setSelection((previous) => previous ? { ...previous, items: previous.items.map((item, at) => at === i ? { ...item, rects: item.rects.map((original, n) => n === j ? rect : original) } : item) } : previous)} />}
    </>,
  };
  function resize(value: number) {
    const next = Math.max(minimumShare, Math.min(bottom ? 75 : 100 - minimumShare, value));
    shares.current[sizeKey] = next;
    body.current?.style.setProperty('--primary-share', `${next}fr`);
    body.current?.style.setProperty('--secondary-share', `${100 - next}fr`);
    const handle = body.current?.querySelector('[role=separator]');
    handle?.setAttribute('aria-valuenow', String(Math.round(next)));
  }
  function toggleGraph() {
    setMode(mode === 'book' ? 'graph' : 'book');
    setBookOpen(false);
    requestAnimationFrame(() => document.getElementById('workspace-graph-toggle')?.focus());
  }
  function revealNote(path?: string) {
    if (path && pendingNote.current?.path !== path) pendingNote.current = undefined;
    setNoteOpen(true);
    if (narrow && mode !== 'book') setBookOpen(false);
  }
  function closeNote() {
    const returnFocus = mode === 'graph' ? body.current?.querySelector<HTMLElement>('.graph-viewport') : body.current?.querySelector<HTMLElement>('.desktop-anchor-mark[aria-pressed="true"]');
    setNoteOpen(false);
    requestAnimationFrame(() => returnFocus?.focus({ preventScroll: true }));
  }
  function toggleBook() {
    setBookOpen(!bookOpen);
    requestAnimationFrame(() => document.getElementById(narrow && !bookOpen ? 'workspace-return-graph' : 'workspace-book-toggle')?.focus());
  }
  function returnToShelf() {
    pendingNote.current = undefined;
    preferredPage.current = undefined;
    setLocate(undefined);
    setRestore(undefined);
    setOriginal(undefined);
    setMode('book');
    setNoteOpen(false);
    setShelfRequest((value) => value + 1);
  }
  // Do not apply a stale highlight after source edits remove or invalidate it.
  useEffect(() => {
    if (!locate) return;
    if (locate.origin === 'relation') {
      let valid = false;
      try { if (original) { originalTargets(original.href, catalog); valid = true; } } catch { /* Removed or mismatched catalogs cannot retain relation highlights. */ }
      if (!valid || !original || original.key !== session.key || !session.originals?.includes(original.href)) { setOriginal(undefined); setLocate(undefined); }
      return;
    }
    if (!Array.isArray(session.anchors)) { setLocate(undefined); return; }
    if (!session.anchors.some((anchor) => { const target = resolveAnchor(anchor, catalog).target; return target && anchorKey(target) === anchorKey({ textbook: locate.textbook, page: locate.page, rects: locate.rects }); })) setLocate(undefined);
  }, [session.anchors, session.originals, session.key, catalog, original]);
  // Select a new note's original only when it is visible; ordinary edits and mode
  // switches retain the reader's scroll. A newly selected note is located when its companion becomes visible.
  const lastLocated = useRef('');
  useEffect(() => {
    if (!bookVisible || !noteActive || original || selection) return;
    const key = `${session.vaultToken}:${session.path ?? ''}:${session.key ?? ''}`;
    const pending = pendingNote.current;
    if (pending && (pending.path !== session.path || pending.vaultToken !== session.vaultToken)) return;
    if (lastLocated.current === key && !pending) return;
    const target = noteTargets.find((item) => item.page === pending?.page) ?? noteTargets[0];
    if (!target) { if (pending && catalog) pendingNote.current = undefined; return; }
    pendingNote.current = undefined; lastLocated.current = key;
    setRestore(undefined);
    setLocate({ ...target, vaultToken: session.vaultToken, serial: ++locateSerial.current });
  }, [session.key, session.path, session.vaultToken, noteTargets, catalog, bookVisible, noteActive, original, selection, openRequest?.serial]);
  const graphControls = <button className="icon-button graph-floating-button" id="workspace-book-toggle" aria-label={bookOpen ? '收起教材' : '展开教材'} title={bookOpen ? '收起教材' : '展开教材'} aria-expanded={bookOpen} aria-controls="workspace-textbook" onClick={toggleBook}>
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 5c-3-2-6-2-9-1v15c3-1 6-1 9 1 3-2 6-2 9-1V4c-3-1-6-1-9 1Zm0 0v15" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /></svg>
  </button>;
  return <div className="desktop-workspace" data-mode={mode}>
    <header className="workspace-toolbar">
      {mode === 'graph' && narrow && bookOpen && <button id="workspace-return-graph" className="workspace-return" onClick={toggleBook}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m14 6-6 6 6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>返回图谱</button>}
      <strong className="workspace-title">{bookTitle}</strong>
      <div className="workspace-actions" ref={setToolbarHost}>
      <button className="workspace-graph" id="workspace-graph-toggle" aria-label={mode === 'graph' ? '关闭图谱' : '打开图谱'} title={mode === 'graph' ? '关闭图谱，返回课本' : '打开图谱'} aria-expanded={mode === 'graph'} aria-controls="workspace-notes" onClick={toggleGraph}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m7 7 10 2M7 7l3 11m7-9-7 9" stroke="currentColor" strokeWidth="1.5" /><circle cx="7" cy="7" r="3" fill="var(--surface)" stroke="currentColor" strokeWidth="1.5" /><circle cx="17" cy="9" r="2.5" fill="var(--surface)" stroke="currentColor" strokeWidth="1.5" /><circle cx="10" cy="18" r="2.5" fill="var(--surface)" stroke="currentColor" strokeWidth="1.5" /></svg><span>图谱</span>
      </button>
      <button className="workspace-shelf" aria-label="返回书架" title="返回书架" onClick={returnToShelf}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 5h4v14H4zM10 5h4v14h-4zM16 6l3-1 3 13-3 1zM3 21h20" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /></svg>
      </button>
      </div>
    </header>
    {original && <section className="desktop-selection" aria-label="关联原文查阅"><button onClick={returnOriginal}>返回关联来源</button><span>教材原文</span>{original.targets.map((target, index) => <button key={index} aria-current={original.index === index ? 'page' : undefined} onClick={() => { setOriginal({ ...original, index }); setRestore(undefined); setLocate({ ...target, origin: 'relation', serial: ++locateSerial.current, vaultToken: session.vaultToken }); }}>文件第 {target.page} 页 · {target.rects.length} 个区域</button>)}</section>}
    {selection && <section className="desktop-selection" aria-label="教材框选草稿"><span>{selection.index === undefined ? '框选后添加位置' : `调整位置 ${selection.index + 1}`} · {selection.items.reduce((count, item) => count + item.rects.length, 0)} 个区域</span>
      <span>{selection.index === undefined ? '可翻页后继续框选；' : '继续框选会回到此位置所在页；'}拖动边界移动，右下角调整大小。</span>
      <button disabled={!catalog} onClick={() => {
        const page = selection.index === undefined ? capture.current?.()?.page : selection.items[0]?.pdf_page;
        if (!catalog || page === undefined || !catalog.pages.some((item) => item.page === page)) return;
        setSelection({ ...selection, drawing: page, error: '' });
        setBookOpen(true);
        if (selection.index !== undefined) located({ textbook: catalog.textbookId, page, rects: selection.items[0]!.rects });
      }}>{selection.index === undefined ? '继续框选当前页' : '继续框选原页'}</button>
      <button disabled={!selection.selected} onClick={() => { const [i, j] = selection.selected.split(':').map(Number); setSelection({ ...selection, selected: '', items: selection.items.map((item, n) => n === i ? { ...item, rects: item.rects.filter((_, at) => at !== j) } : item) }); }}>移除所选区域</button>
      <button onClick={() => setSelection(undefined)}>取消框选</button>
      <button disabled={!session.writable || session.key !== selection.session.key} onClick={() => { void apply(false); }}>{selection.index === undefined ? '添加到当前笔记' : '保存区域调整'}</button>
      {selection.index === undefined && <><input aria-label="框选新笔记名称" value={selection.name} onChange={(event) => setSelection({ ...selection, name: event.target.value })} /><button onClick={() => { void apply(true); }}>从框选新建笔记</button></>}
      {selection.error && <p role="alert">{selection.error}</p>}
    </section>}
    <div ref={body} className="desktop-workspace-body" data-split={split} data-bottom={bottom}>
      <div id="workspace-notes" className="desktop-workspace-view workspace-notes" hidden={!notesVisible}><DesktopApp mode={mode} noteVisible={noteOpen} graphControls={graphControls} onCloseNote={closeNote} onRevealNote={revealNote} toolbarHost={toolbarHost} active={notesVisible} chooseRequest={chooseRequest} openRequest={openRequest} catalog={catalog} onRefreshCatalog={refreshCatalog} onAnchorSession={setSession} anchorBridge={bridge} onLocate={located} onOriginal={locateOriginal} onSelect={begin} /></div>
      {split && <div className="desktop-workspace-resize" role="separator" tabIndex={0} aria-label={bottom ? '调整笔记区域高度' : '调整笔记与课本宽度'} aria-orientation={bottom ? 'horizontal' : 'vertical'} aria-controls="workspace-textbook" aria-valuemin={minimumShare} aria-valuemax={bottom ? 75 : 100 - minimumShare} aria-valuenow={shares.current[sizeKey]} onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId);
      }} onPointerMove={(event) => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId) || !body.current) return;
        const bounds = body.current.getBoundingClientRect(); resize(bottom ? (event.clientY - bounds.top) / bounds.height * 100 : (event.clientX - bounds.left) / bounds.width * 100);
      }} onPointerUp={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }} onKeyDown={(event) => {
        const value = shares.current[sizeKey];
        const next = event.key === (bottom ? 'ArrowUp' : 'ArrowLeft') ? value - 5 : event.key === (bottom ? 'ArrowDown' : 'ArrowRight') ? value + 5 : event.key === 'Home' ? minimumShare : event.key === 'End' ? bottom ? 75 : 100 - minimumShare : null;
        if (next !== null) { event.preventDefault(); resize(next); }
      }}><span aria-hidden="true" /></div>}
      <div id="workspace-textbook" className="desktop-workspace-view workspace-book" hidden={!bookVisible}><DesktopTextbooks vaultToken={session.vaultToken} active={bookVisible} shelfRequest={shelfRequest} onChooseVault={() => setChooseRequest((previous) => previous + 1)} tools={tools} onCatalog={onCatalog} onOpenNote={open} /></div>
    </div>
    <dialog ref={dialog} className="vault-guard note-link-dialog" aria-label="选择教材笔记" onCancel={(event) => { event.preventDefault(); dialog.current?.close(); setCandidates(undefined); preferredPage.current = undefined; }}><h2>选择笔记</h2><div className="note-link-candidates">{candidates?.map((entry) => <button className="note-link-candidate" key={entry.path} onClick={() => { open(entry.path, session.vaultToken, entry.id); dialog.current?.close(); setCandidates(undefined); preferredPage.current = undefined; }}><Candidate entry={entry} catalog={catalog} /></button>)}</div><button onClick={() => { dialog.current?.close(); setCandidates(undefined); preferredPage.current = undefined; }}>取消</button></dialog>
  </div>;
}
