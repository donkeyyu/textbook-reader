import assert from 'node:assert/strict';
import test from 'node:test';
import { loadPersonal, savePersonal, personalStorageKey, type PersonalData } from './personal.ts';

test('personal content survives reload and failed reads or writes do not replace it', () => {
  const entries = new Map<string, string>();
  const storage = { getItem: (key: string) => entries.get(key) ?? null, setItem: (key: string, value: string) => { entries.set(key, value); } };
  assert.deepEqual(loadPersonal(storage), { supplements: [], notes: {} });
  const data: PersonalData = { supplements: [{ id: 'personal-1', title: '我的理解', markdown: '**理由**', page: 8, region: { x: .1, y: .2, width: .5, height: .1 } }], notes: { example: '复习这个条件' } };
  savePersonal(data, loadPersonal(storage), storage);
  assert.deepEqual(loadPersonal(storage), data);
  assert.throws(() => savePersonal({ ...data, supplements: [{ ...data.supplements[0]!, page: 203 }] }, data, storage), /位置无效/);
  assert.deepEqual(loadPersonal(storage), data);
  assert.throws(() => savePersonal(data, data, { ...storage, setItem: () => { throw new Error('quota'); } }), /保存失败/);
  assert.deepEqual(loadPersonal(storage), data);
  for (const invalid of ['{broken', JSON.stringify({ ...data, supplements: [data.supplements[0], data.supplements[0]] }), JSON.stringify({ ...data, notes: { x: 3 } }), JSON.stringify({ ...data, supplements: [{ ...data.supplements[0], region: { x: .9, y: 0, width: .5, height: .1 } }] })]) {
    entries.set(personalStorageKey, invalid);
    assert.throws(() => loadPersonal(storage), /无法读取/);
    assert.equal(entries.get(personalStorageKey), invalid);
  }
});


test('a stale tab cannot overwrite saved notes or restore a deleted supplement', () => {
  let raw: string | null = null;
  const storage = { getItem: () => raw, setItem: (_key: string, value: string) => { raw = value; } };
  const empty = loadPersonal(storage);
  const supplement = { id: 'p1', title: 'Title', markdown: 'Body', page: 10, region: { x: .1, y: .1, width: .2, height: .2 } };
  savePersonal({ supplements: [supplement], notes: {} }, empty, storage);
  const tabA = loadPersonal(storage), tabB = loadPersonal(storage);
  const savedA = { ...tabA, notes: { a: 'saved in A' } };
  savePersonal(savedA, tabA, storage);
  assert.throws(() => savePersonal({ ...tabB, notes: { b: 'draft in B' } }, tabB, storage), /另一标签页更改/);
  assert.deepEqual(loadPersonal(storage), savedA);
  const stale = loadPersonal(storage);
  const deleted = { ...savedA, supplements: [] };
  savePersonal(deleted, savedA, storage);
  assert.throws(() => savePersonal(stale, stale, storage), /另一标签页更改/);
  assert.deepEqual(loadPersonal(storage), deleted);
  savePersonal({ ...deleted, notes: { a: 'next save in A' } }, deleted, storage);
  assert.equal(loadPersonal(storage).notes.a, 'next save in A');
});
