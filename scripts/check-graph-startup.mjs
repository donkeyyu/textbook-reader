import assert from 'node:assert/strict';

// Timing and live-object probes exist only on this dedicated Vite server.
export async function startGraphStartupServer({ port = 47938 } = {}) {
  const { createServer } = await import('vite');
  const server = await createServer({ server: { host: '127.0.0.1', port, strictPort: true }, plugins: [{
    name: 'graph-startup-check', enforce: 'pre',
    transform(source, id) {
      if (!id.endsWith('/reader/graph/useSupplementGraph.ts')) return;
      const replace = (before, after) => {
        assert.ok(source.includes(before), `Startup probe anchor missing: ${before}`);
        source = source.replace(before, after);
      };
      replace('const renderer = new Application();', `const renderer = new Application();
        const qa = window.qaStartup = { app: renderer, profile: { start: performance.now(), draws: [], ticks: [] } };`);
      replace('initializedApp = true;', 'qa.profile.init = performance.now() - qa.profile.start; initializedApp = true;');
      replace('const next = sprites.current;', 'const next = sprites.current; window.qaStartup.sprites = next;');
      replace('function draw() {', 'function draw() { const qaDraw = performance.now();');
      replace('renderer!.render();', `const qaRender = performance.now(); renderer!.render();
        window.qaStartup.profile.draws.push({ total: performance.now() - qaDraw, render: performance.now() - qaRender,
          sinceStart: performance.now() - window.qaStartup.profile.start });`);
      replace('simulation.current = force;', `simulation.current = force;
        window.qaStartup.force = force; window.qaStartup.liveTicks = 0;
        force.on('tick.startupCheck', () => window.qaStartup.liveTicks++);
        const qaTick = force.tick;
        force.tick = function(iterations) { const start = performance.now(); const result = qaTick.call(this, iterations);
          window.qaStartup.profile.ticks.push({ iterations, ms: performance.now() - start }); return result; };`);
      return source;
    },
  }] });
  await server.listen();
  return server;
}

// Call on a fresh reader page, optionally after opening a textbook explanation.
export async function measureGraphStartup(page, { testOrigin }) {
  assert.equal(new URL(await page.url()).origin, testOrigin);
  assert.equal(await page.evaluate(() => !!document.querySelector('.graph-viewport canvas')), false);
  await page.click('#open-supplement-graph');
  await page.waitForFunction(() => window.qaStartup?.profile.draws.length > 0);
  return page.evaluate(() => window.qaStartup.profile);
}

// Run immediately after opening a selected node. Closing its explanation must
// release startup camera tracking while the layout continues to settle.
export async function checkStartupSelectionRelease(page) {
  assert.equal(await page.evaluate(() => window.qaStartup.force.alpha() >= window.qaStartup.force.alphaMin()), true);
  await page.click('[aria-label="关闭解读"]');
  await page.waitForFunction(() => !document.querySelector('.reading-layout').getAnimations()
    .some((animation) => animation.playState === 'running'));
  const result = await page.evaluate(async () => {
    const qa = window.qaStartup, world = qa.app.stage.children[0];
    const sample = () => ({ x: (qa.app.screen.width / 2 - world.x) / world.scale.x,
      y: (qa.app.screen.height / 2 - world.y) / world.scale.y, ticks: qa.liveTicks });
    const before = sample();
    for (let frame = 0; frame < 8; frame++) await new Promise(requestAnimationFrame);
    return { before, after: sample() };
  });
  assert.ok(result.after.ticks > result.before.ticks, 'Check selection release while layout is still moving');
  assert.ok(Math.abs(result.before.x - result.after.x) < 1 && Math.abs(result.before.y - result.after.y) < 1,
    'Closing selection must stop initial camera tracking');
  return result;
}
