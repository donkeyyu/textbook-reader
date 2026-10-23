import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const chapter = JSON.parse(await readFile(new URL('../content/grade-7-volume-1/chapter-1.json', import.meta.url), 'utf8'));
const positioning = JSON.parse(await readFile(new URL('../content/grade-7-volume-1/locations.json', import.meta.url), 'utf8'));
const locations = new Map(positioning.locations.map((location) => [location.id, location]));
export const reviewCases = chapter.supplements.flatMap((note) => note.related.map((link) => ({ note, link })));

async function settled(page) {
  await page.waitForFunction(() => !document.querySelector('.reading-message'), undefined, { timeout: 30_000 });
}

export async function openNote(page, id) {
  const note = chapter.supplements.find((item) => item.id === id);
  assert.ok(note, id);
  await page.fill('#page-input', String(locations.get(note.locationId).page));
  await page.press('#page-input', 'Enter');
  await settled(page);
  const marker = `[data-supplement-ids~="${id}"]`;
  await page.click(marker, { timeout: 30_000 });
  if (await page.evaluate((noteId) => !!document.getElementById(`choice-${noteId}`), id)) await page.click(`#choice-${id}`, { timeout: 30_000 });
  await settled(page);
}

export async function checkAccordion(page, id) {
  await openNote(page, id);
  const ids = await page.evaluate(() => [...document.querySelectorAll('.supplement-accordion summary')].map((summary) => summary.id));
  assert.ok(ids.length > 1, 'Choose a note whose marker is grouped at this width');
  const selected = `choice-${id}`;
  const opened = () => page.evaluate(() => [...document.querySelectorAll('.supplement-accordion[open] summary')].map((summary) => summary.id));
  assert.deepEqual(await opened(), [selected]);
  await page.press(`#${selected}`, 'Enter');
  assert.deepEqual(await opened(), [], 'Enter collapses the current explanation');
  await page.press(`#${selected}`, 'Space');
  assert.deepEqual(await opened(), [selected], 'Space expands the explanation');
  const other = ids.find((item) => item !== selected);
  await page.click(`#${other}`, { timeout: 30_000 });
  assert.deepEqual(await opened(), [other], 'Selecting another title keeps only that explanation open');
  assert.ok(await page.evaluate(() => {
    const panel = document.querySelector('#supplement-panel').getBoundingClientRect();
    const summary = document.querySelector('.supplement-accordion[open] summary').getBoundingClientRect();
    return summary.bottom > panel.top && summary.top < panel.bottom;
  }), 'The selected title stays visible after the preceding explanation collapses');
  console.log(`PASS accordion keyboard and switching: ${id}`);
}

export async function readingSnapshot(page, sourcePage) {
  return page.evaluate((number) => {
    const paper = document.querySelector(`#page-${number}`).getBoundingClientRect();
    const viewport = document.querySelector('.paper-scroller').getBoundingClientRect();
    return {
      fraction: (viewport.top - paper.top) / paper.height,
      panelScroll: document.querySelector('#supplement-panel')?.scrollTop ?? 0,
      title: document.querySelector('#supplement-title')?.textContent,
      expanded: document.querySelector('.supplement-accordion[open] summary')?.id ?? null,
      focus: document.activeElement?.id,
      highlight: document.querySelector('.location-highlight')?.id ?? null,
      back: !!document.querySelector('.return-button'),
    };
  }, sourcePage);
}

export async function checkReviewCase(page, index) {
  const { note, link } = reviewCases[index];
  const sourcePage = locations.get(note.locationId).page;
  const selector = `#related-${note.id}-${link.locationId}`;
  await openNote(page, note.id);
  await page.focus(selector);
  const before = await readingSnapshot(page, sourcePage);
  await page.click(selector);
  await settled(page);
  await page.waitForSelector(`#location-${link.locationId}`);
  assert.ok(await page.evaluate(() => !!document.querySelector('#supplement-panel .return-button')));
  assert.equal(await page.evaluate((id) => [...document.querySelectorAll('.supplement-related button')].some((button) => button.id.endsWith(`-${id}`)), link.locationId), false, 'Active target is not offered again');
  await page.click('#supplement-panel .return-button');
  await settled(page);
  const after = await readingSnapshot(page, sourcePage);
  assert.equal(after.title, before.title);
  assert.equal(after.expanded, before.expanded, 'Return restores the expanded explanation');
  assert.equal(after.back, false, 'One link creates exactly one return entry');
  assert.equal(after.highlight, before.highlight);
  assert.equal(after.focus, selector.slice(1), 'Return restores focus to its source link');
  assert.ok(Math.abs(after.fraction - before.fraction) < .005, `Reading position changed: ${before.fraction} → ${after.fraction}`);
  assert.ok(Math.abs(after.panelScroll - before.panelScroll) < 2, 'Drawer scroll must be restored');
  console.log(`PASS ${index + 1}/${reviewCases.length}: ${note.id} → ${link.locationId} → return`);
}

export async function checkReviewChain(page, targets) {
  await openNote(page, 'ch1-number-line-review');
  const sources = [];
  for (const target of targets) {
    const selector = `.supplement-related button[id$="-${target}"]`;
    await page.focus(selector);
    const locationId = await page.evaluate(() => document.querySelector('.location-highlight')?.id.replace('location-', ''));
    const sourcePage = locations.get(locationId)?.page ?? 28;
    sources.push({ sourcePage, snapshot: await readingSnapshot(page, sourcePage) });
    await page.click(selector);
    await settled(page);
    await page.waitForSelector(`#location-${target}`);
  }
  for (const { sourcePage, snapshot: source } of sources.reverse()) {
    await page.click('.return-button');
    await settled(page);
    const restored = await readingSnapshot(page, sourcePage);
    assert.equal(restored.title, source.title);
    assert.equal(restored.highlight, source.highlight);
    assert.equal(restored.focus, source.focus);
    assert.equal(restored.back, source.back);
    assert.ok(Math.abs(restored.fraction - source.fraction) < .005);
    assert.ok(Math.abs(restored.panelScroll - source.panelScroll) < 2);
  }
  console.log(`PASS chain: ${targets.join(' → ')}; every return restores its source`);
}

export async function checkReviewExit(page, action) {
  await openNote(page, 'ch1-number-line-review');
  await page.click('#related-ch1-number-line-review-ch1-order-on-axis');
  await settled(page);
  if (action === 'close') await page.click('button[aria-label="关闭解读"]');
  else if (action === 'escape') await page.press('#location-ch1-order-on-axis', 'Escape');
  else if (action === 'page-input') {
    await page.fill('#page-input', '30');
    await page.press('#page-input', 'Enter');
  } else if (action === 'thumbnail') {
    if (await page.evaluate(() => document.querySelector('#page-sidebar').hidden)) await page.click('.navigation-toggle');
    await page.click('#thumbnail-30');
  } else await page.click(`button[aria-label="${action === 'next' ? '下一页' : '上一页'}"]`);
  await settled(page);
  const state = await page.evaluate(() => ({
    panel: !!document.querySelector('#supplement-panel'),
    highlight: !!document.querySelector('.location-highlight'),
    back: !!document.querySelector('.return-button'),
    focus: document.activeElement?.id,
  }));
  assert.equal(state.panel, false, `${action} must close the review`);
  assert.equal(state.highlight, false, `${action} must clear the review location`);
  assert.equal(state.back, false);
  if (action === 'close' || action === 'escape') assert.match(state.focus, /^page-/, 'Closing a distant source must focus the current page');
  await openNote(page, 'ch1-deviation');
  assert.equal(await page.evaluate(() => !!document.querySelector('.return-button')), false);
  console.log(`PASS exit: ${action} clears review state; a fresh note has no return`);
}

export async function checkReviewFailures(page) {
  await openNote(page, 'ch1-number-line-review');
  await page.click('#related-ch1-number-line-review-ch1-order-on-axis');
  await settled(page);
  const before = await readingSnapshot(page, 28);
  await page.evaluate(() => {
    const decode = HTMLImageElement.prototype.decode;
    window.restoreReviewDecode = () => { HTMLImageElement.prototype.decode = decode; };
    HTMLImageElement.prototype.decode = function () {
      return this.src.endsWith('/page-20.webp') ? Promise.reject(new Error('test image failure')) : decode.call(this);
    };
  });
  try {
    await page.click('#related-ch1-number-line-review-ch1-absolute-definition');
    await page.waitForSelector('.reading-message[role="alert"]');
    const failed = await readingSnapshot(page, 28);
    assert.equal(failed.highlight, before.highlight);
    assert.equal(failed.title, before.title);
    assert.equal(failed.back, before.back);
    assert.ok(Math.abs(failed.fraction - before.fraction) < .005);
  } finally {
    await page.evaluate(() => { window.restoreReviewDecode(); delete window.restoreReviewDecode; });
  }
  await page.click('.reading-message button');
  await settled(page);
  await page.waitForSelector('#location-ch1-absolute-definition');
  await page.click('.return-button');
  await settled(page);
  assert.equal((await readingSnapshot(page, 28)).highlight, before.highlight);
  await page.click('.return-button');
  await settled(page);
  assert.equal((await readingSnapshot(page, 28)).back, false, 'Failure and retry must not duplicate history');

  await page.evaluate(() => {
    const decode = HTMLImageElement.prototype.decode;
    window.restoreReviewDecode = () => { HTMLImageElement.prototype.decode = decode; };
    HTMLImageElement.prototype.decode = function () {
      return this.src.endsWith('/page-18.webp')
        ? new Promise((resolve) => { window.releaseReviewDecode = resolve; })
        : decode.call(this);
    };
  });
  try {
    await page.click('#related-ch1-number-line-review-ch1-opposite-geometry');
    await page.waitForSelector('.reading-message[role="status"]');
    await page.click('button[aria-label="关闭解读"]');
    await page.evaluate(() => window.releaseReviewDecode());
    await settled(page);
    const canceled = await readingSnapshot(page, 28);
    assert.equal(canceled.title, undefined);
    assert.equal(canceled.highlight, null);
    assert.equal(canceled.back, false, 'Late completion must not restore a closed review');
  } finally {
    await page.evaluate(() => {
      window.restoreReviewDecode();
      delete window.restoreReviewDecode;
      delete window.releaseReviewDecode;
    });
  }
  await openNote(page, 'ch1-measurement-exercise');
  await page.evaluate(() => {
    const button = document.querySelector('#related-ch1-measurement-exercise-ch1-deviation');
    button.click(); button.click();
  });
  await settled(page);
  await page.click('.return-button');
  await settled(page);
  assert.equal((await readingSnapshot(page, 13)).back, false, 'Rapid clicks create only one entry');
  console.log('PASS failures: failure/retry preserves history; cancellation ignores late results; rapid clicks do not duplicate');
}

// Run with an ego-browser Page already open on the local reader.
export async function checkRelatedReturn(page) {
  const note = chapter.supplements.find((item) => item.id === 'ch1-guess-range');
  const related = '#related-ch1-guess-range-ch1-order-on-axis';
  await openNote(page, note.id);
  await page.click(related);
  await page.waitForSelector('#location-ch1-order-on-axis');
  const repeatsTarget = await page.evaluate((selector) => !!document.querySelector(selector), related);
  if (repeatsTarget) {
    await page.click(related);
    await page.waitForFunction(() => !document.querySelector('.reading-message'));
  }
  await page.click('#supplement-panel .return-button');
  await page.waitForFunction(() => !document.querySelector('.reading-message'));
  const restored = await page.evaluate(() => ({
    page: document.querySelector('#page-input').value,
    back: !!document.querySelector('.return-button'),
    title: document.querySelector('#supplement-title').textContent,
  }));
  assert.equal(restored.page, String(locations.get(note.locationId).page), 'One return must reach the source, not the repeated review target');
  assert.equal(restored.back, false, 'A repeated target must not add a duplicate history entry');
  assert.equal(restored.title, note.title);
  assert.equal(repeatsTarget, false, 'The active review target must not remain a navigation link');
  assert.ok(await page.evaluate((selector) => !!document.querySelector(selector), related), 'Returning restores the review link');
  console.log('PASS: review target cannot repeat; one return restores its source and link');
}
