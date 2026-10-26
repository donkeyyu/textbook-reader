import assert from 'node:assert/strict';
import { openGraphSettings } from './check-supplement-graph.mjs';

// Fresh, unselected graph on startGraphStartupServer's owned origin.
export async function checkGraphZoom(page) {
  await page.waitForFunction(() => window.qaStartup?.force?.alpha() < .001, undefined, { timeout: 20000 });
  const state = () => page.evaluate(() => {
    const q = window.qaStartup, world = q.app.stage.children[0], rect = q.app.canvas.getBoundingClientRect();
    const x = Math.round(rect.x + rect.width * .4) - rect.x, y = Math.round(rect.y + rect.height * .4) - rect.y;
    return { zoom: world.scale.x, anchor: { x: (x - world.x) / world.scale.x, y: (y - world.y) / world.scale.y },
      point: { x: rect.x + x, y: rect.y + y }, pageScale: visualViewport.scale };
  });
  const initial = await state();
  assert.ok(initial.zoom >= .1 && initial.zoom < 1, 'First entry opens at overview scale');
  const coverage = await page.evaluate(() => {
    const q = window.qaStartup, world = q.app.stage.children[0];
    const nodes = [...q.sprites.values()];
    return nodes.filter(({ node }) => {
      const x = node.x * world.scale.x + world.x, y = node.y * world.scale.y + world.y;
      return x >= 0 && x <= q.app.screen.width && y >= 0 && y <= q.app.screen.height;
    }).length / nodes.length;
  });
  assert.ok(coverage >= .95, 'Overview shows at least 95% of nodes');
  const wheel = async (deltaY, ctrlKey) => {
    const before = await state();
    await page.cdp('Input.dispatchMouseEvent', { type: 'mouseWheel', ...before.point, deltaX: 0, deltaY, modifiers: ctrlKey ? 2 : 0 });
    await page.waitForFunction((zoom) => window.qaStartup.app.stage.children[0].scale.x !== zoom, before.zoom);
    const after = await state();
    assert.ok(Math.abs(after.anchor.x - before.anchor.x) < .01 && Math.abs(after.anchor.y - before.anchor.y) < .01,
      'Zoom must keep the pointer anchor fixed');
    assert.equal(after.pageScale, before.pageScale, 'Only the graph should zoom');
    return after;
  };
  const normal = await wheel(-40, false);
  await wheel(40, false);
  const pinch = await wheel(-40, true);
  assert.ok(normal.zoom / initial.zoom > 1.09 && normal.zoom / initial.zoom < 1.12);
  assert.ok(pinch.zoom / initial.zoom > 1.48 && pinch.zoom / initial.zoom < 1.51);
  assert.equal((await wheel(-1000, true)).zoom, 3);
  assert.equal((await wheel(1000, true)).zoom, .1);
  await openGraphSettings(page);
  await page.click('[aria-label="放大节点图"]');
  const beforeHide = await state();
  await page.click('#open-supplement-graph'); await page.click('#open-supplement-graph');
  assert.equal((await state()).zoom, beforeHide.zoom, 'Reopening preserves the chosen zoom');
  await openGraphSettings(page);
  await page.click('.graph-zoom button:text-is("全图")');
  assert.ok(Math.abs((await state()).zoom - initial.zoom) < .001);
  return { defaultZoom: initial.zoom, overviewCoverage: coverage, wheelZoom: normal.zoom, pinchZoom: pinch.zoom,
    pointerAnchored: true, limits: true, reopenPreservesZoom: true, overviewAvailable: true };
}
