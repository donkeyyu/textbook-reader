import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DesktopApp } from './DesktopApp';
import { DesktopTextbooks } from './DesktopTextbooks';
import { anchorKey, resolveAnchor, type AnchorTarget, type Catalog, type Rect } from '../../desktop/anchors';
import type { LinkEntry } from '../../desktop/links';
import type { LocalReaderTools } from '../reader/Reader';
import type { AnchorSession, AnchorBridge, LocateRequest } from './anchor-session';
import { AnchorRegions, type SelectionPage } from './AnchorRegions';
import { Candidate } from './NoteLinks';
import './textbooks.css';
import './anchors.css';

type Selection = { session: AnchorSession; items: SelectionPage[]; index?: number; drawing?: number; selected: string; name: string; error: string };
const emptySession: AnchorSession = { vaultToken: '', anchors: undefined, writable: false, index: { entries: [], problems: [] } };
// Both editor and reader stay mounted across full-screen and split views.
export function DesktopWorkspace() {
  const [view, setView] = useState(() => { try { return localStorage.getItem('desktop-workspace-view') === 'textbooks' ? 'textbooks' : 'notes'; } catch { return 'notes'; } });
  const [split, setSplit] = useState(false);
  const [chooseRequest, setChooseRequest] = useState(0);
  const [openRequest, setOpenRequest] = useState<{ path: string; serial: number; vaultToken: string; expectedId?: string }>();
  const [locate, setLocate] = useState<LocateRequest>();
  const [textbooksMounted, setTextbooksMounted] = useState(view === 'textbooks');
  const [browseRequest, setBrowseRequest] = useState<{ view: 'search' | 'graph'; serial: number }>();
  const [session, setSession] = useState<AnchorSession>(emptySession);
  const bridge: AnchorBridge = useRef(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const catalogRequest = useRef(0);
  const catalogRefreshing = useRef({ token: '', count: 0 });
  const [selection, setSelection] = useState<Selection>();
  const [candidates, setCandidates] = useState<LinkEntry[]>();
  const dialog = useRef<HTMLDialogElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const share = useRef(50);
  const locateSerial = useRef(0);
  const token = useRef(''); token.current = session.vaultToken;
  useEffect(() => { try { localStorage.setItem('desktop-workspace-view', view); } catch { /* Navigation remains available. */ } }, [view]);
  useEffect(() => {
    catalogRequest.current++;
    setCatalog(null); setSelection(undefined); setLocate(undefined); setCandidates(undefined); dialog.current?.close();
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
    setLocate({ ...target, serial: ++locateSerial.current, vaultToken: token.current });
    setTextbooksMounted(true); setSplit(true); setView('notes');
  }, []);
  function open(path: string, vaultToken = session.vaultToken, expectedId?: string) {
    setOpenRequest((previous) => ({ path, vaultToken, expectedId, serial: (previous?.serial ?? 0) + 1 })); setView('notes');
  }
  const byPage = useMemo(() => {
    const map = new Map<number, { entry: LinkEntry; target: AnchorTarget }[]>();
    for (const entry of session.index.entries) for (const anchor of entry.anchors) {
      const { target } = resolveAnchor(anchor, catalog);
      if (target) map.set(target.page, [...map.get(target.page) ?? [], { entry, target }]);
    }
    return map;
  }, [session.index, catalog]);
  function choose(entries: LinkEntry[]) {
    const unique = [...new Map(entries.map((entry) => [entry.path, entry])).values()];
    if (unique.length === 1) open(unique[0]!.path, session.vaultToken, unique[0]!.id);
    else { setCandidates(unique); dialog.current?.showModal(); }
  }
  function begin(index?: number) {
    if (!catalog) return;
    const anchor = index === undefined || !Array.isArray(session.anchors) ? null : session.anchors[index];
    const { target } = resolveAnchor(anchor, catalog);
    if (index !== undefined && !target) return;
    setSelection({ session, index, items: target ? [{ textbook: target.textbook, pdf_page: target.page, rects: target.rects.map((rect) => [...rect]) }] : [], selected: target?.rects.length ? '0:0' : '', name: '教材笔记', error: '' });
    setTextbooksMounted(true); setSplit(true);
    if (target) located(target);
  }
  function draw(page: number) {
    if (!catalog) return;
    if (selection?.index !== undefined && selection.items[0]?.pdf_page !== page) { setSelection({ ...selection, error: '调整此条位置请在原页面框选；跨页请新增位置。' }); return; }
    setSelection((previous) => previous ? { ...previous, drawing: page, error: '' } : { session, items: [], selected: '', name: '教材笔记', error: '', drawing: page });
  }
  async function apply(create: boolean) {
    if (!selection || !bridge.current) return;
    const items = selection.items.filter((item) => item.rects.length);
    if (!items.length && selection.index === undefined) { setSelection({ ...selection, error: '请先框选至少一个区域。' }); return; }
    const ok = await bridge.current({ session: selection.session, ...(create ? { create: { name: selection.name, anchors: items } } : selection.index === undefined ? { append: items } : { index: selection.index, rects: items[0]?.rects }) });
    if (ok) { setSelection(undefined); setView('notes'); }
    else setSelection((previous) => previous ? { ...previous, error: '笔记状态或位置已改变，未覆盖当前内容。请取消后重新选择；选择草稿仍在。' } : previous);
  }
  const tools: LocalReaderTools = {
    request: locate?.vaultToken === session.vaultToken ? locate : undefined,
    toolbar: (page) => <><button onClick={() => choose((byPage.get(page) ?? []).map(({ entry }) => entry))} disabled={!byPage.get(page)?.length}>本页笔记 · {new Set(byPage.get(page)?.map(({ entry }) => entry.path)).size}</button><button onClick={() => draw(page)} disabled={!catalog}>框选当前页</button></>,
    page: (page) => <>
      {(() => {
        const entries = byPage.get(page) ?? [];
        if (!entries.length) return null;
        return <button className="desktop-anchor-mark" aria-label={`打开文件第 ${page} 页的 ${new Set(entries.map(({ entry }) => entry.path)).size} 篇笔记`} style={{ top: `${(entries[0]!.target.rects[0]?.[1] ?? .03) * 100}%` }} onClick={() => choose(entries.map(({ entry }) => entry))}>笔记 · {new Set(entries.map(({ entry }) => entry.path)).size}</button>;
      })()}
      {locate?.page === page && locate.rects.map(([x, y, width, height], index) => <div key={index} className="desktop-anchor-boundary" aria-label={`已定位区域 ${index + 1}`} style={{ left: `${x * 100}%`, top: `${y * 100}%`, width: `${width * 100}%`, height: `${height * 100}%` }} />)}
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
    share.current = Math.max(30, Math.min(70, value));
    const panels = body.current?.querySelectorAll<HTMLElement>(':scope > .desktop-workspace-view');
    body.current?.querySelector('[role=separator]')?.setAttribute('aria-valuenow', String(Math.round(share.current)));
    if (panels) { panels[0]!.style.flex = String(share.current); panels[1]!.style.flex = String(100 - share.current); }
  }
  // Do not apply a stale highlight after source edits remove or invalidate it.
  useEffect(() => {
    if (!locate) return;
    if (!Array.isArray(session.anchors)) { setLocate(undefined); return; }
    if (!session.anchors.some((anchor) => { const target = resolveAnchor(anchor, catalog).target; return target && anchorKey(target) === anchorKey({ textbook: locate.textbook, page: locate.page, rects: locate.rects }); })) setLocate(undefined);
  }, [session.anchors, catalog]);
  return <div className="desktop-workspace">
    <nav className="desktop-workspace-tabs" aria-label="本地工作区">
      <button aria-current={!split && view === 'notes' ? 'page' : undefined} onClick={() => { setSplit(false); setView('notes'); }}>笔记库</button>
      <button aria-current={!split && view === 'textbooks' ? 'page' : undefined} onClick={() => { setTextbooksMounted(true); setSplit(false); setView('textbooks'); }}>教材书架</button>
      <button aria-pressed={split} onClick={() => { setTextbooksMounted(true); setSplit(!split); }}>展开教材分屏</button>
      {split && <button onClick={() => setChooseRequest((previous) => previous + 1)}>{session.vaultToken ? '切换笔记库' : '选择笔记库'}</button>}
      {session.path && <button onClick={() => { setSplit(false); setView('notes'); }}>返回当前笔记</button>}
      {(split || view === 'textbooks') && <div className="desktop-local-browse" role="group" aria-label="查阅本地笔记">{(['search', 'graph'] as const).map((target) => <button key={target} onClick={() => { setBrowseRequest((previous) => ({ view: target, serial: (previous?.serial ?? 0) + 1 })); setSplit(false); setView('notes'); }}>{target === 'search' ? '搜索笔记' : '知识图'}</button>)}</div>}
    </nav>
    {selection && <section className="desktop-selection" aria-label="教材框选草稿"><span>{selection.index === undefined ? '框选后添加位置' : `调整位置 ${selection.index + 1}`} · {selection.items.reduce((count, item) => count + item.rects.length, 0)} 个区域</span>
      <span>可在教材中继续框选；拖动边界移动，右下角调整大小。</span>
      <button disabled={!selection.selected} onClick={() => { const [i, j] = selection.selected.split(':').map(Number); setSelection({ ...selection, selected: '', items: selection.items.map((item, n) => n === i ? { ...item, rects: item.rects.filter((_, at) => at !== j) } : item) }); }}>移除所选区域</button>
      <button onClick={() => setSelection(undefined)}>取消框选</button>
      <button disabled={!session.writable || session.key !== selection.session.key} onClick={() => { void apply(false); }}>{selection.index === undefined ? '添加到当前笔记' : '保存区域调整'}</button>
      {selection.index === undefined && <><input aria-label="框选新笔记名称" value={selection.name} onChange={(event) => setSelection({ ...selection, name: event.target.value })} /><button onClick={() => { void apply(true); }}>从框选新建笔记</button></>}
      {selection.error && <p role="alert">{selection.error}</p>}
    </section>}
    <div ref={body} className={`desktop-workspace-body${split ? ' split' : ''}`}>
      <div className="desktop-workspace-view" hidden={!split && view !== 'notes'}><DesktopApp active={split || view === 'notes'} browseRequest={browseRequest} chooseRequest={chooseRequest} openRequest={openRequest} catalog={catalog} onRefreshCatalog={refreshCatalog} onAnchorSession={setSession} anchorBridge={bridge} onLocate={located} onSelect={begin} /></div>
      {split && <div className="desktop-workspace-resize" role="separator" tabIndex={0} aria-label="调整笔记与教材面板" aria-orientation="vertical" aria-valuemin={30} aria-valuemax={70} aria-valuenow={share.current} onPointerDown={(event) => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={(event) => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId) || !body.current) return;
        const bounds = body.current.getBoundingClientRect(); resize(window.innerWidth <= 800 ? 100 - (event.clientY - bounds.top) / bounds.height * 100 : (event.clientX - bounds.left) / bounds.width * 100);
      }} onPointerUp={(event) => event.currentTarget.releasePointerCapture(event.pointerId)} onKeyDown={(event) => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) { event.preventDefault(); resize(share.current + (['ArrowLeft', 'ArrowUp'].includes(event.key) ? -5 : 5)); } }} />}
      <div className="desktop-workspace-view" hidden={!split && view !== 'textbooks'}>{textbooksMounted && <DesktopTextbooks vaultToken={session.vaultToken} active={split || view === 'textbooks'} tools={tools} onCatalog={onCatalog} onOpenNote={open} />}</div>
    </div>
    <dialog ref={dialog} className="vault-guard note-link-dialog" aria-label="选择教材笔记" onCancel={(event) => { event.preventDefault(); dialog.current?.close(); setCandidates(undefined); }}><h2>选择笔记</h2><div className="note-link-candidates">{candidates?.map((entry) => <button className="note-link-candidate" key={entry.path} onClick={() => { open(entry.path, session.vaultToken, entry.id); dialog.current?.close(); setCandidates(undefined); }}><Candidate entry={entry} catalog={catalog} /></button>)}</div><button onClick={() => { dialog.current?.close(); setCandidates(undefined); }}>取消</button></dialog>
  </div>;
}
