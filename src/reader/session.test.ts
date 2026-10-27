import assert from 'node:assert/strict';
import test from 'node:test';
import book from '../textbook/book.json' with { type: 'json' };
import { readingPage, restoredScroll } from './session.ts';
import { groupMarkers } from './marker-groups.ts';
import { loadReadingPosition, readingStorageKey, saveReadingPosition } from './reading-record.ts';
import { loadStartupDestination, resolveStartupDestination, saveStartupDestination, startupStorageKey } from '../app/startup.ts';

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
    assert.throws(() => loadReadingPosition(storage), /上次阅读位置无法识别/, invalid);
    assert.equal(raw, invalid, 'Invalid records remain intact until the reader can safely save');
  }
});

test('startup destinations are independent of legacy positions and require an available shelf member', () => {
  const values = new Map([[readingStorageKey, 'legacy position'], ['textbook-personal-v1:existing', 'saved notes']]);
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  const second = 'second-version';
  const available = [book.documentSha256, second];
  assert.equal(loadStartupDestination(storage), null);
  assert.deepEqual(resolveStartupDestination(null, available, available), { bookId: null, notice: '' });
  saveStartupDestination({ page: 'reader', bookId: second }, storage);
  assert.equal(resolveStartupDestination(loadStartupDestination(storage), available, available).bookId, second);
  assert.match(resolveStartupDestination(loadStartupDestination(storage), [book.documentSha256], available).notice, /不在书架/);
  assert.match(resolveStartupDestination(loadStartupDestination(storage), available, [book.documentSha256]).notice, /暂不可用/);
  saveStartupDestination({ page: 'shelf' }, storage);
  assert.deepEqual(resolveStartupDestination(loadStartupDestination(storage), available, available), { bookId: null, notice: '' });
  assert.equal(values.get(readingStorageKey), 'legacy position');
  assert.equal(values.get('textbook-personal-v1:existing'), 'saved notes');
  for (const raw of ['{broken', 'null', '[]', 'true', '{"version":2,"page":"shelf"}', '{"version":1,"page":"reader","bookId":3}']) {
    values.set(startupStorageKey, raw);
    assert.throws(() => loadStartupDestination(storage), /记录无法识别/);
    assert.equal(values.get(startupStorageKey), raw);
  }
  const denied = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('quota'); } };
  assert.throws(() => loadStartupDestination(denied), /无法读取上次停留页面/);
  assert.throws(() => saveStartupDestination({ page: 'shelf' }, denied), /无法保存当前停留页面/);
});

test('two textbook versions keep separate positions and validate against their own page counts', () => {
  const second = { documentSha256: 'second-version-with-the-same-title', pageCount: 3 };
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  saveReadingPosition({ page: 28, fraction: .37 }, storage);
  saveReadingPosition({ page: 3, fraction: -.2 }, storage, second);
  assert.deepEqual(loadReadingPosition(storage), { page: 28, fraction: .37 });
  assert.deepEqual(loadReadingPosition(storage, second), { page: 3, fraction: -.2 });
  assert.throws(() => saveReadingPosition({ page: 4, fraction: 0 }, storage, second), /阅读位置无效/);
  const current = values.get(readingStorageKey)!;
  values.set(`textbook-reading-v1:${second.documentSha256}`, current);
  assert.throws(() => loadReadingPosition(storage, second), /上次阅读位置无法识别/);
  assert.equal(values.get(readingStorageKey), current);
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
