import { useEffect, useRef, type PointerEvent } from 'react';
import type { Rect } from '../../desktop/anchors';
import { RegionSelector } from '../reader/book/RegionSelector';
export type SelectionPage = { textbook: string; pdf_page: number; rects: Rect[] };
export function AnchorRegions({ page, items, drawing, selected, onAdd, onSelect, onChange }: { page: number; items: SelectionPage[]; drawing: boolean; selected: string; onAdd: (rect: Rect) => void; onSelect: (key: string) => void; onChange: (item: number, rect: number, next: Rect) => void }) {
  const layer = useRef<HTMLDivElement>(null);
  useEffect(() => { if (drawing) layer.current?.querySelector<HTMLElement>('.region-selector')?.focus({ preventScroll: true }); }, [drawing]);
  const drag = useRef<{ pointer: number; x: number; y: number; rect: Rect; resize: boolean } | null>(null);
  function point(event: PointerEvent<HTMLElement>) {
    const bounds = event.currentTarget.parentElement!.getBoundingClientRect();
    return { x: (event.clientX - bounds.left) / bounds.width, y: (event.clientY - bounds.top) / bounds.height };
  }
  return <div ref={layer} className={`desktop-region-layer${drawing ? ' drawing' : ''}`}>{drawing && <RegionSelector onSelect={({ x, y, width, height }) => onAdd([x, y, width, height])} />}
    {items.flatMap((item, i) => item.pdf_page !== page ? [] : item.rects.map((rect, j) => {
      const key = `${i}:${j}`, [x, y, width, height] = rect;
      return <div key={key} className="desktop-region" role="button" tabIndex={0} aria-label={`文件 ${page} 区域 ${j + 1}，拖动移动，Shift 方向键调整大小`} aria-pressed={selected === key} style={{ left: `${x * 100}%`, top: `${y * 100}%`, width: `${width * 100}%`, height: `${height * 100}%` }}
        onPointerDown={(event) => {
          if (!event.isPrimary || event.button !== 0) return;
          event.preventDefault(); event.stopPropagation(); event.currentTarget.focus({ preventScroll: true }); onSelect(key);
          drag.current = { pointer: event.pointerId, ...point(event), rect, resize: (event.target as HTMLElement).classList.contains('desktop-region-handle') };
          event.currentTarget.setPointerCapture(event.pointerId);
        }} onPointerMove={(event) => {
          const start = drag.current; if (!start || start.pointer !== event.pointerId) return;
          const p = point(event), dx = p.x - start.x, dy = p.y - start.y, [x, y, w, h] = start.rect;
          const next: Rect = start.resize ? [x, y, Math.min(1 - x, Math.max(.01, w + dx)), Math.min(1 - y, Math.max(.01, h + dy))] : [Math.max(0, Math.min(1 - w, x + dx)), Math.max(0, Math.min(1 - h, y + dy)), w, h];
          onChange(i, j, next);
        }} onPointerUp={(event) => { drag.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }} onPointerCancel={() => { drag.current = null; }}
        onClick={(event) => { event.stopPropagation(); onSelect(key); }} onKeyDown={(event) => {
          if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
          event.preventDefault(); event.stopPropagation(); onSelect(key);
          const dx = event.key === 'ArrowLeft' ? -.01 : event.key === 'ArrowRight' ? .01 : 0, dy = event.key === 'ArrowUp' ? -.01 : event.key === 'ArrowDown' ? .01 : 0;
          onChange(i, j, event.shiftKey ? [x, y, Math.min(1 - x, Math.max(.01, width + dx)), Math.min(1 - y, Math.max(.01, height + dy))] : [Math.max(0, Math.min(1 - width, x + dx)), Math.max(0, Math.min(1 - height, y + dy)), width, height]);
        }}><span className="desktop-region-handle" aria-hidden="true" /></div>;
    }))}
  </div>;
}
