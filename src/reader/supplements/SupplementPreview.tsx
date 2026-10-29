import { useLayoutEffect, useRef, useState } from 'react';
import type { Supplement } from '../../textbook/supplements';
import { supplementType } from './supplement-types';
import { MathText } from '../text/MathText';

export type PreviewAnchor = { left: number; top: number; width: number; docked: boolean; maxHeight?: number };

export function SupplementPreview({ note, anchor, onKeep, onLeave }: {
  note: Supplement;
  anchor: PreviewAnchor;
  onKeep: () => void;
  onLeave: () => void;
}) {
  const element = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState(76);
  useLayoutEffect(() => {
    if (!element.current || anchor.docked) return;
    const { height } = element.current.getBoundingClientRect();
    setTop(Math.max(76, Math.min(anchor.top, window.innerHeight - height - 12)));
  }, [anchor, note]);
  return <div ref={element} id="supplement-preview" className={`supplement-preview${anchor.docked ? " preview-docked" : ""}`} role="tooltip" aria-label={note.title} data-supplement-type={supplementType(note)}
    style={anchor.docked ? { maxHeight: anchor.maxHeight } : { left: anchor.left, top, width: anchor.width }} onPointerEnter={onKeep} onPointerLeave={onLeave} onFocus={onKeep}
    onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) onLeave(); }}>
    <p><MathText text={note.preview} /></p>
    <p className="preview-hint">点击标记展开解读</p>
  </div>;
}
