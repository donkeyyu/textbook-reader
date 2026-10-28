import assert from 'node:assert/strict';
import test from 'node:test';
import { loadUiStyle, saveUiStyle, uiStyleStorageKey, uiStyles, type UiStyle } from './ui-style.ts';

test('style choices persist independently of bookshelf and reading records', () => {
  const values = new Map([['textbook-shelf-v1', 'books'], ['textbook-reading-v1:book', 'position']]);
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  assert.equal(loadUiStyle(storage), 'island');
  for (const style of Object.keys(uiStyles) as UiStyle[]) {
    saveUiStyle(style, storage);
    assert.equal(loadUiStyle(storage), style);
  }
  assert.equal(values.get('textbook-shelf-v1'), 'books');
  assert.equal(values.get('textbook-reading-v1:book'), 'position');
  for (const unknown of ['future-style', '{}', '__proto__', 'toString']) {
    values.set(uiStyleStorageKey, unknown);
    assert.equal(loadUiStyle(storage), 'island');
    assert.equal(values.get(uiStyleStorageKey), unknown);
  }
});

test('storage failures report an unsaved preference without changing saved values', () => {
  const values = new Map([[uiStyleStorageKey, 'warm']]);
  const denied = { getItem: (key: string) => values.get(key) ?? null, setItem: () => { throw new Error('quota'); } };
  assert.throws(() => loadUiStyle({ ...denied, getItem: () => { throw new Error('blocked'); } }), /无法读取风格设置/);
  assert.throws(() => saveUiStyle('youth', denied), /风格已应用，但无法保存/);
  assert.equal(loadUiStyle(denied), 'warm');
});
