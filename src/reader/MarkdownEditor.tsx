import { useEffect, useId, useRef, useState } from 'react';
import { minimalSetup } from 'codemirror';
import { EditorView, placeholder } from '@codemirror/view';
import { markdown } from '@codemirror/lang-markdown';
import ReactMarkdown from 'react-markdown';

export function MarkdownContent({ children }: { children: string }) {
  return <div className="markdown-content"><ReactMarkdown>{children}</ReactMarkdown></div>;
}

export function MarkdownEditor({ value, onSave, onSaved, onCancel, label = 'Markdown 内容', note = false, additionalDirty = false, onEdit }: {
  value: string;
  onSave: (value: string) => void | Promise<void>;
  onSaved?: () => void;
  onCancel?: () => void;
  label?: string;
  note?: boolean;
  additionalDirty?: boolean;
  onEdit?: () => void;
}) {
  const [draft, setDraft] = useState(value);
  const [preview, setPreview] = useState(note && !!value.trim());
  const [savedDraft, setSavedDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const dirty = saving || draft !== (note ? savedDraft : value) || additionalDirty || error !== null;
  const canSave = !!draft.trim();
  const callbacks = useRef({ onSave, onSaved, onEdit, note });
  callbacks.current = { onSave, onSaved, onEdit, note };
  const latestDraft = useRef(value);
  const latestRequest = useRef(0);
  const pendingSaves = useRef(0);
  const mounted = useRef(true);
  async function save(next: string) {
    const request = ++latestRequest.current;
    const { onSave, onSaved, note } = callbacks.current;
    pendingSaves.current++;
    setSaving(true);
    try {
      await onSave(next);
      if (request === latestRequest.current) {
        setSavedDraft(next);
        setError(null);
        if (mounted.current && latestDraft.current === next) onSaved?.();
      }
    } catch (cause) {
      if (request === latestRequest.current) {
        const message = cause instanceof Error ? cause.message : '保存失败，请保留编辑内容并重试。';
        setError(note ? `笔记未保存：${message}` : message);
      }
    } finally {
      pendingSaves.current--;
      if (!pendingSaves.current) setSaving(false);
    }
  }
  const id = useId();
  const editorHost = useRef<HTMLDivElement>(null);
  const initialValue = useRef(value);
  useEffect(() => {
    if (!editorHost.current) return;
    mounted.current = true;
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
          if (!update.docChanged) return;
          const next = update.state.doc.toString();
          latestDraft.current = next;
          setDraft(next);
          callbacks.current.onEdit?.();
          if (callbacks.current.note) void save(next);
        }),
      ],
    });
    return () => { mounted.current = false; editor.destroy(); };
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
    <button type="submit" className="text-button" disabled={!canSave || saving}>{saving ? '保存中…' : '保存'}</button>
  </>;
  return <form className="markdown-editor" data-dirty={dirty} data-saving={saving} onSubmit={(event) => {
    event.preventDefault();
    if (!note && canSave && !saving) void save(draft);
  }}>
    <span id={id} className="sr-only">{label}</span>
    {note && <div className="note-heading"><h3>我的笔记</h3>
      <button type="button" className="text-button note-mode-toggle" aria-pressed={preview} onClick={() => setPreview(!preview)}>{preview ? '源码' : '预览'}</button>
    </div>}
    <div ref={editorHost} className="markdown-source" hidden={preview} />
    {preview && <div className="editor-preview" aria-label="Markdown 预览">{draft.trim() ? <MarkdownContent>{draft}</MarkdownContent> : <p>还没有内容</p>}</div>}
    {error && <div className="editor-save-error"><p role="alert">{error}</p>
      {note && <button type="button" className="text-button note-retry" disabled={saving} onClick={() => { void save(draft); }}>重试</button>}
    </div>}
    {!note && <div className="editor-actions">
      <button type="button" className="text-button editor-preview-toggle" aria-pressed={preview} onClick={() => setPreview(!preview)}>{preview ? '继续编辑' : '预览'}</button>
      {saveActions}
    </div>}
  </form>;
}
