import { useLayoutEffect, useRef, useState } from "react";
import { getLocation, type Supplement } from "../textbook/supplements";

export type PreviewAnchor = { left: number; top: number; width: number; docked: boolean };

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
  return <div ref={element} id="supplement-preview" className={`supplement-preview${anchor.docked ? " preview-docked" : ""}`} role="tooltip" aria-label={note.title}
    style={anchor.docked ? undefined : { left: anchor.left, top, width: anchor.width }} onPointerEnter={onKeep} onPointerLeave={onLeave} onFocus={onKeep}
    onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) onLeave(); }}>
    <p>{note.preview}</p>
    <p className="preview-hint">点击灯泡展开解读</p>
  </div>;
}

export function SupplementPanel({ note, pending, onClose, onRelated, onBack, activeLocationId }: {
  note: Supplement;
  pending: boolean;
  onClose: () => void;
  onRelated: (locationId: string, focusId: string) => void;
  onBack?: () => void;
  activeLocationId: string | null;
}) {
  const relatedLinks = note.related.filter(({ locationId }) => locationId !== activeLocationId);
  return <aside id="supplement-panel" className="supplement-panel" aria-label="补充解读">
    <div className={`supplement-heading${onBack ? " has-return" : ""}`}>
      {onBack && <button className="text-button return-button" disabled={pending} onClick={onBack}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m14 6-6 6 6 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
        返回
      </button>}
      <h2 id="supplement-title" tabIndex={-1}>{note.title}</h2>
      <button className="icon-button" aria-label="关闭解读" onClick={onClose}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
      </button>
    </div>
    <div className="supplement-body">{note.paragraphs.map((paragraph, index) => <p key={index}>{paragraph}</p>)}</div>
    {relatedLinks.length > 0 && <div className="supplement-related" aria-label="关联教材">
      {relatedLinks.map((related) => {
        const location = getLocation(related.locationId);
        const focusId = `related-${note.id}-${related.locationId}`;
        return <div key={related.locationId}>
          <p>{related.purpose}</p>
          <button id={focusId} className="text-button" disabled={pending}
            onClick={() => onRelated(related.locationId, focusId)}>
            {related.label}<span className="related-page">{location.printedPage === null ? `PDF 第 ${location.page} 页` : `第 ${location.printedPage} 页`}</span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m9 5 7 7-7 7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
        </div>;
      })}
    </div>}
  </aside>;
}
