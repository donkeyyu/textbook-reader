import { useEffect, useId, useRef, useState } from 'react';
import { minimalSetup } from 'codemirror';
import { EditorView, placeholder } from '@codemirror/view';
import { markdown } from '@codemirror/lang-markdown';
import ReactMarkdown from 'react-markdown';

export function MarkdownContent({ children }: { children: string }) {
  return <div className="markdown-content"><ReactMarkdown>{children}</ReactMarkdown></div>;
}

export function MarkdownEditor({ value, onSave, onCancel, label = 'Markdown 内容', note = false, additionalDirty = false, onEdit }: {
  value: string;
  onSave: (value: string) => void;
  onCancel?: () => void;
  label?: string;
  note?: boolean;
  additionalDirty?: boolean;
  onEdit?: () => void;
}) {
  const [draft, setDraft] = useState(value);
  const [preview, setPreview] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = draft !== value || additionalDirty;
  const canSave = note ? dirty && !!(value.trim() || draft.trim()) : !!draft.trim();
  const id = useId();
  const editorHost = useRef<HTMLDivElement>(null);
  const initialValue = useRef(value);
  useEffect(() => {
    if (!editorHost.current) return;
    const editor = new EditorView({
      parent: editorHost.current,
      doc: initialValue.current,
      extensions: [
        minimalSetup,
        markdown(),
        EditorView.lineWrapping,
        placeholder('支持标题、列表、加粗和链接'),
        EditorView.contentAttributes.of({ 'aria-labelledby': id, 'aria-multiline': 'true', spellcheck: 'true' }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) { setDraft(update.state.doc.toString()); onEdit?.(); }
        }),
      ],
    });
    return () => editor.destroy();
  }, [id]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  const saveActions = <>
    {onCancel && <button type="button" className="text-button" onClick={() => {
      if (!dirty || window.confirm('放弃尚未保存的编辑内容？')) onCancel();
    }}>取消</button>}
    <button type="submit" className="text-button" disabled={!canSave}>保存</button>
  </>;
  return <form className="markdown-editor" data-dirty={dirty} onSubmit={(event) => {
    event.preventDefault();
    if (!canSave) return;
    try {
      setError(null);
      onSave(draft);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存失败，请保留编辑内容并重试。');
    }
  }}>
    <span id={id} className="sr-only">{label}</span>
    {note && <div className="note-heading"><h3>我的笔记</h3>
      <div className="note-actions">{saveActions}</div>
    </div>}
    <div ref={editorHost} className="markdown-source" hidden={preview} />
    {preview && <div className="editor-preview" aria-label="Markdown 预览">{draft.trim() ? <MarkdownContent>{draft}</MarkdownContent> : <p>还没有内容</p>}</div>}
    {error && <p role="alert">{error}</p>}
    {!note && <div className="editor-actions">
      <button type="button" className="text-button editor-preview-toggle" aria-pressed={preview} onClick={() => setPreview(!preview)}>{preview ? '继续编辑' : '预览'}</button>
      {saveActions}
    </div>}
  </form>;
}
