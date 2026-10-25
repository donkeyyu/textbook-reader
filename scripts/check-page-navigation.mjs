import assert from 'node:assert/strict';

// Run at the desired viewport width with an ego-browser Page on the reader.
export async function checkToolbarPageControls(page) {
  const layout = await page.evaluate(() => {
    const toolbar = document.querySelector('.toolbar');
    const controls = toolbar.querySelector('.page-controls');
    const index = controls?.querySelector('.page-index, .page-jump');
    const buttons = controls ? [...controls.querySelectorAll(':scope > button.icon-button')] : [];
    const rect = (element) => {
      const r = element.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, center: (r.left + r.right) / 2, middle: (r.top + r.bottom) / 2 };
    };
    return {
      count: document.querySelectorAll('.page-controls').length,
      sidebarControls: !!document.querySelector('#page-sidebar .page-controls'),
      toolbar: rect(toolbar),
      index: index ? rect(index) : null,
      steps: buttons.map((button) => ({ ...rect(button), visible: button.checkVisibility() })),
      title: rect(document.querySelector('.book-heading h1')),
      narrow: matchMedia('(max-width: 600px)').matches,
      width: innerWidth,
      documentWidth: document.documentElement.scrollWidth,
    };
  });
  assert.equal(layout.count, 1, 'The reader has exactly one page control');
  assert.equal(layout.sidebarControls, false, 'Page controls stay in the toolbar when navigation opens');
  assert.ok(layout.index, 'Page display or editor is present in the toolbar');
  assert.equal(layout.steps.length, 2, 'Previous and next are direct siblings of the page display');
  const [previous, next] = layout.steps;
  assert.ok(previous.visible && next.visible, 'Both page buttons remain visible at this width');
  assert.ok(previous.right <= layout.index.left + 1 && next.left >= layout.index.right - 1, 'Previous, page display, next appear in that order');
  assert.ok(layout.index.left - previous.right <= 20 && next.left - layout.index.right <= 20, 'Page buttons sit next to the page display');
  assert.ok(Math.abs(layout.index.center - layout.toolbar.center) <= 2, 'The page display is centered in the toolbar');
  assert.ok(Math.abs(previous.middle - layout.index.middle) <= 2 && Math.abs(next.middle - layout.index.middle) <= 2, 'Page buttons align on the same row as the page display');
  assert.ok(previous.left >= 0 && next.right <= layout.width && layout.index.bottom <= layout.toolbar.bottom + 1, 'All page controls stay inside the header and viewport');
  assert.equal(layout.documentWidth, layout.width, 'The header causes no horizontal page overflow');
  if (layout.narrow) assert.ok(layout.index.top >= layout.title.bottom, 'Narrow screens place page controls on the second row');
  return layout;
}

export async function checkPageNavigation(page, expanded) {
  const state = () => page.evaluate(() => {
    const selected = document.querySelector('.page-thumbnail[aria-current="page"]');
    const paper = document.getElementById(selected.id.replace('thumbnail-', 'page-')).getBoundingClientRect();
    const viewport = document.querySelector('.paper-scroller').getBoundingClientRect();
    return { current: selected.id, fraction: (viewport.top - paper.top) / paper.height, scroll: document.querySelector('.paper-scroller').scrollTop };
  });
  const stableReadingLayout = () => page.evaluate(() => new Promise((resolve, reject) => {
    let previous = '', stable = 0, frames = 0;
    function measure() {
      const selected = document.querySelector('.page-thumbnail[aria-current="page"]');
      const paper = selected && document.getElementById(selected.id.replace('thumbnail-', 'page-'))?.getBoundingClientRect();
      const scroller = document.querySelector('.paper-scroller');
      const viewport = scroller?.getBoundingClientRect();
      const layout = paper && viewport ? {
        current: selected.id,
        fraction: (viewport.top - paper.top) / paper.height,
        scroll: scroller.scrollTop,
        paper: { top: paper.top, height: paper.height, width: paper.width },
        viewport: { top: viewport.top, height: viewport.height, width: viewport.width },
        sidebarOpen: !document.querySelector('#page-sidebar').hidden,
      } : null;
      const geometry = JSON.stringify(layout);
      stable = layout && geometry === previous ? stable + 1 : 0;
      previous = geometry;
      if (stable >= 4) resolve(layout);
      else if (++frames >= 120) reject(new Error(`Reading layout did not settle before sidebar toggle: ${geometry}`));
      else requestAnimationFrame(measure);
    }
    requestAnimationFrame(measure);
  }));
  async function setSidebar(open) {
    // A viewport override or a just-closed panel may still have a pending resize.
    const before = await stableReadingLayout();
    if (before.sidebarOpen !== open) {
      const centered = await checkToolbarPageControls(page);
      await page.click('.navigation-toggle');
      try {
        await page.waitForFunction(({ current, fraction }) => {
          const selected = document.querySelector('.page-thumbnail[aria-current="page"]');
          const paper = document.getElementById(current.replace('thumbnail-', 'page-')).getBoundingClientRect();
          const viewport = document.querySelector('.paper-scroller').getBoundingClientRect();
          return selected.id === current && Math.abs((viewport.top - paper.top) / paper.height - fraction) < .005;
        }, before);
      } catch (cause) {
        const after = await state();
        throw new Error(`Sidebar ${open ? 'open' : 'close'} changed reading position: before=${JSON.stringify(before)}, after=${JSON.stringify(after)}`, { cause });
      }
      const after = await checkToolbarPageControls(page);
      assert.ok(Math.abs(after.index.center - centered.index.center) <= 1, 'Sidebar toggles do not move the page controls');
    }
  }
  await setSidebar(expanded);
  await checkToolbarPageControls(page);
  const count = await page.evaluate(() => document.querySelectorAll('.page-thumbnail').length);
  async function edit() {
    if (!await page.evaluate(() => !!document.querySelector('#page-input'))) await page.press('.page-index', 'Enter');
    await checkToolbarPageControls(page);
    assert.ok(await page.evaluate(() => {
      const r = document.querySelector('#page-jump').getBoundingClientRect();
      return r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight;
    }), 'The page editor stays inside the viewport');
  }
  async function jump(input, target) {
    await edit();
    await page.fill('#page-input', input);
    await page.press('#page-input', 'Enter');
    await page.waitForFunction((number) => document.querySelector('.page-thumbnail[aria-current="page"]')?.id === `thumbnail-${number}` && !document.querySelector('.reading-message'), target);
    assert.equal(await page.evaluate(() => !!document.querySelector('#page-input')), false);
    await checkToolbarPageControls(page);
  }
  await edit();
  assert.equal(await page.evaluate(() => !!document.querySelector('#page-jump select, #page-jump button')), false);
  const before = await state();
  for (const input of ['', String(count + 1), '0', '1.5']) {
    await page.fill('#page-input', input);
    await page.press('#page-input', 'Enter');
    await page.waitForSelector('#page-input-error', { state: 'visible' });
    assert.deepEqual(await state(), before, `Invalid file page ${JSON.stringify(input)} preserves the reading position`);
  }
  await page.press('#page-input', 'Escape');
  await page.waitForFunction(() => !document.querySelector('#page-input') && document.activeElement?.classList.contains('page-index'));
  for (const target of [1, Math.floor(count / 2), count, 8, 31]) await jump(String(target), target);
  await jump('10', 10);
  // Both step buttons must work even when the sidebar is collapsed on a phone.
  const [previous, next] = ['.page-controls > button.icon-button:first-child', '.page-controls > button.icon-button:last-child'];
  await page.click(next);
  await page.waitForFunction(() => document.querySelector('.page-thumbnail[aria-current="page"]')?.id === 'thumbnail-11' && !document.querySelector('.reading-message'));
  await page.click(previous);
  await page.waitForFunction(() => document.querySelector('.page-thumbnail[aria-current="page"]')?.id === 'thumbnail-10' && !document.querySelector('.reading-message'));
  await setSidebar(!expanded);
  await setSidebar(expanded);
  console.log(`PASS page navigation: ${expanded ? 'expanded' : 'collapsed'}; centered header, adjacent buttons, sidebar position, file order, first/middle/last, errors and keyboard recovery`);
}
