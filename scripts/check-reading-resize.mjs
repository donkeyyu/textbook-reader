import assert from 'node:assert/strict';
import { splitReadingState } from './check-split-reading.mjs';

// Owned page with the book visible and an explanation open. Run the whole check
// in one browser round so device-metrics reset cannot hide a resize failure.
export async function checkReadingResize(page) {
  const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  const settle = async () => {
    await page.waitForFunction(() => document.querySelector('.reading-layout').getAnimations({ subtree: true })
      .every((animation) => animation.playState !== 'running'));
    await page.evaluate(() => new Promise((resolve) => {
      let frames = 0;
      const next = () => ++frames === 4 ? resolve() : requestAnimationFrame(next);
      requestAnimationFrame(next);
    }));
  };
  const before = await splitReadingState(page);
  assert.equal(before.bookVisible, true);
  assert.ok(before.title, 'Open an explanation before checking resize');
  const results = [];
  const assertPosition = (width) => page.waitForFunction(({ before, width }) => {
    const list = document.querySelector('.paper-list');
    const scroller = document.querySelector('.paper-scroller');
    const paper = list.children[before.page - 1];
    return innerWidth === width && Math.abs((scroller.scrollTop - list.offsetTop - paper.offsetTop)
      / paper.offsetHeight - before.fraction) < .015;
  }, { before, width }, { timeout: 5000 });
  try {
    // No settling between changes: catch clamped scroll offsets while the
    // responsive drawer still occupies its previous grid track.
    for (const width of [390, 1440, 390, 1440, 390, 1440]) {
      await page.cdp('Emulation.setDeviceMetricsOverride', { width, height: width === 390 ? 844 : 960,
        deviceScaleFactor: 1, mobile: false });
    }
    await settle();
    await assertPosition(1440);
    for (const width of [390, 1440, 390, 1440]) {
      await page.cdp('Emulation.setDeviceMetricsOverride', { width, height: width === 390 ? 844 : 960,
        deviceScaleFactor: 1, mobile: false });
      await settle();
      await assertPosition(width);
      const after = await splitReadingState(page);
      assert.equal(after.title, before.title, 'Resize retains the selected explanation');
      assert.equal(after.page, before.page, 'Resize retains the reading page');
      results.push({ width, page: after.page, fraction: after.fraction });
    }
    await page.evaluate(() => { document.querySelector('.paper-scroller').scrollTop += 120; });
    await settle();
    const scrolled = await splitReadingState(page);
    assert.ok(Math.abs(scrolled.fraction - before.fraction) > .02 || scrolled.page !== before.page,
      'An ordinary scroll still updates the reading position');
    return { before, rapidResize: true, resizes: results, ordinaryScroll: scrolled };
  } finally {
    await page.cdp('Emulation.setDeviceMetricsOverride', { ...viewport, deviceScaleFactor: 1, mobile: false });
    await settle();
  }
}
