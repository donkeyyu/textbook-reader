import assert from 'node:assert/strict';
import test from 'node:test';
import { EditorState, Transaction, type TransactionSpec } from '@codemirror/state';
import { history, isolateHistory, redo, undo } from '@codemirror/commands';
import type { ContentNode, NodeRef } from '../../textbook/content.ts';
import { linkQuery, linkText, linkTokens, validBindings, type LinkBinding } from './document.ts';
import { bindLink, linkDocument, linkExtensions, linkState } from './state.ts';
import { linkCandidates, resolveLink } from './candidates.ts';

const targetA: NodeRef = { bookId: 'book', source: 'personal', id: 'same-section-A' };
const targetB: NodeRef = { bookId: 'book', source: 'personal', id: 'same-section-B' };
const markdown = '理由 [[同名]]，再看 [[同名]]。';
const bindings: LinkBinding[] = linkTokens(markdown).map((token, index) => ({ ...token,
  id: `instance-${index}`, target: index ? targetB : targetA }));
function editor(doc = markdown, links: readonly LinkBinding[] = bindings) {
  let state = EditorState.create({ doc, extensions: [history(), linkExtensions(links)] });
  const target = { get state() { return state; }, dispatch(transaction: Transaction) { state = transaction.state; } };
  return { get state() { return state; }, get links() { return state.field(linkState); },
    update(spec: TransactionSpec) { target.dispatch(state.update(spec)); },
    undo() { assert.ok(undo(target)); }, redo() { assert.ok(redo(target)); } };
}
function keys(value: ReturnType<typeof editor>) { return value.links.map(({ id, target }) => [id, target.id]); }
const originalKeys = bindings.map(({ id, target }) => [id, target.id]);

test('same-title instances retain distinct identities through insertion, local edits, delete and history', () => {
  const view = editor();
  view.update({ changes: { from: 0, insert: '前插🙂 ' }, userEvent: 'input.type', annotations: isolateHistory.of('full') });
  assert.deepEqual(keys(view), originalKeys);
  assert.equal(view.links[0]!.from, bindings[0]!.from + 5);
  const first = view.links[0]!;
  view.update({ changes: { from: first.from + 2, to: first.to - 2, insert: '改写' }, userEvent: 'input.type', annotations: isolateHistory.of('full') });
  assert.deepEqual(keys(view), [originalKeys[1]]);
  view.undo(); assert.deepEqual(keys(view), originalKeys);
  view.redo(); assert.deepEqual(keys(view), [originalKeys[1]]);
  view.undo();
  const remove = view.links[0]!;
  view.update({ changes: { from: remove.from, to: remove.to }, userEvent: 'delete.selection' });
  assert.deepEqual(keys(view), [originalKeys[1]]);
  view.undo(); assert.deepEqual(keys(view), originalKeys);
  view.redo(); assert.deepEqual(keys(view), [originalKeys[1]]);
  assert.ok(validBindings(view.state.doc.toString(), view.links, 'book'));
  const saved = JSON.parse(JSON.stringify(linkDocument(view.state)));
  assert.deepEqual(keys(editor(saved.markdown, saved.bindings)), [originalKeys[1]], 'reload retains the remaining B identity');
});

test('plain-text paste never inherits a binding, even when it replaces the same text', () => {
  const view = editor();
  const first = view.links[0]!;
  const text = view.state.sliceDoc(first.from, first.to);
  view.update({ changes: { from: first.from, to: first.to, insert: text }, userEvent: 'input.paste' });
  assert.equal(view.state.doc.toString(), markdown);
  assert.deepEqual(keys(view), [originalKeys[1]]);
  view.undo(); assert.deepEqual(keys(view), originalKeys);
  view.redo(); assert.deepEqual(keys(view), [originalKeys[1]]);
  view.update({ changes: { from: view.state.doc.length, insert: text }, userEvent: 'input.paste' });
  assert.equal(linkTokens(view.state.doc.toString()).length, 3);
  assert.deepEqual(keys(view), [originalKeys[1]]);
  view.undo(); view.undo(); assert.deepEqual(keys(view), originalKeys);
});

test('selection and same-text rebinding are atomic undoable transactions', () => {
  const view = editor('[[同名]] [[同名]]', []);
  let tokens = linkTokens(view.state.doc.toString());
  view.update(bindLink(view.state, tokens[0]!, targetA, '同名', 'picked-A'));
  tokens = linkTokens(view.state.doc.toString());
  view.update(bindLink(view.state, tokens[1]!, targetB, '同名', 'picked-B'));
  const text = view.state.doc.toString();
  view.update(bindLink(view.state, view.links[0]!, targetB, '同名', 'rebound'));
  assert.equal(view.state.doc.toString(), text);
  assert.deepEqual(keys(view), [['rebound', targetB.id], ['picked-B', targetB.id]]);
  view.undo(); assert.deepEqual(keys(view), [['picked-A', targetA.id], ['picked-B', targetB.id]]);
  view.undo(); assert.deepEqual(keys(view), [['picked-A', targetA.id]]);
  view.redo(); view.redo(); assert.deepEqual(keys(view), [['rebound', targetB.id], ['picked-B', targetB.id]]);
});

test('merged typing/deletion events and non-history position mapping restore the right binding snapshots', () => {
  const view = editor();
  view.update({ changes: { from: 0, insert: 'a' }, userEvent: 'input.type' });
  view.update({ changes: { from: 1, insert: 'b' }, userEvent: 'input.type' });
  view.undo(); assert.equal(view.state.doc.toString(), markdown); assert.deepEqual(keys(view), originalKeys);
  view.redo(); assert.deepEqual(keys(view), originalKeys);
  const first = view.links[0]!;
  view.update({ changes: { from: first.from + 2, to: first.from + 3 }, userEvent: 'delete.forward', annotations: isolateHistory.of('before') });
  view.update({ changes: { from: first.from + 2, to: first.from + 3 }, userEvent: 'delete.forward' });
  assert.deepEqual(keys(view), [originalKeys[1]]);
  view.undo(); assert.deepEqual(keys(view), originalKeys);
  view.redo(); assert.deepEqual(keys(view), [originalKeys[1]]);
  view.undo();
  view.update({ changes: { from: 0, insert: 'external ' }, annotations: Transaction.addToHistory.of(false) });
  view.undo();
  assert.equal(view.state.doc.toString(), `external ${markdown}`);
  assert.deepEqual(keys(view), originalKeys);
  assert.equal(view.links[0]!.from, bindings[0]!.from + 9);
});

test('code, escapes, HTML, existing Markdown links and unfinished syntax do not acquire references', () => {
  const source = [
    '[[有效]] `[[行内代码]]` \\[[转义]] [[未闭合',
    '```md', '[[围栏]]', '```', '', '    [[缩进代码]]', '',
    '<script>[[脚本]]</script>', '', '[标题](https://example.com/[[路径]])', '', '尾部 [[有效二]]',
  ].join('\n');
  assert.deepEqual(linkTokens(source).map(({ label }) => label), ['有效', '有效二']);
  assert.equal(linkQuery('[[', 2)?.query, '');
  assert.equal(linkQuery('[[同', 3)?.query, '同');
  for (const source of ['`[[代码]]`', '```\n[[代码\n```', '\\[[转义', '<div>[[内容</div>']) {
    const cursor = source.includes('代码') ? source.indexOf('代码') + 2 : source.indexOf('转义') >= 0 ? source.length : source.indexOf('内容') + 2;
    assert.equal(linkQuery(source, cursor), null, source);
  }
  const view = editor();
  const first = view.links[0]!;
  view.update({ changes: [{ from: first.from, insert: '`' }, { from: first.to, insert: '`' }], userEvent: 'input.type' });
  assert.deepEqual(keys(view), [originalKeys[1]]);
  view.undo(); assert.deepEqual(keys(view), originalKeys);
  const title = '括号 ] 与 [、*强调*、\\、`代码`';
  assert.deepEqual(linkTokens(linkText(title)).map(({ label }) => label), [title]);
});

function node(ref: NodeRef, title = '同名', summary = ref.id): ContentNode {
  return { ...ref, source: 'personal', key: ref.id, title, type: 'personal', summary,
    chapterId: 'chapter', sectionId: 'section', location: null,
    personal: { id: ref.id, title, markdown: summary, page: null, region: null } };
}

test('rename, deleted/default-removed targets, self-links and reload use only durable NodeRef identity', () => {
  const binding = bindings[0]!;
  const renamed = node(targetA, '已改名');
  assert.equal(resolveLink(binding, [renamed, node(targetB)]), renamed);
  assert.equal(resolveLink(binding, [node(targetB), node({ ...targetA, id: 'new-same-title' })]), undefined);
  assert.equal(resolveLink(binding, [node({ ...targetA, bookId: 'other-book' })]), undefined);
  const missingDefault = { ...binding, target: { ...targetA, source: 'default' as const } };
  assert.equal(resolveLink(missingDefault, [node(targetA)]), undefined);
  assert.ok(validBindings(markdown, [missingDefault], 'book'), 'missing targets remain stored for invalid-link display');
  const saved = JSON.parse(JSON.stringify({ markdown, bindings }));
  assert.ok(validBindings(saved.markdown, saved.bindings, 'book'));
  assert.deepEqual(editor(saved.markdown, saved.bindings).links, bindings);
  assert.equal(resolveLink(binding, [node(targetA)])?.id, targetA.id, 'self-navigation has no special exclusion');
  assert.equal(validBindings(markdown, [{ ...binding, target: { ...targetA, bookId: 'other' } }], 'book'), false);
  assert.equal(validBindings(markdown, [{ ...binding, from: binding.from + 1 }]), false);
  assert.equal(validBindings(markdown, [binding, binding]), false);
});

test('same-section candidates retain distinct targets and useful context', () => {
  const catalog = { bookId: 'book', nodes: [node(targetA), node(targetB), node({ ...targetA, bookId: 'other-book' })],
    chapters: [{ id: 'chapter', title: '第二章', start: 1, end: 3 }],
    sections: [{ id: 'section', chapterId: 'chapter', title: '2.1', start: 1, end: 3 }] };
  const candidates = linkCandidates(catalog, '同名');
  assert.deepEqual(candidates.map(({ node }) => node.id), [targetA.id, targetB.id]);
  assert.ok(candidates.every(({ detail }) => detail.includes('第二章') && detail.includes('2.1')));
  assert.notEqual(candidates[0]!.detail, candidates[1]!.detail);
});
