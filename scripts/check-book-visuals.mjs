import assert from 'node:assert/strict';

// Use the local-content preview, book view, and a page owned by this check.
export async function checkBookVisuals(page, cases, { width = 320, evidenceDir } = {}) {
  await page.cdp('Emulation.setDeviceMetricsOverride', { width, height: width < 760 ? 844 : 1000, deviceScaleFactor: 1, mobile: width < 760 });
  await page.cdp('Emulation.setTouchEmulationEnabled', { enabled: width < 760, maxTouchPoints: 1 });
  const results = [];
  for (const item of cases) {
    if (await page.evaluate(() => !!document.querySelector('#supplement-panel'))) await page.click('button[aria-label="关闭解读"]');
    await page.click('.page-index');
    await page.fill('#page-input', String(item.page));
    await page.press('#page-input', 'Enter');
    await page.click(`[data-supplement-ids~="${item.id}"]`);
    if (await page.evaluate((id) => !!document.getElementById(`choice-${id}`), item.id)) await page.click(`#choice-${item.id}`);
    await page.waitForSelector(`[data-diagram="${item.kind}"]`);
    await page.waitForFunction(() => [...document.querySelector('.reading-layout').getAnimations(), ...document.querySelector('#supplement-panel').getAnimations()].every((a) => a.playState !== 'running'));
    const fit = await page.evaluate(() => {
      const panel = document.querySelector('#supplement-panel');
      const figure = panel.querySelector('[data-diagram]');
      const svg = figure.querySelector(':scope > svg');
      const rect = svg?.getBoundingClientRect();
      return {
        panel: panel.scrollWidth <= panel.clientWidth + 1,
        figure: figure.scrollWidth <= figure.clientWidth + 1,
        formulas: [...figure.querySelectorAll('mjx-container')].every((e) => e.getBoundingClientRect().width <= figure.clientWidth),
        mathErrors: figure.querySelectorAll('[data-mml-node="merror"]').length,
        labels: !svg || [...svg.querySelectorAll('text')].every((e) => { const r = e.getBoundingClientRect(); return r.left >= rect.left && r.right <= rect.right && r.top >= rect.top && r.bottom <= rect.bottom; }),
      };
    });
    for (const key of ['panel', 'figure', 'formulas', 'labels']) assert.equal(fit[key], true, `${item.id} at ${width}: ${key}`);
    assert.equal(fit.mathErrors, 0, item.id);
    if (evidenceDir) {
      if (width < 760) { await page.focus('.panel-resize'); await page.press('.panel-resize', 'End'); }
      await page.evaluate(() => {
        const panel = document.querySelector('#supplement-panel');
        const figure = panel.querySelector('[data-diagram]');
        panel.scrollTop += figure.getBoundingClientRect().top - panel.getBoundingClientRect().top - panel.querySelector('.supplement-heading').getBoundingClientRect().height - 12;
      });
      await page.screenshot({ path: `${evidenceDir}/${item.id}-${width}.png` });
    }
    results.push({ id: item.id, page: item.page, width, ...fit });
  }
  return results;
}
