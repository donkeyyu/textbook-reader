import assert from 'node:assert/strict';

// Run with an ego-browser Page already open on the current reader.
export async function checkPageNavigation(page, expanded) {
  const sidebarOpen = await page.evaluate(() => !document.querySelector('#page-sidebar').hidden);
  if (sidebarOpen !== expanded) await page.click('.navigation-toggle');
  const state = () => page.evaluate(() => ({
    label: document.querySelector('.page-index').textContent,
    scroll: document.querySelector('.paper-scroller').scrollTop,
  }));
  async function edit(mode) {
    if (!await page.evaluate(() => !!document.querySelector('#page-input'))) await page.press('.page-index', 'Enter');
    await page.selectOption('select[aria-label="跳页方式"]', mode);
    assert.ok(await page.evaluate(() => {
      const r = document.querySelector('#page-jump').getBoundingClientRect();
      return r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight;
    }), 'The page input and mode switch stay inside the viewport');
  }
  async function jump(input, mode, target) {
    await edit(mode);
    await page.fill('#page-input', input);
    await page.press('#page-input', 'Enter');
    await page.waitForFunction((number) => document.querySelector('.page-index span')?.textContent === `文件页序 ${number}/202` && !document.querySelector('.reading-message'), target);
    assert.equal(await page.evaluate(() => !!document.querySelector('#page-input')), false);
  }
  await edit('printed');
  assert.equal(await page.evaluate(() => document.querySelector('select[aria-label="跳页方式"]').value), 'printed');
  await jump('3', 'printed', 10);
  assert.match((await state()).label, /课本第 3 页/);
  console.log('PASS printed page 3 → file page 10');

  for (const input of ['', '3.0', '999', '1']) {
    await edit('printed');
    const before = await state();
    await page.fill('#page-input', input);
    await page.press('#page-input', 'Enter');
    await page.waitForSelector('#page-input-error', { state: 'visible' });
    assert.deepEqual(await state(), before, `Invalid printed label ${JSON.stringify(input)} must preserve the reading position`);
    assert.ok(await page.evaluate(() => document.querySelector('#page-input-error').textContent));
  }
  console.log('PASS empty, malformed and missing printed labels preserve the reading position');
  // Switch modes after an error, then correct the file page in place.
  await page.selectOption('select[aria-label="跳页方式"]', 'file');
  assert.equal(await page.evaluate(() => document.querySelector('select[aria-label="跳页方式"]').value), 'file');
  const before = await state();
  for (const input of ['', '203', '0', '1.5']) {
    await page.fill('#page-input', input);
    await page.press('#page-input', 'Enter');
    await page.waitForSelector('#page-input-error', { state: 'visible' });
    assert.deepEqual(await state(), before, `Invalid file page ${JSON.stringify(input)} must preserve the reading position`);
  }
  await page.press('#page-input', 'Escape');
  await page.waitForFunction(() => !document.querySelector('#page-input') && document.activeElement?.classList.contains('page-index'));
  console.log('PASS file-page errors and Escape focus recovery');
  for (const target of [1, 101, 202, 8, 31]) {
    await jump(String(target), 'file', target);
    if ([1, 202, 8, 31].includes(target)) assert.match((await state()).label, /无印刷页码/);
  }
  await jump('3', 'printed', 10);
  // Re-open the floating sidebar after narrow-screen navigation closes it.
  if (expanded && await page.evaluate(() => document.querySelector('#page-sidebar').hidden)) await page.click('.navigation-toggle');
  const bounds = await page.evaluate(() => {
    const r = document.querySelector('.page-index').getBoundingClientRect();
    return { left: r.left, right: r.right, width: innerWidth, documentWidth: document.documentElement.scrollWidth };
  });
  assert.ok(bounds.left >= 0 && bounds.right <= bounds.width && bounds.documentWidth === bounds.width, 'Navigation stays inside the viewport');
  console.log(`PASS page navigation: ${expanded ? 'expanded' : 'collapsed'}, printed 3 → file 10, first/middle/last, absent labels, errors, keyboard recovery`);
}
