import assert from 'node:assert/strict';

// Start with graph visible, book hidden, and directories collapsed.
export async function checkNavigationDirectories(page) {
  await page.click('#graph-directory-toggle');
  const all = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll('.graph-directory-tree button[data-node-key]')];
    return { count: buttons.length, unique: new Set(buttons.map((b) => b.dataset.nodeKey)).size,
      expected: Number(document.getElementById('supplement-graph').dataset.nodeCount) };
  });
  assert.equal(all.count, all.expected); assert.equal(all.unique, all.count);
  await page.selectOption('.graph-directory-filter select', 'concept');
  assert.equal(await page.evaluate(() => [...document.querySelectorAll('.graph-directory-tree button')]
    .every((b) => b.dataset.supplementType === 'concept')), true);
  await page.click('.graph-directory-chapter > summary >> nth=0');
  await page.click('.graph-directory-section > summary >> nth=0');
  const title = await page.evaluate(() => document.querySelector('.graph-directory-tree button span').childNodes[0].textContent);
  await page.click('.graph-directory-tree button >> nth=0');
  await page.waitForFunction((title) => document.getElementById('supplement-title')?.textContent === title, title);
  assert.equal(await page.evaluate(() => document.getElementById('graph-directory-toggle').getAttribute('aria-expanded')), 'true');
  await page.press('.graph-directory-filter select', 'Escape');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'graph-directory-toggle');
  await page.click('#graph-book-toggle');
  await page.waitForFunction(() => document.querySelector('.location-highlight'));
  const before = await page.evaluate(() => document.getElementById('supplement-graph').getBoundingClientRect().toJSON());
  await page.click('#book-navigation-toggle');
  const bounds = await page.evaluate(() => {
    const book = document.getElementById('textbook-view').getBoundingClientRect();
    const nav = document.getElementById('page-sidebar').getBoundingClientRect();
    const graph = document.getElementById('supplement-graph').getBoundingClientRect();
    return { book: book.toJSON(), nav: nav.toJSON(), graph: graph.toJSON(), panel: document.getElementById("supplement-panel").getBoundingClientRect().toJSON(), layout: document.querySelector(".reading-layout").getBoundingClientRect().toJSON(),
      globalToggle: !!document.querySelector('.toolbar .navigation-toggle') };
  });
  assert.equal(bounds.globalToggle, false);
  assert.ok(bounds.nav.right <= bounds.book.left + 1);
  assert.ok(bounds.nav.width <= 181);
  assert.ok(bounds.panel.left >= bounds.nav.right - 1);
  assert.ok(Math.abs(bounds.nav.bottom - bounds.layout.bottom) <= 1);
  assert.equal(bounds.graph.width, before.width);
  await page.click('.book-navigation-modes button >> nth=0');
  if (!await page.evaluate(() => document.querySelector('.book-contents details').open)) await page.click('.book-contents summary >> nth=0');
  const timeOrigin = await page.evaluate(() => performance.timeOrigin);
  await page.click('.book-contents details button >> nth=1');
  await page.waitForFunction(() => document.activeElement?.id.startsWith('page-'));
  assert.equal(await page.evaluate(() => document.getElementById('page-sidebar').hidden), false);
  assert.equal(await page.evaluate(() => performance.timeOrigin), timeOrigin);
  await page.click('.book-navigation-modes button >> nth=1');
  assert.equal(await page.evaluate(() => document.querySelector('.page-thumbnails').hidden), false);
  await page.click('#thumbnail-12');
  await page.waitForFunction(() => document.getElementById('thumbnail-12').getAttribute('aria-current') === 'page');
  assert.equal(await page.evaluate(() => document.getElementById('page-sidebar').hidden), false);
  assert.equal(await page.evaluate(() => performance.timeOrigin), timeOrigin);
  await page.press('.book-navigation-modes button >> nth=1', 'Escape');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'book-navigation-toggle');
  return { all, bounds, filterAndChoose: true, keyboardClose: true, bookContentsAndPages: true };
}
