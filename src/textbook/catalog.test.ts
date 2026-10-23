import assert from 'node:assert/strict';
import { stat } from 'node:fs/promises';
import test from 'node:test';
import { bookTitle, getPage, pageCount, pages } from './catalog.ts';

test('the full book includes all 202 pages in physical PDF order', () => {
  assert.equal(bookTitle, '数学 · 七年级上册');
  assert.equal(pageCount, 202);
  assert.equal(pages.length, pageCount);
  for (let page = 1; page <= pageCount; page++) {
    const entry = getPage(page);
    assert.equal(entry, pages[page - 1]);
    assert.equal(entry.page, page);
    assert.equal(entry.image, `/textbooks/grade-7-volume-1/page-${page}.webp`);
    assert.equal(entry.thumbnail, `/textbooks/grade-7-volume-1/thumb-${page}.webp`);
    assert.ok(Number.isInteger(entry.width) && entry.width > 0);
    assert.ok(Number.isInteger(entry.height) && entry.height > 0);
  }
});

test('invalid physical page numbers cannot resolve to another page', () => {
  for (const page of [-1, 0, 203, NaN, Infinity, 1.5]) {
    assert.throws(() => getPage(page), RangeError);
  }
});

test('every page and thumbnail has a generated image and source record', async () => {
  for (const page of pages) {
    for (const path of [page.image, page.thumbnail]) {
      const image = new URL(`../../public${path}`, import.meta.url);
      assert.ok((await stat(image)).size > 0, path);
      assert.ok((await stat(new URL(`${image.href}.json`))).size > 0, `${path}.json`);
    }
  }
});
