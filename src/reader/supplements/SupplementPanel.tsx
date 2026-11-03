import { LocateIcon } from '../../ui/LocateIcon';
import type { ReactNode } from "react";
import { getLocation, type Supplement } from "../../textbook/supplements";
import { supplementType, supplementTypes, TypeMarker } from './supplement-types';
import { MathText } from '../text/MathText';
import { SupplementDiagram } from './SupplementDiagram';
import './supplement-appearance.css';
import { getPage, pageLabel } from "../../textbook/catalog";

export function SupplementPanel({ notes, expandedId, pending, onSelect, onClose, onRelated, onBack, onLocate, activeLocationId, renderPersonal, renderRelated, onHide, methodOpenIds, onMethodToggle }: {
  onHide: (id: string) => void;
  renderPersonal: (note: Supplement) => ReactNode;
  renderRelated?: (note: Supplement) => ReactNode;
  methodOpenIds: string[];
  onMethodToggle: (id: string) => void;
  notes: Supplement[];
  expandedId: string | null;
  pending: boolean;
  onSelect: (id: string | null) => void;
  onClose: () => void;
  onLocate: () => void;
  onRelated: (locationId: string, focusId: string) => void;
  onBack?: () => void;
  activeLocationId: string | null;
}) {
  const grouped = notes.length > 1;
  const activeNote = grouped ? notes.find((note) => note.id === expandedId) : notes[0];
  const types = new Set(notes.map(supplementType));
  const type = activeNote ? supplementType(activeNote) : types.size === 1 ? supplementType(notes[0]!) : 'group';
  return <aside id="supplement-panel" className="supplement-panel" aria-label="补充解读" data-supplement-type={type}>
    <div className={`supplement-heading${onBack ? " has-return" : ""}`}>
      <span className="supplement-kind"><TypeMarker type={type} />{type === 'group' ? '此处解读' : supplementTypes[type]}</span>
      {onBack && <button className="text-button return-button" disabled={pending} onClick={onBack}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m14 6-6 6 6 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
        返回
      </button>}
      <h2 id="supplement-title" tabIndex={-1}><span className="supplement-title-mark" aria-hidden="true"><TypeMarker type={type} /></span>{activeNote?.title ?? "此处解读"}</h2>
      <div className="heading-actions">
        <button className="icon-button hide-supplement" type="button" disabled={pending || !activeNote}
          aria-label={activeNote ? `隐藏解读：${activeNote.title}` : '隐藏当前解读'} title={activeNote ? `隐藏解读：${activeNote.title}` : '请先选择解读'}
          onClick={() => { if (activeNote) onHide(activeNote.id); }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="m3 3 18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.8 5.2A10.8 10.8 0 0 1 12 5c7 0 10 7 10 7a17.5 17.5 0 0 1-3 4M6.3 6.3A19.3 19.3 0 0 0 2 12s3 7 10 7a10.4 10.4 0 0 0 5.7-1.7" />
          </svg>
        </button>
        <button id="locate-supplement" className="icon-button locate-button" aria-label="定位教材原文" title="定位教材原文" type="button" disabled={pending || (grouped && !expandedId)} onClick={onLocate}><LocateIcon /><span className="locate-label">定位原文</span></button>
        <button className="icon-button" aria-label="关闭解读" onClick={onClose}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
        </button>
      </div>
    </div>
    {notes.map((note) => grouped ? <details className="supplement-accordion" key={note.id} open={expandedId === note.id}>
      <summary id={`choice-${note.id}`} aria-controls={`content-${note.id}`} onClick={(event) => {
        event.preventDefault();
        onSelect(expandedId === note.id ? null : note.id);
      }}>
        <span className="supplement-choice-title"><span className="supplement-choice-mark" data-supplement-type={supplementType(note)} aria-hidden="true"><TypeMarker type={supplementType(note)} /></span>{note.title}</span>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m9 5 7 7-7 7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </summary>
      <div id={`content-${note.id}`} className="supplement-accordion-content" role="region" aria-labelledby={`choice-${note.id}`}>
        {expandedId === note.id && <SupplementContent note={note} pending={pending} onRelated={onRelated} activeLocationId={activeLocationId} personal={renderPersonal(note)} related={renderRelated?.(note)} methodOpen={methodOpenIds.includes(note.id)} onMethodToggle={() => onMethodToggle(note.id)} />}
      </div>
    </details> : <SupplementContent key={note.id} note={note} pending={pending} onRelated={onRelated} activeLocationId={activeLocationId} personal={renderPersonal(note)} related={renderRelated?.(note)} methodOpen={methodOpenIds.includes(note.id)} onMethodToggle={() => onMethodToggle(note.id)} />)}
  </aside>;
}

function SupplementContent({ note, pending, onRelated, activeLocationId, personal, related, methodOpen, onMethodToggle }: {
  personal: ReactNode;
  related?: ReactNode;
  methodOpen: boolean;
  onMethodToggle: () => void;
  note: Supplement;
  pending: boolean;
  onRelated: (locationId: string, focusId: string) => void;
  activeLocationId: string | null;
}) {
  const relatedLinks = note.related.filter(({ locationId }) => locationId !== activeLocationId);
  // 正文是主内容；知识、方法、注意事项只在没有正文的旧条目中分栏呈现。
  const guide = note.questionGuide;
  const guideParts = guide && !guide.continuous ? ([
    ['knowledge', '考查知识点', guide.knowledgePoints ?? []],
    ['method', '思路与方法', guide.method],
    ['cautions', '注意事项', guide.cautions ?? []],
  ] as const).filter(([, , items]) => items.length > 0) : [];
  return <>
    <div className="supplement-body">
      {note.paragraphs.map((paragraph, index) => <div key={index}>
        <p><MathText text={paragraph} /></p>
        {index === 0 && <SupplementDiagram note={note} />}
      </div>)}
      {guide && (guide.continuous
        ? [...(guide.knowledgePoints ?? []), ...guide.method, ...(guide.cautions ?? [])].map((paragraph, index) => <p key={index}><MathText text={paragraph} /></p>)
        : <div className="question-guide">
        {guideParts.map(([part, label, items]) => <section key={label} aria-label={label} data-guide-part={part}>
          {label === '思路与方法' ? <>
            <h3><button id={`method-${note.id}`} type="button" className="text-button method-toggle"
              aria-expanded={methodOpen} aria-controls={`method-content-${note.id}`} onClick={onMethodToggle}>
              思路与方法<span className="method-toggle-label">{methodOpen ? '收起' : '展开'}</span>
              <svg className="method-toggle-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m9 5 7 7-7 7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button></h3>
            <div id={`method-content-${note.id}`} hidden={!methodOpen}>
              {items.map((item, index) => <p key={index}><MathText text={item} /></p>)}
            </div>
          </> : <>
            <h3>{label}</h3>
            {items.map((item, index) => <p key={index}><MathText text={item} /></p>)}
          </>}
        </section>)}
      </div>)}
    </div>
    {related !== undefined ? related : relatedLinks.length > 0 && <div className="supplement-related" aria-label="关联教材">
      <h3>关联回顾</h3>
      {relatedLinks.map((related) => {
        const location = getLocation(related.locationId);
        const focusId = `related-${note.id}-${related.locationId}`;
        return <div className="related-entry" key={related.locationId}>
          <button id={focusId} className="text-button related-target" disabled={pending}
            onClick={() => onRelated(related.locationId, focusId)}>
            <span className="related-title">{related.label}</span><span className="related-purpose">{related.purpose}</span><span className="related-page">{pageLabel(getPage(location.page))}</span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m9 5 7 7-7 7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
        </div>;
      })}
    </div>}
    {personal}
  </>;
}
