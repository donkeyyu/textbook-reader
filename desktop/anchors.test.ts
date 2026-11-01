import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { anchorKey, changeAnchors, readAnchors, resolveAnchor, validRect, type Catalog } from './anchors.ts';
import { parse, prepareSave } from './format.ts';
const catalog = JSON.parse(await readFile(new URL('../resources/offline/grade-7-volume-1/catalog.json', import.meta.url), 'utf8')) as Catalog;
const base = { textbook: catalog.textbookId, pdf_page: 20, rects: [[.1, .2, .3, .1], [.2, .5, .2, .2]] };
test('version catalog and independent chains reject invalid prerequisites without guessing', () => {
  assert.equal(resolveAnchor(base, catalog).target?.page, 20);
  assert.equal(resolveAnchor({ textbook: catalog.textbookId, chapter: 'chapter-1' }, catalog).chapter?.id, 'chapter-1');
  assert.equal(resolveAnchor({ textbook: catalog.textbookId, chapter: 'chapter-1' }, catalog).target, null);
  assert.equal(resolveAnchor({ ...base, chapter: 'gone', section: '1.2' }, catalog).target?.page, 20);
  assert.equal(resolveAnchor({ ...base, chapter: 'gone', section: '1.2' }, catalog).section, undefined);
  for (const bad of [{ ...base, textbook: 'other' }, { ...base, pdf_page: 0 }, { ...base, pdf_page: 203 }, { ...base, pdf_page: 20.5 }, { ...base, chapter: 'chapter-3' }, { ...base, rects: [[.9, .2, .3, .1]] }, { ...base, rects: [] }, { ...base, rects: [[0, 0, 1, 1], 'bad'] }]) {
    const before = structuredClone(bad); assert.equal(resolveAnchor(bad, catalog).target, null); assert.deepEqual(bad, before);
  }
  assert.equal(resolveAnchor(base, null).target, null);
  assert.equal(resolveAnchor(base, catalog).page?.printedPage, '13');
  for (const rect of [[0, 0, 1, 1], [.1, .2, .3, .4]]) assert.ok(validRect(rect));
  for (const rect of [[0, 0, 0, 1], [0, 0, 1, Infinity], [0, -.1, 1, 1], [0, 0, 1, 1, 1]]) assert.ok(!validRect(rect));
});
test('edit one YAML anchor preserves unknown data, body, invalid siblings and user anchors', () => {
  const source = '\uFEFF---\r\n# keep\r\nanchors: [user-value]\r\ncustom: &x [a, b]\r\ncopy: *x\r\n_textbook:\r\n  id: stable\r\n  unknown: keep\r\n  anchors:\r\n    - textbook: old # comment\r\n      extra: keep-me\r\n      rects: invalid\r\n    - broken\r\n---\r\n正文\r\n';
  const key = anchorKey(readAnchors(source));
  const next = changeAnchors(source, key, { index: 0, patch: base });
  const parsed = parse(next);
  assert.equal(parsed.body, '正文\r\n'); assert.equal(parsed.newline, '\r\n'); assert.ok(next.startsWith('\uFEFF')); assert.ok(next.includes('# keep')); assert.ok(next.includes('# comment'));
  assert.deepEqual(parsed.data.anchors, ['user-value']); assert.deepEqual(parsed.data.copy, ['a', 'b']);
  assert.equal(parsed.data._textbook.anchors[0].extra, 'keep-me'); assert.equal(parsed.data._textbook.anchors[1], 'broken');
  assert.throws(() => changeAnchors(next, key, { index: 0, remove: true }), /已改变/);
  const without = changeAnchors(changeAnchors(next, undefined, { index: 1, remove: true }), undefined, { index: 0, remove: true });
  assert.equal(readAnchors(without), undefined); assert.equal(parse(without).body, '正文\r\n');
  const cross = changeAnchors('', undefined, { append: [base, { ...base, pdf_page: 21 }] });
  assert.equal((readAnchors(cross) as unknown[]).length, 2);
  assert.throws(() => changeAnchors('---\n_textbook: {anchors: bad}\n---\nbody', undefined, { append: [base] }), /列表/);
  assert.throws(() => changeAnchors('---\n_textbook: {schema_version: 2}\n---\nbody', undefined, { append: [base] }), /版本/);
  assert.throws(() => changeAnchors('---\nbad: [\n---\nbody', undefined, { append: [base] }), /YAML/);
});
test('validity warnings do not prohibit preserving malformed anchors in a normal body save', () => {
  const source = changeAnchors('', undefined, { append: [{ textbook: 'missing', pdf_page: 0, rects: 'bad' }] });
  const saved = prepareSave(source, source + 'body', '2026-11-01T00:00:00Z');
  assert.deepEqual(readAnchors(saved), readAnchors(source));
});
