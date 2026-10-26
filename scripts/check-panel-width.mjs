import assert from 'node:assert/strict';

// Start on a wide viewport with a selected node and graph-only view.
export async function checkPanelWidth(page) {
  const state = () => page.evaluate(() => {
    const panel = document.getElementById('supplement-panel').getBoundingClientRect();
    const handle = document.querySelector('.panel-resize').getBoundingClientRect();
    return { width: panel.width, left: panel.left, handle: handle.toJSON(),
      orientation: document.querySelector('.panel-resize').getAttribute('aria-orientation') };
  });
  await page.waitForFunction(() => !document.querySelector('.reading-layout').getAnimations().some((a) => a.playState === 'running'));
  const before = await state();
  assert.equal(before.orientation, 'vertical');
  assert.ok(Math.abs(before.handle.x + before.handle.width / 2 - before.left) < 2);
  await page.mouse.move(before.left, before.handle.y + before.handle.height / 2);
  await page.mouse.down(); await page.mouse.move(before.left - 100, before.handle.y + before.handle.height / 2); await page.mouse.up();
  await page.waitForFunction((width) => Math.abs(document.getElementById('supplement-panel').getBoundingClientRect().width - width - 100) < 2, before.width);
  const dragged = await state();
  await page.press('.panel-resize', 'ArrowRight');
  await page.waitForFunction((width) => Math.abs(document.getElementById('supplement-panel').getBoundingClientRect().width - width + 20) < 2, dragged.width);
  const keyboard = await state();
  await page.cdp('Emulation.setDeviceMetricsOverride', { width: 700, height: 900, deviceScaleFactor: 1, mobile: false });
  await page.waitForFunction(() => document.querySelector('.panel-resize').getAttribute('aria-orientation') === 'horizontal');
  await page.press('.panel-resize', 'ArrowUp');
  assert.equal(await page.evaluate(() => document.querySelector('.panel-resize').getAttribute('aria-valuenow')), '50');
  await page.cdp('Emulation.setDeviceMetricsOverride', { width: 1760, height: 944, deviceScaleFactor: 1, mobile: false });
  await page.waitForFunction((width) => document.querySelector('.panel-resize').getAttribute('aria-orientation') === 'vertical' && Math.abs(document.getElementById('supplement-panel').getBoundingClientRect().width - width) < 2, keyboard.width);
  assert.equal(await page.evaluate(() => document.getElementById('locate-supplement').textContent.trim()), '');
  assert.equal(await page.evaluate(() => document.getElementById('locate-supplement').getAttribute('aria-label')), '定位教材原文');
  assert.equal(await page.evaluate(() => document.querySelector('.account-summary').textContent.trim()), '');
  await page.click('.account-summary'); await page.waitForSelector('.account-options');
  await page.press('.account-summary', 'Escape');
  assert.equal(await page.evaluate(() => document.querySelector('.account-options').open), false);
  return { before, dragged, keyboard, bottomAndSidePreserved: true, iconsAccessible: true };
}
