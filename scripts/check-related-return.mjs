import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const chapter = JSON.parse(await readFile(new URL('../content/grade-7-volume-1/chapter-1.json', import.meta.url), 'utf8'));
const positioning = JSON.parse(await readFile(new URL('../content/grade-7-volume-1/locations.json', import.meta.url), 'utf8'));
const locations = new Map(positioning.locations.map((location) => [location.id, location]));
export const reviewCases = chapter.supplements.flatMap((note) => note.related.map((link) => ({ note, link })));

async function settled(page) {
  await page.waitForFunction(() => !document.querySelector('.reading-message'), undefined, { timeout: 30_000 });
}

export async function jumpToFilePage(page, number) {
  if (!await page.evaluate(() => !!document.querySelector('#page-input'))) await page.click('.page-index');
  await page.fill('#page-input', String(number));
  await page.press('#page-input', 'Enter');
  await settled(page);
}

export async function checkPreviewEntry(page, number, id) {
  await jumpToFilePage(page, number);
  await page.hover('.page-index');
  const marker = `[data-supplement-ids~="${id}"]`;
  await page.click(marker, { timeout: 5_000 });
  await settled(page);
  await page.waitForSelector('#supplement-panel');
  assert.equal(await page.evaluate((selector) => document.querySelector(selector).getAttribute('aria-expanded'), marker), 'true');
  console.log(`PASS preview leaves marker openable: ${id}`);
}

export async function openNote(page, id) {
  const note = chapter.supplements.find((item) => item.id === id);
  assert.ok(note, id);
  await jumpToFilePage(page, locations.get(note.locationId).page);
  await clickNoteMarker(page, id);
}

async function clickNoteMarker(page, id) {
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
  const method = `#method-${id}`;
  const hasMethod = await page.evaluate((selector) => !!document.querySelector(selector), method);
  if (hasMethod) await page.click(method);
  await page.press(`#${selected}`, 'Enter');
  assert.deepEqual(await opened(), [], 'Enter collapses the current explanation');
  await page.press(`#${selected}`, 'Space');
  assert.deepEqual(await opened(), [selected], 'Space expands the explanation');
  if (hasMethod) assert.equal(await page.evaluate((selector) => document.querySelector(selector).getAttribute('aria-expanded'), method), 'false', 'Directly reopening a grouped guide starts its method collapsed');
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
      methods: [...document.querySelectorAll('.method-toggle[aria-expanded="true"]')].map((button) => button.id),
    };
  }, sourcePage);
}

export async function checkReviewCase(page, index) {
  const { note, link } = reviewCases[index];
  const sourcePage = locations.get(note.locationId).page;
  const selector = `#related-${note.id}-${link.locationId}`;
  await openNote(page, note.id);
  if (note.questionGuide && !note.questionGuide.continuous && index % 2 === 0) await page.click(`#method-${note.id}`);
  await page.focus(selector);
  const before = await readingSnapshot(page, sourcePage);
  await page.evaluate((selector) => {
    document.querySelector(selector).addEventListener('click', () => {
      window.relatedReturnClickScroll = document.querySelector('#supplement-panel').scrollTop;
    }, { once: true, capture: true });
  }, selector);
  await page.click(selector);
  before.panelScroll = await page.evaluate(() => {
    const scroll = window.relatedReturnClickScroll;
    delete window.relatedReturnClickScroll;
    return scroll;
  });
  assert.equal(typeof before.panelScroll, 'number', 'Capture the source after browser input scrolling');
  await settled(page);
  await page.waitForSelector(`#location-${link.locationId}`);
  assert.ok(await page.evaluate((id) => {
    const region = document.getElementById(`location-${id}`).getBoundingClientRect();
    const viewport = document.querySelector('.paper-scroller').getBoundingClientRect();
    return region.bottom > viewport.top && region.top < viewport.bottom && region.left >= viewport.left && region.right <= viewport.right;
  }, link.locationId), 'The linked textbook region is visible in the reading area');
  assert.ok(await page.evaluate(() => !!document.querySelector('#supplement-panel .return-button')));
  assert.equal(await page.evaluate((id) => [...document.querySelectorAll('.supplement-related button')].some((button) => button.id.endsWith(`-${id}`)), link.locationId), false, 'Active target is not offered again');
  await page.click('#supplement-panel .return-button');
  await settled(page);
  const after = await readingSnapshot(page, sourcePage);
  assert.equal(after.title, before.title);
  assert.equal(after.expanded, before.expanded, 'Return restores the expanded explanation');
  assert.deepEqual(after.methods, before.methods, 'Return restores the source method state');
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
    assert.deepEqual(restored.methods, source.methods);
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
    await jumpToFilePage(page, 30);
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
    await page.click('#related-ch1-number-line-review-ch1-source-absolute-definition');
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
  await page.waitForSelector('#location-ch1-source-absolute-definition');
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
    await page.press('#related-ch1-number-line-review-ch1-opposite-geometry', 'Enter');
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
    const button = document.querySelector('#related-ch1-measurement-exercise-ch1-source-standard-comparison');
    button.click(); button.click();
  });
  await settled(page);
  await page.click('.return-button');
  await settled(page);
  assert.equal((await readingSnapshot(page, locations.get('ch1-measurement-exercise').page)).back, false, 'Rapid clicks create only one entry');
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
    page: document.querySelector('.page-index span').textContent.match(/(\d+)\//)[1],
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


export async function checkOnDemandMethod(page, id) {
  const note = chapter.supplements.find((item) => item.id === id);
  assert.ok(note?.questionGuide, 'Choose an existing question guide');
  await openNote(page, id);
  const button = `#method-${id}`;
  const content = `#method-content-${id}`;
  const sourcePage = locations.get(note.locationId).page;
  const state = () => page.evaluate(({ button, content }) => ({
    expanded: document.querySelector(button)?.getAttribute('aria-expanded'),
    visible: document.querySelector(content)?.checkVisibility(),
    method: [...document.querySelectorAll(`${content} p`)].map((item) => item.textContent),
    knowledge: [...document.querySelectorAll('.question-guide section[aria-label="考查知识点"] p')].map((item) => item.textContent),
    cautions: [...document.querySelectorAll('.question-guide section[aria-label="注意事项"] p')].map((item) => item.textContent),
    related: !!document.querySelector('.supplement-related'),
  }), { button, content });
  const initial = await state();
  assert.equal(initial.expanded, 'false');
  assert.equal(initial.visible, false);
  assert.deepEqual(initial.method, note.questionGuide.method, 'Original method content is retained');
  assert.deepEqual(initial.knowledge, note.questionGuide.knowledgePoints);
  assert.deepEqual(initial.cautions, note.questionGuide.cautions);
  assert.ok(initial.related);
  const before = await readingSnapshot(page, sourcePage);
  await page.click(button);
  assert.equal((await state()).visible, true);
  await page.press(button, 'Enter');
  assert.equal((await state()).visible, false);
  await page.press(button, 'Space');
  assert.equal((await state()).visible, true);
  assert.equal((await state()).expanded, 'true');
  const after = await readingSnapshot(page, sourcePage);
  assert.ok(Math.abs(after.fraction - before.fraction) < .005, 'Method toggles keep the textbook region');
  await clickNoteMarker(page, id);
  assert.equal((await state()).visible, false, 'Opening the marker again starts collapsed');
  await page.click(button);
  await page.click('button[aria-label="关闭解读"]');
  await openNote(page, id);
  assert.equal((await state()).visible, false, 'Closing clears method state');
  await page.click(button);
  await page.reload();
  await page.waitForSelector('.page-index');
  assert.equal(await page.evaluate(() => !!document.querySelector('#supplement-panel')), false, 'Refresh does not restore a panel');
  await openNote(page, id);
  assert.equal((await state()).visible, false, 'Re-entering after refresh starts collapsed');
  console.log(`PASS on-demand method: ${id}; default, click, keyboard, reopen, close, refresh`);
}

export async function checkMethodReturnChain(page) {
  const id = 'ch1-exercise-1-1-8';
  await openNote(page, id);
  await page.click(`#method-${id}`);
  const sources = [];
  const first = chapter.supplements.find((item) => item.id === id);
  const second = chapter.supplements.find((item) => item.id === 'ch1-direction-exercise');
  for (const [note, target] of [[first, second.locationId], [second, second.related[0].locationId]]) {
    const selector = `#related-${note.id}-${target}`;
    const sourcePage = locations.get(note.locationId).page;
    await page.focus(selector);
    sources.push({ sourcePage, snapshot: await readingSnapshot(page, sourcePage) });
    await page.click(selector);
    await settled(page);
    const toggle = await page.evaluate(() => document.querySelector('.method-toggle')?.id);
    if (toggle) await page.click(`#${toggle}`);
  }
  for (const source of sources.reverse()) {
    await page.click('.return-button');
    await settled(page);
    const after = await readingSnapshot(page, source.sourcePage);
    assert.deepEqual(after.methods, source.snapshot.methods);
    assert.equal(after.expanded, source.snapshot.expanded);
    assert.equal(after.highlight, source.snapshot.highlight);
    assert.equal(after.focus, source.snapshot.focus);
    assert.ok(Math.abs(after.fraction - source.snapshot.fraction) < .005);
    assert.ok(Math.abs(after.panelScroll - source.snapshot.panelScroll) < 2, `Panel scroll ${source.snapshot.panelScroll} → ${after.panelScroll}; source page ${source.sourcePage}; ${JSON.stringify({before:source.snapshot,after})}`);
  }
  console.log('PASS method multi-level return: each source restores its method, explanation, region and focus');
}

// Run on a dedicated test origin with a saved personal supplement named QA title.
export async function checkTitleDraft(page) {
  await jumpToFilePage(page, 13);
  await page.click('[aria-label="我的补充：QA title"]');
  await page.click('.personal-actions button:first-child');
  await page.fill('.personal-title input', 'Changed title');
  const before = await page.evaluate(() => {
    window.draftConfirm = window.confirm;
    window.draftPrompts = 0;
    window.confirm = () => { window.draftPrompts++; return false; };
    return !window.dispatchEvent(new Event('beforeunload', { cancelable: true }));
  });
  try {
    assert.equal(before, true, 'Title-only edits must protect refresh and closing the tab');
    await page.click('.editor-actions button:nth-child(2)');
    assert.deepEqual(await page.evaluate(() => ({
      title: document.querySelector('.personal-title input')?.value,
      prompts: window.draftPrompts,
    })), { title: 'Changed title', prompts: 1 }, 'Cancel must offer to keep a title-only draft');
  } finally {
    await page.evaluate(() => { window.confirm = window.draftConfirm; delete window.draftConfirm; delete window.draftPrompts; });
  }
  await page.fill('.personal-title input', 'QA title');
  await page.click('.editor-actions button:nth-child(2)');
  console.log('PASS title-only draft: beforeunload and canceled discard retain the title');
}

export async function checkReaderJourney(page) {
  const id = 'ch1-measurement-exercise';
  const readingKey = `textbook-reading-v1:${positioning.documentSha256}`;
  const note = chapter.supplements.find((item) => item.id === id);
  const sourcePage = locations.get(note.locationId).page;
  await jumpToFilePage(page, sourcePage);
  await clickNoteMarker(page, id);
  assert.equal(await page.evaluate((id) => document.getElementById(`method-${id}`).getAttribute('aria-expanded'), id), 'false');
  await page.press(`#method-${id}`, 'Space');
  const related = `#related-${id}-ch1-source-standard-comparison`;
  await page.focus(related);
  const before = await readingSnapshot(page, sourcePage);
  await page.press(related, 'Enter');
  await settled(page);
  await page.waitForSelector('#location-ch1-source-standard-comparison');
  await page.click('.return-button');
  await settled(page);
  const returned = await readingSnapshot(page, sourcePage);
  assert.deepEqual(returned.methods, before.methods);
  assert.equal(returned.title, before.title);
  assert.equal(returned.expanded, before.expanded);
  assert.equal(returned.focus, related.slice(1));
  assert.equal(returned.highlight, before.highlight);
  assert.ok(Math.abs(returned.fraction - before.fraction) < .005);
  assert.ok(Math.abs(returned.panelScroll - before.panelScroll) < 2);
  await page.waitForFunction((key) => {
    const record = JSON.parse(localStorage.getItem(key));
    const currentPage = Number(document.querySelector('.page-index span').textContent.split('/')[0]);
    const paper = document.getElementById(`page-${currentPage}`).getBoundingClientRect();
    const viewport = document.querySelector('.paper-scroller').getBoundingClientRect();
    return record?.page === currentPage && Math.abs(record.fraction - (viewport.top - paper.top) / paper.height) < .005;
  }, readingKey);
  const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), readingKey);
  await page.reload();
  await page.waitForFunction(() => !!document.querySelector('.page-index'));
  const refreshed = await readingSnapshot(page, saved.page);
  assert.ok(Math.abs(refreshed.fraction - saved.fraction) < .005);
  assert.equal(await page.evaluate(() => !!document.querySelector('#supplement-panel, .return-button, .location-highlight')), false);
  await clickNoteMarker(page, id);
  assert.equal(await page.evaluate((id) => document.getElementById(`method-${id}`).getAttribute('aria-expanded'), id), 'false');
  console.log(`PASS full journey: file ${sourcePage} → explanation → keyboard method → related → return → refresh/resume`);
  return { before, returned, saved, refreshed };
}

async function locateCurrentNote(page, locationId) {
  assert.ok(locations.has(locationId), locationId);
  assert.equal(await page.evaluate(() => !!document.querySelector('[data-dirty="true"]')), false, 'Run locate checks without an existing user draft');
  const button = '#supplement-panel .supplement-heading .locate-button';
  await page.waitForSelector(button);
  assert.equal(await page.evaluate((selector) => document.querySelector(selector).disabled, button), false);
  await page.click(button);
  const method = await page.evaluate(() => document.querySelector('#supplement-panel .method-toggle')?.id);
  if (method && await page.evaluate((id) => document.getElementById(id).getAttribute('aria-expanded') === 'false', method)) await page.click(`#${method}`);
  await page.evaluate(() => {
    window.locateCheck = {
      editor: document.querySelector('.personal-note .cm-content'),
      panel: document.querySelector('#supplement-panel'),
      confirm: window.confirm,
      prompts: 0,
      clickScroll: [],
    };
    window.confirm = () => { window.locateCheck.prompts += 1; return false; };
    window.locateCheck.recordClick = (event) => {
      window.locateCheck.clickScroll.push({ event: event.type, scroll: window.locateCheck.panel.scrollTop });
    };
    const button = document.querySelector('#locate-supplement');
    button.addEventListener('pointerdown', window.locateCheck.recordClick, true);
    button.addEventListener('click', window.locateCheck.recordClick, true);
  });
  // CodeMirror measures and can scroll its caret on a later animation frame.
  const stablePanel = () => page.evaluate(() => new Promise((resolve, reject) => {
    let previous = '', stable = 0, frames = 0;
    function measure() {
      const panel = document.querySelector('#supplement-panel');
      const editor = document.querySelector('.personal-note .cm-content');
      if (!panel) { reject(new Error('Locate removed the panel before it settled')); return; }
      const geometry = JSON.stringify([panel.scrollTop, panel.scrollHeight, panel.clientHeight, editor?.getBoundingClientRect().height]);
      stable = geometry === previous ? stable + 1 : 0;
      previous = geometry;
      if (stable >= 4) resolve(panel.scrollTop);
      else if (++frames >= 120) reject(new Error(`Locate setup did not settle: ${geometry}`));
      else requestAnimationFrame(measure);
    }
    requestAnimationFrame(measure);
  }));
  const snapshot = () => page.evaluate(() => ({
    samePanel: document.querySelector('#supplement-panel') === window.locateCheck.panel,
    sameEditor: document.querySelector('.personal-note .cm-content') === window.locateCheck.editor,
    draft: document.querySelector('.personal-note .cm-content')?.textContent,
    dirty: !!document.querySelector('.personal-note [data-dirty="true"]'),
    prompts: window.locateCheck.prompts,
    panelScroll: document.querySelector('#supplement-panel').scrollTop,
    title: document.querySelector('#supplement-title').textContent,
    expanded: [...document.querySelectorAll('.supplement-accordion[open] summary')].map((summary) => summary.id),
    methods: [...document.querySelectorAll('.method-toggle[aria-expanded="true"]')].map((toggle) => toggle.id),
    back: !!document.querySelector('#supplement-panel .return-button'),
    highlight: [...document.querySelectorAll('.location-highlight:not(.preview-highlight)')].map((region) => region.id),
    stored: Object.fromEntries(Object.keys(localStorage).filter((key) => key.startsWith('textbook-personal-v1:')).map((key) => [key, localStorage.getItem(key)])),
  }));
  try {
    await stablePanel();
    await page.evaluate(() => {
      const panel = window.locateCheck.panel;
      panel.scrollTop = Math.min(96, panel.scrollHeight - panel.clientHeight);
    });
    await stablePanel();
    const before = await snapshot();
    await page.evaluate(() => {
      const scroller = document.querySelector('.paper-scroller');
      scroller.scrollTop += Math.max(scroller.clientHeight * 2, 640);
    });
    await page.waitForFunction((id) => {
      const target = document.getElementById(`location-${id}`).getBoundingClientRect();
      const viewport = document.querySelector('.paper-scroller').getBoundingClientRect();
      return target.bottom <= viewport.top || target.top >= viewport.bottom;
    }, locationId);
    await stablePanel();
    const beforeClick = await snapshot();
    assert.ok(Math.abs(beforeClick.panelScroll - before.panelScroll) < 2,
      `Test setup changed panel scroll before locate: setup=${before.panelScroll}, beforeClick=${beforeClick.panelScroll}`);
    // The sticky heading keeps this a real click without first scrolling the panel.
    await page.click(button);
    await page.waitForFunction((id) => {
      const target = document.getElementById(`location-${id}`)?.getBoundingClientRect();
      const viewport = document.querySelector('.paper-scroller').getBoundingClientRect();
      return !!target && target.bottom > viewport.top && target.top < viewport.bottom;
    }, locationId);
    await stablePanel();
    const after = await snapshot();
    const clickScroll = await page.evaluate(() => window.locateCheck.clickScroll);
    assert.ok(Math.abs(after.panelScroll - beforeClick.panelScroll) < 2,
      `Locate panel scroll: setup=${before.panelScroll}, beforeClick=${beforeClick.panelScroll}, events=${JSON.stringify(clickScroll)}, after=${after.panelScroll}`);
    assert.deepEqual({ ...after, panelScroll: beforeClick.panelScroll }, beforeClick, 'Locate preserves the panel, editor, draft, method, accordion, return control and stored personal content');
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'locate-supplement', 'Locate keeps keyboard focus on its button');
  } finally {
    await page.evaluate(() => {
      window.confirm = window.locateCheck.confirm;
      const button = document.querySelector('#locate-supplement');
      button?.removeEventListener('pointerdown', window.locateCheck.recordClick, true);
      button?.removeEventListener('click', window.locateCheck.recordClick, true);
      delete window.locateCheck;
    });
  }
}

export async function checkLocate(page, id = 'ch1-measurement-exercise') {
  await openNote(page, id);
  const location = chapter.supplements.find((note) => note.id === id).locationId;
  await locateCurrentNote(page, location);
  console.log(`PASS locate: ${id}; preserves panel state and scroll without editing personal content`);
}

// Choose an id whose marker is grouped at the current width.
export async function checkLocateGroup(page, id) {
  const note = chapter.supplements.find((item) => item.id === id);
  assert.ok(note, id);
  await jumpToFilePage(page, locations.get(note.locationId).page);
  await page.click(`[data-supplement-ids~="${id}"]`);
  assert.ok(await page.evaluate(() => document.querySelectorAll('.supplement-accordion').length > 1), 'Choose a grouped marker');
  assert.equal(await page.evaluate(() => document.querySelector('.locate-button').disabled), true, 'A group with no selected explanation cannot locate an arbitrary item');
  await page.click(`#choice-${id}`);
  await locateCurrentNote(page, note.locationId);
  await page.evaluate(() => { document.querySelector('#supplement-panel').scrollTop = 0; });
  await page.click(`#choice-${id}`);
  assert.equal(await page.evaluate(() => document.querySelector('.locate-button').disabled), true, 'Collapsing the selected explanation disables locate again');
  console.log(`PASS grouped locate: ${id}; disabled before selection, locates the expanded item and preserves its state`);
}

// This history-only case does not edit notes or write the personal-content key.
export async function checkLocateReturn(page) {
  assert.equal(await page.evaluate(() => !!document.querySelector('[data-dirty="true"]')), false);
  await openNote(page, 'ch1-exercise-1-1-8');
  const sources = [];
  for (const [id, target] of [['ch1-exercise-1-1-8', 'ch1-direction-exercise'], ['ch1-direction-exercise', 'ch1-number-line-distance']]) {
    const note = chapter.supplements.find((item) => item.id === id);
    const method = `#method-${id}`;
    if (await page.evaluate((selector) => document.querySelector(selector)?.getAttribute('aria-expanded') === 'false', method)) await page.click(method);
    const link = `#related-${id}-${target}`;
    await page.focus(link);
    sources.push({ page: locations.get(note.locationId).page, state: await readingSnapshot(page, locations.get(note.locationId).page) });
    await page.press(link, 'Enter');
    await settled(page);
    await page.waitForSelector(`#location-${target}`);
    await page.evaluate(() => {
      const scroller = document.querySelector('.paper-scroller');
      scroller.scrollTop += Math.max(scroller.clientHeight * 2, 640);
    });
    await page.waitForFunction((id) => {
      const region = document.getElementById(`location-${id}`).getBoundingClientRect();
      const viewport = document.querySelector('.paper-scroller').getBoundingClientRect();
      return region.bottom <= viewport.top || region.top >= viewport.bottom;
    }, target);
    await page.click('#locate-supplement');
    await page.waitForFunction((id) => {
      const region = document.getElementById(`location-${id}`)?.getBoundingClientRect();
      const viewport = document.querySelector('.paper-scroller').getBoundingClientRect();
      return !!region && region.bottom > viewport.top && region.top < viewport.bottom;
    }, target);
    assert.ok(await page.evaluate(() => !!document.querySelector('.return-button')), 'Locate retains the related-navigation return control');
  }
  for (const source of sources.reverse()) {
    await page.click('.return-button');
    await settled(page);
    const restored = await readingSnapshot(page, source.page);
    for (const key of ['title', 'expanded', 'focus', 'highlight', 'back']) assert.equal(restored[key], source.state[key], `Locate preserves return history: ${key}`);
    assert.deepEqual(restored.methods, source.state.methods);
    assert.ok(Math.abs(restored.fraction - source.state.fraction) < .005,
      `Return reading position on page ${source.page}: before=${source.state.fraction}, after=${restored.fraction}`);
    assert.ok(Math.abs(restored.panelScroll - source.state.panelScroll) < 2,
      `Return panel scroll on page ${source.page}: before=${source.state.panelScroll}, after=${restored.panelScroll}`);
  }
  console.log('PASS locate return history: two related jumps still return through both original sources');
}
