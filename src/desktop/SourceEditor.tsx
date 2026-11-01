import { useEffect, useRef } from 'react';
import { minimalSetup } from 'codemirror';
import { EditorState, Compartment } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { markdown } from '@codemirror/lang-markdown';
import type { Position } from '../../desktop/contracts';

export function SourceEditor({ source, readOnly, position, onChange, onPosition, onSave }: {
  source: string; readOnly: boolean; position?: Position;
  onChange: (source: string) => void; onPosition: (value: Position) => void; onSave: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const callbacks = useRef({ onChange, onPosition, onSave });
  callbacks.current = { onChange, onPosition, onSave };
  const initial = useRef({ source, position, readOnly });
  const editable = useRef(new Compartment());
  const updating = useRef(false);
  useEffect(() => {
    const cursor = Math.min(initial.current.position?.cursor ?? 0, initial.current.source.length);
    const editor = new EditorView({ parent: host.current!, state: EditorState.create({
      doc: initial.current.source, selection: { anchor: cursor },
      extensions: [minimalSetup, markdown(), EditorView.lineWrapping,
        editable.current.of([EditorView.editable.of(!initial.current.readOnly), EditorState.readOnly.of(initial.current.readOnly)]),
        EditorView.contentAttributes.of({ 'aria-label': '笔记 Markdown 源码', 'aria-multiline': 'true', spellcheck: 'false' }),
        keymap.of([{ key: 'Mod-s', run: () => { callbacks.current.onSave(); return true; } }]),
        EditorView.updateListener.of((update) => {
          if (updating.current) return;
          if (update.docChanged) callbacks.current.onChange(update.state.doc.toString());
          if (update.selectionSet || update.docChanged) callbacks.current.onPosition({ cursor: update.state.selection.main.head, scroll: editor.scrollDOM.scrollTop });
        }),
        EditorView.domEventHandlers({ scroll: (_event, editor) => {
          callbacks.current.onPosition({ cursor: editor.state.selection.main.head, scroll: editor.scrollDOM.scrollTop });
        } }),
      ],
    }) });
    view.current = editor;
    requestAnimationFrame(() => { editor.scrollDOM.scrollTop = initial.current.position?.scroll ?? 0; });
    return () => { view.current = null; editor.destroy(); };
  }, []);
  useEffect(() => {
    const editor = view.current;
    if (!editor) return;
    const old = editor.state.doc.toString();
    updating.current = true;
    if (old !== source) {
      const cursor = Math.max(0, Math.min(source.length, editor.state.selection.main.head + source.length - old.length));
      editor.dispatch({ changes: { from: 0, to: old.length, insert: source }, selection: { anchor: cursor } });
    }
    editor.dispatch({ effects: editable.current.reconfigure([EditorView.editable.of(!readOnly), EditorState.readOnly.of(readOnly)]) });
    updating.current = false;
    if (old !== source) callbacks.current.onPosition({ cursor: editor.state.selection.main.head, scroll: editor.scrollDOM.scrollTop });
  }, [source, readOnly]);
  return <div className="vault-source" ref={host} />;
}
