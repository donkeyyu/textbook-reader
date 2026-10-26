import assert from 'node:assert/strict';
import { openGraphSettings } from './check-supplement-graph.mjs';

// Use startGraphStartupServer on an owned origin. Select a connected node,
// settle the layout and zoom below 80% before calling this check.
export async function checkGraphLabels(page, key) {
  const inspect = () => page.evaluate((key) => {
    const q = window.qaStartup, world = q.app.stage.children[0], rect = q.app.canvas.getBoundingClientRect();
    const direct = new Set([key]);
    for (const { source, target } of q.force.force('link').links()) {
      if (source.key === key) direct.add(target.key);
      if (target.key === key) direct.add(source.key);
    }
    const entries = [...q.sprites].map(([id, s]) => {
      const x = world.x + s.node.x * world.scale.x, y = world.y + s.node.y * world.scale.y;
      return { id, direct: direct.has(id), inside: x > 0 && x < q.app.screen.width && y > 0 && y < q.app.screen.height - 30,
        visible: s.label.visible, full: s.label.text === s.node.title, alpha: s.dot.alpha,
        children: s.dot.children.length, point: { x: rect.x + x, y: rect.y + y } };
    });
    return { zoom: world.scale.x, entries };
  }, key);
  const checkFocused = (state) => {
    const direct = state.entries.filter((s) => s.direct && s.inside);
    assert.ok(direct.length > 1, 'Include a visible connected node');
    assert.ok(direct.every((s) => s.visible && s.full && s.alpha === 1));
    assert.ok(state.entries.every((s) => s.children === 1), 'No outer ring');
  };
  const selected = await inspect();
  assert.ok(selected.zoom < .8);
  checkFocused(selected);
  await page.click('[aria-label="关闭解读"]');
  await page.waitForFunction(() => !document.querySelector('.reading-layout').getAnimations().some((a) => a.playState === 'running'));
  assert.equal((await inspect()).entries.filter((s) => s.visible).length, 0);
  const point = (await inspect()).entries.find((s) => s.id === key).point;
  await page.mouse.move(point.x, point.y);
  await page.waitForFunction(() => [...window.qaStartup.sprites.values()].some((s) => s.dot.alpha < 1));
  checkFocused(await inspect());
  await page.mouse.move(10, 30);
  await page.waitForFunction(() => [...window.qaStartup.sprites.values()].every((s) => !s.label.visible));
  await openGraphSettings(page);
  while ((await inspect()).zoom < .8) await page.click('[aria-label="放大节点图"]');
  assert.ok((await inspect()).entries.some((s) => s.inside && s.visible && !s.direct));
  return { selectedAndNeighborNames: true, hoverAndNeighborNames: true, zoomThreshold: true, noRings: true };
}
