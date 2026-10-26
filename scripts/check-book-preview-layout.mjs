import assert from 'node:assert/strict';

// Start in desktop split view on page 9, with its first marker visible above the bottom edge.
export async function checkBookPreviewLayout(page) {
  const height = await page.evaluate(() => document.getElementById('supplement-graph').getBoundingClientRect().height);
  await page.hover('#supplement-ch1-positive-negative');
  await page.waitForSelector('.preview-docked');
  await page.waitForFunction(() => !document.getElementById('supplement-preview').getAnimations().some(a => a.playState === 'running'));
  const bounds = await page.evaluate(() => {
    const r = selector => document.querySelector(selector).getBoundingClientRect().toJSON();
    return { graph:r('#supplement-graph'), book:r('#textbook-view'), preview:r('.preview-docked'), layout:r('main'), toolbar:r('.book-toolbar'),
      border:getComputedStyle(document.getElementById('book-navigation-toggle')).borderTopWidth };
  });
  assert.equal(bounds.graph.height, height, 'Preview must not reduce the graph height');
  assert.equal(bounds.graph.bottom, bounds.layout.bottom);
  assert.equal(bounds.preview.left, bounds.book.left);
  assert.equal(bounds.preview.width, bounds.book.width);
  assert.ok(Math.abs(bounds.preview.top - bounds.book.bottom) <= 1);
  assert.ok(bounds.preview.bottom <= bounds.layout.bottom + 1);
  assert.equal(bounds.toolbar.height, 44);
  assert.equal(bounds.border, '0px');
  return bounds;
}
