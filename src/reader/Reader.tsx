import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { bookTitle, getPage, pageCount, pages } from "../textbook/catalog";
import { getLocation, getSupplement, supplementsForPage } from "../textbook/supplements";
import { readingPage, restoredScroll, type PageMetric } from "./session";
import { SupplementPanel, SupplementPreview, type PreviewAnchor } from "./Supplement";

type ReadingContext = {
  page: number;
  fraction: number;
  supplementId: string | null;
  locationId: string | null;
  focusId: string;
  panelScroll: number;
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
  const [currentPage, setCurrentPage] = useState(1);
  const [pageInput, setPageInput] = useState("1");
  const [pageError, setPageError] = useState(false);
  const [navigationOpen, setNavigationOpen] = useState(() => window.matchMedia("(min-width: 761px)").matches);
  const [supplementId, setSupplementId] = useState<string | null>(null);
  const [selectedLocation, setSelectedLocation] = useState<string | null>(null);
  const [history, setHistory] = useState<ReadingContext[]>([]);
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

    function updatePosition() {
      if (!element) return;
      const page = readingPage(metrics.current, element.scrollTop, element.clientHeight, element.scrollHeight);
      const metric = metrics.current[page - 1];
      current.current = page;
      setCurrentPage(page);
      if (metric) anchor.current = { page, fraction: (element.scrollTop - metric.top) / metric.height };
    }

    function measure() {
      if (!element || !list) return;
      const saved = anchor.current;
      const resized = width > 0 && width !== list.clientWidth;
      width = list.clientWidth;
      metrics.current = measurePages(list);
      const metric = metrics.current[saved.page - 1];
      if (resized && metric) element.scrollTop = restoredScroll(metric, saved.fraction);
      updatePosition();
    }

    function scroll() {
      if (navigationPending.current) {
        requestId.current += 1;
        navigationPending.current = false;
        setPending(false);
        setError(null);
      }
      setPreview(null);
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(updatePosition);
    }
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    observer.observe(element);
    element.addEventListener("scroll", scroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      element.removeEventListener("scroll", scroll);
    };
  }, []);

  useEffect(() => {
    if (document.activeElement?.id !== "page-input") {
      setPageInput(String(currentPage));
      setPageError(false);
    }
    const list = thumbnailList.current;
    const selected = document.getElementById(`thumbnail-${currentPage}`);
    if (list && selected) {
      if (selected.offsetTop < list.scrollTop) list.scrollTop = selected.offsetTop;
      else if (selected.offsetTop + selected.offsetHeight > list.scrollTop + list.clientHeight) {
        list.scrollTop = selected.offsetTop + selected.offsetHeight - list.clientHeight;
      }
    }
  }, [currentPage, navigationOpen]);

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
    setPageInput(String(commit.page));
    setPageError(false);
    const panel = document.getElementById("supplement-panel");
    if (panel && commit.panelScroll !== undefined) panel.scrollTop = commit.panelScroll;
    document.getElementById(commit.focusId)?.focus({ preventScroll: true });
    setCommit(null);
  }, [commit]);

  useEffect(() => {
    const closePreview = () => setPreview(null);
    window.addEventListener("resize", closePreview);
    return () => {
      requestId.current += 1;
      clearTimeout(previewTimer.current);
      window.removeEventListener("resize", closePreview);
    };
  }, []);

  function focusMarker(id: string) {
    suppressPreviewFocus.current = true;
    document.getElementById(`supplement-${id}`)?.focus({ preventScroll: true });
    suppressPreviewFocus.current = false;
  }
  function keepPreview() { clearTimeout(previewTimer.current); }
  function leavePreview() {
    keepPreview();
    previewTimer.current = setTimeout(() => setPreview(null), preview?.anchor.docked ? 500 : 180);
  }
  function showPreview(id: string, button: HTMLButtonElement) {
    keepPreview();
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

  function openSupplement(id: string) {
    cancelJump();
    keepPreview();
    setPreview(null);
    setSelectedLocation(null);
    setSupplementId(id);
    setHistory([]);
    if (window.matchMedia("(max-width: 760px)").matches) setNavigationOpen(false);
    requestAnimationFrame(() => {
      const panel = document.getElementById("supplement-panel");
      if (panel) panel.scrollTop = 0;
      document.getElementById("supplement-title")?.focus({ preventScroll: true });
    });
  }

  function closeSupplement() {
    cancelJump();
    const id = supplementId;
    setSupplementId(null);
    setSelectedLocation(null);
    setHistory([]);
    requestAnimationFrame(() => {
      const marker = id ? document.getElementById(`supplement-${id}`)?.getBoundingClientRect() : undefined;
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
      supplementId, locationId: selectedLocation, focusId,
      panelScroll: document.getElementById("supplement-panel")?.scrollTop ?? 0,
    } });
  }

  async function navigate(jump: Jump) {
    const target = getPage(jump.page);
    const id = ++requestId.current;
    retryJump.current = jump;
    navigationPending.current = true;
    setPreview(null);
    setPending(true);
    setError(null);
    try {
      const image = new Image();
      image.src = target.image;
      await image.decode();
      if (requestId.current !== id) return;
      if (jump.source) setHistory((previous) => [...previous, jump.source!]);
      else if (!jump.restore) setHistory([]);
      if (jump.restore) {
        setHistory((previous) => previous.slice(0, -1));
        setSupplementId(jump.restore.supplementId);
        setSelectedLocation(jump.restore.locationId);
      } else {
        const note = jump.locationId ? supplementsForPage(jump.page).find((item) => item.locationId === jump.locationId) : undefined;
        // A textbook-only target keeps the source explanation and its return control.
        setSupplementId(note?.id ?? (jump.locationId ? supplementId : null));
        setSelectedLocation(jump.locationId ?? null);
      }
      setCommit({ page: jump.page, fraction: jump.restore?.fraction, locationId: jump.locationId, panelScroll: jump.restore?.panelScroll,
        focusId: jump.restore?.focusId ?? (jump.locationId ? `location-${jump.locationId}` : `page-${jump.page}`) });
      if (window.matchMedia("(max-width: 760px)").matches) setNavigationOpen(false);
    } catch {
      if (requestId.current === id) {
        setPageInput(String(current.current));
        setError(`第 ${jump.page} 页暂时无法加载，当前阅读位置已保留。`);
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
  const highlighted = previewNote ? getLocation(previewNote.locationId) : selectedLocation ? getLocation(selectedLocation) : undefined;
  const previous = history.at(-1);

  const pageControls = <div className="page-controls">
    <form className="page-jump" onSubmit={(event) => {
      event.preventDefault();
      const page = Number(pageInput);
      if (!/^\d+$/.test(pageInput) || !Number.isInteger(page) || page < 1 || page > pageCount) { setPageError(true); return; }
      void navigate({ page });
    }}>
      <input id="page-input" aria-label="PDF页码" aria-invalid={pageError} aria-describedby={pageError ? "page-input-error" : undefined}
        inputMode="numeric" value={pageInput} onChange={(event) => { setPageInput(event.target.value); setPageError(false); }}
        onBlur={() => { setPageInput(String(current.current)); setPageError(false); }}
        onFocus={(event) => event.currentTarget.select()} />
      <span aria-label={`共 ${pageCount} 页`}>/ {pageCount}</span>
      <button className="sr-only" type="submit">跳转页面</button>
    </form>
    {pageError && <p id="page-input-error" className="page-input-error" role="alert">输入 1–{pageCount}</p>}
    <div className="page-step-controls">
      <button className="icon-button" aria-label="上一页" disabled={currentPage === 1 || pending} onClick={() => { void navigate({ page: currentPage - 1 }); }}><Chevron direction="left" /></button>
      <button className="icon-button" aria-label="下一页" disabled={currentPage === pageCount || pending} onClick={() => { void navigate({ page: currentPage + 1 }); }}><Chevron direction="right" /></button>
    </div>
  </div>;

  return <div className="reader-app" onKeyDown={(event) => {
    if (event.key !== "Escape") return;
    if (preview) {
      setPreview(null);
      focusMarker(preview.id);
    } else if (supplementId) closeSupplement();
    else if (navigationOpen) {
      setNavigationOpen(false);
      toggleButton.current?.focus();
    }
  }}>
    <header className="toolbar">
      <div className="book-heading">
        <button ref={toggleButton} className="icon-button navigation-toggle" aria-label={navigationOpen ? "收起页面导航" : "展开页面导航"}
          aria-expanded={navigationOpen} aria-controls="page-sidebar" onClick={() => { setPreview(null); setNavigationOpen(!navigationOpen); }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3.5" y="4" width="17" height="16" rx="2" stroke="currentColor" strokeWidth="1.5" /><path d="M9 4v16" stroke="currentColor" strokeWidth="1.5" /></svg>
        </button>
        <h1>{bookTitle}</h1>
      </div>
      <div className="toolbar-actions">
        {!navigationOpen && pageControls}
      </div>
    </header>
    <main className={`reading-layout${navigationOpen ? " navigation-open" : ""}${note ? " supplement-open" : ""}`}>
      <nav id="page-sidebar" className="page-sidebar" hidden={!navigationOpen} aria-label="页面导航">
        {navigationOpen && pageControls}
        <div className="page-thumbnails" ref={thumbnailList}>
          {pages.map((page) => <button id={`thumbnail-${page.page}`} key={page.page} className="page-thumbnail"
            tabIndex={page.page === currentPage ? 0 : -1} aria-label={`跳转到第 ${page.page} 页`} aria-current={page.page === currentPage ? "page" : undefined}
            onKeyDown={(event) => {
              const number = event.key === "ArrowDown" ? page.page + 1 : event.key === "ArrowUp" ? page.page - 1 : event.key === "Home" ? 1 : event.key === "End" ? pageCount : null;
              if (number !== null) { event.preventDefault(); document.getElementById(`thumbnail-${Math.max(1, Math.min(pageCount, number))}`)?.focus(); }
            }} onClick={() => { void navigate({ page: page.page }); }}>
            <img src={page.thumbnail} alt="" width="80" height="112" loading="lazy" /><span>{page.page}</span>
          </button>)}
        </div>
      </nav>
      <div className="paper-scroller" ref={scroller} tabIndex={0} aria-label="教材连续阅读"
        onWheel={cancelJump} onTouchStart={cancelJump} onKeyDown={(event) => {
          if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(event.key)) cancelJump();
        }}>
        <div className="paper-list" ref={pageList}>
          {pages.map((page) => <section id={`page-${page.page}`} key={page.page} className="paper" tabIndex={-1}
            aria-label={`教材第 ${page.page} 页`} style={{ aspectRatio: `${page.width} / ${page.height}` }}>
            <PageImage page={page} />
            {highlighted?.page === page.page && <div id={`location-${highlighted.id}`} className={`location-highlight${previewNote ? " preview-highlight" : ""}`} tabIndex={-1}
              aria-label={`教材位置：${highlighted.anchorLabel}`} style={{ left: `${highlighted.region.x * 100}%`, top: `${highlighted.region.y * 100}%`,
                width: `${highlighted.region.width * 100}%`, height: `${highlighted.region.height * 100}%` }} />}
            {supplementsForPage(page.page).map((item) => {
              const location = getLocation(item.locationId);
              return <button key={item.id} id={`supplement-${item.id}`} className="supplement-marker"
                style={{ left: `${location.marker.x * 100}%`, top: `${location.marker.y * 100}%` }}
                aria-label={`解读：${item.title}`} aria-expanded={supplementId === item.id || preview?.id === item.id}
                aria-controls={supplementId === item.id ? "supplement-panel" : preview?.id === item.id ? "supplement-preview" : undefined}
                aria-describedby={preview?.id === item.id ? "supplement-preview" : undefined}
                onPointerEnter={(event) => { if (event.pointerType !== "touch") showPreview(item.id, event.currentTarget); }}
                onPointerLeave={leavePreview} onFocus={(event) => { if (!suppressPreviewFocus.current) showPreview(item.id, event.currentTarget); }}
                onBlur={(event) => { if (!(event.relatedTarget instanceof Node) || !document.getElementById("supplement-preview")?.contains(event.relatedTarget)) leavePreview(); }}
                onClick={() => openSupplement(item.id)}><span aria-hidden="true">💡</span></button>;
            })}
          </section>)}
        </div>
      </div>
      {note && <SupplementPanel key={note.id} note={note} pending={pending} onClose={closeSupplement} onRelated={relatedJump}
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
