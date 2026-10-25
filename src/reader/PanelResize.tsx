import { useEffect, useRef, useState } from 'react';

/** Resize the stacked reader panel without rerendering the textbook pages. */
export function PanelResize() {
  const handle = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(45);

  useEffect(() => {
    const layout = handle.current?.parentElement;
    return () => { layout?.style.removeProperty('--supplement-height'); };
  }, []);

  function resize(value: number) {
    const next = Math.max(20, Math.min(80, value));
    handle.current?.parentElement?.style.setProperty('--supplement-height', `${next}%`);
    setSize(next);
  }

  return <div ref={handle} className="panel-resize" role="separator" tabIndex={0}
    aria-label="调整解读区域高度" aria-orientation="horizontal" aria-controls="supplement-panel"
    aria-valuemin={20} aria-valuemax={80} aria-valuenow={Math.round(size)} aria-valuetext={`${Math.round(size)}%`}
    onPointerDown={(event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.currentTarget.focus();
      event.currentTarget.setPointerCapture(event.pointerId);
    }}
    onPointerMove={(event) => {
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
      const bounds = event.currentTarget.parentElement!.getBoundingClientRect();
      if (bounds.height > 0) resize((bounds.bottom - event.clientY) / bounds.height * 100);
    }}
    onPointerUp={(event) => {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    }}
    onKeyDown={(event) => {
      const next = event.key === 'ArrowUp' ? size + 5 : event.key === 'ArrowDown' ? size - 5
        : event.key === 'Home' ? 20 : event.key === 'End' ? 80 : null;
      if (next !== null) { event.preventDefault(); event.stopPropagation(); resize(next); }
    }}><span aria-hidden="true" /></div>;
}
