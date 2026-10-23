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

export function SupplementPanel({ notes, expandedId, pending, onSelect, onClose, onRelated, onBack, activeLocationId }: {
  notes: Supplement[];
  expandedId: string | null;
  pending: boolean;
  onSelect: (id: string | null) => void;
  onClose: () => void;
  onRelated: (locationId: string, focusId: string) => void;
  onBack?: () => void;
  activeLocationId: string | null;
}) {
  const grouped = notes.length > 1;
  return <aside id="supplement-panel" className="supplement-panel" aria-label="补充解读">
    <div className={`supplement-heading${onBack ? " has-return" : ""}`}>
      {onBack && <button className="text-button return-button" disabled={pending} onClick={onBack}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m14 6-6 6 6 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
        返回
      </button>}
      <h2 id="supplement-title" tabIndex={-1}>{grouped ? "此处解读" : notes[0]!.title}</h2>
      <button className="icon-button" aria-label="关闭解读" onClick={onClose}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
      </button>
    </div>
    {notes.map((note) => grouped ? <details className="supplement-accordion" key={note.id} open={expandedId === note.id}>
      <summary id={`choice-${note.id}`} aria-controls={`content-${note.id}`} onClick={(event) => {
        event.preventDefault();
        onSelect(expandedId === note.id ? null : note.id);
      }}>
        <span>{note.title}</span>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m9 5 7 7-7 7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </summary>
      <div id={`content-${note.id}`} className="supplement-accordion-content" role="region" aria-labelledby={`choice-${note.id}`}>
        {expandedId === note.id && <SupplementContent note={note} pending={pending} onRelated={onRelated} activeLocationId={activeLocationId} />}
      </div>
    </details> : <SupplementContent key={note.id} note={note} pending={pending} onRelated={onRelated} activeLocationId={activeLocationId} />)}
  </aside>;
}

function SupplementContent({ note, pending, onRelated, activeLocationId }: {
  note: Supplement;
  pending: boolean;
  onRelated: (locationId: string, focusId: string) => void;
  activeLocationId: string | null;
}) {
  const relatedLinks = note.related.filter(({ locationId }) => locationId !== activeLocationId);
  return <>
    <div className="supplement-body">
      {note.questionGuide && <div className="question-guide">
        {([
          ['考查知识点', note.questionGuide.knowledgePoints],
          ['思路与方法', note.questionGuide.method],
          ['注意事项', note.questionGuide.cautions],
        ] as const).map(([label, items]) => <section key={label} aria-label={label}>
          <h3>{label}</h3>
          {items.map((item, index) => <p key={index}>{item}</p>)}
        </section>)}
      </div>}
      {note.paragraphs.map((paragraph, index) => <p key={index}>{paragraph}</p>)}
    </div>
    {relatedLinks.length > 0 && <div className="supplement-related" aria-label="关联教材">
      {note.questionGuide && <h3>相关知识</h3>}
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
  </>;
}
