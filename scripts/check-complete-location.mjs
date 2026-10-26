import assert from 'node:assert/strict';

// Start with the textbook visible and content loaded.
export async function checkCompleteLocation(page) {
  await page.click('.page-index');
  await page.fill('input[aria-label="页码"]', '12');
  await page.press('input[aria-label="页码"]', 'Enter');
  await page.click('#supplement-ch1-practice-p5-1');
  await page.mouse.move(100, 30);
  await page.waitForFunction(() => !!document.getElementById('location-ch1-practice-p5-1') && !document.getElementById('supplement-preview'));
  const region = await page.evaluate(() => {
    const frame = document.getElementById('location-ch1-practice-p5-1');
    return {top: parseFloat(frame.style.top), height: parseFloat(frame.style.height)};
  });
  assert.ok(region.top + region.height >= 28, 'both lines of the reservoir question are framed');
  assert.ok(region.top + region.height < 28.9, 'the next question is excluded');
  await page.click('#supplement-ch1-measurement-exercise');
  await page.mouse.move(100, 30);
  await page.waitForFunction(() => !!document.getElementById('location-ch1-measurement-exercise-part-1'));
  assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('.location-highlight')].map(e => [e.parentElement.id, e.dataset.supplementType])), [['page-12', 'question'], ['page-13', 'question']]);
  await page.click('[aria-label="关闭解读"]');
  await page.waitForFunction(() => !document.querySelector('.location-highlight'));
  return {completeQuestion:true, continuation:true, closeClearsAllRegions:true};
}
