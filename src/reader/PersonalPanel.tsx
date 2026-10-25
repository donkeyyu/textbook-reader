import { useRef, useState } from 'react';
import { MarkdownContent, MarkdownEditor } from './MarkdownEditor';
import type { PersonalSupplement } from './personal';

export function PersonalPanel({ item, isNew, onSave, onClose, onDelete, onEdit }: {
  item: PersonalSupplement;
  isNew: boolean;
  onSave: (item: PersonalSupplement) => void | Promise<void>;
  onClose: () => void;
  onDelete: () => void | Promise<void>;
  onEdit: () => void;
}) {
  const [editing, setEditing] = useState(isNew);
  const [title, setTitle] = useState(item.title);
  const latestTitle = useRef(title);
  latestTitle.current = title;
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState('');
  return <aside id="supplement-panel" className="supplement-panel" aria-label="我的补充">
    <div className="supplement-heading">
      <h2 id="supplement-title" tabIndex={-1}>{isNew ? '添加补充' : item.title}</h2>
      {!editing && <button className="text-button" onClick={onClose}>关闭</button>}
    </div>
    {editing ? <>
      <label className="personal-title">标题
        <input data-dirty={title !== item.title} value={title} maxLength={200} onChange={(event) => { latestTitle.current = event.target.value; setTitle(event.target.value); onEdit(); }} autoFocus />
      </label>
      <MarkdownEditor additionalDirty={title !== item.title} onEdit={onEdit} value={item.markdown} label="补充内容（Markdown）" onSave={(markdown) => {
        if (!title.trim()) throw new Error('请填写标题。');
        return onSave({ ...item, title: title.trim(), markdown });
      }} onSaved={() => {
        if (latestTitle.current === title) setEditing(false);
      }} onCancel={() => {
        if (isNew) onClose();
        else { setTitle(item.title); setEditing(false); }
      }} />
    </> : <>
      <MarkdownContent>{item.markdown}</MarkdownContent>
      <div className="personal-actions">
        <button className="text-button" onClick={() => setEditing(true)}>编辑补充</button>
        <button className="text-button" onClick={() => setConfirmDelete(true)}>删除补充</button>
      </div>
      {confirmDelete && <div className="delete-confirmation">
        <p>删除这条个人补充？</p>
        <div className="personal-actions">
          <button className="text-button" onClick={async () => {
            try { await onDelete(); } catch (cause) { setError(cause instanceof Error ? cause.message : '删除失败，请重试。'); }
          }}>确认删除</button>
          <button className="text-button" onClick={() => { setConfirmDelete(false); setError(''); }}>保留</button>
        </div>
        {error && <p role="alert">{error}</p>}
      </div>}
    </>}
  </aside>;
}
