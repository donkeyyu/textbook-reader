import assert from 'node:assert/strict';
import { openGraphSearch, openGraphSettings } from './check-supplement-graph.mjs';

// Run on an owned reader page with the graph open and controls collapsed.
export async function checkGraphControls(page, { narrow = false } = {}) {
  await page.waitForFunction(() => !document.querySelector('.reading-layout').getAnimations().some((a) => a.playState === 'running'));
  const bounds = () => page.evaluate(() => {
    const graph = document.getElementById('supplement-graph').getBoundingClientRect();
    const canvas = document.querySelector('.graph-viewport canvas').getBoundingClientRect();
    const targets = ['.graph-settings', '#graph-book-toggle'];
    return { canvasFills: Math.abs(canvas.height - graph.height) < 2 && Math.abs(canvas.width - graph.width) < 2,
      graphInViewport: graph.bottom <= innerHeight + 1 && graph.right <= innerWidth + 1,
      overflow: targets.filter((selector) => {
        const rect = document.querySelector(selector)?.getBoundingClientRect();
        return rect && (rect.top < graph.top - 1 || rect.left < graph.left - 1 || rect.bottom > graph.bottom + 1 || rect.right > graph.right + 1);
      }) };
  });
  const initial = await bounds();
  assert.equal(initial.canvasFills, true); assert.equal(initial.graphInViewport, true); assert.deepEqual(initial.overflow, []);
  assert.equal(await page.evaluate(() => !!document.querySelector('.reading-view-controls')), false);
  assert.equal(await page.evaluate(() => !!document.getElementById('open-personal-library')), false);
  assert.equal(await page.evaluate(() => document.querySelector('#open-supplement-graph').textContent.trim()), '');
  assert.equal(await page.evaluate(() => document.querySelector('#add-personal-supplement').getAttribute('aria-label')), '添加补充');
  const settingsIcon = () => page.evaluate(() => {
    const { x, y } = document.querySelector('.graph-settings summary svg').getBoundingClientRect();
    return { x, y };
  });
  const closedIcon = await settingsIcon();
  await openGraphSettings(page);
  const openIcon = await settingsIcon();
  assert.ok(Math.abs(openIcon.x - closedIcon.x) < 1 && Math.abs(openIcon.y - closedIcon.y) < 1,
    'Settings icon stays at the same position when expanded');
  assert.deepEqual((await bounds()).overflow, []);
  const beforeZoom = await page.evaluate(() => document.querySelector('.graph-zoom output').textContent);
  await page.click('[aria-label="缩小节点图"]');
  assert.notEqual(await page.evaluate(() => document.querySelector('.graph-zoom output').textContent), beforeZoom);
  await openGraphSearch(page);
  assert.equal(await page.evaluate(() => document.activeElement === document.querySelector('.graph-search input')), true);
  await page.fill('.graph-search input', '练习');
  await page.waitForSelector('#graph-search-results button');
  assert.deepEqual((await bounds()).overflow, []);
  await page.press('.graph-search input', 'Escape');
  assert.equal(await page.evaluate(() => document.getElementById('graph-search-toggle').getAttribute('aria-expanded')), 'false');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'graph-search-toggle');
  await page.focus('.graph-viewport'); await page.press('.graph-viewport', '/');
  await page.waitForFunction(() => document.activeElement === document.querySelector('.graph-search input'));
  await page.fill('.graph-search input', '0要和它记录的量一起读');
  await page.waitForSelector('#graph-search-results button');
  await page.press('.graph-search input', 'ArrowDown'); await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.getElementById('supplement-title')?.textContent === '0要和它记录的量一起读');
  assert.equal(await page.evaluate(() => document.getElementById('graph-search-toggle').getAttribute('aria-expanded')), 'false');
  await page.waitForFunction(() => !document.querySelector('.reading-layout').getAnimations().some((a) => a.playState === 'running'));
  await openGraphSettings(page); assert.deepEqual((await bounds()).overflow, []);
  await page.press('.graph-settings > summary', 'Escape');
  assert.equal(await page.evaluate(() => document.querySelector('.graph-settings').open), false);
  await page.click('#graph-book-toggle');
  await page.waitForFunction((narrow) => narrow ? document.getElementById('supplement-graph').hidden : document.querySelector('.reading-layout').classList.contains('views-split'), narrow);
  const ownerBounds = () => page.evaluate(() => {
    const graph = document.getElementById('supplement-graph').getBoundingClientRect();
    const book = document.getElementById('textbook-view').getBoundingClientRect();
    const panel = document.getElementById('supplement-panel').getBoundingClientRect();
    const layout = document.querySelector('.reading-layout').getBoundingClientRect();
    return { graph: graph.toJSON(), book: book.toJSON(), panel: panel.toJSON(), layout: layout.toJSON(),
      bookVisible: getComputedStyle(document.getElementById('textbook-view')).visibility === 'visible',
      pressed: document.getElementById('graph-book-toggle').getAttribute('aria-pressed') };
  });
  const split = await ownerBounds();
  assert.equal(split.bookVisible, true);
  if (narrow) assert.equal(await page.evaluate(() => document.getElementById('page-sidebar').hidden), true, 'Showing the book must not open its navigation');
  if (!narrow) {
    assert.equal(split.pressed, 'true');
    assert.ok(split.book.left >= split.graph.right);
    assert.ok(split.panel.left >= split.graph.right, 'Explanation belongs entirely to the book pane');
    if (split.layout.right - split.book.left <= 1100) {
      assert.ok(split.panel.top >= split.book.bottom - 1, 'Narrow book pane stacks its explanation below');
      assert.ok(Math.abs(split.graph.height - split.layout.height) < 2, 'Explanation does not shorten the graph');
    } else {
      assert.ok(split.panel.left >= split.book.right - 1, 'Wide book pane places explanation beside the book');
    }
    await page.click('#graph-book-toggle');
    await page.waitForFunction(() => document.getElementById('graph-book-toggle').getAttribute('aria-pressed') === 'false');
  } else {
    await page.click('#open-supplement-graph');
  }
  await page.waitForFunction(() => !document.querySelector('.reading-layout').getAnimations().some((a) => a.playState === 'running'));
  const graphOnly = await ownerBounds();
  assert.equal(graphOnly.bookVisible, false);
  if (graphOnly.layout.width > 1100) assert.ok(graphOnly.panel.left >= graphOnly.graph.right - 1);
  else assert.ok(graphOnly.panel.top >= graphOnly.graph.bottom - 1);
  assert.ok(graphOnly.panel.bottom <= graphOnly.layout.bottom + 1);
  return { initial, split, graphOnly, settingsAndSearchWithinGraph: true, keyboardSearch: true,
    iconToolbar: true, bookToggleAndPanelOwnership: true };
}
