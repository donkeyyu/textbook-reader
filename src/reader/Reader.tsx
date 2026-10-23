import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { bookTitle, getPage, pageCount, pages } from "../textbook/catalog";
import { readingPage, restoredScroll, type PageMetric } from "./session";

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
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const pageList = useRef<HTMLDivElement>(null);
  const thumbnailList = useRef<HTMLDivElement>(null);
  const metrics = useRef<PageMetric[]>([]);
  const anchor = useRef({ page: 1, fraction: 0 });
  const current = useRef(1);
  const requestId = useRef(0);
  const retryPage = useRef(1);
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
      metrics.current = Array.from(list.children, (child) => {
        const page = child as HTMLElement;
        return { top: list.offsetTop + page.offsetTop, height: page.offsetHeight };
      });
      const metric = metrics.current[saved.page - 1];
      if (resized && metric) element.scrollTop = restoredScroll(metric, saved.fraction);
      updatePosition();
    }

    function scroll() {
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

  useEffect(() => () => { requestId.current += 1; }, []);

  function cancelJump() {
    requestId.current += 1;
    setPending(false);
    setError(null);
  }

  async function navigate(page: number) {
    const target = getPage(page);
    const id = ++requestId.current;
    retryPage.current = page;
    setPending(true);
    setError(null);
    try {
      const image = new Image();
      image.src = target.image;
      await image.decode();
      if (requestId.current !== id) return;
      const element = scroller.current;
      const metric = metrics.current[page - 1];
      if (element && metric) {
        element.scrollTop = metric.top - parseFloat(getComputedStyle(element).paddingTop);
        current.current = page;
        setCurrentPage(page);
        setPageInput(String(page));
        setPageError(false);
        document.getElementById(`page-${page}`)?.focus({ preventScroll: true });
      }
      if (window.matchMedia("(max-width: 760px)").matches) setNavigationOpen(false);
    } catch {
      if (requestId.current === id) {
        setPageInput(String(current.current));
        setError(`第 ${page} 页暂时无法加载，当前阅读位置已保留。`);
      }
    } finally {
      if (requestId.current === id) setPending(false);
    }
  }

  const pageControls = <div className="page-controls">
    <form className="page-jump" onSubmit={(event) => {
      event.preventDefault();
      const page = Number(pageInput);
      if (!/^\d+$/.test(pageInput) || !Number.isInteger(page) || page < 1 || page > pageCount) { setPageError(true); return; }
      void navigate(page);
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
      <button className="icon-button" aria-label="上一页" disabled={currentPage === 1 || pending} onClick={() => { void navigate(currentPage - 1); }}><Chevron direction="left" /></button>
      <button className="icon-button" aria-label="下一页" disabled={currentPage === pageCount || pending} onClick={() => { void navigate(currentPage + 1); }}><Chevron direction="right" /></button>
    </div>
  </div>;

  return <div className="reader-app" onKeyDown={(event) => {
    if (event.key === "Escape" && navigationOpen) {
      setNavigationOpen(false);
      toggleButton.current?.focus();
    }
  }}>
    <header className="toolbar">
      <div className="book-heading">
        <button ref={toggleButton} className="icon-button navigation-toggle" aria-label={navigationOpen ? "收起页面导航" : "展开页面导航"}
          aria-expanded={navigationOpen} aria-controls="page-sidebar" onClick={() => setNavigationOpen(!navigationOpen)}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3.5" y="4" width="17" height="16" rx="2" stroke="currentColor" strokeWidth="1.5" /><path d="M9 4v16" stroke="currentColor" strokeWidth="1.5" /></svg>
        </button>
        <h1>{bookTitle}</h1>
      </div>
      {!navigationOpen && pageControls}
    </header>
    <main className={`reading-layout${navigationOpen ? " navigation-open" : ""}`}>
      <nav id="page-sidebar" className="page-sidebar" hidden={!navigationOpen} aria-label="页面导航">
        {navigationOpen && pageControls}
        <div className="page-thumbnails" ref={thumbnailList}>
          {pages.map((page) => <button id={`thumbnail-${page.page}`} key={page.page} className="page-thumbnail"
            tabIndex={page.page === currentPage ? 0 : -1} aria-label={`跳转到第 ${page.page} 页`} aria-current={page.page === currentPage ? "page" : undefined}
            onKeyDown={(event) => {
              const number = event.key === "ArrowDown" ? page.page + 1 : event.key === "ArrowUp" ? page.page - 1 : event.key === "Home" ? 1 : event.key === "End" ? pageCount : null;
              if (number !== null) { event.preventDefault(); document.getElementById(`thumbnail-${Math.max(1, Math.min(pageCount, number))}`)?.focus(); }
            }} onClick={() => { void navigate(page.page); }}>
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
          </section>)}
        </div>
      </div>
    </main>
    {(pending || error) && <div className="reading-message" role={error ? "alert" : "status"}>
      <span>{error ?? "正在打开教材…"}</span>
      {error && <button className="text-button" onClick={() => { void navigate(retryPage.current); }}>重试</button>}
    </div>}
  </div>;
}
