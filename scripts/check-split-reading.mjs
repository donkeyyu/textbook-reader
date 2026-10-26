import assert from 'node:assert/strict';
import { jumpToFilePage } from './check-related-return.mjs';

export async function splitReadingState(page) {
  return page.evaluate(() => {
    const layout = document.querySelector('.reading-layout');
    const book = document.querySelector('.paper-scroller');
    const list = document.querySelector('.paper-list');
    const pages = [...list.children];
    const current = Number(document.querySelector('.page-index span')?.textContent.split('/')[0]);
    const paper = pages[current - 1];
    return { split: layout.classList.contains('views-split'),
      bookVisible: book.getAttribute('aria-hidden') !== 'true',
      graphVisible: !!document.querySelector('.supplement-graph:not([hidden])'),
      page: current, fraction: paper ? (book.scrollTop - list.offsetTop - paper.offsetTop) / paper.offsetHeight : null,
      zoom: document.querySelector('.graph-zoom output')?.textContent,
      separator: Number(document.querySelector('.split-resize')?.getAttribute('aria-valuenow')),
      focus: document.activeElement?.id || document.activeElement?.getAttribute('aria-label'),
      title: document.getElementById('supplement-title')?.textContent,
      panelScroll: document.getElementById('supplement-panel')?.scrollTop,
      dirty: !!document.querySelector('[data-dirty="true"]'),
      methodOpen: [...document.querySelectorAll('.method-toggle')].map((button) => button.getAttribute('aria-expanded')) };
  });
}

export async function selectSplitNode(page, query, key) {
  await page.fill('.graph-search input', query);
  await page.waitForFunction((key) => [...document.querySelectorAll('#graph-search-results button')]
    .some((button) => button.dataset.nodeKey === key), key);
  const index = await page.evaluate((key) => [...document.querySelectorAll('#graph-search-results button')]
    .findIndex((button) => button.dataset.nodeKey === key), key);
  await page.click(`#graph-search-results button >> nth=${index}`);
  await page.waitForFunction(() => document.activeElement?.id === 'supplement-title' && !document.getElementById('graph-search-results'));
}

export async function waitForReadingPosition(page, before) {
  await page.waitForFunction(({ page, fraction }) => {
    const book = document.querySelector('.paper-scroller');
    const list = document.querySelector('.paper-list');
    const paper = list.children[page - 1];
    const next = (book.scrollTop - list.offsetTop - paper.offsetTop) / paper.offsetHeight;
    return Math.abs(next - fraction) < .015;
  }, before);
}

// Optional QA-only Pixi probe from check-supplement-graph.mjs, never app state.
export async function splitGraphCamera(page) {
  return page.evaluate(() => {
    const app = window.qa03GraphProbe?.app;
    const world = app?.stage.children[0];
    if (!world) return null;
    return { x: (app.screen.width / 2 - world.x) / world.scale.x,
      y: (app.screen.height / 2 - world.y) / world.scale.y, scale: world.scale.x,
      hiddenDraws: window.qa03GraphProbe.hidden };
  });
}

export function assertSameCamera(before, after) {
  assert.ok(before && after, 'Install the QA graph probe before checking camera preservation');
  assert.ok(Math.abs(after.x - before.x) < 1 && Math.abs(after.y - before.y) < 1);
  assert.equal(after.scale, before.scale);
  assert.equal(after.hiddenDraws, before.hiddenDraws, 'A hidden graph must not draw');
}

export async function checkSplitKeyboardResize(page) {
  const before = await splitReadingState(page);
  assert.ok(before.split);
  await page.focus('.split-resize');
  await page.press('.split-resize', before.separator < 70 ? 'ArrowRight' : 'ArrowLeft');
  await page.waitForFunction((share) => Number(document.querySelector('.split-resize').getAttribute('aria-valuenow')) !== share, before.separator);
  await waitForReadingPosition(page, before);
  const after = await splitReadingState(page);
  assert.notEqual(after.separator, before.separator);
  assert.equal(after.page, before.page);
  assert.ok(Math.abs(after.fraction - before.fraction) < .015, 'Width changes retain the page-relative position');
  assert.equal(after.zoom, before.zoom);
  return { before, after };
}

export async function checkReadingViewRecovery(page) {
  const before = await splitReadingState(page);
  await page.click('[aria-label="关闭教材视图"]');
  await page.click('[aria-label="关闭节点图视图"]');
  await page.waitForFunction(() => document.activeElement?.id === 'show-graph-view');
  const closed = await splitReadingState(page);
  assert.equal(closed.bookVisible, false);
  assert.equal(closed.graphVisible, false);
  await page.click('#show-book-view');
  await page.click('#show-graph-view');
  await waitForReadingPosition(page, before);
  await page.waitForFunction((scroll) => !document.getElementById('supplement-panel') || Math.abs(document.getElementById('supplement-panel').scrollTop - scroll) < 1, before.panelScroll ?? 0);
  const after = await splitReadingState(page);
  assert.equal(after.page, before.page);
  assert.ok(Math.abs(after.fraction - before.fraction) < .015);
  assert.equal(after.zoom, before.zoom);
  assert.equal(after.title, before.title);
  assert.equal(after.panelScroll, before.panelScroll);
  assert.deepEqual(after.methodOpen, before.methodOpen);
  return { before, closed, after };
}

export async function checkSplitOriginalRetry(page, { testOrigin }) {
  assert.equal(new URL(await page.url()).origin, testOrigin);
  assert.equal((await splitReadingState(page)).dirty, false);
  const chain = await page.evaluate(async () => {
    const { readPublishedContent } = await import('/src/textbook/content-store.ts');
    const { getLocation } = await import('/src/textbook/supplements.ts');
    const { supplements } = await readPublishedContent();
    const at = new Map(supplements.map((node) => [node.locationId, node]));
    const incoming = new Map();
    for (const source of supplements) for (const related of source.related) {
      const target = at.get(related.locationId);
      if (target && target.id !== source.id) incoming.set(target.id, source);
    }
    const middle = supplements.find((node) => incoming.has(node.id) && node.related.some((related) => !at.has(related.locationId)));
    if (!middle) throw new Error('No current two-level original-only fixture');
    const source = incoming.get(middle.id);
    const original = middle.related.find((related) => !at.has(related.locationId));
    return { source: { id: source.id, title: source.title, page: getLocation(source.locationId).page },
      middle: { id: middle.id, title: middle.title, locationId: middle.locationId },
      original: { id: original.locationId, page: getLocation(original.locationId).page } };
  });
  console.log('QA07 original fixture', chain);
  await page.click('.graph-toolbar > button');
  await jumpToFilePage(page, chain.source.page);
  await page.click(`[data-supplement-ids~="${chain.source.id}"]`);
  if (await page.evaluate((id) => !!document.getElementById(`choice-${id}`), chain.source.id)) await page.click(`#choice-${chain.source.id}`);
  await page.click(`#related-${chain.source.id}-${chain.middle.locationId}`);
  await page.waitForFunction((title) => document.getElementById('supplement-title')?.textContent === title, chain.middle.title);
  console.log('QA07 source-to-middle ready');
  await page.click('#open-supplement-graph');
  await page.waitForFunction(() => document.activeElement === document.querySelector('.graph-search input'));
  const relation = `#related-${chain.middle.id}-${chain.original.id}`;
  const camera = await splitGraphCamera(page);
  await page.focus(relation);
  await page.press(relation, 'Enter');
  await page.waitForFunction(() => document.querySelector('.views-split') && !document.querySelector('.reading-message'));
  const first = await splitReadingState(page);
  console.log('QA07 original split ready');
  assert.equal(first.title, chain.middle.title);
  assertSameCamera(camera, await splitGraphCamera(page));
  const point = await page.evaluate(() => { const r = document.querySelector('.paper-scroller').getBoundingClientRect(); return { x: r.x + 80, y: r.y + 80 }; });
  await page.mouse.move(point.x, point.y);
  await page.mouse.wheel(0, 400, { label: '滚离原文后重复定位' });
  await page.waitForFunction((fraction) => {
    const s = document.querySelector('.paper-scroller'), l = document.querySelector('.paper-list');
    const p = l.children[Number(document.querySelector('.page-index span').textContent.split('/')[0]) - 1];
    return Math.abs((s.scrollTop - l.offsetTop - p.offsetTop) / p.offsetHeight - fraction) > .1;
  }, first.fraction);
  assertSameCamera(camera, await splitGraphCamera(page));
  await page.click('[aria-label="关闭教材视图"]');
  const source = await splitReadingState(page);
  await page.evaluate((number) => {
    window.qa07Decode = HTMLImageElement.prototype.decode;
    HTMLImageElement.prototype.decode = function () {
      return this.src.includes(`/page-${number}.webp`) ? Promise.reject(new Error('QA07 original decode failure')) : window.qa07Decode.call(this);
    };
  }, chain.original.page);
  try {
    await page.focus(relation);
    await page.press(relation, 'Enter');
    await page.waitForSelector('.reading-message[role="alert"]');
    const failed = await splitReadingState(page);
    assert.equal(failed.bookVisible, false);
    assert.equal(failed.graphVisible, true);
    assert.equal(failed.title, source.title);
    assertSameCamera(camera, await splitGraphCamera(page));
  } finally {
    await page.evaluate(() => { HTMLImageElement.prototype.decode = window.qa07Decode; delete window.qa07Decode; });
  }
  await page.click('.reading-message button');
  await page.waitForFunction(() => document.querySelector('.views-split') && !document.querySelector('.reading-message'));
  await waitForReadingPosition(page, first);
  console.log('QA07 original retry ready');
  await page.focus(relation);
  await page.press(relation, 'Enter');
  await page.waitForFunction((id) => document.activeElement?.id === `location-${id}` && !document.querySelector('.reading-message'), chain.original.id);
  await page.focus('.return-button');
  await page.press('.return-button', 'Enter');
  await page.waitForFunction((title) => document.getElementById('supplement-title')?.textContent === title && !!document.querySelector('.return-button'), chain.middle.title);
  assert.equal(await page.evaluate(() => document.activeElement.id), `related-${chain.middle.id}-${chain.original.id}`);
  await page.focus('.return-button');
  await page.press('.return-button', 'Enter');
  await page.waitForFunction((title) => document.getElementById('supplement-title')?.textContent === title && !document.querySelector('.return-button'), chain.source.title);
  return { chain, originalOnlyOpensSplit: true, repeatRepositions: true, failureKeepsSourceAndGraph: true,
    retryRetainsCamera: true, repeatedLocateAddsNoHistory: true, twoReturnLevelsAndFocus: true };
}

// Start with both reading views open at desktop width; no account is required.
export async function checkSplitResponsiveFocus(page) {
  const state = () => page.evaluate(() => {
    const element = document.activeElement, rect = element.getBoundingClientRect(), css = getComputedStyle(element);
    return { tag: element.tagName, id: element.id, class: element.className, label: element.getAttribute('aria-label'),
      valid: element !== document.body && element !== document.documentElement && !element.closest('[hidden],[inert]') &&
        css.display !== 'none' && css.visibility !== 'hidden' && rect.width > 0 && rect.height > 0,
      bookInert: document.getElementById('textbook-view').inert,
      graphHidden: document.getElementById('supplement-graph').hidden,
      splitterDisplay: getComputedStyle(document.querySelector('.split-resize')).display };
  });
  const settle = () => page.evaluate(() => new Promise((resolve) => {
    let frames = 0, finished = false;
    const finish = (timedOut) => { if (!finished) { finished = true; clearTimeout(timer); resolve({ frames, timedOut }); } };
    const frame = () => { if (++frames >= 3) finish(false); else if (!finished) requestAnimationFrame(frame); };
    const timer = setTimeout(() => finish(true), 6000);
    requestAnimationFrame(frame);
  }));
  const cases = [];
  for (const [name, active, selector, expected] of [
    ['graph search', 'book', '.graph-search input', 'show-book-view'],
    ['graph canvas', 'book', '.graph-viewport', 'show-book-view'],
    ['splitter', 'book', '.split-resize', 'show-book-view'],
    ['book scroller', 'graph', '#textbook-view', 'show-graph-view'],
    ['visible toolbar', 'book', '.page-index', null],
  ]) {
    await page.cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 950, deviceScaleFactor: 1, mobile: false });
    await page.waitForFunction(() => !!document.querySelector('.views-split'));
    await page.click(`#show-${active}-view`);
    await settle();
    await page.focus(selector);
    const before = await state();
    assert.ok(before.valid, `${name}: the wide-screen source must be focusable`);
    await page.cdp('Emulation.setDeviceMetricsOverride', { width: 980, height: 950, deviceScaleFactor: 1, mobile: false });
    await page.waitForFunction((active) => !document.querySelector('.views-split') &&
      document.getElementById('supplement-graph').hidden === (active === 'book') &&
      document.getElementById('textbook-view').inert === (active === 'graph') &&
      getComputedStyle(document.querySelector('.split-resize')).display === 'none', active);
    const settled = await settle(), afterResize = await state();
    await page.keyboard.press('Tab');
    const afterTab = await state();
    const correctTarget = expected ? afterResize.id === expected : afterResize.class === 'page-index';
    cases.push({ name, active, selector, expected, before, settled, afterResize, afterTab,
      passed: settled.frames >= 3 && !settled.timedOut && afterResize.valid && correctTarget && afterTab.valid });
  }
  return { cases, passed: cases.every((item) => item.passed), viewport: { wide: [1280, 950], narrow: [980, 950], dpr: 1 } };
}
