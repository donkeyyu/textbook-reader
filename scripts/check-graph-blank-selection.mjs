import assert from 'node:assert/strict';

// StartGraphStartupServer supplies the canvas probe on an owned origin.
// Call with a real selected node and a settled layout.
export async function checkGraphBlankSelection(page) {
  const blank = () => page.evaluate(() => {
    const q = window.qaStartup, world = q.app.stage.children[0], rect = q.app.canvas.getBoundingClientRect();
    for (let y = 60; y < rect.height - 60; y += 35) for (let x = 60; x < rect.width - 140; x += 35) {
      if ([...q.sprites.values()].every(({ node }) => Math.hypot(world.x + node.x * world.scale.x - x,
        world.y + node.y * world.scale.y - y) > 32)) return { x: rect.x + x, y: rect.y + y };
    }
    throw new Error('No empty canvas point found');
  });
  const selected = () => page.evaluate(() => !!document.querySelector('.graph-zoom button:last-child')?.textContent.includes('当前节点'));
  assert.equal(await selected(), true);
  const start = await blank();
  await page.mouse.move(start.x, start.y); await page.mouse.down();
  await page.mouse.move(start.x + 70, start.y + 25, { steps: 5 }); await page.mouse.up();
  assert.equal(await selected(), true, 'Panning must retain the selection');
  // Exercise the existing draft guard without changing saved personal content.
  await page.evaluate(() => {
    const marker = document.createElement('div'); marker.id = 'qa-unsaved-graph'; marker.dataset.dirty = 'true';
    document.body.appendChild(marker); window.qaConfirm = window.confirm; window.confirm = () => false;
  });
  try {
    let point = await blank(); await page.mouse.click(point.x, point.y);
    assert.equal(await selected(), true, 'Declining draft discard must retain the selection');
  } finally {
    await page.evaluate(() => { document.getElementById('qa-unsaved-graph').remove(); window.confirm = window.qaConfirm; delete window.qaConfirm; });
  }
  const point = await blank(); await page.mouse.click(point.x, point.y);
  await page.waitForFunction(() => !document.querySelector('.reading-layout').classList.contains('supplement-open'));
  assert.equal(await selected(), false);
  assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('graph-viewport')), true);
  await page.waitForFunction(() => [...window.qaStartup.sprites.values()].every((s) => s.dot.alpha === 1));
  return { blankClickClosesAndDeselects: true, panKeepsSelection: true, draftGuard: true, focusReturnsToGraph: true };
}
