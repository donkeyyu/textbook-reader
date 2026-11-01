import { useEffect, useRef } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { minimalSetup } from 'codemirror';
import { EditorState, Compartment, StateField, StateEffect, Facet, Transaction, Prec, EditorSelection } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, keymap, type DecorationSet } from '@codemirror/view';
import { codeFolding, foldEffect, foldService } from '@codemirror/language';
import { markdown } from '@codemirror/lang-markdown';
import type { BodyMode, FrontmatterMode, Position } from '../../desktop/contracts';
import { parse } from '../../desktop/format';
import { isMap, isScalar } from 'yaml';
import { NoteMarkdown } from './note-markdown';
import { markdownBlocks, referenceDefinitions } from './markdown-source';
import { loadMath, subscribeMath } from '../reader/text/math';
import { autocompletion } from '@codemirror/autocomplete';
import { historyField } from '@codemirror/commands';
import { noteReferences, pathLink, type LinkEntry, type NoteReference } from '../../desktop/links';

export type EditorScene = { json?: ReturnType<EditorState['toJSON']>; scroll?: number };
const openLink = Facet.define<(reference: NoteReference) => void, (reference: NoteReference) => void>({ combine: (values) => values[0]! });

type Display = { bodyMode: BodyMode; frontmatterMode: FrontmatterMode };
const display = Facet.define<Display, Display>({ combine: (values) => values[0]! });
const focused = StateEffect.define<boolean>();
const redraw = StateEffect.define<void>();
export function headerEnd(source: string) {
  const start = /^(\uFEFF?)---\r?\n/.exec(source);
  if (!start) return 0;
  const end = /^(?:---|\.\.\.)\r?$(?:\n)?/m.exec(source.slice(start[0].length));
  return end ? start[0].length + end.index + end[0].length : source.length;
}
function sourceChange(old: string, source: string) {
  let from = 0, suffix = 0;
  while (from < Math.min(old.length, source.length) && old[from] === source[from]) from++;
  while (suffix < Math.min(old.length, source.length) - from && old[old.length - suffix - 1] === source[source.length - suffix - 1]) suffix++;
  return { from, to: old.length - suffix, insert: source.slice(from, source.length - suffix) };
}

function reservedRange(state: EditorState) {
  const source = state.doc.toString();
  try {
    const { doc, meta } = parse(source);
    const pair = isMap(doc.contents) ? doc.contents.items.find((item) => isScalar(item.key) && item.key.value === '_textbook') : undefined;
    const start = /^(\uFEFF?)---\r?\n/.exec(source)?.[0].length;
    if (!start || !pair || !isScalar(pair.key) || !pair.key.range || !meta?.range) return null;
    const line = state.doc.lineAt(start + pair.key.range[0]);
    const to = start + meta.range[1] - (source[start + meta.range[1] - 1] === '\n' ? (source[start + meta.range[1] - 2] === '\r' ? 2 : 1) : 0);
    // Flow objects can fold after the key; block objects fold below its line.
    const from = meta.flow ? start + pair.key.range[1] + 1 : line.to;
    return to > from ? { from, to } : null;
  } catch { return null; }
}
class RenderedBlock extends WidgetType {
  constructor(readonly source: string, readonly from: number, readonly references: string) { super(); }
  override eq(other: RenderedBlock) { return this.source === other.source && this.from === other.from && this.references === other.references; }
  toDOM(view: EditorView) {
    const dom = document.createElement('div');
    dom.className = 'note-rendered-block';
    dom.innerHTML = renderToStaticMarkup(<NoteMarkdown source={this.source} offset={this.from} references={this.references} />);
    dom.tabIndex = 0;
    dom.setAttribute('role', 'button');
    dom.setAttribute('aria-label', `编辑：${this.source.replace(/\s+/g, ' ').slice(0, 60)}`);
    const edit = () => {
      const prefix = /^(?:#{1,6}\s+|>\s*\[![^\]]+\][+-]?\s*|[-*+]\s+|\d+\.\s+)/.exec(this.source)?.[0].length ?? 0;
      view.dispatch({ selection: { anchor: this.from + prefix }, effects: focused.of(true) });
      view.focus();
    };
    dom.addEventListener('mousedown', (event) => {
      if ((event.target as Element).closest('summary, [data-note-link]')) return;
      event.preventDefault(); edit();
    });
    dom.addEventListener('click', (event) => {
      const link = (event.target as Element).closest<HTMLElement>('[data-note-link]');
      if (link?.dataset.noteLink) { event.preventDefault(); view.state.facet(openLink)(JSON.parse(link.dataset.noteLink) as NoteReference); }
    });
    dom.addEventListener('keydown', (event) => {
      if (event.target !== dom || !['Enter', ' '].includes(event.key)) return;
      event.preventDefault(); edit();
    });
    return dom;
  }
  override ignoreEvent() { return true; }
}
const rendering = StateField.define<{ decorations: DecorationSet; focused: boolean }>({
  create(state) { return build(state, false); },
  update(value, transaction) {
    const focus = transaction.effects.find((effect) => effect.is(focused));
    return transaction.docChanged || transaction.selection || transaction.reconfigured || transaction.effects.some((effect) => effect.is(redraw)) || focus
      ? build(transaction.state, focus ? focus.value as boolean : value.focused) : value;
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
});
function build(state: EditorState, hasFocus: boolean) {
  const { bodyMode, frontmatterMode } = state.facet(display);
  const source = state.doc.toString(), start = headerEnd(source);
  const ranges = [];
  if (frontmatterMode === 'properties' && start) ranges.push(Decoration.replace({ block: true }).range(0, start));
  const references = bodyMode === 'live' ? referenceDefinitions(source.slice(start)) : '';
  if (bodyMode === 'live') for (const block of markdownBlocks(source.slice(start), start)) {
    if (block.type === 'LinkReference') continue;
    const selection = state.selection.main;
    const active = hasFocus && selection.from <= block.to && selection.to >= block.from;
    if (!active) ranges.push(Decoration.replace({ block: true, widget: new RenderedBlock(block.source, block.from, references) }).range(block.from, block.to));
  }
  return { decorations: Decoration.set(ranges, true), focused: hasFocus };
}

export function SourceEditor({ source, readOnly, position, bodyMode, frontmatterMode, onChange, onPosition, onSave, onLink, entries = [], scene }: {
  source: string; readOnly: boolean; position?: Position; bodyMode: BodyMode; frontmatterMode: FrontmatterMode;
  onChange: (source: string) => void; onPosition: (value: Position) => void; onSave: () => void;
  onLink?: (reference: NoteReference) => void; entries?: LinkEntry[]; scene?: EditorScene;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const callbacks = useRef({ onChange, onPosition, onSave, onLink, entries });
  callbacks.current = { onChange, onPosition, onSave, onLink, entries };
  const initial = useRef({ source, position, readOnly, bodyMode, frontmatterMode });
  const appliedDisplay = useRef({ readOnly, bodyMode, frontmatterMode });
  const editable = useRef(new Compartment()), presentation = useRef(new Compartment());
  const updating = useRef(false), folded = useRef(false);
  useEffect(() => {
    const first = initial.current;
    const cursor = Math.min(first.position?.cursor ?? headerEnd(first.source), first.source.length);
    const config = {
      doc: first.source, selection: { anchor: cursor },
      extensions: [minimalSetup, markdown(), EditorView.lineWrapping, codeFolding(),
        openLink.of((raw) => callbacks.current.onLink?.(raw)),
        autocompletion({ override: [(context) => {
          const match = context.matchBefore(/\[\[(?:\\.|[^\]\\\n])*/);
          if (!match) return null;
          const doc = context.state.doc.toString();
          // Validate using the same parser as the disk index, including code and escapes.
          const probe = doc.slice(0, match.from) + '[[textbook-link-probe]]' + doc.slice(context.pos);
          if (!noteReferences(probe).some((link) => !link.property && link.from === match.from)) return null;
          const query = match.text.slice(2).replace(/\\(.)/g, '$1').toLocaleLowerCase();
          return { from: match.from, filter: false, options: callbacks.current.entries.filter((entry) => entry.path.toLocaleLowerCase().includes(query)).map((entry) => ({
            label: entry.path.slice(0, -3), detail: entry.summary, type: 'text',
            apply: (view: EditorView, _completion: unknown, from: number, to: number) => {
              const suffix = view.state.doc.sliceString(to, to + 2) === ']]' ? 2 : 0;
              const insert = pathLink(entry.path, entry.path.split('/').at(-1)!.slice(0, -3));
              view.dispatch({ changes: { from, to: to + suffix, insert }, selection: { anchor: from + insert.length } });
            },
          })) };
        }] }),
        foldService.of((state, from) => { const range = reservedRange(state); return range && state.doc.lineAt(range.from).from === from ? range : null; }),
        presentation.current.of(display.of(first)), rendering,
        EditorState.transactionFilter.of((transaction) => {
          if (transaction.annotation(Transaction.remote) || transaction.startState.facet(display).frontmatterMode !== 'properties') return transaction;
          const start = headerEnd(transaction.startState.doc.toString());
          if (!transaction.docChanged && transaction.selection?.ranges.some((range) => range.from < start)) {
            return [transaction, { selection: EditorSelection.create(transaction.selection.ranges.map((range) => EditorSelection.range(Math.max(start, range.anchor), Math.max(start, range.head)))) }];
          }
          let touchesHeader = false;
          transaction.changes.iterChanges((from) => { if (from < start) touchesHeader = true; });
          return touchesHeader ? [] : transaction;
        }),
        Prec.highest(keymap.of([{ key: 'Mod-a', run: (editor) => {
          if (editor.state.facet(display).frontmatterMode !== 'properties') return false;
          editor.dispatch({ selection: { anchor: headerEnd(editor.state.doc.toString()), head: editor.state.doc.length } });
          return true;
        } }])),
        editable.current.of([EditorView.editable.of(!first.readOnly && first.bodyMode !== 'preview'), EditorState.readOnly.of(first.readOnly || first.bodyMode === 'preview')]),
        EditorView.contentAttributes.of({ 'aria-label': '笔记 Markdown 源码', 'aria-multiline': 'true', spellcheck: 'false' }),
        keymap.of([{ key: 'Mod-s', run: () => { callbacks.current.onSave(); return true; } }]),
        EditorView.updateListener.of((update) => {
          if (updating.current) return;
          if (update.docChanged) callbacks.current.onChange(update.state.doc.toString());
          if (update.selectionSet || update.docChanged) callbacks.current.onPosition({ cursor: update.state.selection.main.head, scroll: editor.scrollDOM.scrollTop });
        }),
        EditorView.domEventHandlers({
          focus: (_event, editor) => { editor.dispatch({ effects: focused.of(true) }); },
          blur: (_event, editor) => { editor.dispatch({ effects: focused.of(false) }); },
          scroll: (_event, editor) => { callbacks.current.onPosition({ cursor: editor.state.selection.main.head, scroll: editor.scrollDOM.scrollTop }); },
        }),
      ],
    };
    let state = scene?.json ? EditorState.fromJSON(scene.json, config, { history: historyField }) : EditorState.create(config);
    if (state.doc.toString() !== first.source) state = state.update({ changes: sourceChange(state.doc.toString(), first.source), annotations: [Transaction.addToHistory.of(false), Transaction.remote.of(true)] }).state;
    const editor = new EditorView({ parent: host.current!, state });
    view.current = editor;
    const unsubscribe = subscribeMath(() => { if (view.current) editor.dispatch({ effects: redraw.of() }); });
    void loadMath().catch(() => {});
    requestAnimationFrame(() => { editor.scrollDOM.scrollTop = scene?.scroll ?? first.position?.scroll ?? 0; });
    return () => {
      if (scene) { scene.json = editor.state.toJSON({ history: historyField }); scene.scroll = editor.scrollDOM.scrollTop; }
      unsubscribe(); view.current = null; editor.destroy();
    };
  }, []);
  useEffect(() => {
    const editor = view.current;
    if (!editor) return;
    const old = editor.state.doc.toString();
    updating.current = true;
    if (old !== source) {
      // Preserve history ranges by applying only the changed text. A full-document
      // replacement maps prior body edits away even when addToHistory is false.
      editor.dispatch({ changes: sourceChange(old, source), annotations: [Transaction.addToHistory.of(false), Transaction.remote.of(true)] });
    }
    const locked = readOnly || bodyMode === 'preview';
    const previous = appliedDisplay.current;
    if (previous.readOnly !== readOnly || previous.bodyMode !== bodyMode || previous.frontmatterMode !== frontmatterMode) {
      editor.dispatch({ effects: [editable.current.reconfigure([EditorView.editable.of(!locked), EditorState.readOnly.of(locked)]), presentation.current.reconfigure(display.of({ bodyMode, frontmatterMode }))] });
      appliedDisplay.current = { readOnly, bodyMode, frontmatterMode };
    }
    if (!folded.current && frontmatterMode === 'source') {
      const range = reservedRange(editor.state);
      if (range) { editor.dispatch({ effects: foldEffect.of(range) }); folded.current = true; }
    }
    updating.current = false;
    if (old !== source) callbacks.current.onPosition({ cursor: editor.state.selection.main.head, scroll: editor.scrollDOM.scrollTop });
  }, [source, readOnly, bodyMode, frontmatterMode]);
  return <div className={`vault-source vault-source-${bodyMode}`} ref={host} hidden={bodyMode === 'preview'} />;
}
