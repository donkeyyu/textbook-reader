import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { openGraphSearch } from './check-supplement-graph.mjs';
import { jumpToFilePage } from './check-related-return.mjs';
import { splitReadingState, waitForReadingPosition } from './check-split-reading.mjs';

const book = JSON.parse(await readFile(new URL('../src/textbook/book.json', import.meta.url), 'utf8'));
const readingStorageKey = `textbook-reading-v1:${book.documentSha256}`;

// Run on a dedicated origin: navigation changes its saved reading position.
export async function checkGraphReadingPosition(page, { testOrigin, filePage = 28 } = {}) {
  assert.equal(new URL(await page.url()).origin, testOrigin);
  await jumpToFilePage(page, filePage);
  await page.waitForFunction(({ key, number }) => JSON.parse(localStorage.getItem(key))?.page === number,
    { key: readingStorageKey, number: filePage });
  await page.reload();
  await page.waitForSelector('#open-supplement-graph:not([disabled])');
  await page.waitForFunction((number) => Number(document.querySelector('.page-index span')?.textContent.split('/')[0]) === number, filePage);
  const before = await splitReadingState(page);
  await page.click('#open-supplement-graph');
  await page.waitForSelector('.graph-viewport canvas');
  const samples = await page.evaluate(async (readingStorageKey) => {
    const samples = [], start = performance.now();
    // Observe the whole transition, including writes made while the book is hidden.
    do {
      samples.push({ page: Number(document.querySelector('.page-index span').textContent.split('/')[0]),
        saved: JSON.parse(localStorage.getItem(readingStorageKey)),
        width: document.querySelector('.paper-list').clientWidth });
      await new Promise(requestAnimationFrame);
    } while (performance.now() - start < 650);
    return samples;
  }, readingStorageKey);
  assert.ok(samples.every((sample) => sample.page === filePage && sample.saved?.page === filePage),
    `Opening graph changed page: ${[...new Set(samples.map((sample) => `${sample.page}/${sample.saved?.page}`))].join(', ')}`);
  await page.click('#graph-book-toggle');
  await waitForReadingPosition(page, before);
  const after = await splitReadingState(page);
  assert.equal(after.page, before.page);
  assert.ok(Math.abs(after.fraction - before.fraction) < .015);
  return { before, after, samples };
}

// Continue from checkGraphReadingPosition's visible split book. This fixture's
// relation opens original textbook content, then returns to the saved source.
export async function checkHiddenGraphRelatedReturn(page) {
  const before = await splitReadingState(page);
  assert.equal(before.bookVisible, true);
  await page.click('#graph-book-toggle');
  await openGraphSearch(page);
  await page.fill('.graph-search input', '零上与零下温度');
  await page.click('#graph-search-results button');
  await page.waitForFunction(() => document.activeElement?.id === 'supplement-title');
  await page.waitForFunction(() => !document.querySelector('.reading-layout').getAnimations().some((animation) => animation.playState === 'running'));
  await page.click('#related-ch1-why-negative-ch1-source-positive-negative');
  await page.waitForSelector('.return-button');
  await page.waitForFunction(() => !document.querySelector('.reading-message'));
  await page.click('.return-button');
  await page.waitForFunction(() => !document.querySelector('.reading-message'));
  const after = await splitReadingState(page);
  assert.equal(after.page, before.page, 'Returning from a graph relation retains the visible textbook anchor');
  assert.ok(Math.abs(after.fraction - before.fraction) < .015, `Return moved within page: ${before.fraction} → ${after.fraction}`);
  return { before, after };
}
