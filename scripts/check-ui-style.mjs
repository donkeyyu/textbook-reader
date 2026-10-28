import assert from 'node:assert/strict';
import { openShelfReader } from './check-bookshelf.mjs';
import { checkReviewCase, jumpToFilePage } from './check-related-return.mjs';

const key = 'textbook-ui-style-v1';

async function choose(page, style) {
  await page.click('button[aria-label="设置"]');
  await page.waitForSelector('.shelf-settings[open]');
  await page.click(`input[name="ui-style"][value="${style}"]`);
  assert.equal(await page.evaluate(() => document.documentElement.dataset.uiStyle), style);
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), '设置');
  await page.evaluate(async () => { await document.fonts.ready; });
}

// Use an owned Page on an empty, dedicated localhost origin. No sign-in or cloud writes.
export async function checkUiStyles(page, { testOrigin, evidenceDir } = {}) {
  assert.ok(testOrigin, 'Pass a dedicated testOrigin');
  const origin = new URL(testOrigin);
  assert.ok(origin.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(origin.hostname) && origin.port);
  assert.equal(new URL(await page.url()).origin, origin.origin);
  assert.equal(await page.evaluate(() => localStorage.length), 0, 'Use a new origin; preserve existing browser records');
  await page.waitForSelector('.shelf-toolbar');
  assert.equal(await page.evaluate(() => document.documentElement.dataset.uiStyle), 'island');
  assert.equal(await page.evaluate(() => performance.getEntriesByType('resource').some((entry) => entry.name.includes('noto-serif'))), false);
  await page.focus('button[aria-label="设置"]');
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => document.querySelectorAll('.shelf-settings input[type="radio"]').length), 4);
  assert.equal(await page.evaluate(() => document.querySelector('.shelf-settings input:checked')?.value), 'island');
  await page.keyboard.press('Escape');
  await choose(page, 'warm');

  await page.click('button[aria-label="设置"]');
  await page.evaluate((key) => {
    window.uiStyleQASetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name, value) {
      if (this === localStorage && name === key) throw new DOMException('QA style quota', 'QuotaExceededError');
      return window.uiStyleQASetItem.call(this, name, value);
    };
  }, key);
  try {
    await page.click('input[name="ui-style"][value="youth"]');
    assert.equal(await page.evaluate(() => document.documentElement.dataset.uiStyle), 'youth');
    assert.equal(await page.evaluate((key) => localStorage.getItem(key), key), 'warm');
    assert.match(await page.evaluate(() => document.querySelector('.style-save-error')?.textContent), /无法保存/);
  } finally {
    await page.evaluate(() => { Storage.prototype.setItem = window.uiStyleQASetItem; delete window.uiStyleQASetItem; });
  }
  await page.click('button:text-is("重试保存")');
  assert.equal(await page.evaluate((key) => localStorage.getItem(key), key), 'youth');
  assert.equal(await page.evaluate(() => !!document.querySelector('.style-save-error')), false);
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('name')), 'ui-style');
  await page.press('input[name="ui-style"][value="youth"]', 'ArrowLeft');
  assert.equal(await page.evaluate(() => document.documentElement.dataset.uiStyle), 'warm');
  await page.keyboard.press('Escape');

  for (const style of ['island', 'simple', 'warm', 'youth']) {
    await choose(page, style);
    await page.reload();
    await page.waitForSelector('.shelf-toolbar');
    assert.equal(await page.evaluate(() => document.documentElement.dataset.uiStyle), style, 'Reload must restore the selected style');
    await page.evaluate(async () => { await document.fonts.ready; });
    await openShelfReader(page);
    await jumpToFilePage(page, 10);
    await page.click('button[aria-label="概念与性质：−27 g说的是比标准少多少"]');
    await page.waitForFunction(() => {
      const image = document.querySelector('#page-10 .page-image');
      return image?.complete && image.naturalWidth > 0;
    });
    assert.equal(await page.evaluate(() => document.documentElement.dataset.uiStyle), style);
    const image = await page.evaluate(() => document.querySelector('#page-10 .page-image').getAttribute('src'));
    assert.equal(image, '/textbooks/grade-7-volume-1/page-10.webp');
    await page.waitForFunction(() => document.querySelector('#supplement-panel').getAnimations({ subtree: true }).every((animation) => animation.playState !== 'running'));
    if (evidenceDir) await page.screenshot({ path: `${evidenceDir}/${style}-reader.png` });
    await checkReviewCase(page, 0);
    await jumpToFilePage(page, 10);
    await page.click('button[aria-label="返回书架"]');
    await page.waitForSelector('.shelf-toolbar');
    assert.match(await page.evaluate(() => document.querySelector('.shelf-position')?.textContent), /课本第 3 页/);
    if (evidenceDir) await page.screenshot({ path: `${evidenceDir}/${style}-shelf.png` });
    await page.click('.shelf-cover');
    await page.waitForSelector('.page-index');
    assert.equal(await page.evaluate(() => document.querySelector('.page-index')?.textContent), '10/202', 'Changing style must retain the saved textbook page');
    await page.reload();
    await page.waitForSelector('.page-index');
    assert.equal(await page.evaluate(() => document.documentElement.dataset.uiStyle), style, 'Direct reader startup must restore style');
    assert.equal(await page.evaluate(() => document.querySelector('.page-index')?.textContent), '10/202');
    await page.click('button[aria-label="返回书架"]');
    await page.waitForSelector('.shelf-toolbar');
  }
  console.log('PASS UI styles: default, keyboard, persistence, save retry, shelf/reader resume, original pixels and related return in all four styles');
}

export async function checkUiStylesNarrow(page, { evidenceDir } = {}) {
  await page.waitForSelector('.shelf-toolbar');
  for (const style of ['island', 'simple', 'warm', 'youth']) {
    await choose(page, style);
    const bounds = await page.evaluate(() => {
      const brand = document.querySelector('.shelf-brand').getBoundingClientRect();
      const actions = document.querySelector('.shelf-toolbar .toolbar-actions').getBoundingClientRect();
      const targets = [...document.querySelectorAll('.shelf-toolbar .shelf-primary, .shelf-settings-trigger, .shelf-toolbar .account-summary')]
        .every((button) => { const rect = button.getBoundingClientRect(); return rect.width >= 44 && rect.height >= 44; });
      return { width: innerWidth, scrollWidth: document.documentElement.scrollWidth, brandRight: brand.right, actionsLeft: actions.left, actionsRight: actions.right, targets };
    });
    assert.ok(bounds.scrollWidth <= bounds.width && bounds.brandRight <= bounds.actionsLeft && bounds.actionsRight <= bounds.width, 'Header controls must fit without overlap');
    assert.ok(bounds.targets, 'Shelf toolbar controls must keep 44px touch targets');
    await page.click('button[aria-label="设置"]');
    assert.equal(await page.evaluate(() => [...document.querySelectorAll('.style-option')].every((item) => {
      const rect = item.getBoundingClientRect(); return rect.left >= 0 && rect.right <= innerWidth;
    })), true, 'Every style choice must fit the narrow dialog');
    await page.waitForFunction(() => document.querySelector('.shelf-settings').getAnimations().every((animation) => animation.playState !== 'running'));
    if (evidenceDir) await page.screenshot({ path: `${evidenceDir}/${style}-settings.png` });
    await page.keyboard.press('Escape');
    if (evidenceDir) await page.screenshot({ path: `${evidenceDir}/${style}-shelf.png` });
    await openShelfReader(page);
    await jumpToFilePage(page, 10);
    await page.click('button[aria-label="概念与性质：−27 g说的是比标准少多少"]');
    await page.waitForFunction(() => document.querySelector('#supplement-panel').getAnimations({ subtree: true }).every((animation) => animation.playState !== 'running'));
    if (evidenceDir) await page.screenshot({ path: `${evidenceDir}/${style}-reader.png` });
    await page.click('button[aria-label="返回书架"]');
    await page.waitForSelector('.shelf-toolbar');
  }
  console.log('PASS narrow UI styles: header/settings bounds and shelf/reader paths');
}
