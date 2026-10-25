import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { bookTitle, getPage, pageCount, pages, pageLabel, resolvePageInput, type PageInputMode } from "../textbook/catalog";
import { getLocation, getSupplement, supplementsForPage } from "../textbook/supplements";
import { loadPersonal, savePersonal, type PersonalData, type PersonalSupplement } from './personal';
import { MarkdownContent, MarkdownEditor } from './MarkdownEditor';
import { PanelResize } from './PanelResize';
import { PersonalPanel } from './PersonalPanel';
import { RegionSelector } from './RegionSelector';
import { supplementTypes, supplementType, TypeMarker, type SupplementType } from './supplement-types';
import { readingPage, restoredScroll, type PageMetric } from "./session";
import { groupMarkers } from "./marker-groups";
import { loadReadingPosition, saveReadingPosition } from "./reading-record";
import { SupplementPanel, SupplementPreview, type PreviewAnchor } from "./Supplement";

type ReadingContext = {
  page: number;
  fraction: number;
  supplementId: string | null;
  choiceIds: string[] | null;
  locationId: string | null;
  focusId: string;
  panelScroll: number;
  methodOpenIds: string[];
};
type Jump = { page: number; locationId?: string; source?: ReadingContext; restore?: ReadingContext };
type Commit = { page: number; fraction?: number; locationId?: string; focusId: string; panelScroll?: number };

function measurePages(list: HTMLDivElement): PageMetric[] {
  return Array.from(list.children, (child) => {
    const page = child as HTMLElement;
    return { top: list.offsetTop + page.offsetTop, height: page.offsetHeight };
  });
}

function Chevron({ direction }: { direction: "left" | "right" }) {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d={direction === "left" ? "m14 6-6 6 6 6" : "m10 6 6 6-6 6"} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>;
}

function PageImage({ page }: { page: (typeof pages)[number] }) {
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  return <>
    <img className="page-image" src={`${page.image}${attempt ? `?retry=${attempt}` : ""}`} alt={page.alt}
      width={page.width} height={page.height} loading={page.page === 1 ? "eager" : "lazy"} decoding="async"
      style={{ visibility: failed ? "hidden" : undefined }} onError={() => setFailed(true)} onLoad={() => setFailed(false)} />
    {failed && <div className="page-error" role="alert"><span>第 {page.page} 页暂时无法加载</span>
      <button className="text-button" onClick={() => { setFailed(false); setAttempt(attempt + 1); }}>重试</button>
    </div>}
  </>;
}

export function Reader() {
  const [resume] = useState(() => {
    try { return { position: loadReadingPosition(), error: '' }; }
    catch (cause) { return { position: null, error: (cause as Error).message }; }
  });
  const [readingError, setReadingError] = useState(resume.error);
  const [loaded] = useState(() => {
    try { return { data: loadPersonal(), error: '' }; }
    catch { return { data: { supplements: [], notes: {} } as PersonalData, error: '本地笔记无法读取。请检查浏览器存储后刷新；当前不会覆盖已存内容。' }; }
  });
  const [personal, setPersonal] = useState(loaded.data);
  const personalState = useRef(loaded.data);
  const personalWrites = useRef(Promise.resolve());
  const [personalItem, setPersonalItem] = useState<PersonalSupplement | null>(null);
  const [selectionPage, setSelectionPage] = useState<number | null>(null);
  const [editingNote, setEditingNote] = useState<string | null>(null);
  const [hiddenTypes, setHiddenTypes] = useState<SupplementType[]>([]);
  const [hiddenIds, setHiddenIds] = useState<string[]>([]);
  function storePersonal(update: (current: PersonalData) => PersonalData) {
    const write = personalWrites.current.then(async () => {
      if (loaded.error) throw new Error(loaded.error);
      const data = update(personalState.current);
      await savePersonal(data, personalState.current);
      personalState.current = data;
      setPersonal(data);
    });
    personalWrites.current = write.catch(() => {});
    return write;
  }
  function saveNote(id: string, value: string) {
    return storePersonal((current) => {
      const notes = { ...current.notes };
      if (value.trim()) notes[id] = value;
      else delete notes[id];
      return { ...current, notes };
    });
  }
  const [currentPage, setCurrentPage] = useState(1);
  const [pageInput, setPageInput] = useState("");
  const [pageMode, setPageMode] = useState<PageInputMode>("printed");
  const [pageError, setPageError] = useState("");
  const [editingPage, setEditingPage] = useState(false);
  const [navigationOpen, setNavigationOpen] = useState(() => window.matchMedia("(min-width: 761px)").matches);
  const [supplementId, setSupplementId] = useState<string | null>(null);
  const [choiceIds, setChoiceIds] = useState<string[] | null>(null);
  const [methodOpenIds, setMethodOpenIds] = useState<string[]>([]);
  const [paperWidth, setPaperWidth] = useState(690);
  const [markerSize, setMarkerSize] = useState(() => window.matchMedia("(max-width: 760px)").matches ? 32 : 36);
  const [selectedLocation, setSelectedLocation] = useState<string | null>(null);
  const [history, setHistory] = useState<ReadingContext[]>([]);
  const [groupPreview, setGroupPreview] = useState<string[] | null>(null);
  const [preview, setPreview] = useState<{ id: string; anchor: PreviewAnchor } | null>(null);
  const [commit, setCommit] = useState<Commit | null>(null);
  const previewTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const suppressPreviewFocus = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const pageList = useRef<HTMLDivElement>(null);
  const thumbnailList = useRef<HTMLDivElement>(null);
  const metrics = useRef<PageMetric[]>([]);
  const anchor = useRef({ page: 1, fraction: 0 });
  const current = useRef(1);
  const requestId = useRef(0);
  const navigationPending = useRef(false);
  const retryJump = useRef<Jump>({ page: 1 });
  const toggleButton = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    const element = scroller.current;
    const list = pageList.current;
    if (!element || !list) return;
    let frame = 0;
    let width = 0;
    let initialized = false;
    let storageFailed = !!resume.error;
    let saveTimer: ReturnType<typeof setTimeout> | undefined;

    function savePosition() {
      clearTimeout(saveTimer);
      saveTimer = undefined;
      if (!initialized || storageFailed) return;
      try { saveReadingPosition(anchor.current); }
      catch (cause) { storageFailed = true; setReadingError((cause as Error).message); }
    }

    function updatePosition() {
      if (!element) return;
      const page = readingPage(metrics.current, element.scrollTop, element.clientHeight, element.scrollHeight);
      const metric = metrics.current[page - 1];
      current.current = page;
      setCurrentPage(page);
      if (metric) anchor.current = { page, fraction: (element.scrollTop - metric.top) / metric.height };
      if (initialized && !storageFailed && saveTimer === undefined) saveTimer = setTimeout(savePosition, 750);
    }

    function measure() {
      if (!element || !list) return;
      const saved = anchor.current;
      const resized = width > 0 && width !== list.clientWidth;
      width = list.clientWidth;
      setPaperWidth(width);
      setMarkerSize(window.matchMedia("(max-width: 760px)").matches ? 32 : 36);
      metrics.current = measurePages(list);
      const metric = metrics.current[saved.page - 1];
      if (!initialized) {
        const position = resume.position;
        const initialMetric = position && metrics.current[position.page - 1];
        if (position && initialMetric) element.scrollTop = restoredScroll(initialMetric, position.fraction);
        initialized = true;
      } else if (resized && metric) element.scrollTop = restoredScroll(metric, saved.fraction);
      updatePosition();
    }

    function scroll() {
      if (navigationPending.current) {
        requestId.current += 1;
        navigationPending.current = false;
        setPending(false);
        setError(null);
      }
      clearPreview();
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(updatePosition);
    }
    function flushPosition() {
      cancelAnimationFrame(frame);
      updatePosition();
      savePosition();
    }
    function visibilityChanged() { if (document.visibilityState === "hidden") flushPosition(); }

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    observer.observe(element);
    element.addEventListener("scroll", scroll, { passive: true });
    document.addEventListener("visibilitychange", visibilityChanged);
    window.addEventListener("pagehide", flushPosition);
    return () => {
      clearTimeout(saveTimer);
      cancelAnimationFrame(frame);
      observer.disconnect();
      element.removeEventListener("scroll", scroll);
      document.removeEventListener("visibilitychange", visibilityChanged);
      window.removeEventListener("pagehide", flushPosition);
    };
  }, []);

  useEffect(() => {
    if (selectionPage !== null) document.querySelector<HTMLElement>('.region-selector')?.focus({ preventScroll: true });
  }, [selectionPage]);

  useEffect(() => {
    if (!editingPage) {
      setPageInput(pageMode === "printed" ? getPage(currentPage).printedPage ?? "" : String(currentPage));
      setPageError("");
    }
    const list = thumbnailList.current;
    const selected = document.getElementById(`thumbnail-${currentPage}`);
    if (list && selected) {
      if (selected.offsetTop < list.scrollTop) list.scrollTop = selected.offsetTop;
      else if (selected.offsetTop + selected.offsetHeight > list.scrollTop + list.clientHeight) {
        list.scrollTop = selected.offsetTop + selected.offsetHeight - list.clientHeight;
      }
    }
  }, [currentPage, navigationOpen, pageMode, editingPage]);

  useLayoutEffect(() => {
    if (!commit || !scroller.current || !pageList.current) return;
    const element = scroller.current;
    metrics.current = measurePages(pageList.current);
    const metric = metrics.current[commit.page - 1];
    if (!metric) return;
    const padding = parseFloat(getComputedStyle(element).paddingTop);
    const location = commit.locationId ? getLocation(commit.locationId) : undefined;
    element.scrollTop = commit.fraction !== undefined
      ? restoredScroll(metric, commit.fraction)
      : metric.top + (location ? metric.height * location.region.y : 0) - padding;
    anchor.current = { page: commit.page, fraction: (element.scrollTop - metric.top) / metric.height };
    current.current = commit.page;
    setCurrentPage(commit.page);
    setPageInput(pageMode === "printed" ? getPage(commit.page).printedPage ?? "" : String(commit.page));
    setPageError("");
    const panel = document.getElementById("supplement-panel");
    const focused = document.getElementById(commit.focusId);
    focused?.focus({ preventScroll: true });
    if (panel && focused && commit.focusId.startsWith("choice-")) {
      const bounds = panel.getBoundingClientRect();
      const title = focused.getBoundingClientRect();
      if (title.top < bounds.top) panel.scrollTop += title.top - bounds.top;
      else if (title.bottom > bounds.bottom) panel.scrollTop += title.bottom - bounds.bottom;
    }
  }, [commit]);

  useEffect(() => {
    if (!commit) return;
    // Restore after child editors mount so their height cannot clamp the saved scroll.
    const panel = document.getElementById("supplement-panel");
    if (panel && commit.panelScroll !== undefined) panel.scrollTop = commit.panelScroll;
    setCommit(null);
  }, [commit]);

  useEffect(() => {
    const closePreview = () => clearPreview();
    window.addEventListener("resize", closePreview);
    return () => {
      requestId.current += 1;
      clearTimeout(previewTimer.current);
      window.removeEventListener("resize", closePreview);
    };
  }, []);

  function focusMarker(id: string) {
    suppressPreviewFocus.current = true;
    document.querySelector<HTMLButtonElement>(`[data-supplement-ids~="${id}"]`)?.focus({ preventScroll: true });
    suppressPreviewFocus.current = false;
  }
  function clearPreview() { setPreview(null); setGroupPreview(null); }
  function showGroupPreview(ids: string[]) {
    keepPreview();
    setPreview(null);
    setGroupPreview(ids);
  }
  function keepPreview() { clearTimeout(previewTimer.current); }
  function leavePreview() {
    keepPreview();
    previewTimer.current = setTimeout(() => clearPreview(), preview?.anchor.docked ? 500 : 180);
  }
  function showPreview(id: string, button: HTMLButtonElement) {
    keepPreview();
    setGroupPreview(null);
    const paper = button.closest(".paper")?.getBoundingClientRect();
    const reader = scroller.current?.getBoundingClientRect();
    if (!paper || !reader) return;
    const rightSpace = reader.right - paper.right - 24;
    const leftSpace = paper.left - reader.left - 24;
    const docked = Math.max(rightSpace, leftSpace) < 220;
    const onRight = rightSpace >= 220;
    const width = Math.min(280, onRight ? rightSpace : leftSpace);
    setPreview({ id, anchor: {
      top: button.getBoundingClientRect().top,
      left: onRight ? paper.right + 12 : paper.left - width - 12,
      width, docked,
    } });
  }

  function cancelJump() {
    requestId.current += 1;
    navigationPending.current = false;
    setPending(false);
    setError(null);
  }

  function openSupplement(id: string, highlight = !!getSupplement(id)?.questionGuide) {
    setPersonalItem(null);
    setSelectionPage(null);
    cancelJump();
    setMethodOpenIds([]);
    keepPreview();
    clearPreview();
    setChoiceIds(null);
    setSelectedLocation(highlight ? getSupplement(id)!.locationId : null);
    setSupplementId(id);
    setHistory([]);
    if (highlight) {
      const location = getLocation(getSupplement(id)!.locationId);
      setCommit({ page: location.page, locationId: location.id, focusId: "supplement-title", panelScroll: 0 });
    }
    if (window.matchMedia("(max-width: 760px)").matches) setNavigationOpen(false);
    requestAnimationFrame(() => {
      const panel = document.getElementById("supplement-panel");
      if (panel) panel.scrollTop = 0;
      document.getElementById("supplement-title")?.focus({ preventScroll: true });
    });
  }

  function openChoices(ids: string[]) {
    setPersonalItem(null);
    setSelectionPage(null);
    cancelJump();
    setMethodOpenIds([]);
    keepPreview();
    clearPreview();
    setSupplementId(null);
    setSelectedLocation(null);
    setHistory([]);
    setChoiceIds(ids);
    if (window.matchMedia("(max-width: 760px)").matches) setNavigationOpen(false);
    requestAnimationFrame(() => {
      const panel = document.getElementById("supplement-panel");
      if (panel) panel.scrollTop = 0;
      document.getElementById(`choice-${ids[0]}`)?.focus({ preventScroll: true });
    });
  }

  function selectAccordion(id: string | null) {
    setPersonalItem(null);
    setSelectionPage(null);
    cancelJump();
    keepPreview();
    clearPreview();
    setMethodOpenIds([]);
    setSupplementId(id);
    const location = id ? getLocation(getSupplement(id)!.locationId) : undefined;
    setSelectedLocation(location?.id ?? null);
    if (location) setCommit({ page: location.page, locationId: location.id, focusId: `choice-${id}` });
  }

  function closeSupplement() {
    cancelJump();
    setMethodOpenIds([]);
    const id = supplementId ?? choiceIds?.[0];
    setChoiceIds(null);
    setSupplementId(null);
    setSelectedLocation(null);
    setHistory([]);
    requestAnimationFrame(() => {
      const marker = id ? document.querySelector(`[data-supplement-ids~="${id}"]`)?.getBoundingClientRect() : undefined;
      const viewport = scroller.current?.getBoundingClientRect();
      if (id && marker && viewport && marker.bottom > viewport.top && marker.top < viewport.bottom) focusMarker(id);
      else document.getElementById(`page-${current.current}`)?.focus({ preventScroll: true });
    });
  }

  function relatedJump(locationId: string, focusId: string) {
    if (locationId === selectedLocation) return;
    const location = getLocation(locationId);
    const element = scroller.current;
    if (!element) return;
    const page = readingPage(metrics.current, element.scrollTop, element.clientHeight, element.scrollHeight);
    const metric = metrics.current[page - 1];
    if (!metric) return;
    void navigate({ page: location.page, locationId, source: {
      page, fraction: (element.scrollTop - metric.top) / metric.height,
      supplementId, choiceIds, methodOpenIds, locationId: selectedLocation, focusId,
      panelScroll: document.getElementById("supplement-panel")?.scrollTop ?? 0,
    } });
  }

  async function navigate(jump: Jump) {
    const target = getPage(jump.page);
    const id = ++requestId.current;
    retryJump.current = jump;
    navigationPending.current = true;
    clearPreview();
    setPending(true);
    setError(null);
    try {
      const image = new Image();
      image.src = target.image;
      await image.decode();
      if (requestId.current !== id) return;
      setPersonalItem(null); setSelectionPage(null);
      setChoiceIds(jump.restore?.choiceIds ?? null);
      if (jump.source) setHistory((previous) => [...previous, jump.source!]);
      else if (!jump.restore) setHistory([]);
      if (jump.restore) {
        setHistory((previous) => previous.slice(0, -1));
        setSupplementId(jump.restore.supplementId);
        setMethodOpenIds(jump.restore.methodOpenIds);
        setSelectedLocation(jump.restore.locationId);
      } else {
        const note = jump.locationId ? supplementsForPage(jump.page).find((item) => item.locationId === jump.locationId) : undefined;
        if (!jump.locationId || note) setMethodOpenIds([]);
        // A textbook-only target keeps the source explanation and its return control.
        setSupplementId(note?.id ?? (jump.locationId ? supplementId : null));
        setSelectedLocation(jump.locationId ?? null);
      }
      setCommit({ page: jump.page, fraction: jump.restore?.fraction, locationId: jump.locationId, panelScroll: jump.restore?.panelScroll,
        focusId: jump.restore?.focusId ?? (jump.locationId ? `location-${jump.locationId}` : `page-${jump.page}`) });
      if (window.matchMedia("(max-width: 760px)").matches) setNavigationOpen(false);
    } catch {
      if (requestId.current === id) {
        setPageInput(pageMode === "printed" ? getPage(current.current).printedPage ?? "" : String(current.current));
        setError(`文件第 ${jump.page} 页暂时无法加载，当前阅读位置已保留。`);
      }
    } finally {
      if (requestId.current === id) {
        navigationPending.current = false;
        setPending(false);
      }
    }
  }

  const note = supplementId ? getSupplement(supplementId) : undefined;
  const previewNote = preview ? getSupplement(preview.id) : undefined;
  const highlightedIds = groupPreview
    ? groupPreview.map((id) => getSupplement(id)!.locationId)
    : previewNote ? [previewNote.locationId]
    : selectedLocation ? [selectedLocation]
    : choiceIds && !supplementId ? choiceIds.map((id) => getSupplement(id)!.locationId) : [];
  const highlightedLocations = [...new Set(highlightedIds)].map(getLocation);
  const previous = history.at(-1);

  function closePageInput() {
    setEditingPage(false);
    setPageError("");
    requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('.page-index')?.focus());
  }

  const currentPrintedPage = getPage(currentPage).printedPage;
  const pageControls = <div className="page-controls">
    <button className="page-index" type="button" aria-label={`文件页序 ${currentPage}/${pageCount}，${currentPrintedPage === null ? "无印刷页码" : `课本第 ${currentPrintedPage} 页`}，点击跳转`}
      aria-expanded={editingPage} aria-controls="page-jump" title="跳转页面"
      onClick={() => {
        setPageInput(pageMode === "printed" ? currentPrintedPage ?? "" : String(currentPage));
        setPageError(""); setEditingPage(!editingPage);
      }}>
      <span>文件页序 {currentPage}/{pageCount}</span>
      <span>{currentPrintedPage === null ? "无印刷页码" : `课本第 ${currentPrintedPage} 页`}</span>
    </button>
    {editingPage && <form id="page-jump" className="page-jump" aria-label="跳转页面" onKeyDown={(event) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closePageInput(); }
    }} onSubmit={(event) => {
      event.preventDefault();
      const result = resolvePageInput(pageInput, pageMode);
      if (result.error !== undefined) { setPageError(result.error); return; }
      setEditingPage(false); setPageError("");
      void navigate({ page: result.page });
    }}>
      <select aria-label="跳页方式" value={pageMode} onChange={(event) => {
        const mode = event.target.value as PageInputMode;
        setPageMode(mode); setPageError("");
        setPageInput(mode === "printed" ? currentPrintedPage ?? "" : String(currentPage));
      }}>
        <option value="printed">课本页码</option>
        <option value="file">文件页序</option>
      </select>
      <input id="page-input" aria-label={pageMode === "printed" ? "课本页码" : "文件页序"} aria-invalid={!!pageError}
        aria-describedby={pageError ? "page-input-error" : undefined} placeholder={pageMode === "printed" ? "课本页码" : `1–${pageCount}`}
        autoFocus inputMode="numeric" value={pageInput} onChange={(event) => { setPageInput(event.target.value); setPageError(""); }}
        onFocus={(event) => event.currentTarget.select()} />
      <button className="text-button" type="submit">跳转</button>
      <button className="text-button" type="button" onClick={closePageInput}>取消</button>
      {pageError && <p id="page-input-error" className="page-input-error" role="alert">{pageError}</p>}
    </form>}
    <div className="page-step-controls">
      <button className="icon-button" aria-label="上一页" disabled={currentPage === 1 || pending} onClick={() => { void navigate({ page: currentPage - 1 }); }}><Chevron direction="left" /></button>
      <button className="icon-button" aria-label="下一页" disabled={currentPage === pageCount || pending} onClick={() => { void navigate({ page: currentPage + 1 }); }}><Chevron direction="right" /></button>
    </div>
  </div>;

  return <div className="reader-app" onSubmitCapture={(event) => {
    if ((event.target as HTMLElement).matches('.page-jump') && document.querySelector('[data-dirty="true"]') && !window.confirm('有尚未保存的内容，放弃修改？')) {
      event.preventDefault(); event.stopPropagation();
    }
  }} onClickCapture={(event) => {
    const target = event.target as HTMLElement;
    if (target.closest('.markdown-editor, .personal-title, .method-toggle')) return;
    if (document.querySelector('[data-dirty="true"]') && target.closest('button, summary, input') && !window.confirm('有尚未保存的内容，放弃修改？')) {
      event.preventDefault(); event.stopPropagation();
    }
  }} onKeyDown={(event) => {
    if (event.key !== "Escape") return;
    const filters = event.currentTarget.querySelector<HTMLDetailsElement>('.supplement-filters[open]');
    if (filters) {
      filters.open = false;
      filters.querySelector('summary')?.focus();
      return;
    }
    if (selectionPage) { setSelectionPage(null); return; }
    if (personalItem) return;
    if (editingNote || event.currentTarget.querySelector('.markdown-editor[data-dirty="true"]')) return;
    if (preview || groupPreview) {
      const id = preview?.id ?? groupPreview![0]!;
      clearPreview();
      focusMarker(id);
    } else if (supplementId || choiceIds) closeSupplement();
    else if (navigationOpen) {
      setNavigationOpen(false);
      toggleButton.current?.focus();
    }
  }}>
    <header className="toolbar">
      <div className="book-heading">
        <button ref={toggleButton} className="icon-button navigation-toggle" aria-label={navigationOpen ? "收起页面导航" : "展开页面导航"}
          aria-expanded={navigationOpen} aria-controls="page-sidebar" onClick={() => { clearPreview(); setNavigationOpen(!navigationOpen); }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3.5" y="4" width="17" height="16" rx="2" stroke="currentColor" strokeWidth="1.5" /><path d="M9 4v16" stroke="currentColor" strokeWidth="1.5" /></svg>
        </button>
        <h1>{bookTitle}</h1>
      </div>
      <div className="toolbar-actions">
        {!navigationOpen && pageControls}
        <details className="supplement-filters" onPointerLeave={(event) => {
          if (event.pointerType !== 'mouse') return;
          const filters = event.currentTarget;
          if (filters.contains(document.activeElement)) filters.querySelector('summary')?.focus();
          filters.open = false;
        }}>
          <summary aria-label="显示补充类型" title="显示补充类型">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M4 7h16M4 17h16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              <circle cx="9" cy="7" r="2.5" fill="var(--surface)" stroke="currentColor" strokeWidth="1.5" />
              <circle cx="15" cy="17" r="2.5" fill="var(--surface)" stroke="currentColor" strokeWidth="1.5" />
            </svg>
          </summary>
          <div className="filter-options">
            {(Object.entries(supplementTypes) as [SupplementType, string][]).map(([type, label]) => <label key={type}>
              <TypeMarker type={type} /><span>{label}</span>
              <input className="sr-only" type="checkbox" checked={!hiddenTypes.includes(type)} onChange={() => {
                setHiddenTypes(hiddenTypes.includes(type) ? hiddenTypes.filter((value) => value !== type) : [...hiddenTypes, type]);
                clearPreview(); closeSupplement(); setPersonalItem(null);
              }} />
              <svg className="filter-check" width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="m5 12 4 4L19 6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </label>)}
            {hiddenIds.length > 0 && <button className="text-button" onClick={() => setHiddenIds([])}>恢复隐藏的 {hiddenIds.length} 条补充</button>}
          </div>
        </details>
        <button className="text-button" onClick={() => { closeSupplement(); setPersonalItem(null); clearPreview(); setSelectionPage(currentPage); }}>添加补充</button>
      </div>
    </header>
    {selectionPage !== null && <div className="selection-help" role="status">在第 {selectionPage} 页拖动框选段落；键盘可用方向键调整，Enter 确认。<button className="text-button" onClick={() => setSelectionPage(null)}>取消</button></div>}
    {loaded.error && <p className="storage-error" role="alert">{loaded.error}</p>}
    {readingError && <p className="storage-error" role="status">{readingError}</p>}
    <main className={`reading-layout${navigationOpen ? " navigation-open" : ""}${note || choiceIds || personalItem ? " supplement-open" : ""}`}>
      <nav id="page-sidebar" className="page-sidebar" hidden={!navigationOpen} aria-label="页面导航">
        {navigationOpen && pageControls}
        <div className="page-thumbnails" ref={thumbnailList}>
          {pages.map((page) => <button id={`thumbnail-${page.page}`} key={page.page} className="page-thumbnail"
            tabIndex={page.page === currentPage ? 0 : -1} aria-label={`跳转到文件第 ${page.page} 页，${page.printedPage === null ? "无印刷页码" : pageLabel(page)}`} aria-current={page.page === currentPage ? "page" : undefined}
            onKeyDown={(event) => {
              const number = event.key === "ArrowDown" ? page.page + 1 : event.key === "ArrowUp" ? page.page - 1 : event.key === "Home" ? 1 : event.key === "End" ? pageCount : null;
              if (number !== null) { event.preventDefault(); document.getElementById(`thumbnail-${Math.max(1, Math.min(pageCount, number))}`)?.focus(); }
            }} onClick={() => { void navigate({ page: page.page }); }}>
            <img src={page.thumbnail} alt="" width="80" height="112" loading="lazy" /><span>文件第 {page.page} 页</span><span>{page.printedPage === null ? "无印刷页码" : pageLabel(page)}</span>
          </button>)}
        </div>
      </nav>
      <div className="paper-scroller" ref={scroller} tabIndex={0} aria-label="教材连续阅读"
        onClick={(event) => {
          const target = event.target as HTMLElement;
          if (!target.matches('.page-image') && target !== event.currentTarget) return;
          const bottomPanel = window.matchMedia('(max-width: 1100px)').matches && (note || choiceIds || personalItem);
          if (!bottomPanel && !preview?.anchor.docked) return;
          if (document.querySelector('[data-dirty="true"]') && !window.confirm('有尚未保存的内容，放弃修改？')) return;
          keepPreview(); clearPreview();
          if (bottomPanel) { closeSupplement(); setPersonalItem(null); setEditingNote(null); }
        }}
        onWheel={cancelJump} onTouchStart={cancelJump} onKeyDown={(event) => {
          if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(event.key)) cancelJump();
        }}>
        <div className="paper-list" ref={pageList}>
          {pages.map((page) => <section id={`page-${page.page}`} key={page.page} className="paper" tabIndex={-1}
            aria-label={`教材文件第 ${page.page} 页，${page.printedPage === null ? "无印刷页码" : pageLabel(page)}`} style={{ aspectRatio: `${page.width} / ${page.height}` }}>
            <PageImage page={page} />
            {highlightedLocations.filter((location) => location.page === page.page).map((highlighted) => <div key={highlighted.id} id={`location-${highlighted.id}`} className={`location-highlight${previewNote || groupPreview ? " preview-highlight" : ""}`} tabIndex={-1}
              aria-label={`教材位置：${highlighted.anchorLabel}`} style={{ left: `${highlighted.region.x * 100}%`, top: `${highlighted.region.y * 100}%`,
                width: `${highlighted.region.width * 100}%`, height: `${highlighted.region.height * 100}%` }} />)}
            {groupMarkers(supplementsForPage(page.page).filter((item) => !hiddenIds.includes(item.id) && !hiddenTypes.includes(supplementType(item))).map((item) => {
              const { marker } = getLocation(item.locationId);
              return { id: item.id, x: marker.x * paperWidth, y: marker.y * paperWidth * page.height / page.width };
            }), markerSize).map((group) => {
              const item = getSupplement(group[0]!.id)!;
              const location = getLocation(item.locationId);
              const ids = group.map(({ id }) => id);
              const grouped = group.length > 1;
              return <button key={item.id} id={`supplement-${item.id}`} className="supplement-marker" data-supplement-ids={ids.join(' ')}
                style={{ left: `${location.marker.x * 100}%`, top: `${location.marker.y * 100}%` }}
                aria-label={grouped ? `选择此处的${group.length}条解读` : `${supplementTypes[supplementType(item)]}：${item.title}`}
                aria-expanded={ids.includes(supplementId ?? '') || !!choiceIds?.some((id) => ids.includes(id)) || preview?.id === item.id}
                aria-controls={grouped || ids.includes(supplementId ?? '') ? "supplement-panel" : preview?.id === item.id ? "supplement-preview" : undefined}
                aria-describedby={preview?.id === item.id ? "supplement-preview" : undefined}
                onPointerEnter={(event) => { if (event.pointerType !== "touch") { if (grouped) showGroupPreview(ids); else showPreview(item.id, event.currentTarget); } }}
                onPointerLeave={leavePreview} onFocus={(event) => { if (!suppressPreviewFocus.current) { if (grouped) showGroupPreview(ids); else showPreview(item.id, event.currentTarget); } }}
                onBlur={(event) => { if (!(event.relatedTarget instanceof Node) || !document.getElementById("supplement-preview")?.contains(event.relatedTarget)) leavePreview(); }}
                onClick={() => grouped ? openChoices(ids) : openSupplement(item.id)}><TypeMarker type={grouped ? "group" : supplementType(item)} />
                {grouped && <span className="marker-count" aria-hidden="true">{group.length}</span>}
              </button>;
            })}
            {!hiddenTypes.includes('personal') && personal.supplements.filter((item) => item.page === page.page && !hiddenIds.includes(item.id)).map((item) => <button key={item.id} className="supplement-marker personal-marker" aria-label={`我的补充：${item.title}`}
              style={{ left: `${Math.min(.97, item.region.x + item.region.width) * 100}%`, top: `${item.region.y * 100}%` }}
              onClick={() => { closeSupplement(); clearPreview(); setPersonalItem(item); setSelectionPage(null); }}><TypeMarker type="personal" /></button>)}
            {personalItem?.page === page.page && <div className="location-highlight" style={{ left: `${personalItem.region.x * 100}%`, top: `${personalItem.region.y * 100}%`, width: `${personalItem.region.width * 100}%`, height: `${personalItem.region.height * 100}%` }} />}
            {selectionPage === page.page && <RegionSelector onSelect={(region) => {
              setPersonalItem({ id: crypto.randomUUID(), title: '', markdown: '', page: page.page, region });
              setSelectionPage(null);
            }} />}
          </section>)}
        </div>
      </div>
      {(personalItem || choiceIds || note) && <PanelResize />}
      {personalItem && <PersonalPanel onEdit={cancelJump} key={personalItem.id} item={personalItem} isNew={!personal.supplements.some((item) => item.id === personalItem.id)}
        onClose={() => setPersonalItem(null)} onSave={async (item) => {
          await storePersonal((current) => ({ ...current, supplements: [...current.supplements.filter((value) => value.id !== item.id), item] }));
          setHiddenTypes((types) => types.filter((type) => type !== 'personal'));
          setPersonalItem((current) => current?.id === item.id ? item : current);
        }} onDelete={async () => {
          await storePersonal((current) => ({ ...current, supplements: current.supplements.filter((item) => item.id !== personalItem.id) }));
          setPersonalItem((current) => current?.id === personalItem.id ? null : current);
        }} />}
      {!personalItem && (choiceIds || note) && <SupplementPanel key={choiceIds?.join(" ") ?? note?.id} notes={choiceIds ? choiceIds.map((id) => getSupplement(id)!) : [note!]}
        methodOpenIds={methodOpenIds} onMethodToggle={(id) => setMethodOpenIds((open) => open.includes(id) ? open.filter((value) => value !== id) : [...open, id])}
        expandedId={supplementId} onSelect={selectAccordion} pending={pending} onClose={closeSupplement} onRelated={relatedJump}
        onHide={(id) => { setHiddenIds([...hiddenIds, id]); closeSupplement(); }}
        renderPersonal={(item) => <section className="personal-note" aria-label="我的笔记">
          {!personal.notes[item.id] || editingNote === item.id ? <MarkdownEditor onEdit={() => { cancelJump(); setEditingNote(item.id); }} key={item.id} note value={personal.notes[item.id] ?? ''} label="笔记 Markdown" onSave={(value) => saveNote(item.id, value)} onSaved={() => setEditingNote(null)} onCancel={personal.notes[item.id] ? () => setEditingNote(null) : undefined} /> : <>
            <div className="note-heading"><h3>我的笔记</h3>
              <button className="text-button" onClick={() => setEditingNote(item.id)}>编辑</button>
            </div>
            <MarkdownContent>{personal.notes[item.id]!}</MarkdownContent>
          </>}
        </section>}
        activeLocationId={selectedLocation}
        onBack={previous ? () => { void navigate({ page: previous.page, restore: previous }); } : undefined} />}
    </main>
    {preview && previewNote && <SupplementPreview key={preview.id} note={previewNote} anchor={preview.anchor}
      onKeep={keepPreview} onLeave={leavePreview} />}
    {(pending || error) && <div className="reading-message" role={error ? "alert" : "status"}>
      <span>{error ?? "正在打开教材…"}</span>
      {error && <button className="text-button" onClick={() => { void navigate(retryJump.current); }}>重试</button>}
    </div>}
  </div>;
}
