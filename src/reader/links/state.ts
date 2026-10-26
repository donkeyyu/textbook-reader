import { StateEffect, StateField, type ChangeDesc, type EditorState, type Extension, type TransactionSpec } from '@codemirror/state';
import { invertedEffects, isolateHistory } from '@codemirror/commands';
import type { NodeRef } from '../../textbook/content.ts';
import { linkText, linkTokens, matchingBindings, type LinkBinding, type LinkDocument, type LinkToken } from './document.ts';

function mapRange<T extends LinkToken>(range: T, changes: ChangeDesc): T {
  return { ...range, from: changes.mapPos(range.from, 1), to: changes.mapPos(range.to, -1) };
}

// History may merge events. Map snapshots without dropping collapsed ranges;
// the last (earliest) snapshot restores the full binding set for that group.
const restoreBindings = StateEffect.define<readonly LinkBinding[]>({
  map: (bindings, changes) => bindings.map((binding) => mapRange(binding, changes)),
});

export const linkState = StateField.define<readonly LinkBinding[]>({
  create: () => [],
  update(bindings, transaction) {
    let next = bindings;
    if (transaction.docChanged) {
      next = bindings.filter((binding) => {
        let touched = false;
        transaction.changes.iterChangedRanges((from, to) => {
          if (from === to ? from > binding.from && from < binding.to : from < binding.to && to > binding.from) touched = true;
        });
        return !touched;
      }).map((binding) => mapRange(binding, transaction.changes));
    }
    for (const effect of transaction.effects) if (effect.is(restoreBindings)) next = effect.value;
    return next === bindings ? bindings : matchingBindings(transaction.newDoc.toString(), next);
  },
});

export function linkExtensions(bindings: readonly LinkBinding[] = []): Extension {
  return [
    linkState.init((state) => matchingBindings(state.doc.toString(), bindings)),
    invertedEffects.of((transaction) => {
      const before = transaction.startState.field(linkState);
      return before === transaction.state.field(linkState) ? [] : [restoreBindings.of(before)];
    }),
  ];
}

export function linkDocument(state: EditorState): LinkDocument {
  return { markdown: state.doc.toString(), bindings: state.field(linkState) };
}

/** Binding and displayed text are a single undoable editor transaction. */
export function bindLink(state: EditorState, range: { from: number; to: number }, target: NodeRef,
  title: string, id: string = crypto.randomUUID()): TransactionSpec {
  const text = linkText(title);
  const changes = state.changes({ from: range.from, to: range.to, insert: text });
  const existing = state.field(linkState).filter((binding) => binding.to <= range.from || binding.from >= range.to)
    .map((binding) => mapRange(binding, changes));
  const token = linkTokens(text)[0];
  if (!token) throw new Error('节点名称不能形成有效链接，请修改名称后重试。');
  const binding: LinkBinding = { ...token, from: range.from, to: range.from + text.length, id, target: { ...target } };
  return { changes, effects: restoreBindings.of([...existing, binding].sort((a, b) => a.from - b.from)),
    selection: { anchor: binding.to }, userEvent: 'input.complete', annotations: isolateHistory.of('full') };
}
