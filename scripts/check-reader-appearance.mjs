import assert from 'node:assert/strict';
import { chooseDirectoryType } from './check-navigation-directories.mjs';
import { checkGraphControls } from './check-graph-controls.mjs';
import { openGraphSearch } from './check-supplement-graph.mjs';

// Owned reader Page, current theme/viewport chosen by caller; book only, no open
// supplement, menus or directories. Ends graph-only with a selected explanation
// and all menus closed. Changes reading position, never account data or theme.
// Canvas pixels/colors need a separate Pixi probe or screenshot review.
export async function checkReaderAppearance(page, { narrow = false, evidenceDir } = {}) {
  const style = await page.evaluate(() => document.documentElement.dataset.uiStyle);
  assert.ok(['island', 'simple', 'warm', 'youth'].includes(style));
  const prefix = `${style}-${narrow ? 'narrow' : 'desktop'}`;
  const capture = async (name) => {
    if (evidenceDir) await page.screenshot({ path: `${evidenceDir}/${prefix}-${name}.png` });
  };
  const settle = () => page.waitForFunction(() =>
    document.querySelector('.reading-layout').getAnimations({ subtree: true })
      .every((animation) => animation.playState !== 'running'));
  const position = () => page.evaluate(() => document.querySelector('.page-index').textContent);
  const paint = async (selector) => {
    await page.mouse.move(0, 0);
    await page.waitForFunction((selector) => document.querySelector(selector).getAnimations()
      .every((animation) => animation.playState !== 'running'), selector);
    return page.evaluate((selector) => {
      const css = getComputedStyle(document.querySelector(selector));
      return [css.color, css.backgroundColor, css.borderColor];
    }, selector);
  };
  const fits = async (selectors) => {
    const failures = await page.evaluate((selectors) => selectors.filter((selector) => {
      const element = document.querySelector(selector);
      if (!element) return true;
      const r = element.getBoundingClientRect();
      return r.width <= 0 || r.height <= 0 || r.left < -1 || r.top < -1 ||
        r.right > innerWidth + 1 || r.bottom > innerHeight + 1;
    }), selectors);
    assert.deepEqual(failures, [], 'Open controls must fit the viewport');
  };
  const selected = async (selector, attribute, before) => {
    assert.equal(await page.evaluate(({ selector, attribute }) =>
      document.querySelector(selector).getAttribute(attribute), { selector, attribute }), 'true');
    if (style !== 'simple') assert.notDeepEqual(await paint(selector), before,
      `${selector} must visibly distinguish its selected state without hover`);
  };
  const textColor = async (selector) => {
    if (style === 'simple') return;
    assert.equal(await page.evaluate((selector) => {
      const element = document.querySelector(selector);
      const sample = document.createElement('span');
      sample.style.color = 'var(--app-text)';
      element.append(sample);
      const expected = getComputedStyle(sample).color;
      sample.remove();
      return getComputedStyle(element).color === expected;
    }, selector), true, `${selector} text must use the active theme`);
  };

  await page.waitForSelector('#textbook-view:not([hidden])');
  assert.equal(await page.evaluate(() => !document.getElementById('supplement-graph') || document.getElementById('supplement-graph').hidden), true);
  const bookBefore = await position();
  const navPaint = await paint('#book-navigation-toggle');
  await page.click('#book-navigation-toggle');
  await selected('#book-navigation-toggle', 'aria-expanded', navPaint);
  await settle();
  assert.equal(await position(), bookBefore, 'Opening navigation retains the page');
  await page.click('.book-navigation-modes button[aria-label="目录"]');
  await page.waitForSelector('.book-contents details');
  if (!await page.evaluate(() => document.querySelector('.book-contents details').open)) {
    await page.click('.book-contents summary >> nth=0');
  }
  await page.click('.book-contents details button >> nth=1');
  await page.waitForFunction(() => document.activeElement?.id.startsWith('page-'));
  await page.waitForSelector('.book-contents button[aria-current="location"]');
  const chapterPage = await position();
  await fits(['#page-sidebar', '.book-navigation-modes']);
  await capture('catalog');
  await page.press('.book-navigation-modes button[aria-label="目录"]', 'Escape');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'book-navigation-toggle');
  await settle();
  assert.equal(await position(), chapterPage, 'Closing navigation retains the chosen page');

  await page.click('.supplement-filters > summary');
  await fits(['.filter-options']);
  await textColor('.filter-options');
  await capture('filters');
  // Do not change persisted hidden types; this pass checks the menu surface.
  await page.click('.supplement-filters > summary');
  await openGraphSearch(page);
  await page.fill('.graph-search input', '题');
  await page.waitForSelector('#graph-search-results button');
  await fits(['#graph-search-panel', '#graph-search-results']);
  await textColor('#graph-search-results button');
  await capture('search');
  await page.press('.graph-search input', 'Escape');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'graph-search-toggle');
  assert.equal(await position(), chapterPage, 'Search and Escape retain the page');

  const graphPaint = await paint('#open-supplement-graph');
  await page.click('#open-supplement-graph');
  await page.waitForSelector('.graph-viewport canvas');
  await selected('#open-supplement-graph', 'aria-expanded', graphPaint);
  await settle();
  const directoryPaint = await paint('#graph-directory-toggle');
  await page.click('#graph-directory-toggle');
  await selected('#graph-directory-toggle', 'aria-expanded', directoryPaint);
  await chooseDirectoryType(page, 'concept');
  assert.equal(await page.evaluate(() => {
    const buttons = [...document.querySelectorAll('.graph-directory-tree button')];
    return buttons.length > 0 && buttons.every((button) => button.dataset.supplementType === 'concept');
  }), true, 'Type menu selection filters the directory');
  if (!await page.evaluate(() => document.querySelector('.graph-directory-chapter').open)) {
    await page.click('.graph-directory-chapter > summary >> nth=0');
  }
  if (!await page.evaluate(() => document.querySelector('.graph-directory-section').open)) {
    await page.click('.graph-directory-section > summary >> nth=0');
  }
  await fits(['#graph-directory', '#graph-directory-type-toggle']);
  await textColor('.graph-directory-tree button');
  await capture('graph-directory');
  const title = await page.evaluate(() =>
    document.querySelector('.graph-directory-tree button > .graph-directory-node-title').childNodes[0].textContent);
  await page.click('.graph-directory-tree button >> nth=0');
  await page.waitForFunction((title) => document.getElementById('supplement-title')?.textContent === title, title);
  assert.equal(await position(), chapterPage, 'Graph selection leaves the hidden book in place');
  assert.equal(await page.evaluate(() => document.querySelector('#graph-directory-type-toggle').dataset.value), 'concept');
  await page.press('#graph-directory-type-toggle', 'Escape');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'graph-directory-toggle');

  if (!narrow) {
    const bookPaint = await paint('#graph-book-toggle');
    await page.click('#graph-book-toggle');
    await selected('#graph-book-toggle', 'aria-pressed', bookPaint);
    await settle();
    await capture('split');
    await page.click('#graph-book-toggle');
    await settle();
  }
  const controls = await checkGraphControls(page, { narrow });
  await capture('graph');
  assert.equal(await page.evaluate(() => document.documentElement.dataset.uiStyle), style);
  return { style, narrow, catalog: true, filterMenu: true, contentSearch: true,
    directoryTypeSelection: true, selectedIcons: style !== 'simple', controls,
    canvasColors: 'Use the existing Pixi probe or inspect screenshots separately' };
}
