import assert from 'node:assert/strict';

const cases = [
  ['ch3-q-p88-example4', 'triangle-area'],
  ['ch3-triangle-base-height', 'triangle-height'],
  ['ch3-area-value-unit', 'area-unit'],
];

// Start on file page 88 in the book view. Does not edit personal content.
export async function checkPage88Content(page, { evidenceDir } = {}) {
  const results = [];
  const settle = () => page.waitForFunction(() => [...document.querySelector('.reading-layout').getAnimations(), ...(document.querySelector('#supplement-panel')?.getAnimations() ?? [])]
    .every((animation) => animation.playState !== 'running'));
  async function open(id, diagram) {
    if (await page.evaluate(() => !!document.querySelector('#supplement-panel'))) await page.click('button[aria-label="关闭解读"]');
    await page.click(`[data-supplement-ids~="${id}"]`);
    if (await page.evaluate((id) => !!document.getElementById(`choice-${id}`), id)) await page.click(`#choice-${id}`);
    await page.waitForSelector(`[data-diagram="${diagram}"]`);
    await settle();
  }
  for (const width of [1440, 390, 320]) {
    await page.cdp('Emulation.setDeviceMetricsOverride', { width, height: width === 1440 ? 1000 : 844, deviceScaleFactor: 1, mobile: width < 760 });
    await page.cdp('Emulation.setTouchEmulationEnabled', { enabled: width < 760, maxTouchPoints: 1 });
    await settle();
    for (const [id, diagram] of cases) {
      await open(id, diagram);
      const fit = await page.evaluate(() => {
        const panel = document.querySelector('#supplement-panel');
        const figure = panel.querySelector('.area-diagram');
        const svg = figure.querySelector(':scope > svg');
        const view = svg.getBoundingClientRect();
        return {
          panel: panel.scrollWidth <= panel.clientWidth + 1,
          figure: figure.scrollWidth <= figure.clientWidth + 1,
          formulas: [...figure.querySelectorAll('mjx-container')].every((e) => e.getBoundingClientRect().width <= figure.clientWidth),
          labels: [...svg.querySelectorAll('text')].every((e) => { const b = e.getBoundingClientRect(); return b.left >= view.left && b.right <= view.right && b.top >= view.top && b.bottom <= view.bottom; }),
          label: svg.getAttribute('aria-label'),
        };
      });
      for (const key of ['panel', 'figure', 'formulas', 'labels']) assert.equal(fit[key], true, `${width} / ${diagram} / ${key}`);
      assert.ok(fit.label, 'A diagram has a text description');
      if (width < 760) {
        await page.focus('.panel-resize');
        await page.press('.panel-resize', 'End');
        await settle();
      }
      if (evidenceDir && width !== 320) {
        await page.evaluate(() => {
          const panel = document.querySelector('#supplement-panel');
          const figure = panel.querySelector('.area-diagram');
          panel.scrollTop += figure.getBoundingClientRect().top - panel.getBoundingClientRect().top - panel.querySelector('.supplement-heading').getBoundingClientRect().height - 12;
        });
        await page.screenshot({ path: `${evidenceDir}/${diagram}-${width}.png` });
      }
      results.push({ width, diagram, ...fit });
    }
    await open(...cases[0]);
    if (await page.evaluate(() => document.querySelector('#method-ch3-q-p88-example4').getAttribute('aria-expanded') === 'false')) await page.click('#method-ch3-q-p88-example4');
    await page.waitForFunction(() => document.querySelector('#method-ch3-q-p88-example4')?.getAttribute('aria-expanded') === 'true');
    await page.click('#related-ch3-q-p88-example4-ch3-triangle-base-height');
    await page.waitForSelector('[data-diagram="triangle-height"]');
    await page.click('#supplement-panel .return-button');
    await page.waitForSelector('[data-diagram="triangle-area"]');
    await page.waitForFunction(() => document.querySelector('#method-ch3-q-p88-example4')?.getAttribute('aria-expanded') === 'true');
    await page.click('#locate-supplement');
    await settle();
    assert.match(await page.evaluate(() => document.querySelector('.page-index').textContent), /88/);
  }
  await page.cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await page.cdp('Emulation.setTouchEmulationEnabled', { enabled: false });
  return { bounds: results, relatedReturn: true, methodRestored: true, locate: true };
}
