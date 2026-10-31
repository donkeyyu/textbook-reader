import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { openGraphSearch, openGraphSettings } from './check-supplement-graph.mjs';

const chapter = JSON.parse(await readFile(new URL('../content/grade-7-volume-1/chapter-1.json', import.meta.url), 'utf8'));
const referenceTitle = chapter.supplements.find((note) => note.id === 'ch1-zero-reference').title;

// Run on an owned reader page with the graph open and controls collapsed.
export async function checkGraphControls(page, { narrow = false } = {}) {
  await page.waitForFunction(() => !document.querySelector('.reading-layout').getAnimations().some((a) => a.playState === 'running'));
  const bounds = () => page.evaluate(() => {
    const graph = document.getElementById('supplement-graph').getBoundingClientRect();
    const canvas = document.querySelector('.graph-viewport canvas').getBoundingClientRect();
    const targets = ['.graph-settings', '#graph-book-toggle'];
    return { canvasFills: Math.abs(canvas.height - graph.height) < 2 && Math.abs(canvas.width - graph.width) < 2,
      graphInViewport: graph.bottom <= innerHeight + 1 && graph.right <= innerWidth + 1,
      overflow: targets.filter((selector) => {
        const rect = document.querySelector(selector)?.getBoundingClientRect();
        return rect && (rect.top < graph.top - 1 || rect.left < graph.left - 1 || rect.bottom > graph.bottom + 1 || rect.right > graph.right + 1);
      }) };
  });
  const initial = await bounds();
  assert.equal(initial.canvasFills, true); assert.equal(initial.graphInViewport, true); assert.deepEqual(initial.overflow, []);
  assert.equal(await page.evaluate(() => !!document.querySelector('.reading-view-controls')), false);
  assert.equal(await page.evaluate(() => !!document.getElementById('open-personal-library')), false);
  assert.equal(await page.evaluate(() => document.querySelector('#open-supplement-graph').getAttribute('aria-label')), '节点图');
  assert.equal(await page.evaluate(() => document.querySelector('#add-personal-supplement').getAttribute('aria-label')), '添加补充');
  const settingsIcon = () => page.evaluate(() => {
    const { x, y } = document.querySelector('.graph-settings summary svg').getBoundingClientRect();
    return { x, y };
  });
  const closedIcon = await settingsIcon();
  await openGraphSettings(page);
  const openIcon = await settingsIcon();
  assert.ok(Math.abs(openIcon.x - closedIcon.x) < 1 && Math.abs(openIcon.y - closedIcon.y) < 1,
    'Settings icon stays at the same position when expanded');
  assert.deepEqual((await bounds()).overflow, []);
  const beforeZoom = await page.evaluate(() => document.querySelector('.graph-zoom output').textContent);
  await page.click('[aria-label="缩小节点图"]');
  assert.notEqual(await page.evaluate(() => document.querySelector('.graph-zoom output').textContent), beforeZoom);
  await openGraphSearch(page);
  assert.equal(await page.evaluate(() => document.activeElement === document.querySelector('.graph-search input')), true);
  await page.fill('.graph-search input', '练习');
  await page.waitForSelector('#graph-search-results button');
  assert.deepEqual((await bounds()).overflow, []);
  await page.press('.graph-search input', 'Escape');
  assert.equal(await page.evaluate(() => document.getElementById('graph-search-toggle').getAttribute('aria-expanded')), 'false');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'graph-search-toggle');
  await page.focus('.graph-viewport'); await page.press('.graph-viewport', '/');
  await page.waitForFunction(() => document.activeElement === document.querySelector('.graph-search input'));
  await page.fill('.graph-search input', referenceTitle);
  await page.waitForSelector('#graph-search-results button');
  await page.press('.graph-search input', 'ArrowDown'); await page.keyboard.press('Enter');
  await page.waitForFunction((title) => document.getElementById('supplement-title')?.textContent === title, referenceTitle);
  assert.equal(await page.evaluate(() => document.getElementById('graph-search-toggle').getAttribute('aria-expanded')), 'false');
  await page.waitForFunction(() => !document.querySelector('.reading-layout').getAnimations().some((a) => a.playState === 'running'));
  await openGraphSettings(page); assert.deepEqual((await bounds()).overflow, []);
  await page.press('.graph-settings > summary', 'Escape');
  assert.equal(await page.evaluate(() => document.querySelector('.graph-settings').open), false);
  await page.click('#graph-book-toggle');
  await page.waitForFunction((narrow) => narrow ? document.getElementById('supplement-graph').hidden : document.querySelector('.reading-layout').classList.contains('views-split'), narrow);
  const ownerBounds = () => page.evaluate(() => {
    const graph = document.getElementById('supplement-graph').getBoundingClientRect();
    const book = document.getElementById('textbook-view').getBoundingClientRect();
    const panel = document.getElementById('supplement-panel').getBoundingClientRect();
    const layout = document.querySelector('.reading-layout').getBoundingClientRect();
    return { graph: graph.toJSON(), book: book.toJSON(), panel: panel.toJSON(), layout: layout.toJSON(),
      bookVisible: getComputedStyle(document.getElementById('textbook-view')).visibility === 'visible',
      pressed: document.getElementById('graph-book-toggle').getAttribute('aria-pressed') };
  });
  const split = await ownerBounds();
  assert.equal(split.bookVisible, true);
  if (narrow) assert.equal(await page.evaluate(() => document.getElementById('page-sidebar').hidden), true, 'Showing the book must not open its navigation');
  if (!narrow) {
    assert.equal(split.pressed, 'true');
    assert.ok(split.book.left >= split.graph.right);
    assert.ok(split.panel.left >= split.graph.right, 'Explanation belongs entirely to the book pane');
    if (split.layout.right - split.book.left <= 1100) {
      assert.ok(split.panel.top >= split.book.bottom - 1, 'Narrow book pane stacks its explanation below');
      assert.ok(Math.abs(split.graph.height - split.layout.height) < 2, 'Explanation does not shorten the graph');
    } else {
      assert.ok(split.panel.left >= split.book.right - 1, 'Wide book pane places explanation beside the book');
    }
    await page.click('#graph-book-toggle');
    await page.waitForFunction(() => document.getElementById('graph-book-toggle').getAttribute('aria-pressed') === 'false');
  } else {
    await page.click('#open-supplement-graph');
  }
  await page.waitForFunction(() => !document.querySelector('.reading-layout').getAnimations().some((a) => a.playState === 'running'));
  const graphOnly = await ownerBounds();
  assert.equal(graphOnly.bookVisible, false);
  if (graphOnly.layout.width > 1100) assert.ok(graphOnly.panel.left >= graphOnly.graph.right - 1);
  else assert.ok(graphOnly.panel.top >= graphOnly.graph.bottom - 1);
  assert.ok(graphOnly.panel.bottom <= graphOnly.layout.bottom + 1);
  return { initial, split, graphOnly, settingsAndSearchWithinGraph: true, keyboardSearch: true,
    iconToolbar: true, bookToggleAndPanelOwnership: true };
}

// Owned reader Page, page editor and navigation closed; settings start/end closed.
// Checks either visible pane locally; desktop split also compares their top rows.
export async function checkPaneControlAlignment(page) {
  await page.waitForFunction(() => document.querySelector('.reading-layout').getAnimations({ subtree: true })
    .every((animation) => animation.playState !== 'running'));
  const panes = await page.evaluate(() => {
    const visible = (selector) => document.querySelector(selector)?.checkVisibility();
    const measure = (owner, selectors) => {
      const pane = document.querySelector(owner).getBoundingClientRect();
      const controls = selectors.map((selector) => {
        const element = document.querySelector(selector), rect = element.getBoundingClientRect();
        const icon = element.querySelector('svg')?.getBoundingClientRect();
        return { selector, visible: element.checkVisibility(), left: rect.left - pane.left,
          right: pane.right - rect.right, width: rect.width, height: rect.height,
          centerY: rect.top + rect.height / 2 - pane.top,
          icon: icon ? { width: icon.width, height: icon.height, x: icon.x, y: icon.y,
            centerY: icon.top + icon.height / 2 - pane.top } : null };
      });
      const layoutStyle = getComputedStyle(document.querySelector('.reading-layout'));
      return { width: pane.width, height: pane.height, controls, controlSize: parseFloat(layoutStyle.getPropertyValue('--view-control-size')), toolbarHeight: parseFloat(layoutStyle.getPropertyValue('--view-toolbar-height')), island: document.documentElement.dataset.uiStyle === 'island' };
    };
    return {
      graph: visible('#supplement-graph') ? measure('#supplement-graph',
        ['#graph-directory-toggle', '.graph-settings', '#graph-book-toggle']) : null,
      book: visible('.book-toolbar') ? measure('.book-toolbar', ['#book-navigation-toggle',
        '.page-controls > button.icon-button:first-child', '.page-index', '.page-controls > button.icon-button:last-child']) : null,
    };
  });
  assert.ok(panes.graph || panes.book, 'At least one reading pane is visible');
  const centers = [];
  for (const [name, pane] of Object.entries(panes)) {
    if (!pane) continue;
    for (const control of pane.controls) {
      assert.equal(control.visible, true);
      assert.ok(Math.abs(control.height - pane.controlSize) <= 1, `${control.selector} keeps the themed control height`);
      assert.ok(control.left >= 0 && control.right >= 0, `${control.selector} fits its pane`);
      assert.ok(Math.abs(control.centerY - pane.toolbarHeight / 2) <= 1, `${control.selector} sits centered in its top row`);
      centers.push(control.centerY);
      if (control.selector !== '.page-index') assert.ok(control.icon, `${control.selector} retains its icon`);
      if (control.icon) {
        assert.ok(Math.abs(control.icon.width - (name === 'graph' && pane.island ? 20 : 16)) <= 1 && Math.abs(control.icon.height - (name === 'graph' && pane.island ? 20 : 16)) <= 1,
          `${control.selector} uses its intended icon size`);
        assert.ok(Math.abs(control.icon.centerY - control.centerY) <= 1, 'Icon aligns with its control');
      }
    }
    const ordered = [...pane.controls].sort((a, b) => a.left - b.left);
    for (let index = 1; index < ordered.length; index++) {
      assert.ok(ordered[index - 1].left + ordered[index - 1].width <= ordered[index].left + 1,
        `${name} top controls must not overlap`);
    }
    assert.ok(Math.abs(pane.controls[0].left - 12) <= 1, `${name} navigation uses the shared left inset`);
  }
  assert.ok(Math.max(...centers) - Math.min(...centers) <= 1, 'Visible pane controls share their relative vertical center');
  if (panes.book) {
    assert.ok(Math.abs(panes.book.height - panes.book.toolbarHeight) <= 1);
    const pager = panes.book.controls[2];
    assert.ok(Math.abs(pager.left - pager.right) <= 2, 'Page display remains centered in the book pane');
  }
  if (panes.graph) {
    assert.ok(Math.abs(panes.graph.controls.at(-1).right - 12) <= 1, 'Graph right controls use the shared inset');
    const icon = panes.graph.controls[1].icon;
    try {
      await openGraphSettings(page);
      const expanded = await page.evaluate(() => {
        const rect = document.querySelector('.graph-settings summary svg').getBoundingClientRect();
        return { x: rect.x, y: rect.y };
      });
      assert.ok(Math.abs(expanded.x - icon.x) <= 1 && Math.abs(expanded.y - icon.y) <= 1,
        'Opening settings leaves its icon in place');
    } finally {
      if (await page.evaluate(() => document.querySelector('.graph-settings').open)) {
        await page.press('.graph-settings > summary', 'Escape');
      }
    }
    const closed = await page.evaluate(() => {
      const rect = document.querySelector('.graph-settings summary svg').getBoundingClientRect();
      return { x: rect.x, y: rect.y };
    });
    assert.ok(Math.abs(closed.x - icon.x) <= 1 && Math.abs(closed.y - icon.y) <= 1,
      'Closing settings leaves its icon in place');
  }
  return panes;
}
