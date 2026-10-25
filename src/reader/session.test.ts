import assert from 'node:assert/strict';
import test from 'node:test';
import book from '../textbook/book.json' with { type: 'json' };
import { readingPage, restoredScroll } from './session.ts';
import { groupMarkers } from './marker-groups.ts';
import { loadReadingPosition, readingStorageKey, saveReadingPosition } from './reading-record.ts';

const pages = [{ top: 32, height: 900 }, { top: 956, height: 900 }, { top: 1880, height: 500 }];

test('scrolling updates the page at the reading line in both directions', () => {
  assert.equal(readingPage(pages, 0, 800, 2412), 1);
  assert.equal(readingPage(pages, 900, 800, 2412), 2);
  assert.equal(readingPage(pages, 400, 800, 2412), 1);
  assert.equal(readingPage(pages, 716, 800, 2412), 2);
});

test('the last page is selected at the bottom even when shorter than the viewport', () => {
  assert.equal(readingPage(pages, 1612, 800, 2412), 3);
  assert.equal(readingPage([{ top: 0, height: 100 }], 0, 800, 100), 1);
});

test('width changes preserve the page-relative reading position, including page margins', () => {
  assert.equal(restoredScroll({ top: 1600, height: 1000 }, .4), 2000);
  assert.equal(restoredScroll({ top: 800, height: 500 }, .4), 1000);
  assert.equal(restoredScroll({ top: 800, height: 500 }, -.1), 750);
  assert.equal(restoredScroll({ top: 32, height: 500 }, -.2), 0);
});

test('overlapping markers merge without losing questions and separate again at a larger scale', () => {
  const markers = [{ id: 'a', x: 100, y: 100 }, { id: 'b', x: 100, y: 125 }, { id: 'c', x: 100, y: 150 }, { id: 'left', x: 10, y: 125 }];
  assert.deepEqual(groupMarkers(markers, 36).map((group) => group.map(({ id }) => id)), [['a', 'b', 'c'], ['left']]);
  assert.equal(groupMarkers(markers.map((marker) => ({ ...marker, x: marker.x * 2, y: marker.y * 2 })), 36).length, 4);
  assert.equal(groupMarkers([{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 36, y: 0 }], 36).length, 2);
});


test('reading records keep page-relative positions separate from personal content and other textbooks', () => {
  const values = new Map([['textbook-personal-v1:existing', 'saved notes'], ['textbook-reading-v1:other-book', 'other position']]);
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  assert.equal(loadReadingPosition(storage), null);
  for (const position of [{ page: 1, fraction: 0 }, { page: 101, fraction: .45 }, { page: 202, fraction: -.2 }]) {
    saveReadingPosition(position, storage);
    assert.deepEqual(loadReadingPosition(storage), position);
  }
  const record = JSON.parse(values.get(readingStorageKey)!);
  assert.equal(record.version, 1);
  assert.ok(readingStorageKey.endsWith(record.documentSha256));
  assert.equal(values.get('textbook-personal-v1:existing'), 'saved notes');
  assert.equal(values.get('textbook-reading-v1:other-book'), 'other position');
});

test('damaged, mismatched, and invalid reading records fall back to the cover', () => {
  let raw = '';
  const storage = { getItem: () => raw, setItem: (_key: string, value: string) => { raw = value; } };
  saveReadingPosition({ page: 10, fraction: .4 }, storage);
  const valid = JSON.parse(raw);
  for (const invalid of [
    '{broken', 'null', '[]', 'true',
    ...[{ version: 2 }, { documentSha256: 'other-book' }, { page: 0 }, { page: 203 }, { page: 1.5 },
      { page: '10' }, { fraction: null }, { fraction: '0.4' }, { fraction: 2 }]
      .map((change) => JSON.stringify({ ...valid, ...change })),
  ]) {
    raw = invalid;
    assert.equal(loadReadingPosition(storage), null, invalid);
  }
});

test('reading storage failures are reported without touching any other records', () => {
  const denied = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('quota'); } };
  assert.throws(() => loadReadingPosition(denied), /无法读取上次阅读位置/);
  assert.throws(() => saveReadingPosition({ page: 20, fraction: .5 }, denied), /无法保存阅读位置/);
  let writes = 0;
  const storage = { getItem: () => null, setItem: () => { writes += 1; } };
  for (const position of [{ page: 203, fraction: 0 }, { page: 1, fraction: NaN }, { page: 1, fraction: Infinity }]) {
    assert.throws(() => saveReadingPosition(position, storage), /阅读位置无效/);
  }
  assert.equal(writes, 0);
});


test('a tall viewport can save and restore the last page above its start, then keep saving', () => {
  let top = 16;
  const metrics = book.pages.map((page) => {
    const metric = { top, height: page.height * 304 / page.width };
    top += metric.height + 16;
    return metric;
  });
  const viewportHeight = 1096;
  const scrollTop = top - viewportHeight;
  const page = readingPage(metrics, scrollTop, viewportHeight, top);
  const metric = metrics[page - 1]!;
  const position = { page, fraction: (scrollTop - metric.top) / metric.height };
  assert.equal(page, book.pageCount);
  assert.ok(position.fraction < -1, 'The last page fits well below the viewport top');
  let raw: string | null = null;
  const storage = { getItem: () => raw, setItem: (_key: string, value: string) => { raw = value; } };
  saveReadingPosition(position, storage);
  const restored = loadReadingPosition(storage)!;
  assert.deepEqual(restored, position);
  assert.ok(Math.abs(restoredScroll(metric, restored.fraction) - scrollTop) < .001);
  const next = { page: 101, fraction: .45 };
  saveReadingPosition(next, storage);
  assert.deepEqual(loadReadingPosition(storage), next);
});
