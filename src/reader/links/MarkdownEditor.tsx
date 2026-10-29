import { useEffect, useId, useRef, useState } from 'react';
import { minimalSetup } from 'codemirror';
import { EditorView, placeholder } from '@codemirror/view';
import { markdown } from '@codemirror/lang-markdown';
import { autocompletion, startCompletion } from '@codemirror/autocomplete';
import { LinkContent, type LinkContext } from './LinkContent';
import { CreateLinkedNode } from './CreateLinkedNode';
import { nodeLinkCompletions, type LinkRequest } from './candidates';
import { linkTokens, type LinkBinding, type LinkDocument } from './document';
import { bindLink, linkDocument, linkExtensions, linkState } from './state';
import './links.css';

export function MarkdownEditor({ value, bindings = [], links, onSave, onSaved, onCancel, label = 'Markdown 内容', note = false, additionalDirty = false, onEdit }: {
  value: string;
  bindings?: readonly LinkBinding[];
  links?: LinkContext;
  onSave: (value: string, bindings: readonly LinkBinding[]) => void | Promise<void>;
  onSaved?: () => void;
  onCancel?: () => void;
  label?: string;
  note?: boolean;
  additionalDirty?: boolean;
  onEdit?: () => void;
}) {
  const [draft, setDraft] = useState<LinkDocument>(() => ({ markdown: value, bindings }));
  const [preview, setPreview] = useState(note && !!value.trim());
  const [savedDraft, setSavedDraft] = useState(() => JSON.stringify({ markdown: value, bindings }));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const draftKey = JSON.stringify(draft);
  const dirty = saving || draftKey !== (note ? savedDraft : JSON.stringify({ markdown: value, bindings })) || additionalDirty || error !== null;
  const canSave = !!draft.markdown.trim();
  const callbacks = useRef({ onSave, onSaved, onEdit, note, links });
  callbacks.current = { onSave, onSaved, onEdit, note, links };
  const latestDraft = useRef(draftKey);
  const draftVersion = useRef(0);
  const latestRequest = useRef(0);
  const pendingSaves = useRef(0);
  const mounted = useRef(true);
  const form = useRef<HTMLFormElement>(null);
  async function save(next: LinkDocument) {
    const request = ++latestRequest.current;
    const version = draftVersion.current;
    const key = JSON.stringify(next);
    const { onSave, onSaved, note } = callbacks.current;
    pendingSaves.current++;
    setSaving(true);
    try {
      await onSave(next.markdown, next.bindings);
      if (request === latestRequest.current) {
        setSavedDraft(key);
        if (version === draftVersion.current) setError(null);
        if (mounted.current && version === draftVersion.current && latestDraft.current === key) onSaved?.();
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
  const view = useRef<EditorView | null>(null);
  const [creating, setCreating] = useState<(LinkRequest & { document: EditorView['state']['doc'] }) | null>(null);
  const initialValue = useRef(value);
  const initialBindings = useRef(bindings);
  useEffect(() => {
    if (!editorHost.current) return;
    mounted.current = true;
    const editor = new EditorView({
      parent: editorHost.current,
      doc: initialValue.current,
      extensions: [
        minimalSetup,
        markdown(),
        linkExtensions(initialBindings.current),
        ...(callbacks.current.links ? [autocompletion({ icons: false, interactionDelay: 0, override: [nodeLinkCompletions(
          () => callbacks.current.links!, (request) => setCreating({ ...request, document: request.view.state.doc }))] })] : []),
        EditorView.lineWrapping,
        placeholder('支持标题、列表、加粗和链接'),
        EditorView.contentAttributes.of({ 'aria-labelledby': id, 'aria-multiline': 'true', spellcheck: 'true' }),
        EditorView.updateListener.of((update) => {
          if (!update.docChanged && update.startState.field(linkState) === update.state.field(linkState)) return;
          const next = linkDocument(update.state);
          draftVersion.current++;
          latestDraft.current = JSON.stringify(next);
          // Auth events can arrive before React commits this native editor edit.
          // Keep the shared draft guard accurate during that same event turn.
          if (form.current) form.current.dataset.dirty = 'true';
          setDraft(next);
          callbacks.current.onEdit?.();
          if (callbacks.current.note) void save(next);
        }),
      ],
    });
    view.current = editor;
    return () => { mounted.current = false; view.current = null; editor.destroy(); };
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
  const unbound = links ? linkTokens(draft.markdown).filter((token) => !draft.bindings.some((binding) => binding.from === token.from && binding.to === token.to)) : [];
  return <><form ref={form} className="markdown-editor" data-dirty={dirty} data-saving={saving} onKeyDown={(event) => {
    if (event.defaultPrevented) event.stopPropagation();
  }} onSubmit={(event) => {
    event.preventDefault();
    if (!note && canSave && !saving) void save(draft);
  }}>
    <span id={id} className="sr-only">{label}</span>
    {note && <div className="note-heading"><h3>我的笔记</h3>
      <button type="button" className="text-button note-mode-toggle" aria-pressed={preview} onClick={() => setPreview(!preview)}>{preview ? '源码' : '预览'}</button>
    </div>}
    <div ref={editorHost} className="markdown-source" hidden={preview} />
    {preview && <div className="editor-preview" aria-label="Markdown 预览">{draft.markdown.trim() ? <LinkContent bindings={draft.bindings} links={links} markdown={draft.markdown} /> : <p>还没有内容</p>}</div>}
    {unbound.length > 0 && <div className="unbound-links"><span>链接尚未选择目标：</span>{unbound.map((token, index) =>
      <button key={token.from} className="text-button" type="button" aria-label={`选择第 ${index + 1} 处链接“${token.label}”的目标`} onClick={() => {
        setPreview(false);
        requestAnimationFrame(() => {
          const editor = view.current;
          if (!editor) return;
          editor.dispatch({ selection: { anchor: token.to - 2 } }); editor.focus(); startCompletion(editor);
        });
      }}>[[{token.label}]]</button>)}</div>}
    {error && <div className="editor-save-error"><p role="alert">{error}</p>
      {note && <button type="button" className="text-button note-retry" disabled={saving} onClick={() => { void save(draft); }}>重试</button>}
    </div>}
    {!note && <div className="editor-actions">
      <button type="button" className="text-button editor-preview-toggle" aria-pressed={preview} onClick={() => setPreview(!preview)}>{preview ? '继续编辑' : '预览'}</button>
      {saveActions}
    </div>}
  </form>{creating && links && <CreateLinkedNode title={creating.query} links={links} onDone={(target) => {
    setCreating(null);
    if (target) {
      if (view.current !== creating.view || creating.view.state.doc !== creating.document) {
        setError('补充已创建，来源文字已有变化，请重新选择链接目标。'); return;
      }
      creating.view.dispatch(bindLink(creating.view.state, creating, target.ref, target.title));
    }
    requestAnimationFrame(() => view.current?.focus());
  }} />}</>;
}
