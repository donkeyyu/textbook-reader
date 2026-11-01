import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from './format.ts';
import { deleteUserProperty, inferPropertyType, inspectProperties, propertyNumber, setUserProperty } from './properties.ts';

test('user properties: add/edit/delete retain unknown YAML, comments, body and reserved metadata', () => {
  const original = '\uFEFF---\r\n# keep heading\r\nid: custom # keep inline\r\nunknown: {nested: [one, 2, true]}\r\nanchors: [user-only]\r\n_textbook:\r\n  id: internal\r\n  create_time: "2020-01-01T00:00:00Z"\r\n  anchors: [{textbook: book, chapter: chapter, pdf_page: 2, rects: [[0, 0, 1, 1]]}]\r\n---\r\n# body\r\n\r\nkeep $x$\r\n';
  const reserved = parse(original).data._textbook;
  let edited = setUserProperty(original, 'id', 'student');
  edited = setUserProperty(edited, 'score', 2.5, true);
  edited = setUserProperty(edited, 'tags', ['甲', '乙'], true);
  edited = setUserProperty(edited, 'checked', false, true);
  edited = deleteUserProperty(edited, 'score');
  const current = parse(edited);
  assert.deepEqual(current.data._textbook, reserved);
  assert.equal(current.data.id, 'student');
  assert.deepEqual(current.data.unknown, { nested: ['one', 2, true] });
  assert.deepEqual(current.data.tags, ['甲', '乙']);
  assert.equal(current.data.checked, false);
  assert.equal('score' in current.data, false);
  assert.equal(current.body, parse(original).body);
  assert.ok(edited.startsWith('\uFEFF---\r\n'));
  assert.ok(edited.includes('# keep heading'));
  assert.ok(edited.includes('# keep inline'));
  assert.ok(edited.indexOf('id: student') < edited.indexOf('unknown:'));
  assert.deepEqual(inspectProperties(edited).anchors, reserved.anchors);
  assert.deepEqual(inspectProperties(edited).properties.find((entry) => entry.name === 'anchors')?.value, ['user-only']);
  assert.throws(() => setUserProperty(edited, '_textbook', {}), /保留对象/);
  assert.throws(() => deleteUserProperty(edited, '_textbook'), /保留对象/);
  assert.throws(() => setUserProperty(edited, 'id', 'duplicate', true), /已存在/);
});

test('user properties: invalid and duplicate YAML block visual writes without losing drafts', () => {
  for (const source of [
    '---\na: [\n---\nbody',
    '---\na: one\na: two\n---\nbody',
    '---\na: {nested: one, nested: two}\n---\nbody',
    '---\n_textbook: wrong\n---\nbody',
    '---\na: one\nbody',
  ]) {
    const status = inspectProperties(source);
    assert.ok(status.problem, source);
    assert.throws(() => setUserProperty(source, 'other', 'value'));
    assert.throws(() => deleteUserProperty(source, 'a'));
  }
  assert.match(inspectProperties('---\na: one\na: two\n---\nbody').problem, /第 3 行，第 1 列/);
  const repaired = setUserProperty('---\na: one\n---\nbody', 'other', 'value', true);
  assert.equal(inspectProperties(repaired).problem, '');
  assert.equal(parse(repaired).data.other, 'value');
});

test('user properties: aliases cannot be made dangling and display type inference never converts file values', () => {
  const source = '---\na: &shared [one, two]\nb: *shared\ncount: "2"\n---\nbody';
  assert.throws(() => deleteUserProperty(source, 'a'), /anchor|锚/);
  const changed = setUserProperty(source, 'a', ['three']);
  assert.deepEqual(parse(changed).data.b, ['three']);
  const values = ['2', 2, false, ['x'], '2024-02-29', { a: 1 }, null, '2026-99-99', '2026-02-29'];
  assert.deepEqual(values.map(inferPropertyType), ['text', 'number', 'boolean', 'list', 'date', 'object', 'object', 'text', 'text']);
  assert.equal(inspectProperties(source).properties.find((entry) => entry.name === 'count')?.value, '2');
});

test('numeric property editing accepts complete finite values without converting incomplete input to null', () => {
  assert.deepEqual(['-12.5', '.25', '-0.5', '2e-3', '0'].map(propertyNumber), [-12.5, 0.25, -0.5, 0.002, 0]);
  for (const text of ['', '-', '.', '-.', '1.', '1e-', 'Infinity', '1e999', ' 2 ']) assert.equal(propertyNumber(text), undefined, text);
});
