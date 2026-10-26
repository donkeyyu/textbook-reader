import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import './split.css';

type View = 'book' | 'graph';

export function useReadingViews() {
  const [open, setOpen] = useState({ book: true, graph: false });
  const [active, setActive] = useState<View>('book');
  const [narrow, setNarrow] = useState(() => window.matchMedia('(max-width: 1000px)').matches);
  const panelPosition = useRef<{ element: HTMLElement; context: string; top: number } | null>(null);
  const focusOwner = useRef<Element | null>(null);

  useEffect(() => {
    const remember = (event: FocusEvent) => {
      const target = event.target;
      focusOwner.current = target instanceof Element && target.closest('.paper-scroller, .book-navigation, .book-navigation-toggle, .book-toolbar, .supplement-graph, .split-resize') ? target : null;
    };
    document.addEventListener('focusin', remember);
    return () => document.removeEventListener('focusin', remember);
  }, []);

  function panelContext(element: HTMLElement) {
    return element.querySelector('details[open] summary')?.id ?? '';
  }

  function capturePanelScroll() {
    const element = document.getElementById('supplement-panel');
    if (!element) { panelPosition.current = null; return 0; }
    const context = panelContext(element);
    const previous = panelPosition.current;
    const max = element.scrollHeight - element.clientHeight;
    // A taller view can temporarily fit the whole panel and clamp its scroll.
    const clamped = previous?.element === element && previous.context === context && previous.top > max && element.scrollTop >= max - 1;
    panelPosition.current = { element, context, top: clamped ? previous.top : element.scrollTop };
    return panelPosition.current.top;
  }

  useEffect(() => {
    const media = window.matchMedia('(max-width: 1000px)');
    const changed = () => { capturePanelScroll(); setNarrow(media.matches); };
    media.addEventListener('change', changed);
    return () => media.removeEventListener('change', changed);
  }, []);

  function show(view: View, only = false) {
    capturePanelScroll();
    setOpen((current) => only ? { book: view === 'book', graph: view === 'graph' } : { ...current, [view]: true });
    setActive(view);
  }

  function close(view: View) {
    capturePanelScroll();
    setOpen((current) => ({ ...current, [view]: false }));
    setActive(view === 'book' ? 'graph' : 'book');
    requestAnimationFrame(() => document.getElementById('graph-book-toggle')?.focus({ preventScroll: true }));
  }

  const bookVisible = open.book && (!narrow || active === 'book');
  const graphVisible = open.graph && (!narrow || active === 'graph');
  useLayoutEffect(() => {
    const saved = panelPosition.current;
    if (saved && document.getElementById('supplement-panel') === saved.element && panelContext(saved.element) === saved.context) {
      saved.element.scrollTop = saved.top;
    }
  }, [open, active, narrow]);
  useEffect(() => {
    // Native hidden/inert handling can blur the source before this effect runs.
    const current = document.activeElement;
    const focused = current === document.body || current === document.documentElement ? focusOwner.current : current;
    if ((!bookVisible && focused?.closest('.paper-scroller, .book-navigation, .book-navigation-toggle, .book-toolbar')) || (!graphVisible && focused?.closest('.supplement-graph')) ||
      (narrow && focused?.classList.contains('split-resize'))) {
      document.getElementById('open-supplement-graph')?.focus({ preventScroll: true });
    }
  }, [bookVisible, graphVisible, narrow]);
  return { open, narrow, bookVisible, graphVisible, split: bookVisible && graphVisible, show, close, capturePanelScroll };
}

/** Keep the width on the layout element so dragging does not rerender the book. */
export function SplitResize() {
  const handle = useRef<HTMLDivElement>(null);
  const [share, setShare] = useState(45);

  function resize(value: number) {
    const next = Math.max(30, Math.min(70, value));
    handle.current?.parentElement?.style.setProperty('--graph-share', `${next}fr`);
    handle.current?.parentElement?.style.setProperty('--book-share', `${100 - next}fr`);
    setShare(next);
  }

  return <div ref={handle} className="split-resize" role="separator" tabIndex={0}
    aria-label="调整节点图与教材宽度" aria-orientation="vertical" aria-controls="supplement-graph textbook-view"
    aria-valuemin={30} aria-valuemax={70} aria-valuenow={Math.round(share)} aria-valuetext={`节点图 ${Math.round(share)}%`}
    onPointerDown={(event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.currentTarget.focus();
      event.currentTarget.setPointerCapture(event.pointerId);
    }} onPointerMove={(event) => {
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
      const bounds = event.currentTarget.parentElement!.getBoundingClientRect();
      if (bounds.width) resize((event.clientX - bounds.left) / bounds.width * 100);
    }} onPointerUp={(event) => {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    }} onKeyDown={(event) => {
      const next = event.key === 'ArrowLeft' ? share - 5 : event.key === 'ArrowRight' ? share + 5
        : event.key === 'Home' ? 30 : event.key === 'End' ? 70 : null;
      if (next !== null) { event.preventDefault(); event.stopPropagation(); resize(next); }
    }}><span aria-hidden="true" /></div>;
}
