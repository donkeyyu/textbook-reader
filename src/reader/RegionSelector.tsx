import { useRef, useState, type PointerEvent } from 'react';
import type { PersonalSupplement } from './personal';

type Region = PersonalSupplement['region'];
const initial: Region = { x: .15, y: .4, width: .65, height: .1 };

export function RegionSelector({ onSelect }: { onSelect: (region: Region) => void }) {
  const [region, setRegion] = useState<Region>(initial);
  const start = useRef<{ x: number; y: number; pointerId: number } | null>(null);
  function point(event: PointerEvent<HTMLDivElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
      y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)),
    };
  }
  function selection(event: PointerEvent<HTMLDivElement>): Region {
    const end = point(event);
    const origin = start.current!;
    return { x: Math.min(origin.x, end.x), y: Math.min(origin.y, end.y), width: Math.abs(origin.x - end.x), height: Math.abs(origin.y - end.y) };
  }
  return <div className="region-selector" tabIndex={0} role="button"
    aria-label="选择补充段落：拖动框选；方向键移动选框，Shift 加方向键调整大小，Enter 确认"
    style={{ position: 'absolute', inset: 0, touchAction: 'none', cursor: 'crosshair' }}
    onPointerDown={(event) => {
      if (!event.isPrimary || event.button !== 0) return;
      event.preventDefault();
      event.currentTarget.focus({ preventScroll: true });
      start.current = { ...point(event), pointerId: event.pointerId };
      event.currentTarget.setPointerCapture(event.pointerId);
      setRegion({ ...point(event), width: 0, height: 0 });
    }} onPointerMove={(event) => {
      if (start.current?.pointerId === event.pointerId) setRegion(selection(event));
    }} onPointerUp={(event) => {
      if (start.current?.pointerId !== event.pointerId) return;
      const chosen = selection(event);
      start.current = null;
      event.currentTarget.releasePointerCapture(event.pointerId);
      if (chosen.width >= .02 && chosen.height >= .01) onSelect(chosen);
      else setRegion(initial);
    }} onPointerCancel={() => { start.current = null; setRegion(initial); }}
    onKeyDown={(event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault(); event.stopPropagation(); onSelect(region); return;
      }
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      const dx = event.key === 'ArrowLeft' ? -.01 : event.key === 'ArrowRight' ? .01 : 0;
      const dy = event.key === 'ArrowUp' ? -.01 : event.key === 'ArrowDown' ? .01 : 0;
      setRegion((previous) => event.shiftKey ? {
        ...previous, width: Math.max(.02, Math.min(1 - previous.x, previous.width + dx)),
        height: Math.max(.01, Math.min(1 - previous.y, previous.height + dy)),
      } : {
        ...previous, x: Math.max(0, Math.min(1 - previous.width, previous.x + dx)),
        y: Math.max(0, Math.min(1 - previous.height, previous.y + dy)),
      });
    }}>
    <div className="location-highlight" style={{ left: `${region.x * 100}%`, top: `${region.y * 100}%`, width: `${region.width * 100}%`, height: `${region.height * 100}%` }} />
  </div>;
}
