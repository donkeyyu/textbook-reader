import assert from 'node:assert/strict';

// Fresh, cooled graph with no explanation; startGraphStartupServer exposes Pixi only for QA.
export async function checkDirectorySelection(page) {
  await page.waitForFunction(() => window.qaStartup?.force.alpha() < .001, undefined, { timeout: 20000 });
  if (await page.evaluate(() => document.getElementById('graph-directory-toggle').getAttribute('aria-expanded') !== 'true')) {
    await page.click('#graph-directory-toggle');
  }
  const camera = () => page.evaluate(() => {
    const q = window.qaStartup, world = q.app.stage.children[0];
    return { x: world.x, y: world.y, zoom: world.scale.x };
  });
  const choose = async (offscreen) => {
    const fixture = await page.evaluate((offscreen) => {
      const q = window.qaStartup, world = q.app.stage.children[0];
      const panel = document.getElementById('graph-directory');
      const canvas = q.app.canvas.getBoundingClientRect(), directory = panel.getBoundingClientRect();
      const left = directory.right - canvas.left + 24;
      const right = q.app.screen.width - (document.getElementById('supplement-panel') ? 24 : 444);
      const selected = panel.querySelector('[aria-current="true"]')?.dataset.nodeKey;
      const items = [...q.sprites.values()].filter(({ node }) => {
        if (offscreen && node.key === selected) return false;
        const x = node.x * world.scale.x + world.x, y = node.y * world.scale.y + world.y;
        return offscreen ? (x < left - 40 && y > directory.top - canvas.top && y < directory.bottom - canvas.top) || x > right + 40
          : x > left && x < right && y > 90 && y < q.app.screen.height - 90;
      });
      const node = items[0]?.node;
      if (!node) throw new Error('No fixture fits the current viewport; run this check on a wide graph');
      const buttons = [...panel.querySelectorAll('button[data-node-key]')];
      const index = buttons.findIndex((button) => button.dataset.nodeKey === node.key);
      const button = buttons[index];
      for (let parent = button.parentElement; parent && parent !== panel; parent = parent.parentElement) {
        if (parent.tagName === 'DETAILS') parent.open = true;
      }
      window.qaDirectoryTree = panel.querySelector('.graph-directory-tree');
      return { key: node.key, title: node.title, index };
    }, offscreen);
    await page.click(`#graph-directory button[data-node-key] >> nth=${fixture.index}`);
    await page.waitForFunction(({ title }) => document.getElementById('supplement-title')?.textContent === title &&
      !document.querySelector('.reading-layout').getAnimations().some((a) => a.playState === 'running'), fixture);
    await page.evaluate(async () => { for (let i = 0; i < 4; i++) await new Promise(requestAnimationFrame); });
    const state = await page.evaluate((key) => {
      const q = window.qaStartup, world = q.app.stage.children[0], node = q.sprites.get(key).node;
      const panel = document.getElementById('graph-directory'), canvas = q.app.canvas.getBoundingClientRect();
      const x = node.x * world.scale.x + world.x, y = node.y * world.scale.y + world.y;
      const obstacle = panel.getBoundingClientRect();
      const covered = x > obstacle.left - canvas.left - 19 && x < obstacle.right - canvas.left + 19 &&
        y > obstacle.top - canvas.top - 19 && y < obstacle.bottom - canvas.top + 19;
      return { open: document.getElementById('graph-directory-toggle').getAttribute('aria-expanded'),
        sameTree: window.qaDirectoryTree === panel?.querySelector('.graph-directory-tree'),
        focusedKey: document.activeElement?.dataset.nodeKey,
        visible: !covered && x >= 19 && x <= q.app.screen.width - 19 &&
          y >= 19 && y <= q.app.screen.height - 19 };
    }, fixture.key);
    assert.equal(state.open, 'true'); assert.equal(state.sameTree, true); assert.equal(state.focusedKey, fixture.key);
    assert.equal(state.visible, true);
    return fixture;
  };
  const before = await camera();
  const visible = await choose(false);
  assert.deepEqual(await camera(), before, 'A visible node must not move or zoom the camera');
  await page.focus('.graph-viewport');
  for (let i = 0; i < 6; i++) await page.press('.graph-viewport', 'Shift+ArrowLeft');
  const offscreen = await choose(true);
  assert.equal((await camera()).zoom, before.zoom, 'Revealing an offscreen node preserves zoom');
  const widthBefore = await page.evaluate(() => document.getElementById('graph-directory').getBoundingClientRect().width);
  await page.focus('.graph-directory-resize'); await page.press('.graph-directory-resize', 'ArrowRight');
  await page.waitForFunction((width) => document.getElementById('graph-directory').getBoundingClientRect().width > width, widthBefore);
  const handle = await page.evaluate(() => document.querySelector('.graph-directory-resize').getBoundingClientRect().toJSON());
  const start = { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 };
  await page.mouse.move(start.x, start.y); await page.mouse.down();
  await page.mouse.move(start.x + 80, start.y); await page.mouse.up();
  const widthAfter = await page.evaluate(() => document.getElementById('graph-directory').getBoundingClientRect().width);
  assert.ok(widthAfter > widthBefore + 60, 'Dragging adjusts directory width');
  await page.click('#graph-directory-toggle'); await page.click('#graph-directory-toggle');
  assert.equal(await page.evaluate(() => document.getElementById('graph-directory').getBoundingClientRect().width), widthAfter);
  await page.evaluate(() => { delete window.qaDirectoryTree; });
  return { visibleNode: visible.title, offscreenNode: offscreen.title, widthBefore, widthAfter,
    treeAndFocusPreserved: true, visibleCameraPreserved: true, offscreenZoomPreserved: true };
}
