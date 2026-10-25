import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { jumpToFilePage, openNote } from '../../../../scripts/check-related-return.mjs';

const book = JSON.parse(await readFile(new URL('../../../../src/textbook/book.json', import.meta.url), 'utf8'));
export const readingKey = `textbook-reading-v1:${book.documentSha256}`;
export const personalKey = `textbook-personal-v1:${book.documentSha256}`;
export const record = (page, fraction) => ({ version: 1, documentSha256: book.documentSha256, page, fraction });

export async function region(page, number) {
  return page.evaluate((number) => {
    const scroller = document.querySelector('.paper-scroller');
    const paper = document.getElementById(`page-${number}`);
    const top = paper.parentElement.offsetTop + paper.offsetTop;
    return { page: number, fraction: (scroller.scrollTop - top) / paper.offsetHeight };
  }, number);
}

export async function assertRegion(page, expected) {
  await page.waitForSelector('.paper-scroller');
  const actual = await region(page, expected.page);
  assert.ok(Math.abs(actual.fraction - expected.fraction) < .005, JSON.stringify({ expected, actual }));
  return actual;
}

export async function waitSaved(page, expected) {
  await page.waitForFunction(({ key, expected }) => {
    const actual = JSON.parse(localStorage.getItem(key));
    return actual?.page === expected.page && Math.abs(actual.fraction - expected.fraction) < .005;
  }, { key: readingKey, expected }, { timeout: 10000 });
}

export async function setRegion(page, number, fraction) {
  await jumpToFilePage(page, number);
  await page.evaluate(({ number, fraction }) => {
    const paper = document.getElementById(`page-${number}`);
    document.querySelector('.paper-scroller').scrollTop = paper.parentElement.offsetTop + paper.offsetTop + paper.offsetHeight * fraction;
  }, { number, fraction });
  await waitSaved(page, { page: number, fraction });
  return region(page, number);
}

// Use a dedicated local preview origin: these controlled fixtures must not touch user data.
export async function preload(page, { value, fail, trace = false } = {}) {
  const config = { key: readingKey, value, fail, trace };
  const { identifier } = await page.cdp('Page.addScriptToEvaluateOnNewDocument', { source: `
    (() => {
      const config = ${JSON.stringify(config)};
      if (!location.origin.startsWith('http://127.0.0.1:5194')) return;
      if (config.value !== undefined) localStorage.setItem(config.key, config.value);
      window.resumeWrites = [];
      window.resumeAttempts = 0;
      const get = Storage.prototype.getItem;
      const set = Storage.prototype.setItem;
      Storage.prototype.getItem = function(key) {
        if (key === config.key && config.fail === 'read') throw new Error('controlled read failure');
        return get.call(this, key);
      };
      Storage.prototype.setItem = function(key, value) {
        if (key === config.key) {
          window.resumeAttempts += 1;
          if (config.fail === 'write') throw new Error('controlled quota failure');
          if (config.trace) window.resumeWrites.push(JSON.parse(value));
        }
        return set.call(this, key, value);
      };
    })();` });
  return () => page.cdp('Page.removeScriptToEvaluateOnNewDocument', { identifier });
}

export async function checkStorageFailures(page) {
  const personalBefore = await page.evaluate((key) => localStorage.getItem(key), personalKey);
  for (const fail of ['read', 'write']) {
    const remove = await preload(page, { fail });
    try {
      await page.reload();
      await page.waitForSelector('.storage-error[role="status"]');
      await jumpToFilePage(page, 12);
      await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 900)));
      assert.equal(await page.evaluate(() => document.querySelectorAll('.storage-error[role="status"]').length), 1);
      assert.equal(await page.evaluate(() => window.resumeAttempts), fail === 'read' ? 0 : 1);
      assert.equal(await page.evaluate((key) => localStorage.getItem(key), personalKey), personalBefore);
      console.log(`PASS ${fail} failure: one notice; reading and saved notes remain available`);
    } finally { await remove(); }
  }
  await page.reload();
}

export async function checkInvalidRecords(page) {
  for (const value of ['{broken', JSON.stringify({ ...record(20, .3), documentSha256: 'other-book' }), JSON.stringify(record(203, .3))]) {
    const remove = await preload(page, { value });
    try {
      await page.reload();
      await page.waitForSelector('.paper-scroller');
      assert.equal(await page.evaluate(() => document.querySelector('.paper-scroller').scrollTop), 0);
      await page.click('button[aria-label="下一页"]');
      await page.waitForFunction(() => document.querySelector('#thumbnail-2').getAttribute('aria-current') === 'page');
    } finally { await remove(); }
  }
  console.log('PASS damaged, foreign, and out-of-range records: cover opens; reading still works');
}

export async function checkFirstWriteAndFlush(page) {
  const expected = { page: 50, fraction: .37 };
  const remove = await preload(page, { value: JSON.stringify(record(expected.page, expected.fraction)), trace: true });
  try {
    await page.reload();
    await waitSaved(page, expected);
    await assertRegion(page, expected);
    await page.waitForFunction(() => window.resumeWrites.length > 0);
    assert.ok((await page.evaluate(() => window.resumeWrites)).every((write) => write.page === 50));
    const rate = await page.evaluate(async () => {
      const started = performance.now();
      const before = window.resumeWrites.length;
      for (let index = 0; index < 12; index++) {
        document.querySelector('.paper-scroller').scrollTop += 2;
        await new Promise((resolve) => setTimeout(resolve, 80));
      }
      return { elapsed: performance.now() - started, writes: window.resumeWrites.length - before };
    });
    assert.ok(rate.writes <= Math.ceil(rate.elapsed / 700) + 1, `scroll writes are throttled: ${JSON.stringify(rate)}`);
    console.log('Observed scroll writes', rate);
    for (const event of ['pagehide', 'visibilitychange']) {
      await page.evaluate((event) => {
        document.querySelector('.paper-scroller').scrollTop += 8;
        if (event === 'visibilitychange') Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
        (event === 'pagehide' ? window : document).dispatchEvent(new Event(event));
        if (event === 'visibilitychange') delete document.visibilityState;
      }, event);
      const actual = await region(page, 50);
      await waitSaved(page, actual);
    }
    console.log('PASS first writes retain page 50; scrolling is throttled; pagehide/hidden flush pending position');
  } finally { await remove(); }
}

export async function checkRelatedRefresh(page) {
  await openNote(page, 'ch1-number-line-review');
  await page.evaluate(() => {
    const panel = document.querySelector('#supplement-panel');
    const button = document.querySelector('#related-ch1-number-line-review-ch1-order-on-axis');
    window.scrollTo(0, 0);
    panel.scrollTop += button.getBoundingClientRect().top - panel.getBoundingClientRect().top - 50;
  });
  await page.click('#related-ch1-number-line-review-ch1-order-on-axis');
  await page.waitForSelector('#location-ch1-order-on-axis');
  await page.waitForSelector('.return-button');
  const target = await page.evaluate((key) => {
    const paper = document.querySelector('.location-highlight').closest('.paper');
    return Number(paper.id.replace('page-', ''));
  }, readingKey);
  const expected = await region(page, target);
  await waitSaved(page, expected);
  await page.reload();
  await assertRegion(page, expected);
  assert.equal(await page.evaluate(() => !!document.querySelector('#supplement-panel, .return-button, .location-highlight, [data-dirty="true"]')), false);
  console.log(`PASS related target page ${target} survives refresh; panel, history, and drafts are absent`);
}
