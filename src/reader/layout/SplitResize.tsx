import { useRef, useState } from 'react';

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
