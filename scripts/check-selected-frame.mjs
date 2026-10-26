import assert from 'node:assert/strict';

// Start in textbook view with content loaded.
export async function checkSelectedFrame(page) {
  for (const id of ['ch1-deviation', 'ch1-zero-boundary']) {
    await page.click(`#supplement-${id}`);
    await page.mouse.move(100, 30);
    await page.waitForFunction((id) => !!document.getElementById(`location-${id}`) && !document.getElementById('supplement-preview'), id);
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('.location-highlight')].map(e => e.id)), [`location-${id}`]);
  }
  await page.click('[aria-label="关闭解读"]');
  await page.mouse.move(100, 30);
  await page.waitForFunction(() => !document.getElementById('supplement-panel') && !document.getElementById('supplement-preview'));
  assert.equal(await page.evaluate(() => document.querySelectorAll('.location-highlight').length), 0);
  return {framePersists:true,switchUpdatesFrame:true,closeClearsFrame:true};
}
