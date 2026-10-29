import assert from 'node:assert/strict';

// Start in book-only mode. Exercises the shared search across all reading views.
export async function checkContentSearch(page) {
  const choose = async (title) => {
    await page.click('#graph-search-toggle');
    await page.fill('.graph-search input', title);
    await page.waitForSelector('#graph-search-results button');
    await page.press('.graph-search input', 'ArrowDown');
    await page.keyboard.press('Enter');
    await page.waitForFunction((title) => document.getElementById('supplement-title')?.textContent === title, title);
  };
  const { boundary, reference } = await page.evaluate(async () => {
    const { readPublishedContent } = await import('/src/textbook/content-store.ts');
    const { supplements } = await readPublishedContent();
    return { boundary: supplements.find((note) => note.id === 'ch1-zero-boundary'),
      reference: supplements.find((note) => note.id === 'ch1-zero-reference') };
  });
  assert.ok(boundary && reference, 'The reviewed zero locations must have published explanations');
  const first = boundary.title;
  await choose(first);
  await page.waitForSelector('.location-highlight');
  assert.equal(await page.evaluate(() => !!document.querySelector('#supplement-graph:not([hidden])')), false);
  await page.click('#graph-search-toggle');
  await page.fill('.graph-search input', boundary.paragraphs[0] ?? boundary.preview);
  await page.waitForSelector('#graph-search-results button');
  assert.ok(await page.evaluate((title) => document.getElementById('graph-search-results').textContent.includes(title), first));
  await page.press('.graph-search input', 'Escape');
  const bookPage = await page.evaluate(() => document.querySelector('.page-index').textContent);
  await page.click('#open-supplement-graph');
  await page.waitForSelector('.graph-viewport canvas');
  await choose(reference.title);
  assert.equal(await page.evaluate(() => document.querySelector('.page-index').textContent), bookPage, 'Hidden book must not jump');
  const focusedScale = await page.evaluate(() => document.querySelector('.graph-zoom output').textContent);
  await page.focus('.graph-viewport');
  await page.press('.graph-viewport', '-');
  await choose(reference.title);
  await page.waitForFunction((scale) => document.querySelector('.graph-zoom output').textContent === scale, focusedScale);
  await page.click('#graph-book-toggle');
  await choose(first);
  await page.waitForFunction(() => {
    const target = document.getElementById('location-ch1-zero-boundary');
    const viewport = document.getElementById('textbook-view');
    if (!target || !viewport || viewport.inert || target.closest('.paper')?.id !== 'page-9') return false;
    const region = target.getBoundingClientRect();
    const bounds = viewport.getBoundingClientRect();
    return region.width > 0 && region.height > 0 && region.top >= bounds.top - 1 && region.bottom <= bounds.bottom + 1 &&
      region.left >= bounds.left - 1 && region.right <= bounds.right + 1;
  });
  await page.click('#graph-search-toggle');
  await page.fill('.graph-search input', '不存在的内容xyz');
  assert.equal(await page.evaluate(() => document.querySelectorAll('#graph-search-results button').length), 0);
  await page.fill('.graph-search input', '题');
  await page.waitForFunction(() => document.querySelectorAll('#graph-search-results button').length > 20);
  for (const width of [1736, 390]) {
    await page.cdp('Emulation.setDeviceMetricsOverride', {width, height:944, deviceScaleFactor:1, mobile:false});
    const bounds = await page.evaluate(() => {
      const p = document.getElementById('graph-search-panel').getBoundingClientRect();
      const icon = document.getElementById('graph-search-toggle').getBoundingClientRect();
      const results = document.getElementById('graph-search-results').getBoundingClientRect();
      return {inline:Math.abs(p.top - icon.top) < 1 && p.right <= icon.left, resultsVisible:results.left >= 0 && results.right <= innerWidth && results.bottom <= innerHeight, left:p.left,right:p.right,bottom:p.bottom,top:p.top,width:innerWidth,height:innerHeight,
        global:!!document.querySelector('.toolbar #graph-search-toggle'),
        onTop:document.elementFromPoint(p.left + 20, p.top + 20)?.closest('#graph-search-panel') !== null};
    });
    assert.ok(bounds.inline && bounds.resultsVisible && bounds.onTop && bounds.global && bounds.left >= 0 && bounds.right <= bounds.width && bounds.top >= 0 && bounds.bottom <= bounds.height);
  }
  await page.press('.graph-search input', 'Escape');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'graph-search-toggle');
  return {bookSelection: true, hiddenBookStable: true, splitSelection: true, responsiveSearch: true};
}
