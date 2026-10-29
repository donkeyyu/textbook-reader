import { LinkContent } from '../links/LinkContent';
import { LocateIcon } from '../../ui/LocateIcon';
import { useRef, useState, type ReactNode } from 'react';
import { MarkdownEditor } from '../links/MarkdownEditor';
import type { PersonalSupplement } from '../../content/personal';
import type { ChapterRef, SectionRef } from '../../textbook/sections';
import type { LinkContext } from '../links/LinkContent';
import './personal-library.css';

export function PersonalPanel({ item, isNew, chapters, sections, links, backlinks, onSave, onClose, onBack, onDelete, onEdit, onLocate }: {
  item: PersonalSupplement;
  isNew: boolean;
  chapters: ChapterRef[];
  sections: SectionRef[];
  links?: LinkContext;
  backlinks?: ReactNode;
  onSave: (item: PersonalSupplement) => void | Promise<void>;
  onClose: () => void;
  onBack: () => void;
  onDelete: () => void | Promise<void>;
  onEdit: () => void;
  onLocate: () => void;
}) {
  const [editing, setEditing] = useState(isNew);
  const [title, setTitle] = useState(item.title);
  const latestTitle = useRef(title);
  latestTitle.current = title;
  const [chapterId, setChapterId] = useState(item.chapterId ?? null);
  const [sectionId, setSectionId] = useState(item.sectionId ?? null);
  const metadataDirty = chapterId !== (item.chapterId ?? null) || sectionId !== (item.sectionId ?? null);
  const latestMetadata = useRef({ chapterId, sectionId });
  latestMetadata.current = { chapterId, sectionId };
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');
  return <aside id="supplement-panel" className="supplement-panel" aria-label="我的补充" data-supplement-type="personal">
    <div className="supplement-heading">
      <h2 id="supplement-title" tabIndex={-1}>{isNew ? '添加补充' : item.title}</h2>
      <div className="heading-actions">
        {item.page !== null && <button id="locate-personal" className="icon-button locate-button" aria-label="定位教材原文" title="定位教材原文" type="button" onClick={onLocate}><LocateIcon /></button>}
        {!editing && <button className="text-button" onClick={onClose}>关闭</button>}
      </div>
    </div>
    {editing ? <>
      <label className="personal-title">标题
        <input data-dirty={title !== item.title} value={title} maxLength={200} onChange={(event) => { latestTitle.current = event.target.value; setTitle(event.target.value); onEdit(); }} autoFocus />
      </label>
      <div className="personal-metadata" data-dirty={metadataDirty}>
        <label>章节<select aria-label="章节" value={chapterId ?? ''} onChange={(event) => { setChapterId(event.target.value || null); setSectionId(null); onEdit(); }}>
          <option value="">未归属章节</option>{chapters.map((chapter) => <option key={chapter.id} value={chapter.id}>{chapter.title}</option>)}
        </select></label>
        {chapterId && <label>节<select aria-label="节" value={sectionId ?? ''} onChange={(event) => { setSectionId(event.target.value || null); onEdit(); }}>
          <option value="">未归属节</option>{sections.filter((section) => section.chapterId === chapterId).map((section) => <option key={section.id} value={section.id}>{section.title}</option>)}
        </select></label>}
      </div>
      <MarkdownEditor additionalDirty={title !== item.title || metadataDirty} onEdit={onEdit} value={item.markdown} bindings={item.bindings}
        links={links ? { ...links, chapterId } : undefined} label="补充内容（Markdown）" onSave={(markdown, bindings) => {
        if (!title.trim()) throw new Error('请填写标题。');
        return onSave({ ...item, title: title.trim(), markdown, bindings, chapterId, sectionId });
      }} onSaved={() => {
        if (latestTitle.current === title && latestMetadata.current.chapterId === chapterId && latestMetadata.current.sectionId === sectionId) setEditing(false);
      }} onCancel={() => {
        if (isNew) onBack();
        else { setTitle(item.title); setChapterId(item.chapterId ?? null); setSectionId(item.sectionId ?? null); setEditing(false); }
      }} />
    </> : <>
      <button className="text-button personal-panel-back" type="button" onClick={onBack}>全部补充</button>
      <p className="personal-context">{chapters.find(({ id }) => id === item.chapterId)?.title ?? '未归属章节'}{item.sectionId ? ` · ${sections.find(({ id }) => id === item.sectionId)?.title ?? item.sectionId}` : ''}</p>
      <LinkContent bindings={item.bindings} links={links} markdown={item.markdown} />
      <div className="personal-actions">
        <button className="text-button" disabled={deleting} onClick={() => setEditing(true)}>编辑补充</button>
        <button className="text-button" disabled={deleting} onClick={() => setConfirmDelete(true)}>删除补充</button>
      </div>
      {confirmDelete && <div className="delete-confirmation">
        <p>删除这条个人补充？</p>
        <div className="personal-actions">
          <button className="text-button" disabled={deleting} onClick={async () => {
            setDeleting(true);
            try { await onDelete(); } catch (cause) { setError(cause instanceof Error ? cause.message : '删除失败，请重试。'); }
            finally { setDeleting(false); }
          }}>{deleting ? '删除中…' : '确认删除'}</button>
          <button className="text-button" disabled={deleting} onClick={() => { setConfirmDelete(false); setError(''); }}>保留</button>
        </div>
        {error && <p role="alert">{error}</p>}
      </div>}
    </>}
    {backlinks}
  </aside>;
}
