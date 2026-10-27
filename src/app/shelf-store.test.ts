import assert from 'node:assert/strict';
import test from 'node:test';
import { loadShelf, removeShelfBook, saveShelf, shelfStorageKey } from './shelf-store.ts';

test('shelf membership persists without duplicate versions or changes to reading and personal records', () => {
  const values = new Map([['textbook-reading-v1:book', 'reading'], ['textbook-personal-v1:book', 'notes']]);
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  assert.deepEqual(loadShelf(storage), []);
  saveShelf(['book', 'other-version', 'book'], storage);
  assert.deepEqual(loadShelf(storage), ['book', 'other-version']);
  assert.equal(values.get('textbook-reading-v1:book'), 'reading');
  assert.equal(values.get('textbook-personal-v1:book'), 'notes');
  const saved = values.get(shelfStorageKey);
  for (const raw of ['{broken', 'null', '[]', '{"version":2,"bookIds":[]}', '{"version":1,"bookIds":[1]}']) {
    values.set(shelfStorageKey, raw);
    assert.throws(() => loadShelf(storage), /原记录已保留/);
    assert.equal(values.get(shelfStorageKey), raw);
  }
  values.set(shelfStorageKey, saved!);
  const denied = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('quota'); } };
  assert.throws(() => loadShelf(denied), /无法读取本地书架/);
  assert.throws(() => saveShelf(['book'], denied), /无法保存本地书架/);
  assert.equal(values.get(shelfStorageKey), saved);
});

test('removing and restoring one version preserves other membership, reading and personal content, including on failure', () => {
  const values = new Map([['textbook-reading-v1:book', 'reading'], ['textbook-personal-v1:book', 'notes and supplements']]);
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  saveShelf(['book', 'same-title-other-version'], storage);
  assert.deepEqual(removeShelfBook('book', storage), ['same-title-other-version']);
  assert.deepEqual(loadShelf(storage), ['same-title-other-version']);
  saveShelf([...loadShelf(storage), 'book', 'book'], storage);
  assert.deepEqual(loadShelf(storage), ['same-title-other-version', 'book']);
  const before = new Map(values);
  const denied = { ...storage, setItem: () => { throw new Error('quota'); } };
  assert.throws(() => removeShelfBook('book', denied), /无法保存本地书架/);
  assert.deepEqual(values, before);
  assert.equal(values.get('textbook-reading-v1:book'), 'reading');
  assert.equal(values.get('textbook-personal-v1:book'), 'notes and supplements');
  values.set(shelfStorageKey, '{broken');
  assert.throws(() => removeShelfBook('book', storage), /原记录已保留/);
  assert.equal(values.get(shelfStorageKey), '{broken');
});
