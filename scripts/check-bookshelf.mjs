import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { jumpToFilePage, readingSnapshot, checkReviewCase } from './check-related-return.mjs';

const book = JSON.parse(await readFile(new URL('../src/textbook/book.json', import.meta.url), 'utf8'));
const shelfKey = 'textbook-shelf-v1';
const startupKey = 'textbook-startup-v1';
const readingKey = `textbook-reading-v1:${book.documentSha256}`;

async function picker(page) {
  await page.click('.shelf-toolbar button:text-is("添加教材")');
  await page.waitForSelector('dialog[open][aria-labelledby="textbook-picker-title"]');
}

async function add(page) {
  await picker(page);
  await page.click('dialog[open] button:text-is("添加到书架")');
  await page.waitForSelector('dialog[open] button:text-is("已添加")');
  await page.click('button[aria-label="关闭教材选择"]');
  await page.waitForSelector('.shelf-cover');
}

async function open(page) {
  await page.click('.shelf-cover');
  await page.waitForSelector('.page-index');
}

// Follow the visible shelf path when the app is not already reading a book.
export async function openShelfReader(page) {
  if (await page.evaluate(() => !!document.querySelector('.page-index'))) return;
  await page.waitForSelector('.shelf-toolbar');
  if (!await page.evaluate(() => !!document.querySelector('.shelf-cover'))) await add(page);
  await open(page);
}

async function back(page) {
  await page.click('button[aria-label="返回书架"]');
  await page.waitForSelector('.shelf-toolbar');
}

// Only an owned Page on a NEW, EMPTY localhost origin. The check writes only
// its two local records; it never signs in or changes any personal content.
export async function checkBookshelf(page, { testOrigin, evidenceDir } = {}) {
  assert.ok(testOrigin, 'Pass a dedicated testOrigin');
  const origin = new URL(testOrigin);
  assert.ok(origin.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(origin.hostname) && origin.port);
  assert.equal(new URL(await page.url()).origin, origin.origin);
  assert.equal(await page.evaluate(() => localStorage.length), 0, 'Existing origin data must be preserved; use a fresh origin');
  const shot = async (name) => { if (evidenceDir) await page.screenshot({ path: `${evidenceDir}/${name}.png` }); };
  try {
    await page.waitForSelector('.shelf-empty');
    await shot('empty');
    await page.focus('.shelf-toolbar .shelf-primary');
    await page.keyboard.press('Enter');
    await page.waitForSelector('dialog[open]');
    const catalog = await page.evaluate(() => ({
      covers: [...document.querySelectorAll('dialog[open] img')].map((img) => img.alt),
      title: document.querySelector('dialog[open] h3')?.textContent,
      edition: document.querySelector('dialog[open] .shelf-edition')?.textContent,
    }));
    assert.deepEqual(catalog.covers, [`${book.title}封面`]);
    assert.equal(catalog.title, book.title);
    assert.equal(catalog.edition, '人教版 · 2024 年审定');
    await shot('picker');
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => document.activeElement === document.querySelector('.shelf-toolbar .shelf-primary')), true);
    assert.equal(await page.evaluate(() => !!document.querySelector('.shelf-cover')), false, 'Cancel must not add a book');
    await add(page);
    await picker(page);
    assert.equal(await page.evaluate(() => [...document.querySelectorAll('dialog[open] button')].find((b) => b.textContent === '已添加')?.disabled), true);
    await page.keyboard.press('Escape');
    await page.reload();
    await page.waitForSelector('.shelf-cover');
    assert.equal(await page.evaluate(() => document.querySelectorAll('.shelf-cover').length), 1, 'Refresh must retain exactly one version');
    assert.equal(await page.evaluate(() => !!document.querySelector('.shelf-empty')), false);
    await shot('shelf');
    await open(page);
    assert.equal(await page.evaluate(() => document.querySelector('.page-index')?.textContent?.trim()), `1/${book.pageCount}`);
    assert.equal(await page.evaluate(() => !!document.querySelector('button[aria-label="登录"]')), true);
    await jumpToFilePage(page, 28);
    await page.evaluate(() => {
      const paper = document.getElementById('page-28').getBoundingClientRect();
      const viewport = document.querySelector('.paper-scroller');
      viewport.scrollTop += paper.top - viewport.getBoundingClientRect().top + paper.height * .37;
    });
    const before = await readingSnapshot(page, 28);
    await back(page);
    const label = book.pages[27].printedPage === null ? '文件第 28 页' : `课本第 ${book.pages[27].printedPage} 页`;
    assert.equal(await page.evaluate(() => document.querySelector('.shelf-position')?.textContent), `上次读到${label}`);
    assert.equal(await page.evaluate(() => document.activeElement === document.querySelector('.shelf-cover')), true);
    await page.click('button:text-is("继续阅读")');
    await page.waitForSelector('.page-index');
    const resumed = await readingSnapshot(page, 28);
    assert.ok(Math.abs(resumed.fraction - before.fraction) < .01, 'Returning must flush the latest anchor before unmount');
    await checkReviewCase(page, 0);
    await shot('reader');

    // Exercise the same dirty-context boundary as checkGraphBlankSelection.
    // This is a guard probe, not a cloud editor/save test.
    await page.evaluate(() => {
      const draft = document.createElement('input');
      draft.id = 'bookshelf-qa-draft'; draft.dataset.dirty = 'true'; draft.value = 'QA draft retained';
      document.querySelector('.reader-app').appendChild(draft);
    });
    await page.click('button[aria-label="返回书架"]'); await page.dismissDialog();
    assert.equal(await page.evaluate(() => document.getElementById('bookshelf-qa-draft')?.value), 'QA draft retained');
    assert.equal(await page.evaluate(() => !!document.querySelector('.page-index')), true);
    await page.click('button[aria-label="返回书架"]'); await page.acceptDialog();
    await page.waitForSelector('.shelf-toolbar');

    await open(page);
    await page.evaluate((key) => {
      window.bookshelfQASetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function (name, value) {
        if (this === localStorage && name === key) throw new DOMException('QA reading quota', 'QuotaExceededError');
        return window.bookshelfQASetItem.call(this, name, value);
      };
    }, readingKey);
    await back(page);
    assert.equal(await page.evaluate(() => [...document.querySelectorAll('.shelf-error')].some((node) => node.textContent.includes('无法保存阅读位置'))), true,
      'A last-moment reading save failure must remain visible after return');
    await page.evaluate(() => { Storage.prototype.setItem = window.bookshelfQASetItem; delete window.bookshelfQASetItem; });

    // Upgrade fixture: the old reading record exists, but no shelf record does.
    const legacy = JSON.stringify({ version: 1, documentSha256: book.documentSha256, page: 9, fraction: .24 });
    await page.evaluate(({ shelfKey, readingKey, legacy }) => {
      localStorage.removeItem(shelfKey); localStorage.setItem(readingKey, legacy);
    }, { shelfKey, readingKey, legacy });
    await page.reload(); await page.waitForSelector('.shelf-empty');
    assert.equal(await page.evaluate((key) => localStorage.getItem(key), readingKey), legacy, 'Entering the shelf must not reset legacy reading');
    await add(page); await open(page);
    const upgraded = await readingSnapshot(page, 9);
    assert.ok(Math.abs(upgraded.fraction - .24) < .01);
    await back(page);

    await page.evaluate((key) => localStorage.setItem(key, '{broken shelf'), shelfKey);
    await page.reload(); await page.waitForSelector('.shelf-error');
    await picker(page); await page.click('button:text-is("添加到书架")');
    assert.equal(await page.evaluate((key) => localStorage.getItem(key), shelfKey), '{broken shelf');
    await page.click('button:text-is("直接阅读")'); await page.waitForSelector('.page-index'); await back(page);
    await page.evaluate((key) => localStorage.removeItem(key), shelfKey);
    await page.reload(); await page.waitForSelector('.shelf-empty');
    await page.evaluate((key) => {
      window.bookshelfQASetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function (name, value) {
        if (this === localStorage && name === key) throw new DOMException('QA quota', 'QuotaExceededError');
        return window.bookshelfQASetItem.call(this, name, value);
      };
    }, shelfKey);
    await picker(page); await page.click('button:text-is("添加到书架")');
    await page.waitForSelector('dialog[open] .shelf-error');
    assert.equal(await page.evaluate(() => !!document.querySelector('.shelf-cover')), false);
    assert.equal(await page.evaluate((key) => localStorage.getItem(key), shelfKey), null);
    assert.equal(await page.evaluate(() => document.querySelector('dialog[open] .shelf-message').textContent.includes('已将')), false);
    await shot('save-failed');
    await page.click('button:text-is("直接阅读")'); await page.waitForSelector('.page-index');
    await back(page);
    await page.evaluate(() => { Storage.prototype.setItem = window.bookshelfQASetItem; delete window.bookshelfQASetItem; });
    return { firstEntry: true, actualCatalog: true, cancelAndKeyboardFocus: true, addedOnceAndRetainedOnRefresh: true,
      anonymousCoverReading: true, returnFlushAndResume: true, existingRelatedReturn: true,
      draftGuardProbe: true, returnSaveFailureVisible: true, legacyReadingPreserved: true, corruptShelfPreservedAndReadable: true,
      saveFailureReportedAndReadable: true };
  } finally {
    if (await page.evaluate(() => !!document.getElementById('bookshelf-qa-draft'))) {
      await page.evaluate(() => document.getElementById('bookshelf-qa-draft').remove());
    }
    if (await page.evaluate(() => !!document.querySelector('.return-to-shelf'))) await back(page);
    await page.evaluate(({ shelfKey, readingKey, startupKey }) => {
      if (window.bookshelfQASetItem) { Storage.prototype.setItem = window.bookshelfQASetItem; delete window.bookshelfQASetItem; }
      localStorage.removeItem(shelfKey); localStorage.removeItem(readingKey);
      localStorage.removeItem(startupKey);
    }, { shelfKey, readingKey, startupKey });
    await page.reload();
  }
}
