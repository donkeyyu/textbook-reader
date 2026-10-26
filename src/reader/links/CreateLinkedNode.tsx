import { useEffect, useRef, useState } from 'react';
import type { NodeRef } from '../../textbook/content.ts';
import type { LinkContext } from './LinkContent.tsx';

export function CreateLinkedNode({ title: initialTitle, links, onDone }: {
  title: string; links: LinkContext; onDone: (target: { ref: NodeRef; title: string } | null) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [id] = useState(() => crypto.randomUUID());
  const [title, setTitle] = useState(initialTitle);
  const [markdown, setMarkdown] = useState('');
  const [chapterId, setChapterId] = useState(links.chapterId);
  const [sectionId, setSectionId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const dirty = !!title || !!markdown || saving;
  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault(); event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  return <dialog ref={dialog} className="create-linked-node" aria-labelledby="create-linked-node-title" onCancel={(event) => {
    event.preventDefault(); if (!saving) onDone(null);
  }} onKeyDown={(event) => event.stopPropagation()}>
    <form data-dirty={dirty} onSubmit={async (event) => {
      event.preventDefault();
      if (saving || !title.trim() || !markdown.trim()) return;
      setSaving(true); setError('');
      try {
        const ref = await links.onCreate({ id, title: title.trim(), markdown, chapterId, sectionId, page: null, region: null });
        onDone({ ref, title: title.trim() });
      } catch (cause) { setError(cause instanceof Error ? cause.message : '创建失败，请保留内容后重试。'); setSaving(false); }
    }}>
      <h3 id="create-linked-node-title">创建并链接补充</h3>
      <label>标题<input name="linked-title" autoFocus required maxLength={200} disabled={saving} value={title} onChange={(event) => setTitle(event.target.value)} /></label>
      <label>内容<textarea name="linked-body" required rows={5} disabled={saving} value={markdown} onChange={(event) => setMarkdown(event.target.value)} placeholder="写下这条补充的内容，支持 Markdown" /></label>
      <label>章节<select aria-label="新链接章节" disabled={saving} value={chapterId ?? ''} onChange={(event) => { setChapterId(event.target.value || null); setSectionId(null); }}>
        <option value="">未归属章节</option>{links.chapters.map((chapter) => <option key={chapter.id} value={chapter.id}>{chapter.title}</option>)}
      </select></label>
      {chapterId && <label>节<select aria-label="新链接节" disabled={saving} value={sectionId ?? ''} onChange={(event) => setSectionId(event.target.value || null)}>
        <option value="">未归属节</option>{links.sections.filter((section) => section.chapterId === chapterId).map((section) => <option key={section.id} value={section.id}>{section.title}</option>)}
      </select></label>}
      {error && <p role="alert">{error}</p>}
      <div className="editor-actions"><button className="text-button" type="button" disabled={saving} onClick={() => onDone(null)}>取消创建</button>
        <button className="text-button" type="submit" disabled={saving || !title.trim() || !markdown.trim()}>{saving ? '正在创建…' : '创建并链接'}</button></div>
    </form>
  </dialog>;
}
