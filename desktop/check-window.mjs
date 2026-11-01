import assert from 'node:assert/strict';

// Resize the actual OS window. Device emulation hides viewport/window mismatches.
export async function resizeWindow(app, page, { width, height }, outer = false) {
  const native = await app.evaluate(({ BrowserWindow, screen }, { width, height, outer }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.webContents.disableDeviceEmulation();
    const previous = window.getBounds(), content = window.getContentBounds();
    const work = screen.getDisplayMatching(previous).workArea;
    const frame = previous.height - content.height;
    const nextWidth = Math.min(width, work.width), nextHeight = Math.min(height + (outer ? 0 : frame), work.height);
    window.setBounds({ x: Math.max(work.x, Math.min(previous.x, work.x + work.width - nextWidth)), y: Math.max(work.y, Math.min(previous.y, work.y + work.height - nextHeight)), width: nextWidth, height: nextHeight });
    return { bounds: window.getBounds(), content: window.getContentBounds() };
  }, { width, height, outer });
  await page.waitForFunction(({ width, height }) => innerWidth === width && innerHeight === height, native.content);
  assert.deepEqual(await page.evaluate(() => [innerWidth, innerHeight]), [native.content.width, native.content.height]);
  return native;
}

export async function showNoteList(page) {
  const toggle = page.getByRole('button', { name: '笔记列表', exact: true });
  if (await toggle.isVisible() && await toggle.getAttribute('aria-expanded') === 'false') await toggle.click();
}
