import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import test from 'node:test';
import { bookTitle, getPage, pageCount, pages, resolvePageInput } from './catalog.ts';
import book from './book.json' with { type: 'json' };

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

test('all printed labels come from the reviewed full-book index, including absent labels', async () => {
  const entries = (await readFile(new URL(`../../${book.pageMapSource}`, import.meta.url), 'utf8')).trim().split(/\r?\n/).map((line) => JSON.parse(line));
  assert.equal(entries.length, pageCount);
  for (const [index, entry] of entries.entries()) {
    assert.equal(entry.document_sha256, book.documentSha256);
    assert.equal(entry.review_state, 'reviewed');
    assert.equal(entry.physical_page, index + 1);
    assert.equal(getPage(index + 1).printedPage, entry.printed_page);
    assert.equal(entry.printed_page_state, entry.printed_page === null ? 'absent' : 'verified');
  }
  assert.equal(pages.filter((page) => page.printedPage === null).length, 16);
  const labels = pages.flatMap((page) => page.printedPage === null ? [] : [page.printedPage]);
  assert.equal(new Set(labels).size, labels.length, 'Duplicate labels must be resolved at data preparation');
});

test('page lookup distinguishes printed labels from file order and preserves non-numbered pages', () => {
  assert.deepEqual(resolvePageInput('3', 'printed'), { page: 10 });
  assert.deepEqual(resolvePageInput(' 3 ', 'printed'), { page: 10 });
  assert.deepEqual(resolvePageInput('94', 'printed'), { page: 101 });
  assert.deepEqual(resolvePageInput('192', 'printed'), { page: 199 });
  for (const page of [1, 8, 31, 101, 200, 202]) assert.deepEqual(resolvePageInput(String(page), 'file'), { page });
  for (const page of pages.filter((entry) => entry.printedPage !== null)) {
    assert.deepEqual(resolvePageInput(page.printedPage!, 'printed'), { page: page.page });
  }
  for (const input of ['', ' ', '3.0', '-1', '1e2', '3/202', '999', '1']) {
    assert.ok(resolvePageInput(input, 'printed').error, input);
  }
  for (const input of ['', '0', '203', '-1', '1.5', 'Infinity', 'NaN', '1e2', '2/202']) {
    assert.ok(resolvePageInput(input, 'file').error, input);
  }
  const duplicate = resolvePageInput('3', 'printed', [{ page: 2, printedPage: '3' }, { page: 8, printedPage: '3' }]);
  assert.ok(duplicate.error);
  assert.equal(duplicate.page, undefined, 'A repeated label cannot silently select the first page');
  assert.deepEqual(resolvePageInput('iv', 'printed', [{ page: 1, printedPage: 'iv' }]), { page: 1 }, 'Printed pages are exact labels');
});

test('every page and thumbnail has a generated image and source record', async () => {
  const source = JSON.parse(await readFile(new URL('../../public/textbooks/grade-7-volume-1/source.json', import.meta.url), 'utf8'));
  assert.equal(source.documentSha256, book.documentSha256);
  assert.equal(source.pageMapSource, book.pageMapSource);
  assert.deepEqual(source.pages, book.pages);
  for (const page of pages) {
    for (const path of [page.image, page.thumbnail]) {
      const image = new URL(`../../public${path}`, import.meta.url);
      assert.ok((await stat(image)).size > 0, path);
      assert.ok((await stat(new URL(`${image.href}.json`))).size > 0, `${path}.json`);
    }
  }
});
