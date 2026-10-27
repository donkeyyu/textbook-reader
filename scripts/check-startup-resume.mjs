import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { jumpToFilePage, readingSnapshot, checkReaderJourney } from './check-related-return.mjs';

const book = JSON.parse(await readFile(new URL('../src/textbook/book.json', import.meta.url), 'utf8'));
const shelfKey = 'textbook-shelf-v1';
const startupKey = 'textbook-startup-v1';
const readingKey = `textbook-reading-v1:${book.documentSha256}`;
const otherKey = 'textbook-reading-v1:resume-qa-other-version';
const personalKey = 'textbook-personal-v1:resume-qa-sentinel';
const keys = [shelfKey, startupKey, readingKey, otherKey, personalKey];

async function back(page) {
  await page.click('button[aria-label="返回书架"]');
  await page.waitForFunction((selector) => !!document.querySelector(selector), '.shelf-toolbar');
}

async function open(page) {
  await page.click('.shelf-cover');
  await page.waitForFunction((selector) => !!document.querySelector(selector), '.page-index');
}

async function assertPosition(page, position) {
  await page.waitForFunction((position) => {
    const paper = document.getElementById(`page-${position.page}`)?.getBoundingClientRect();
    const viewport = document.querySelector('.paper-scroller')?.getBoundingClientRect();
    return paper && viewport && Math.abs((viewport.top - paper.top) / paper.height - position.fraction) < .01;
  }, position);
  const state = await readingSnapshot(page, position.page);
  assert.ok(Math.abs(state.fraction - position.fraction) < .01);
  return state;
}

// Use an owned Page and a fresh localhost origin. No auth or cloud writes.
// The dirty input is a guard probe, not a real editor/save test.
export async function checkStartupResume(page, { testOrigin, evidenceDir, failuresOnly = false } = {}) {
  assert.ok(testOrigin, 'Pass a dedicated testOrigin');
  const origin = new URL(testOrigin);
  assert.ok(origin.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(origin.hostname) && origin.port);
  assert.equal(new URL(await page.url()).origin, origin.origin);
  assert.equal(await page.evaluate(() => localStorage.length), 0, 'Do not alter existing origin data');
  const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  const shot = async (name) => { if (evidenceDir) await page.screenshot({ path: `${evidenceDir}/${name}.png` }); };
  let denyScript;
  let journey;
  let phase = 'initial shelf';
  try {
    await page.waitForFunction((selector) => !!document.querySelector(selector), '.shelf-empty');
    const legacy = JSON.stringify({ version: 1, documentSha256: book.documentSha256, page: 28, fraction: .37 });
    await page.evaluate(({ readingKey, legacy, otherKey, personalKey }) => {
      localStorage.setItem(readingKey, legacy);
      localStorage.setItem(otherKey, 'another version position');
      localStorage.setItem(personalKey, 'saved QA content');
    }, { readingKey, legacy, otherKey, personalKey });
    if (!failuresOnly) {
    phase = 'legacy reload';
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction((selector) => !!document.querySelector(selector), '.shelf-empty');
    assert.equal(await page.evaluate((key) => localStorage.getItem(key), readingKey), legacy);
    await page.click('.shelf-toolbar button:text-is("添加教材")');
    await page.click('dialog[open] button:text-is("添加到书架")');
    await page.click('button[aria-label="关闭教材选择"]');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction((selector) => !!document.querySelector(selector), '.shelf-cover');
    assert.equal(await page.evaluate(() => !!document.querySelector('.shelf-empty')), false, 'Members remain visible without a startup record');
    assert.equal(await page.evaluate((key) => localStorage.getItem(key), readingKey), legacy);
    await open(page);
    await assertPosition(page, { page: 28, fraction: .37 });
    await page.waitForFunction((key) => JSON.parse(localStorage.getItem(key))?.page === 'reader', startupKey);
    assert.equal(await page.evaluate((key) => localStorage.getItem(key), readingKey), legacy, 'Opening must restore before it can save');

    // Reuse the established explanation → related → return → refresh check.
    phase = 'existing reader journey';
    journey = await checkReaderJourney(page);
    console.log('PASS startup: legacy position, saved members, and existing reader journey');
    await jumpToFilePage(page, 28);
    await page.evaluate(() => {
      const paper = document.getElementById('page-28').getBoundingClientRect();
      const viewport = document.querySelector('.paper-scroller');
      viewport.scrollTop += paper.top - viewport.getBoundingClientRect().top + paper.height * .37;
    });
    await assertPosition(page, { page: 28, fraction: .37 });
    await page.goto('about:blank');
    await page.goto(origin.origin, { waitUntil: 'domcontentloaded' });
    await assertPosition(page, { page: 28, fraction: .37 });
    await shot('reopened-reader');
    await page.cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await assertPosition(page, { page: 28, fraction: .37 });
    assert.equal(await page.evaluate(() => !!document.querySelector('#supplement-panel, .return-button, .location-highlight')), false);
    await shot('narrow-resume');

    const destination = await page.evaluate((key) => localStorage.getItem(key), startupKey);
    await page.evaluate(() => {
      const draft = document.createElement('input');
      draft.id = 'startup-qa-draft'; draft.dataset.dirty = 'true'; draft.value = 'kept QA draft';
      document.querySelector('.reader-app').appendChild(draft);
    });
    await page.click('button[aria-label="返回书架"]'); await page.dismissDialog();
    assert.equal(await page.evaluate(() => document.getElementById('startup-qa-draft')?.value), 'kept QA draft');
    assert.equal(await page.evaluate((key) => localStorage.getItem(key), startupKey), destination);
    await page.evaluate(() => document.getElementById('startup-qa-draft').remove());
    await page.reload({ waitUntil: 'domcontentloaded' }); await assertPosition(page, { page: 28, fraction: .37 });
    await back(page);
    await page.goto('about:blank'); await page.goto(origin.origin, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction((selector) => !!document.querySelector(selector), '.shelf-cover');
    assert.equal(await page.evaluate(() => !!document.querySelector('.page-index')), false);
    await shot('reopened-shelf');
    console.log('PASS startup: reopened reader/shelf, narrow resume, and canceled guard');
    }

    // Unavailable version and available-but-absent membership need no 03 UI.
    phase = 'unavailable or missing member';
    for (const [bookId, expected] of [['resume-qa-unavailable', '暂不可用'], [book.documentSha256, '不在书架']]) {
      await page.evaluate(({ startupKey, shelfKey, bookId, current }) => {
        localStorage.setItem(startupKey, JSON.stringify({ version: 1, page: 'reader', bookId }));
        localStorage.setItem(shelfKey, JSON.stringify({ version: 1, bookIds: bookId === current ? [] : [bookId, current] }));
      }, { startupKey, shelfKey, bookId, current: book.documentSha256 });
      await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForFunction((selector) => !!document.querySelector(selector), '.shelf-toolbar');
      assert.equal(await page.evaluate((text) => document.querySelector('.shelf-main').textContent.includes(text), expected), true);
      assert.equal(await page.evaluate(() => !!document.querySelector('.page-index')), false);
      await shot(bookId === book.documentSha256 ? 'not-on-shelf' : 'unavailable-version');
    }
    await page.evaluate(({ shelfKey, startupKey, current }) => {
      localStorage.setItem(shelfKey, JSON.stringify({ version: 1, bookIds: [current] }));
      localStorage.setItem(startupKey, JSON.stringify({ version: 1, page: 'shelf' }));
    }, { shelfKey, startupKey, current: book.documentSha256 });
    await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForFunction((selector) => !!document.querySelector(selector), '.shelf-cover');

    phase = 'invalid reading positions';
    for (const value of ['{broken', JSON.stringify({ version: 1, documentSha256: 'wrong-version', page: 28, fraction: .37 }),
      JSON.stringify({ version: 1, documentSha256: book.documentSha256, page: 203, fraction: .37 })]) {
      await page.evaluate(({ startupKey, readingKey, current, value }) => {
        localStorage.setItem(startupKey, JSON.stringify({ version: 1, page: 'reader', bookId: current }));
        localStorage.setItem(readingKey, value);
      }, { startupKey, readingKey, current: book.documentSha256, value });
      await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForFunction((selector) => !!document.querySelector(selector), '.page-index');
      assert.equal(await page.evaluate(() => document.querySelector('.page-index')?.textContent?.trim()), '1/202');
      assert.equal(await page.evaluate(() => document.querySelector('.storage-error')?.textContent.includes('上次阅读位置无法识别')), true);
      await jumpToFilePage(page, 9); await back(page);
      assert.equal(await page.evaluate((key) => localStorage.getItem(key), readingKey), value, 'Bad position is retained, other records are untouched');
    }
    console.log('PASS startup: unavailable/missing member and invalid reading positions');
    phase = 'invalid startup record';
    await page.evaluate(({ readingKey, legacy, startupKey }) => { localStorage.setItem(readingKey, legacy); localStorage.setItem(startupKey, '{broken'); }, { readingKey, legacy, startupKey });
    await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForFunction((selector) => !!document.querySelector(selector), '.shelf-cover');
    phase = 'startup write failure';
    assert.equal(await page.evaluate(() => document.querySelector('.shelf-main').textContent.includes('停留页面记录无法识别')), true);
    await open(page); await assertPosition(page, { page: 28, fraction: .37 }); await back(page);
    assert.equal(await page.evaluate((key) => localStorage.getItem(key), startupKey), '{broken');

    await page.evaluate((key) => localStorage.setItem(key, JSON.stringify({ version: 1, page: 'shelf' })), startupKey);
    await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForFunction((selector) => !!document.querySelector(selector), '.shelf-cover');
    await page.evaluate((key) => {
      window.resumeQASetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function (name, value) {
        if (this === localStorage && name === key) throw new DOMException('QA quota', 'QuotaExceededError');
        return window.resumeQASetItem.call(this, name, value);
      };
    }, startupKey);
    await open(page);
    await page.waitForFunction(() => document.querySelector('.storage-error')?.textContent.includes('无法保存当前停留页面'));
    assert.equal(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).page, startupKey), 'shelf');
    await back(page);
    assert.equal(await page.evaluate(() => document.querySelector('.shelf-main').textContent.includes('无法保存当前停留页面')), true);
    await page.evaluate(() => { Storage.prototype.setItem = window.resumeQASetItem; delete window.resumeQASetItem; });

    phase = 'storage read failures';
    const denied = await page.cdp('Page.addScriptToEvaluateOnNewDocument', { source: `
      const resumeOriginalGet = Storage.prototype.getItem;
      Storage.prototype.getItem = function (key) {
        if (this === localStorage && ${JSON.stringify([startupKey, readingKey])}.includes(key)) throw new DOMException('QA denied', 'SecurityError');
        return resumeOriginalGet.call(this, key);
      };
    ` });
    denyScript = denied.identifier;
    await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForFunction((selector) => !!document.querySelector(selector), '.shelf-cover');
    assert.equal(await page.evaluate(() => document.querySelector('.shelf-main').textContent.includes('无法读取上次停留页面')), true);
    await open(page); await page.waitForFunction((selector) => !!document.querySelector(selector), '.storage-error');
    assert.equal(await page.evaluate(() => document.querySelector('.storage-error').textContent.includes('无法读取上次阅读位置')), true);
    await shot('storage-read-failure');
    await back(page);
    await page.cdp('Page.removeScriptToEvaluateOnNewDocument', { identifier: denyScript }); denyScript = undefined;
    await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForFunction((selector) => !!document.querySelector(selector), '.shelf-cover');
    assert.deepEqual(await page.evaluate(({ otherKey, personalKey }) => [localStorage.getItem(otherKey), localStorage.getItem(personalKey)], { otherKey, personalKey }), ['another version position', 'saved QA content']);
    return { mainJourney: failuresOnly ? null : { legacyAndMemberOnlyStartup: true, readerReopen: true, shelfReopen: true, resizedResume: true,
      guardProbeAndCanceledDestination: true, existingReaderJourney: journey }, unavailableAndMissingMember: true, invalidPositionsPreserved: true,
      invalidStartupPreservedAndReadable: true, storageWriteAndReadFailure: true, unrelatedRecordsPreserved: true,
    };
  } catch (cause) {
    console.error('Startup QA failed during:', phase);
    console.error(await page.snapshot());
    throw cause;
  } finally {
    if (denyScript) await page.cdp('Page.removeScriptToEvaluateOnNewDocument', { identifier: denyScript });
    await page.goto('about:blank');
    await page.goto(origin.origin, { waitUntil: 'domcontentloaded' });
    // The fresh page has unmodified Storage methods. Remove only our own keys.
    if (await page.evaluate(() => !!document.querySelector('.return-to-shelf'))) await back(page);
    await page.evaluate((keys) => { for (const key of keys) localStorage.removeItem(key); }, keys);
    await page.cdp('Emulation.setDeviceMetricsOverride', { ...viewport, deviceScaleFactor: 1, mobile: false });
    await page.reload({ waitUntil: 'domcontentloaded' });
  }
}
